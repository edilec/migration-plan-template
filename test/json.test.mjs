import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../src/json.mjs';

test('strict parser accepts only unambiguous JSON syntax', () => {
  assert.deepEqual(parseStrictJson('{"schemaVersion":"1","steps":[],"decisions":[]}'),
    { schemaVersion: '1', steps: [], decisions: [] });
  assert.throws(() => parseStrictJson('{"schemaVersion":"1","\\u0073chemaVersion":"1"}'),
    /Duplicate JSON key/u);
  assert.throws(() => parseStrictJson('{"cutoverOrder":1}'), /number/u);
  assert.throws(() => parseStrictJson('{"cutoverOrder":0.999999999999999999}'), /number/u);
});

test('JSON depth and node bounds accept N and refuse N plus one', () => {
  assert.deepEqual(parseStrictJson('{"a":{"b":null}}', { maxDepth: 2 }), { a: { b: null } });
  assert.throws(() => parseStrictJson('{"a":{"b":null}}', { maxDepth: 1 }), /depth/u);
  assert.deepEqual(parseStrictJson('[null,null]', { maxNodes: 3 }), [null, null]);
  assert.throws(() => parseStrictJson('[null,null]', { maxNodes: 2 }), /nodes/u);
});

test('malformed JSON diagnostics never include an untrusted canary', () => {
  assert.throws(() => parseStrictJson('{"owner":token=SYNTHETIC_SECRET_CANARY}'), error => {
    assert.equal(error.message.includes('SYNTHETIC_SECRET_CANARY'), false);
    return true;
  });
});
