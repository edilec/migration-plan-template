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
