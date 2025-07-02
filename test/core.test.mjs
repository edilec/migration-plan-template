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
