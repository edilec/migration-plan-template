const identifier = /^[A-Za-z0-9._-]{1,64}$/u;
const kinds = new Set(['prepare', 'backfill', 'verify', 'cutover', 'retire']);
const compatibility = new Set(['dual-run', 'backward-compatible', 'not-applicable']);
const rollback = new Set(['restore', 'reverse-switch', 'not-required']);
const checkpoints = new Set(['after', 'before-and-after']);
const evidenceCodes = new Set(['backup', 'compatibility-test', 'data-count', 'metric-baseline',
  'rollback-test', 'operator-review', 'dry-run', 'access-review']);
const stepFields = ['id', 'kind', 'owner', 'dependsOn', 'compatibility', 'rollback',
  'checkpoint', 'evidenceNeeds', 'destructive', 'cutoverOrder'];
const decisionFields = ['stepId', 'recordId', 'reviewerRole', 'outcome'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const knownKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const safeId = value => typeof value === 'string' && identifier.test(value);

export function validateRequirements(document, bounds, add) {
  let invalid = false;
  let issueCount = 0;
  const issue = (ruleId, pointer, message) => {
    invalid = true;
    issueCount++;
    add(ruleId, pointer, message);
  };
  if (!record(document) || document.schemaVersion !== '1' ||
      !Array.isArray(document.steps) || !Array.isArray(document.decisions) ||
      !knownKeys(document, ['schemaVersion', 'steps', 'decisions'])) {
    issue('requirements-invalid', '/', 'Saved requirements have an unsupported envelope.');
    return { valid: false, steps: [], decisions: [], decisionByStep: new Map(), checked: 0 };
  }
  const { steps, decisions } = document;
  if (steps.length === 0) issue('requirements-empty', '/steps', 'No migration steps were declared.');
  if (steps.length > bounds.maxSteps) issue('limit-exceeded', '/limits/maxSteps', 'Step count exceeds limit.');
  if (decisions.length > bounds.maxDecisions) issue('limit-exceeded', '/limits/maxDecisions', 'Decision count exceeds limit.');
  if (steps.length > bounds.maxSteps || decisions.length > bounds.maxDecisions) {
    return { valid: false, steps: [], decisions: [], decisionByStep: new Map(), checked: 0 };
  }
  const ids = new Set();
  let checked = 0;
  for (const [index, item] of steps.entries()) {
    const pointer = `/steps/${index}`;
    const before = issueCount;
    if (!record(item) || !knownKeys(item, stepFields)) {
      issue('step-unsupported', pointer, 'Step contains unsupported fields or shape.');
      if (!record(item)) continue;
    }
    if (!safeId(item.id)) issue('step-unsupported', `${pointer}/id`, 'Step identity is missing or unsupported.');
    else if (ids.has(item.id)) issue('step-duplicate', `${pointer}/id`, 'Step identity is duplicated.');
    else ids.add(item.id);
    if (!safeId(item.owner)) issue('owner-missing', `${pointer}/owner`, 'Step ownership is missing or unsupported.');
    if (!kinds.has(item.kind)) issue('step-unsupported', `${pointer}/kind`, 'Step kind is unsupported.');
    if (!compatibility.has(item.compatibility)) {
      issue('step-unsupported', `${pointer}/compatibility`, 'Compatibility declaration is unsupported.');
    }
    if (!rollback.has(item.rollback)) issue('step-unsupported', `${pointer}/rollback`, 'Rollback declaration is unsupported.');
    if (!checkpoints.has(item.checkpoint)) {
      issue('step-unsupported', `${pointer}/checkpoint`, 'Checkpoint declaration is unsupported.');
    }
    if (typeof item.destructive !== 'boolean') {
      issue('step-unsupported', `${pointer}/destructive`, 'Destructive classification is unavailable.');
    } else {
      if (['cutover', 'retire'].includes(item.kind) && !item.destructive) {
        issue('destructive-underdeclared', `${pointer}/destructive`, 'Operation requires destructive review.');
      }
      if (item.destructive && (item.rollback === 'not-required' || item.checkpoint !== 'before-and-after')) {
        issue('step-unsupported', pointer, 'Destructive step lacks rollback or before-and-after checkpoint.');
      }
    }
    if (!Array.isArray(item.dependsOn)) {
      issue('step-unsupported', `${pointer}/dependsOn`, 'Dependency list is unavailable.');
    } else if (item.dependsOn.length > bounds.maxDependencies) {
      issue('limit-exceeded', '/limits/maxDependencies', 'Dependencies per step exceed limit.');
    } else {
      const seen = new Set();
      for (const [depIndex, dependency] of item.dependsOn.entries()) {
        if (!safeId(dependency) || seen.has(dependency) || dependency === item.id) {
          issue('step-unsupported', `${pointer}/dependsOn/${depIndex}`, 'Dependency identity is unsupported.');
        }
        seen.add(dependency);
      }
    }
    if (!Array.isArray(item.evidenceNeeds) || item.evidenceNeeds.length === 0) {
      issue('evidence-unsupported', `${pointer}/evidenceNeeds`, 'Evidence needs are unavailable.');
    } else if (item.evidenceNeeds.length > bounds.maxEvidenceCodes) {
      issue('limit-exceeded', '/limits/maxEvidenceCodes', 'Evidence-code count exceeds limit.');
    } else {
      const seen = new Set();
      for (const [codeIndex, code] of item.evidenceNeeds.entries()) {
        if (!evidenceCodes.has(code) || seen.has(code)) {
          issue('evidence-unsupported', `${pointer}/evidenceNeeds/${codeIndex}`, 'Evidence code is unsupported or duplicated.');
        }
        seen.add(code);
      }
    }
    if (item.kind === 'cutover') {
      const order = item.cutoverOrder;
      if (typeof order !== 'string' || !/^[1-9][0-9]?$/u.test(order) || Number(order) > 64) {
        issue('cutover-ambiguous', `${pointer}/cutoverOrder`, 'Cutover order is unavailable or unsupported.');
      }
    } else if (item.cutoverOrder !== null) {
      issue('step-unsupported', `${pointer}/cutoverOrder`, 'Non-cutover step declares cutover order.');
    }
    if (before === issueCount) checked++;
  }
  const decisionByStep = new Map();
  const seenRecords = new Set();
  for (const [index, item] of decisions.entries()) {
    const pointer = `/decisions/${index}`;
    if (!record(item) || !knownKeys(item, decisionFields)) {
      issue('decision-invalid', pointer, 'Review record contains unsupported fields or shape.');
      if (!record(item)) continue;
    }
    if (!safeId(item.stepId) || !ids.has(item.stepId) ||
        !steps.some(step => record(step) && step.id === item.stepId && step.destructive === true)) {
      issue('decision-invalid', `${pointer}/stepId`, 'Review record does not name a destructive step.');
    } else if (decisionByStep.has(item.stepId)) {
      issue('decision-duplicate', `${pointer}/stepId`, 'More than one review record targets the same step.');
    } else decisionByStep.set(item.stepId, index);
    if (!safeId(item.recordId)) {
      issue('decision-invalid', `${pointer}/recordId`, 'Review record identity is missing or unsupported.');
    } else if (seenRecords.has(item.recordId)) {
      issue('decision-duplicate', `${pointer}/recordId`, 'Review record identity is duplicated.');
    } else seenRecords.add(item.recordId);
    if (!safeId(item.reviewerRole)) {
      issue('decision-invalid', `${pointer}/reviewerRole`, 'Reviewer role is missing or unsupported.');
    }
    if (!['approved', 'rejected'].includes(item.outcome)) {
      issue('decision-invalid', `${pointer}/outcome`, 'Review outcome is unsupported.');
    }
  }
  return { valid: !invalid, steps, decisions, decisionByStep, checked };
}
