# Migration Plan Template

This offline reporter turns one explicit saved migration-requirements document
into an ordered review plan. It helps an operator see dependencies, cutover
sequence, compatibility and rollback declarations, checkpoints, evidence needs,
and the separately recorded decision for each destructive step. It never runs a
migration. A `recorded-approved` row means only that the input **asserts** a
review record; it is not authorization or a safety certification.

## Quick start

Node.js 22 or newer is required. There are no runtime or development packages.

```sh
node bin/migration-plan-template.mjs --root examples/clean --input input.json
node bin/migration-plan-template.mjs --root examples/failing --input input.json
node bin/migration-plan-template.mjs --root examples/incomplete --input input.json --json
npm run check
```

The examples exit 0 (complete plan), 1 (recorded rejection) and 2 (missing
ownership). `--help` prints usage. The default CLI writes one JSON report to
stdout and fixed counts to stderr; `--json` suppresses only those human counts.
There is no report-file mode: no input, migration or other file is modified.

## Supported requirements document

`--root` names an existing directory; `--input` is a safe relative UTF-8 JSON
file inside its real path. A symlinked input alias or an outside-root target is
refused. The document has exactly `schemaVersion: "1"`, a nonempty `steps`
array, and a `decisions` array. The clean example is runnable; a compact shape
is:

```json
{
  "schemaVersion": "1",
  "steps": [{
    "id": "switch", "kind": "cutover", "owner": "platformRole", "dependsOn": [],
    "compatibility": "dual-run", "rollback": "reverse-switch",
    "checkpoint": "before-and-after", "evidenceNeeds": ["backup"],
    "destructive": true, "cutoverOrder": "1"
  }],
  "decisions": [{
    "stepId": "switch", "recordId": "reviewOne",
    "reviewerRole": "changeReviewer", "outcome": "approved"
  }]
}
```

`id`, `owner`, `stepId`, `recordId`, and `reviewerRole` are opaque ASCII
identifiers of 1–64 units (`A–Z`, `a–z`, digits, `.`, `_`, `-`). They are
matched exactly but never printed. Supported step kinds are `prepare`,
`backfill`, `verify`, `cutover`, `retire`. A backfill is additive in this
profile; mark it destructive if it may replace or remove existing data.
Cutovers and retirements must always be marked destructive. Compatibility is
`dual-run`, `backward-compatible`, or `not-applicable`; rollback is `restore`,
`reverse-switch`, or `not-required`; checkpoint is `after` or
`before-and-after`. A destructive step needs a real rollback declaration and
a before-and-after checkpoint. At least one unique evidence-need code is
required from `backup`, `compatibility-test`, `data-count`, `metric-baseline`,
`rollback-test`, `operator-review`, `dry-run`, `access-review`.

Each destructive step needs its **own** decision row with a unique `recordId`.
Outcomes are `approved` or `rejected`; the tool does not authenticate either
assertion. A missing decision is unknown, while a recorded rejection is a
known blocked plan. Non-destructive steps do not take decision rows. `cutoverOrder`
is a decimal string 1–64 for cutovers and `null` otherwise. Orders must be
distinct and contiguous from 1. Adjacent orders constrain the dependency
graph, including indirect paths through non-cutover steps; an ambiguous or
cyclic sequence is incomplete rather than arbitrarily sorted.

The report's `plan` rows contain source ordinals and pointers, fixed typed
declarations, dependency ordinals and decision pointers—not opaque step,
owner or reviewer names, prose, credentials or unkeyed digests. The relative
named input path appears only as `location.file`. The operator should inspect
the source positions before any actual change. Structural or sequencing
uncertainty leaves `plan` empty; a missing review decision can appear as
`decision: "missing"` in an otherwise ordered but incomplete plan.

## Rules and exit codes

| Rule | Observation | Severity / result |
| --- | --- | --- |
| `decision-rejected` | Export records a rejected destructive step. | error; complete evidence fails, exit 1 |
| `decision-missing`, `decision-invalid`, `decision-duplicate` | A destructive review record is absent, unsupported, duplicated, or points elsewhere. | warning; incomplete, exit 2 |
| `cutover-ambiguous`, `dependency-unresolved`, `dependency-cycle` | A safe complete sequence cannot be established. | warning; incomplete, exit 2 |
| `owner-missing`, `destructive-underdeclared`, `step-unsupported`, `step-duplicate`, `evidence-unsupported` | Required step evidence is absent or unsupported. | warning; incomplete, exit 2 |
| `requirements-invalid`, `requirements-empty`, `limit-exceeded`, `clock-invalid` | Input envelope, subject or analysis is unavailable. | warning; incomplete, exit 2 |
| `input-unreadable`, `input-invalid`, `path-outside-root`, `input-alias-unsupported` | Named input could not safely provide evidence. | warning; incomplete, exit 2 |

Exit 0 is `pass` only for complete nonempty evidence and no recorded rejection.
Exit 1 is `fail` for a known rejection on complete evidence. Exit 2 is
`incomplete` when evidence, sequence or analysis is unknown, even if a known
rejection is also visible. A malformed/unreadable named input returns an
incomplete JSON report. Invalid CLI configuration (including an unknown flag
or a root that is not a directory) exits 2 with **empty stdout** and a fixed
stderr diagnostic. No untrusted input text is copied into human output.

## Limits and non-goals

The defaults are 1,048,576 input bytes, 128 steps, 96 decision records, 16
dependencies per step, 6 evidence codes per step, 64 cutover positions, 32
JSON depth levels, 50,000 JSON nodes, and 2,000 elapsed milliseconds. A value
at its bound is permitted; N+1 is incomplete. JSON numeric tokens are refused
because the profile uses decimal strings and has no numeric field. Duplicate
JSON keys and invalid UTF-8 are refused before interpretation. Library callers
can lower analysis bounds and inject a finite, monotone clock. Findings sort by
UTF-16 code unit; identical inputs produce byte-identical stdout.

This tool does not inspect live systems, verify that backups or rollback
procedures work, authenticate people or reviews, execute or schedule a step,
read Git, access a database, contact a network host, or generate commands. The
plan is a document for human review, never an action queue.
