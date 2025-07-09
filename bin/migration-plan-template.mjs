#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { generatePlan, incompleteInput, isSafePath, MAX_INPUT_BYTES } from '../src/index.mjs';
import { parseStrictJson } from '../src/json.mjs';

const usage = 'Usage: migration-plan-template --root DIR --input FILE [--json]\n';
const inside = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json' && !Object.hasOwn(options, 'json')) options.json = true;
    else if (['--root', '--input'].includes(arg) && !Object.hasOwn(options, arg.slice(2)) && index + 1 < args.length) {
      options[arg.slice(2)] = args[++index];
    } else throw Error('Invalid CLI configuration.');
  }
  if (typeof options.root !== 'string' || !options.root || !isSafePath(options.input)) {
    throw Error('Invalid CLI configuration.');
  }
  let realRoot;
  try { realRoot = realpathSync(resolve(options.root)); if (!statSync(realRoot).isDirectory()) throw Error(); }
  catch { throw Error('Invalid CLI configuration.'); }
  return { ...options, realRoot };
}

function reportFor(options) {
  const file = options.input;
  const named = resolve(options.realRoot, file);
  let real;
  try { real = realpathSync(named); }
  catch { return incompleteInput(file, 'input-unreadable'); }
  if (!inside(real, options.realRoot)) return incompleteInput(file, 'path-outside-root');
  if (real !== named) return incompleteInput(file, 'input-alias-unsupported');
  let bytes;
  try {
    const stats = statSync(real);
    if (!stats.isFile()) return incompleteInput(file, 'input-unreadable');
    if (stats.size > MAX_INPUT_BYTES) return incompleteInput(file, 'limit-exceeded', '/limits/maxBytes');
    bytes = readFileSync(real);
  } catch { return incompleteInput(file, 'input-unreadable'); }
  if (bytes.length > MAX_INPUT_BYTES) return incompleteInput(file, 'limit-exceeded', '/limits/maxBytes');
  try {
    const document = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return generatePlan(document, { file });
  } catch { return incompleteInput(file, 'input-invalid'); }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(usage);
  else {
    const report = reportFor(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!options.json) {
      process.stderr.write(`${report.status}: ${report.summary.steps} steps, ${report.summary.decisions} decisions, ${report.summary.warnings} warnings\n`);
    }
    process.exitCode = report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
  }
} catch {
  process.stderr.write('Invalid CLI configuration.\n');
  process.exitCode = 2;
}
