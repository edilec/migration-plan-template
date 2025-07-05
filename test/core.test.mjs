import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan } from '../src/index.mjs';

const step = (overrides = {}) => ({
  id: 'phaseA', kind: 'prepare', owner: 'platformRole', dependsOn: [],
  compatibility: 'not-applicable', rollback: 'not-required',
  checkpoint: 'after', evidenceNeeds: ['operator-review'],
  destructive: false, cutoverOrder: null, ...overrides,
});
const clean = () => ({ schemaVersion: '1', steps: [step()], decisions: [] });
const cutover = (id, order, overrides = {}) => step({
  id, kind: 'cutover', compatibility: 'dual-run', rollback: 'reverse-switch',
  checkpoint: 'before-and-after', evidenceNeeds: ['backup', 'operator-review'],
  destructive: true, cutoverOrder: order, ...overrides,
});
const decision = (stepId, recordId, outcome = 'approved') => ({
  stepId, recordId, reviewerRole: 'changeReviewer', outcome,
});

test('complete one-step requirements produce a quiet located plan without raw labels', () => {
  const report = generatePlan(clean(), { now: () => 0 });
  assert.equal(report.tool, 'migration-plan-template');
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.summary, { checked: 1, errors: 0, warnings: 0, steps: 1, decisions: 0, cutovers: 0 });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.plan, [{
    stepOrdinal: 1, sourcePointer: '/steps/0', kind: 'prepare', dependsOnOrdinals: [],
    ownerPointer: '/steps/0/owner', compatibility: 'not-applicable',
    rollback: 'not-required', checkpoint: 'after', evidenceNeeds: ['operator-review'],
    destructive: false, cutoverOrder: null, decision: 'not-required', decisionPointer: null,
  }]);
  const output = JSON.stringify(report);
  assert.equal(output.includes('phaseA'), false);
  assert.equal(output.includes('platformRole'), false);
});

test('independent cutovers exported in reverse source order still follow declared order', () => {
  const document = { schemaVersion: '1',
    steps: [cutover('second', '2'), cutover('first', '1')],
    decisions: [decision('second', 'reviewB'), decision('first', 'reviewA')] };
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.plan.map(row => row.stepOrdinal), [2, 1]);
  assert.deepEqual(report.plan.map(row => row.decisionPointer), ['/decisions/1', '/decisions/0']);
  assert.deepEqual(report.plan.map(row => row.decision), ['recorded-approved', 'recorded-approved']);
  assert.equal(JSON.stringify(report).includes('changeReviewer'), false);
});

test('an indirect dependency contradicting cutover order is incomplete without a settled plan', () => {
  const document = { schemaVersion: '1', steps: [
    cutover('first', '1', { dependsOn: ['gate'] }),
    step({ id: 'gate', kind: 'verify', dependsOn: ['second'] }),
    cutover('second', '2'),
  ], decisions: [decision('first', 'reviewA'), decision('second', 'reviewB')] };
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.plan, []);
  assert.ok(report.findings.some(f => f.ruleId === 'cutover-ambiguous' && f.location.pointer === '/steps/0/cutoverOrder'));
});

test('each destructive step requires its own reviewed decision record', () => {
  const document = { schemaVersion: '1', steps: [cutover('first', '1')], decisions: [] };
  let report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'decision-missing' && f.location.pointer === '/steps/0'));
  document.decisions.push(decision('first', 'reviewA'));
  report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.equal(report.plan[0].decision, 'recorded-approved');
  assert.equal(report.plan[0].decisionPointer, '/decisions/0');
});

test('a recorded rejection is a known failure, not an unknown approval', () => {
  const document = { schemaVersion: '1', steps: [cutover('first', '1')],
    decisions: [decision('first', 'reviewA', 'rejected')] };
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'fail');
  assert.deepEqual(report.findings.map(f => [f.ruleId, f.severity, f.location.pointer]),
    [['decision-rejected', 'error', '/decisions/0/outcome']]);
  assert.equal(report.plan[0].decision, 'recorded-rejected');
});

test('one review record identity cannot stand in for two destructive decisions', () => {
  const document = { schemaVersion: '1', steps: [cutover('first', '1'), cutover('second', '2')],
    decisions: [decision('first', 'reviewA'), decision('second', 'reviewA')] };
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'decision-duplicate' && f.location.pointer === '/decisions/1/recordId'));
  assert.equal(JSON.stringify(report).includes('reviewA'), false);
});

test('missing ownership never becomes a settled plan', () => {
  const document = clean();
  delete document.steps[0].owner;
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.plan, []);
  assert.ok(report.findings.some(f => f.ruleId === 'owner-missing' && f.location.pointer === '/steps/0/owner'));
  assert.equal(generatePlan(clean(), { now: () => 0 }).status, 'pass');
});

test('a later valid step stays counted when an earlier step is incomplete', () => {
  const document = { schemaVersion: '1', steps: [step({ id: 'first', owner: '' }),
    step({ id: 'second' })], decisions: [] };
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.summary.checked, 1);
  assert.deepEqual(report.plan, []);
});

test('unknown fields and empty steps remain incomplete without exposing their text', () => {
  const document = clean();
  document.steps[0].untrusted = 'SYNTHETIC_SECRET_CANARY';
  let report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.plan, []);
  assert.ok(report.findings.some(f => f.ruleId === 'step-unsupported' && f.location.pointer === '/steps/0'));
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET_CANARY'), false);
  report = generatePlan({ schemaVersion: '1', steps: [], decisions: [] }, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.summary.checked, 0);
  assert.ok(report.findings.some(f => f.ruleId === 'requirements-empty'));
});

test('unsupported evidence needs are incomplete and never echoed', () => {
  const document = clean();
  document.steps[0].evidenceNeeds = ['SYNTHETIC_SECRET_CANARY'];
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.plan, []);
  assert.ok(report.findings.some(f => f.ruleId === 'evidence-unsupported' && f.location.pointer === '/steps/0/evidenceNeeds/0'));
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET_CANARY'), false);
});

test('a cutover cannot be declared non-destructive to bypass review', () => {
  const document = { schemaVersion: '1', steps: [cutover('first', '1', { destructive: false })], decisions: [] };
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'destructive-underdeclared' && f.location.pointer === '/steps/0/destructive'));
});

test('unsupported decision outcome cannot satisfy a destructive review', () => {
  const document = { schemaVersion: '1', steps: [cutover('first', '1')],
    decisions: [decision('first', 'reviewA', 'SYNTHETIC_SECRET_CANARY')] };
  const report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.plan, []);
  assert.ok(report.findings.some(f => f.ruleId === 'decision-invalid' && f.location.pointer === '/decisions/0/outcome'));
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET_CANARY'), false);
});

test('step and decision counts accept N and refuse N plus one', () => {
  const document = clean();
  document.steps = Array.from({ length: 128 }, (_, index) => step({ id: `phase${index}` }));
  let report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.checked, 128);
  document.steps.push(step({ id: 'phase128' }));
  report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxSteps'));

  const decisions = clean();
  decisions.steps = Array.from({ length: 96 }, (_, index) => step({ id: `phase${index}`,
    kind: 'backfill', destructive: true, rollback: 'restore', checkpoint: 'before-and-after' }));
  decisions.decisions = decisions.steps.map((item, index) => decision(item.id, `review${index}`));
  report = generatePlan(decisions, { now: () => 0 });
  assert.equal(report.status, 'pass');
  decisions.steps.push(step({ id: 'phase96', kind: 'backfill', destructive: true,
    rollback: 'restore', checkpoint: 'before-and-after' }));
  decisions.decisions.push(decision('phase96', 'review96'));
  report = generatePlan(decisions, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxDecisions'));
});

test('dependencies and evidence-code counts accept N and refuse N plus one', () => {
  const document = clean();
  document.steps = Array.from({ length: 17 }, (_, index) => step({ id: `parent${index}` }));
  document.steps.push(step({ id: 'child', dependsOn: document.steps.slice(0, 16).map(item => item.id) }));
  let report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  document.steps[17].dependsOn.push('parent16');
  report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxDependencies'));

  const evidence = clean();
  evidence.steps[0].evidenceNeeds = ['backup', 'compatibility-test', 'data-count',
    'metric-baseline', 'rollback-test', 'operator-review'];
  assert.equal(generatePlan(evidence, { now: () => 0 }).status, 'pass');
  evidence.steps[0].evidenceNeeds.push('dry-run');
  report = generatePlan(evidence, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/maxEvidenceCodes'));
});

test('identifier bounds accept their legal edge and refuse the next value', () => {
  const document = clean();
  document.steps[0].id = 'x'.repeat(64);
  document.steps[0].owner = 'r'.repeat(64);
  assert.equal(generatePlan(document, { now: () => 0 }).status, 'pass');
  document.steps[0].id += 'x';
  let report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'step-unsupported' && f.location.pointer === '/steps/0/id'));
  document.steps[0].id = 'phaseA';
  document.steps[0].owner += 'r';
  report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'owner-missing' && f.location.pointer === '/steps/0/owner'));
});

test('cutover-order bound allows 64 ordered reviews and refuses order 65', () => {
  const document = { schemaVersion: '1',
    steps: Array.from({ length: 64 }, (_, index) => cutover(`cut${index}`, String(index + 1))),
    decisions: Array.from({ length: 64 }, (_, index) => decision(`cut${index}`, `review${index}`)) };
  let report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.equal(report.plan.length, 64);
  document.steps.push(cutover('cut64', '65'));
  document.decisions.push(decision('cut64', 'review64'));
  report = generatePlan(document, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'cutover-ambiguous' && f.location.pointer === '/steps/64/cutoverOrder'));
});

test('injected finite monotone clock allows exact deadline and refuses N plus one', () => {
  const clock = end => { let calls = 0; return () => calls++ === 0 ? 0 : end; };
  assert.equal(generatePlan(clean(), { now: clock(2000) }).status, 'pass');
  let report = generatePlan(clean(), { now: clock(2001) });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/timeoutMs'));
  report = generatePlan(clean(), { now: () => NaN });
  assert.equal(report.status, 'incomplete');
  assert.ok(report.findings.some(f => f.ruleId === 'clock-invalid'));
  const backward = (() => { let calls = 0; return () => calls++ === 0 ? 1 : 0; })();
  assert.equal(generatePlan(clean(), { now: backward }).status, 'incomplete');
});
