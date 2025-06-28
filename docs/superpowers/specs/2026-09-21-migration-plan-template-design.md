# Migration Plan Template design

## Purpose and trust boundary

This tool turns one saved, explicit local migration-requirements document into a
structured **review plan**. It does not infer requirements from prose, execute
a migration, grant approval, or certify that an exported review record is
authentic. A recorded approval is only evidence that the input *asserts* a
separate review; the operator remains responsible for verifying it. The CLI
reads one confined UTF-8 JSON file, emits one JSON report on stdout and a fixed
human summary on stderr, and writes no file.

## Supported input profile

The root object has exactly `schemaVersion: "1"`, a nonempty `steps` array, and
a `decisions` array. Every step has exactly these fields:

| Field | Supported value |
| --- | --- |
| `id` | unique opaque ASCII identifier, 1–64 units, `[A-Za-z0-9._-]` |
| `kind` | `prepare`, `backfill`, `verify`, `cutover`, or `retire` |
| `owner` | nonempty opaque ASCII role identifier, 1–64 units, same alphabet |
| `dependsOn` | array of exact step IDs; no duplicate or self dependency |
| `compatibility` | `dual-run`, `backward-compatible`, or `not-applicable` |
| `rollback` | `restore`, `reverse-switch`, or `not-required` |
| `checkpoint` | `after` or `before-and-after` |
| `evidenceNeeds` | nonempty, unique subset of `backup`, `compatibility-test`, `data-count`, `metric-baseline`, `rollback-test`, `operator-review` |
| `destructive` | explicit boolean; `cutover` and `retire` must be `true` |
| `cutoverOrder` | decimal string `"1"`–`"64"` for `cutover`; otherwise `null` |

`backfill` describes an additive operation in this narrow profile; if it may
replace or remove existing data, the exporter must set `destructive: true`.
Any `destructive: true` step needs `rollback` other than `not-required` and a
`before-and-after` checkpoint. This checks the export's declarations, not the
truth of the described operation. An operator must independently review scope.

Each decision record has exactly `stepId`, `recordId`, `reviewerRole`, and
`outcome`. The first three are opaque identifiers in the same 1–64-unit ASCII
profile; outcome is `approved` or `rejected`. Each destructive step needs
exactly one separately identifiable decision record. Record IDs must be
unique; a single blanket record cannot cover two steps. A decision for a
non-destructive or nonexistent step is unsupported evidence. The report says
`recorded-approved` or `recorded-rejected`, never unqualified `approved`.

Unknown fields, malformed JSON, duplicate keys, unsupported numbers, invalid
identities and missing evidence never become absence or a passing check.

## Generated plan and outcome

The report contains topologically ordered rows with source step ordinal and
pointer, dependency ordinals, fixed kind/compatibility/rollback/checkpoint and
evidence-need codes, an owner source pointer, and a decision source pointer or
`null`. It never emits opaque IDs, owner/reviewer labels, arbitrary input text,
or an unkeyed hash of any of them. Each adjacent cutover order adds a
sequencing edge to the dependency graph, so independent cutovers exported in
reverse source order still appear in cutover order. Remaining unconstrained
ties use original source order. Findings sort by UTF-16 code unit over file,
pointer and rule ID.

All cutover steps require distinct, contiguous `cutoverOrder` values 1…K. A
dependency from an earlier cutover order to a later one, including through
non-cutover steps, creates a cycle against those ordering edges and makes
sequencing incomplete. Any other cycle, missing dependency or duplicate/missing
cutover order is also incomplete; the tool does not pick an arbitrary order.
A complete plan with every required
decision recorded as approved is `pass`/exit 0. An explicit recorded rejection
on otherwise complete evidence is `fail`/exit 1. Missing owner, review record,
rollback/checkpoint/evidence declaration or ambiguous sequencing is
`incomplete`/exit 2, even if a known rejection is also shown. Empty steps are
not a vacuous pass.

## CLI, limits and verification

`migration-plan-template --root DIR --input FILE [--json]` requires an
existing directory and a safe root-relative file path. The real input must
remain inside the real root; aliases are refused. `--help` exits 0. Invalid
CLI configuration exits 2 with empty stdout and a fixed stderr diagnostic.
Unreadable, invalid UTF-8 or malformed named input exits 2 with a located
`incomplete` JSON report. `--json` suppresses the fixed human summary only.

Defaults: 1,048,576 bytes, 64 steps, 64 decisions, 16 dependencies per step,
6 evidence codes per step, 32 JSON depth levels, 50,000 JSON nodes, and a
2,000-millisecond analysis deadline. Exactly N is legal; N+1 is incomplete.
The library receives an injectable finite, monotone clock. The test process
actively denies network APIs, and source contains no Git, shell, browser,
database or remote adapter. Tests begin with a correctly specified plan,
then prove destructive-review, ownership, independent reverse-source and
indirectly contradictory cutover order, unknown/limit, privacy, confinement,
stream and deterministic-output behavior. Removal mutations must
make each advertised guarantee's named test fail.
