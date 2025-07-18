import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const bin = resolve('bin/migration-plan-template.mjs');
const guard = resolve('support/deny-network.mjs');
const run = (...args) => spawnSync(process.execPath, ['--import', guard, bin, ...args], { encoding: 'utf8' });
const example = name => resolve('examples', name);

test('saved migration examples exercise pass, rejected and incomplete real CLI exits', () => {
  for (const [name, exit, status, rule] of [
    ['clean', 0, 'pass', null], ['failing', 1, 'fail', 'decision-rejected'],
    ['incomplete', 2, 'incomplete', 'owner-missing'],
  ]) {
    const child = run('--root', example(name), '--input', 'input.json');
    assert.equal(child.status, exit, child.stderr);
    const report = JSON.parse(child.stdout);
    assert.equal(report.tool, 'migration-plan-template');
    assert.equal(report.status, status);
    assert.equal(report.findings.some(f => f.ruleId === rule), rule !== null);
    assert.match(child.stderr, /^(?:pass|fail|incomplete): \d+ steps, \d+ decisions, \d+ warnings\n$/u);
    assert.equal((child.stdout + child.stderr).includes('platformRole'), false);
  }
});

test('help, JSON-only mode and invalid configuration have distinct stream shapes', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--root DIR --input FILE/u);
  assert.equal(help.stderr, '');
  const json = run('--root', example('clean'), '--input', 'input.json', '--json');
  assert.equal(json.status, 0);
  assert.equal(json.stderr, '');
  const unknown = run('--root', example('clean'), '--input', 'input.json', '--json', '--bad=SYNTHETIC_SECRET_CANARY');
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, '');
  assert.equal(unknown.stderr, 'Invalid CLI configuration.\n');
  const rootFile = run('--root', resolve('package.json'), '--input', 'input.json');
  assert.equal(rootFile.status, 2);
  assert.equal(rootFile.stdout, '');
});

test('missing, malformed, duplicate-key and invalid-UTF8 named inputs return incomplete reports', () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-input-'));
  try {
    let child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(f => f.ruleId), ['input-unreadable']);
    writeFileSync(join(root, 'input.json'), '{"owner": token=SYNTHETIC_SECRET_CANARY}');
    child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(f => f.ruleId), ['input-invalid']);
    assert.equal((child.stdout + child.stderr).includes('SYNTHETIC_SECRET_CANARY'), false);
    writeFileSync(join(root, 'input.json'), '{"schemaVersion":"1","\\u0073chemaVersion":"1"}');
    child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(f => f.ruleId), ['input-invalid']);
    writeFileSync(join(root, 'input.json'), Buffer.from([0xff]));
    child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(f => f.ruleId), ['input-invalid']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('read confinement rejects a symlink outside the real declared root', () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'migration-outside-'));
  try {
    writeFileSync(join(outside, 'input.json'), '{"secret":"SYNTHETIC_SECRET_CANARY"}');
    symlinkSync(join(outside, 'input.json'), join(root, 'input.json'));
    const child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(f => f.ruleId), ['path-outside-root']);
    assert.equal(child.stdout.includes('SYNTHETIC_SECRET_CANARY'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('an in-root input symlink is an incomplete alias, while its real file passes', () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-alias-'));
  try {
    writeFileSync(join(root, 'real.json'), readFileSync(example('clean') + '/input.json'));
    symlinkSync('real.json', join(root, 'alias.json'));
    const real = run('--root', root, '--input', 'real.json');
    assert.equal(real.status, 0);
    assert.equal(JSON.parse(real.stdout).status, 'pass');
    const alias = run('--root', root, '--input', 'alias.json');
    assert.equal(alias.status, 2);
    assert.deepEqual(JSON.parse(alias.stdout).findings.map(f => f.ruleId), ['input-alias-unsupported']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('input byte limit accepts exactly N and refuses N plus one', () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-bytes-'));
  try {
    const text = JSON.stringify({ schemaVersion: '1', steps: [{
      id: 'preflight', kind: 'prepare', owner: 'platformRole', dependsOn: [],
      compatibility: 'not-applicable', rollback: 'not-required', checkpoint: 'after',
      evidenceNeeds: ['operator-review'], destructive: false, cutoverOrder: null,
    }], decisions: [] });
    const input = join(root, 'input.json');
    writeFileSync(input, text + ' '.repeat(1048576 - Buffer.byteLength(text)));
    let child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout).status, 'pass');
    writeFileSync(input, text + ' '.repeat(1048577 - Buffer.byteLength(text)));
    child = run('--root', root, '--input', 'input.json');
    assert.equal(child.status, 2);
    assert.deepEqual(JSON.parse(child.stdout).findings.map(f => f.location.pointer), ['/limits/maxBytes']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('filesystem root and repeated identical inputs preserve deterministic output', () => {
  const absolute = resolve('examples/clean/input.json');
  const first = run('--root', '/', '--input', absolute.slice(1), '--json');
  const second = run('--root', '/', '--input', absolute.slice(1), '--json');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(first.stdout, second.stdout);
  assert.equal(JSON.parse(first.stdout).status, 'pass');
});

test('named input paths never enter JSON or human report labels', () => {
  const root = mkdtempSync(join(tmpdir(), 'migration-label-'));
  try {
    const bytes = readFileSync(example('failing') + '/input.json');
    writeFileSync(join(root, 'input.json'), bytes);
    writeFileSync(join(root, 'token-SYNTHETIC_SECRET_CANARY.json'), bytes);
    const ordinary = run('--root', root, '--input', 'input.json');
    const canary = run('--root', root, '--input', 'token-SYNTHETIC_SECRET_CANARY.json');
    assert.equal(ordinary.status, 1);
    assert.equal(canary.status, 1);
    assert.equal(canary.stdout, ordinary.stdout);
    assert.equal(JSON.parse(canary.stdout).findings[0].location.file, 'input');
    assert.equal((canary.stdout + canary.stderr).includes('SYNTHETIC_SECRET_CANARY'), false);
    const missing = run('--root', root, '--input', 'missing-SYNTHETIC_SECRET_CANARY.json');
    assert.equal(missing.status, 2);
    assert.equal(JSON.parse(missing.stdout).findings[0].location.file, 'input');
    assert.equal((missing.stdout + missing.stderr).includes('SYNTHETIC_SECRET_CANARY'), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
