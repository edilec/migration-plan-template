# Migration Plan Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one explicit saved migration-requirements document into a located, deterministic review plan without taking a migration action.

**Architecture:** `src/json.mjs` checks JSON syntax and duplicates before parsing. `src/index.mjs` validates typed declarations, builds dependency and cutover edges, and emits the report; `bin/migration-plan-template.mjs` confines and reads one local file, then prints JSON plus a fixed human summary. All opaque labels stay in memory and are replaced by source ordinals/pointers in output.

**Tech Stack:** Node.js 22+ ESM, `node:test`, `node:assert/strict`, zero packages.

**Spec:** `docs/superpowers/specs/2026-09-21-migration-plan-template-design.md`

## Global Constraints

- No network, Git command, shell execution, browser, database, migration execution, input mutation or report file.
- An exported review approval is an assertion in data, never authorization or certification.
- `pass` requires nonempty complete evidence; missing or ambiguous evidence is `incomplete`/2; a recorded rejection on complete evidence is `fail`/1.
- CLI invalid configuration exits 2 with empty stdout; unreadable or malformed named input returns an incomplete JSON report.
- Bounds are inclusive at N and incomplete at N+1; clocks are injected and finite/monotone; ordering uses UTF-16 code units.
- Commits are local only; no remote operation, AI attribution, real private data or literal NUL/U+2028/U+2029 source bytes.

---

### Task 1: Strict saved input and correct plan control

**Files:** Create `src/json.mjs`, `src/index.mjs`, `test/core.test.mjs`, `test/json.test.mjs`.

**Interfaces:** `parseStrictJson(text, {maxDepth,maxNodes})` returns a JS document or throws `EvidenceError`. `generatePlan(document, {now,file,limits})` returns the report envelope; `TOOL_ID` equals `migration-plan-template`.

- [ ] **Write red correct-input test.** Define a one-step `prepare` document with `owner: "platform"`, no dependencies, `compatibility: "not-applicable"`, `rollback: "not-required"`, `checkpoint: "after"`, `evidenceNeeds: ["operator-review"]`, `destructive: false`, `cutoverOrder: null`, no decisions. Assert `status === "pass"`, checked 1, no findings, and the sole plan row has `/steps/0` and owner pointer `/steps/0/owner`; assert no raw owner/id appears in `JSON.stringify(report)`.
- [ ] **Run red.** `node --test test/core.test.mjs` must fail for missing `generatePlan`, not malformed test data.
- [ ] **Implement minimal good path.** Freeze rule severities, validate exact root/step keys, and emit a stable report with source ordinal/pointer and fixed enum fields; do not yet infer any missing evidence as absence.
- [ ] **Run green.** `node --test test/core.test.mjs` must pass the exact good case.
- [ ] **Write red parser tests.** `{"schemaVersion":"1","\\u0073chemaVersion":"1"}` must be refused as a duplicate, and numeric JSON tokens must be refused; assert a valid JSON literal with no duplicate parses.
- [ ] **Run red, implement bounded recursive scanner, run green.** Parse strings with JSON's own decoder after scanning and reject all numbers (the profile uses decimal strings); enforce maxDepth 32/maxNodes 50,000 with N/N+1 tests and generic errors without source excerpts.
- [ ] **Commit coherent good-input/parser milestone.** Run the focused tests and `git diff --check` first; commit only this repository.

### Task 2: Evidence validation, ordering and review decisions

**Files:** Modify `src/index.mjs`, `test/core.test.mjs`.

**Interfaces:** The report has `plan` rows with `stepOrdinal`, `sourcePointer`, `dependsOnOrdinals`, `ownerPointer`, `decisionPointer` and fixed enum fields. It has summary counts and sorted findings from one `ruleId -> severity` map.

- [ ] **Write red good control for two independent cutovers exported in order 2,1.** Give each a distinct reviewed decision and assert plan ordinals `[2,1]`, `pass`, and no sequencing finding. This catches a plain source-order topological queue.
- [ ] **Write red contradictory control.** Make cutover order 1 depend on a `verify` step that depends on cutover order 2; assert `incomplete` and `cutover-ambiguous` at the cutover source pointer, without presenting a settled plan order.
- [ ] **Implement ordering.** Resolve exact IDs to source ordinals, add dependency edges and adjacent cutover-order edges, then use stable source-order Kahn traversal; a cycle, missing target, duplicate ID/order or noncontiguous order yields an incomplete finding.
- [ ] **Write red decision controls.** One destructive cutover without its own decision yields `incomplete`; a separate recorded `approved` decision yields `pass`; a recorded `rejected` decision on otherwise complete evidence yields `fail`/`decision-rejected`. Two destructive steps sharing a decision record ID remain incomplete.
- [ ] **Implement decision and declaration validation.** Require owner, rollback/checkpoint/evidence for each step, enforce known hazardous kinds marked destructive, and keep every opaque input label out of findings and plan rows.
- [ ] **Write red unknown/limit tests.** Missing owner, invalid dependency target, unsupported field, empty steps, 128/129 steps, 64/65 decisions, 16/17 dependencies, 6/7 distinct evidence codes, 2,000/2,001-millisecond clock and nonmonotone/NaN clock each have a paired good case and exact incomplete rule.
- [ ] **Implement bounded validation and status precedence.** A warning means incomplete even when a proven rejected decision exists; never mark checked 0 as pass. Sort findings by code units.
- [ ] **Run focused tests, make 4–6 deliberate source-removal mutations in disposable copies, and commit.** Each named test must fail from the intended changed outcome rather than a syntax error or timeout.

### Task 3: Confined CLI, active offline denial and documentation

**Files:** Create `bin/migration-plan-template.mjs`, `support/deny-network.mjs`, `test/cli.test.mjs`, `test/no-network.test.mjs`, `examples/clean/input.json`, `examples/failing/input.json`, `examples/incomplete/input.json`; modify `package.json`, `README.md`.

**Interfaces:** CLI accepts `--root DIR --input FILE [--json]` and `--help`. It prints one JSON report to stdout and fixed human counts to stderr unless `--json`; no file output is supported.

- [ ] **Write red real-CLI tests.** Clean/failing/incomplete examples exit 0/1/2; `--help` exits 0; unknown flag and root-as-file exit 2/empty stdout/fixed stderr; missing or malformed named input returns an incomplete JSON report.
- [ ] **Write red read-boundary tests.** Symlink outside the real root is incomplete, root `/` with a clean absolute fixture is valid, exactly 1,048,576 bytes parses and 1,048,577 bytes is incomplete. Identical runs have byte-identical stdout.
- [ ] **Implement CLI.** Decode UTF-8 strictly, call strict parser, refuse input aliases and escapes, and emit no raw parse message, option text or payload in streams.
- [ ] **Write red offline controls.** Under a preload guard, `fetch('data:text/plain,probe')` and a null-receiver `Socket.connect` must throw. A source gate detects reintroduced network/subprocess callsites and has a safe negative control.
- [ ] **Implement guard and package scripts.** Set version `0.1.0`, zero dependencies and `lint`, `test`, `check`; run all tests under the active denial preload.
- [ ] **Write README.** Include what/why, quick start, full typed input profile, rule table, exit shapes, exact bounds, examples, review-assertion caveat and non-goals.
- [ ] **Verify and commit.** Fresh `npm run check`, exact sample CLI exits, NUL/LS/PS and attribution scan, `git diff --check`, 8+ disposable behavior mutations with timeout reported separately, then local commit and clean-tree check. Send measured Phase 1 signal; independent Phase 2 follows.
