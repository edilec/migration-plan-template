export class EvidenceError extends Error {}

export function parseStrictJson(text, { maxDepth = 32, maxNodes = 50000 } = {}) {
  if (typeof text !== 'string') throw new EvidenceError('JSON text is unavailable.');
  if (![maxDepth, maxNodes].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('Invalid parser bounds.');
  }
  let offset = 0;
  let nodes = 0;
  const invalid = message => { throw new EvidenceError(message); };
  const space = () => {
    while (offset < text.length && /[\u0020\t\r\n]/u.test(text[offset])) offset++;
  };
  const string = () => {
    if (text[offset] !== '"') invalid('Expected JSON string.');
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        try { return JSON.parse(text.slice(start, offset)); }
        catch { invalid('Invalid JSON string.'); }
      }
      if (character.charCodeAt(0) < 32) invalid('Invalid JSON string.');
      if (character === '\\') offset++;
    }
    invalid('Unterminated JSON string.');
  };
  const value = depth => {
    if (++nodes > maxNodes) invalid('JSON nodes limit exceeded.');
    space();
    const character = text[offset];
    if (character === '{' || character === '[') {
      if (depth + 1 > maxDepth) invalid('JSON depth limit exceeded.');
      const object = character === '{';
      offset++;
      space();
      if (text[offset] === (object ? '}' : ']')) { offset++; return; }
      const keys = object ? new Set() : null;
      while (offset < text.length) {
        if (object) {
          const key = string();
          if (keys.has(key)) invalid('Duplicate JSON key.');
          keys.add(key);
          space();
          if (text[offset++] !== ':') invalid('Expected JSON colon.');
        }
        value(depth + 1);
        space();
        if (text[offset] === (object ? '}' : ']')) { offset++; return; }
        if (text[offset++] !== ',') invalid('Expected JSON comma.');
        space();
      }
      invalid('Unterminated JSON container.');
    }
    if (character === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return; }
    }
    if (character === '-' || /[0-9]/u.test(character ?? '')) invalid('Unsupported JSON number.');
    invalid('Invalid JSON token.');
  };
  value(0);
  space();
  if (offset !== text.length) invalid('Trailing JSON data.');
  try { return JSON.parse(text); }
  catch { invalid('Invalid JSON document.'); }
}
