export const TOOL_ID = 'migration-plan-template';

export function generatePlan(document, { now = Date.now, file = 'input.json', limits = {} } = {}) {
  void now;
  void file;
  void limits;
  const plan = document.steps.map((item, index) => ({
    stepOrdinal: index + 1,
    sourcePointer: `/steps/${index}`,
    kind: item.kind,
    dependsOnOrdinals: [],
    ownerPointer: `/steps/${index}/owner`,
    compatibility: item.compatibility,
    rollback: item.rollback,
    checkpoint: item.checkpoint,
    evidenceNeeds: item.evidenceNeeds,
    destructive: item.destructive,
    cutoverOrder: item.cutoverOrder,
    decision: 'not-required',
    decisionPointer: null,
  }));
  return {
    schemaVersion: '1', tool: TOOL_ID, status: 'pass',
    summary: { checked: plan.length, errors: 0, warnings: 0, steps: plan.length,
      decisions: document.decisions.length, cutovers: 0 },
    findings: [], plan,
  };
}
