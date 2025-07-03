export const TOOL_ID = 'migration-plan-template';
export class ConfigError extends Error {}

const RULE_SEVERITY = Object.freeze({
  'cutover-ambiguous': 'warning',
  'dependency-unresolved': 'warning',
  'dependency-cycle': 'warning',
  'decision-missing': 'warning',
  'decision-duplicate': 'warning',
  'decision-rejected': 'error',
});
const byCodeUnit = (a, b) => a === b ? 0 : a < b ? -1 : 1;

export function generatePlan(document, { now = Date.now, file = 'input.json', limits = {} } = {}) {
  void now;
  void limits;
  const findings = [];
  let incomplete = false;
  const add = (ruleId, pointer, message) => {
    const severity = RULE_SEVERITY[ruleId];
    if (!severity) throw Error('Unknown report rule.');
    findings.push({ ruleId, severity, message, location: { file, pointer } });
    if (severity === 'warning') incomplete = true;
  };
  const steps = document.steps;
  const decisions = document.decisions;
  const decisionByStep = new Map();
  const seenRecords = new Set();
  for (const [index, item] of decisions.entries()) {
    if (decisionByStep.has(item.stepId)) {
      add('decision-duplicate', `/decisions/${index}/stepId`, 'More than one review record targets the same step.');
    } else decisionByStep.set(item.stepId, index);
    if (seenRecords.has(item.recordId)) {
      add('decision-duplicate', `/decisions/${index}/recordId`, 'Review record identity is duplicated.');
    } else seenRecords.add(item.recordId);
  }
  for (const [index, item] of steps.entries()) {
    if (!item.destructive) continue;
    const decisionIndex = decisionByStep.get(item.id);
    if (decisionIndex === undefined) {
      add('decision-missing', `/steps/${index}`, 'Destructive step has no separate review record.');
    } else if (decisions[decisionIndex].outcome === 'rejected') {
      add('decision-rejected', `/decisions/${decisionIndex}/outcome`, 'Export records a rejected destructive step.');
    }
  }
  const idToIndex = new Map(steps.map((item, index) => [item.id, index]));
  const outgoing = steps.map(() => new Set());
  const indegree = steps.map(() => 0);
  let graphUnknown = false;
  const edge = (before, after) => {
    if (!outgoing[before].has(after)) {
      outgoing[before].add(after);
      indegree[after]++;
    }
  };
  for (const [index, item] of steps.entries()) {
    for (const dependency of item.dependsOn) {
      const before = idToIndex.get(dependency);
      if (before === undefined) {
        graphUnknown = true;
        add('dependency-unresolved', `/steps/${index}/dependsOn`, 'Declared dependency is unavailable.');
      } else edge(before, index);
    }
  }
  const cutovers = steps.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === 'cutover')
    .sort((a, b) => Number(a.item.cutoverOrder) - Number(b.item.cutoverOrder));
  const orders = cutovers.map(({ item }) => item.cutoverOrder);
  if (orders.some((order, index) => order !== String(index + 1))) {
    graphUnknown = true;
    add('cutover-ambiguous', `/steps/${cutovers[0]?.index ?? 0}/cutoverOrder`,
      'Cutover sequence is missing, duplicated or unsupported.');
  } else for (let index = 1; index < cutovers.length; index++) {
    edge(cutovers[index - 1].index, cutovers[index].index);
  }
  const ordered = [];
  const used = new Set();
  while (ordered.length < steps.length) {
    const next = indegree.findIndex((count, index) => count === 0 && !used.has(index));
    if (next === -1) break;
    used.add(next);
    ordered.push(next);
    for (const after of outgoing[next]) indegree[after]--;
  }
  if (ordered.length !== steps.length) {
    graphUnknown = true;
    if (cutovers.length > 1) add('cutover-ambiguous', `/steps/${cutovers[0].index}/cutoverOrder`,
      'Cutover sequence contradicts the dependency graph.');
    else add('dependency-cycle', '/steps', 'Declared dependencies do not form a sequence.');
  }
  const plan = graphUnknown ? [] : ordered.map(index => {
    const item = steps[index];
    const decisionIndex = decisionByStep.get(item.id);
    return { stepOrdinal: index + 1, sourcePointer: `/steps/${index}`, kind: item.kind,
      dependsOnOrdinals: item.dependsOn.map(id => idToIndex.get(id) + 1).sort((a, b) => a - b),
      ownerPointer: `/steps/${index}/owner`, compatibility: item.compatibility,
      rollback: item.rollback, checkpoint: item.checkpoint, evidenceNeeds: item.evidenceNeeds,
      destructive: item.destructive, cutoverOrder: item.cutoverOrder,
      decision: item.destructive ? decisionIndex === undefined ? 'missing'
        : `recorded-${decisions[decisionIndex].outcome}` : 'not-required',
      decisionPointer: decisionIndex === undefined ? null : `/decisions/${decisionIndex}` };
  });
  findings.sort((a, b) => byCodeUnit(a.location.file, b.location.file) ||
    byCodeUnit(a.location.pointer, b.location.pointer) || byCodeUnit(a.ruleId, b.ruleId));
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.filter(finding => finding.severity === 'warning').length;
  return { schemaVersion: '1', tool: TOOL_ID, status: incomplete ? 'incomplete' : errors ? 'fail' : 'pass',
    summary: { checked: steps.length, errors, warnings,
      steps: steps.length, decisions: document.decisions.length, cutovers: cutovers.length },
    findings, plan };
}
