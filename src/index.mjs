import { validateRequirements } from './validation.mjs';

export const TOOL_ID = 'migration-plan-template';
const REPORT_FILE = 'input';
export class ConfigError extends Error {}
export const MAX_INPUT_BYTES = 1048576;
export const DEFAULT_LIMITS = Object.freeze({
  maxSteps: 128, maxDecisions: 96, maxDependencies: 16,
  maxEvidenceCodes: 6, timeoutMs: 2000,
});

const RULE_SEVERITY = Object.freeze({
  'requirements-invalid': 'warning',
  'requirements-empty': 'warning',
  'step-unsupported': 'warning',
  'step-duplicate': 'warning',
  'owner-missing': 'warning',
  'evidence-unsupported': 'warning',
  'destructive-underdeclared': 'warning',
  'decision-invalid': 'warning',
  'decision-duplicate': 'warning',
  'decision-missing': 'warning',
  'decision-rejected': 'error',
  'dependency-unresolved': 'warning',
  'dependency-cycle': 'warning',
  'cutover-ambiguous': 'warning',
  'limit-exceeded': 'warning',
  'clock-invalid': 'warning',
  'input-unreadable': 'warning',
  'input-invalid': 'warning',
  'path-outside-root': 'warning',
  'input-alias-unsupported': 'warning',
});
const byCodeUnit = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const safePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
export const isSafePath = value => typeof value === 'string' && value.length <= 256 && safePath.test(value) &&
  !value.split('/').some(part => !part || part === '.');

function checkedLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new ConfigError('Invalid limits.');
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[key]) {
      throw new ConfigError('Invalid limit.');
    }
  }
  return { ...DEFAULT_LIMITS, ...limits };
}

export function incompleteInput(ruleId, pointer = '') {
  if (!['input-unreadable', 'input-invalid', 'path-outside-root',
    'input-alias-unsupported', 'limit-exceeded'].includes(ruleId)) throw new ConfigError('Invalid input report.');
  const message = {
    'input-unreadable': 'Named requirements could not be read or decoded.',
    'input-invalid': 'Named requirements are not supported JSON.',
    'path-outside-root': 'Named requirements resolve outside the declared root.',
    'input-alias-unsupported': 'Named requirements are an alias with ambiguous provenance.',
    'limit-exceeded': 'Named requirements exceed the byte limit.',
  }[ruleId];
  return { schemaVersion: '1', tool: TOOL_ID, status: 'incomplete',
    summary: { checked: 0, errors: 0, warnings: 1, steps: 0, decisions: 0, cutovers: 0 },
    findings: [{ ruleId, severity: RULE_SEVERITY[ruleId], message,
      location: { file: REPORT_FILE, ...(pointer ? { pointer } : {}) } }], plan: [] };
}

export function generatePlan(document, { now = Date.now, limits = {} } = {}) {
  if (typeof now !== 'function') throw new ConfigError('Invalid clock.');
  const bounds = checkedLimits(limits);
  const findings = [];
  let incomplete = false;
  const add = (ruleId, pointer, message) => {
    const severity = RULE_SEVERITY[ruleId];
    if (!severity) throw Error('Unknown report rule.');
    findings.push({ ruleId, severity, message, location: { file: REPORT_FILE, pointer } });
    if (severity === 'warning') incomplete = true;
  };
  let start;
  let last;
  try {
    start = now();
    if (!Number.isFinite(start)) throw Error();
    last = start;
  } catch { add('clock-invalid', '/clock', 'Injected clock did not return a finite value.'); }
  const tick = () => {
    if (!Number.isFinite(start)) return false;
    let current;
    try { current = now(); } catch { current = NaN; }
    if (!Number.isFinite(current) || current < last) {
      if (!findings.some(f => f.ruleId === 'clock-invalid')) {
        add('clock-invalid', '/clock', 'Injected clock is not finite and monotone.');
      }
      return false;
    }
    last = current;
    if (current - start > bounds.timeoutMs) {
      if (!findings.some(f => f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/timeoutMs')) {
        add('limit-exceeded', '/limits/timeoutMs', 'Analysis deadline exceeded.');
      }
      return false;
    }
    return true;
  };
  let validated;
  try { validated = validateRequirements(document, bounds, add); }
  catch {
    add('requirements-invalid', '/', 'Saved requirements could not be evaluated.');
    validated = { valid: false, steps: [], decisions: [], decisionByStep: new Map(), checked: 0 };
  }
  const { steps, decisions, decisionByStep } = validated;
  for (const [index, item] of steps.entries()) {
    if (!item || typeof item !== 'object' || item.destructive !== true) continue;
    const decisionIndex = decisionByStep.get(item.id);
    if (decisionIndex === undefined && validated.valid) {
      add('decision-missing', `/steps/${index}`, 'Destructive step has no separate review record.');
    } else if (decisions[decisionIndex]?.outcome === 'rejected') {
      add('decision-rejected', `/decisions/${decisionIndex}/outcome`, 'Export records a rejected destructive step.');
    }
  }
  let plan = [];
  let graphUnknown = !validated.valid || !tick();
  if (!graphUnknown) {
    const idToIndex = new Map(steps.map((item, index) => [item.id, index]));
    const outgoing = steps.map(() => new Set());
    const indegree = steps.map(() => 0);
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
        'Cutover sequence is missing or duplicated.');
    } else for (let index = 1; index < cutovers.length; index++) {
      edge(cutovers[index - 1].index, cutovers[index].index);
    }
    const ordered = [];
    const used = new Set();
    while (ordered.length < steps.length && tick()) {
      const next = indegree.findIndex((count, index) => count === 0 && !used.has(index));
      if (next === -1) break;
      used.add(next);
      ordered.push(next);
      for (const after of outgoing[next]) indegree[after]--;
    }
    if (ordered.length !== steps.length && !findings.some(f => f.ruleId === 'clock-invalid' ||
      (f.ruleId === 'limit-exceeded' && f.location.pointer === '/limits/timeoutMs'))) {
      graphUnknown = true;
      if (cutovers.length > 1) add('cutover-ambiguous', `/steps/${cutovers[0].index}/cutoverOrder`,
        'Cutover sequence contradicts the dependency graph.');
      else add('dependency-cycle', '/steps', 'Declared dependencies do not form a sequence.');
    }
    if (ordered.length !== steps.length) graphUnknown = true;
    if (!graphUnknown) plan = ordered.map(index => {
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
  }
  if (!tick()) plan = [];
  findings.sort((a, b) => byCodeUnit(a.location.file, b.location.file) ||
    byCodeUnit(a.location.pointer, b.location.pointer) || byCodeUnit(a.ruleId, b.ruleId));
  const errors = findings.filter(finding => finding.severity === 'error').length;
  const warnings = findings.filter(finding => finding.severity === 'warning').length;
  const declaredLength = key => {
    try { return Array.isArray(document?.[key]) ? document[key].length : 0; }
    catch { return 0; }
  };
  return { schemaVersion: '1', tool: TOOL_ID, status: incomplete ? 'incomplete' : errors ? 'fail' : 'pass',
    summary: { checked: validated.checked, errors, warnings,
      steps: declaredLength('steps'), decisions: declaredLength('decisions'),
      cutovers: steps.filter(item => item?.kind === 'cutover').length },
    findings, plan };
}
