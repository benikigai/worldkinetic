/** Finite JSON only. Named check arrays have set semantics; other arrays retain order. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalize(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(item: unknown, key = '', depth = 0): string {
    if (depth > 128) throw new Error('JSON nesting exceeds 128 levels.');
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object') throw new Error('Only finite JSON values are supported.');
    if (ancestors.has(item)) throw new Error('Cyclic JSON is not supported.');
    ancestors.add(item);
    try {
      if (Object.getOwnPropertySymbols(item).length) throw new Error('Symbol keys are not JSON.');
      if (Array.isArray(item)) {
        if (Object.keys(item).length !== item.length || Object.getOwnPropertyNames(item).length !== item.length + 1) throw new Error('Sparse or extended arrays are not JSON.');
        let entries = Array.from({ length: item.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !('value' in descriptor)) throw new Error('Array accessors are not JSON.');
          return descriptor.value as unknown;
        });
        if (key === 'checks' || key === 'requiredChecks') {
          const ids = new Set<string>();
          const tagged = entries.map(entry => {
            const id = key === 'requiredChecks' ? entry : entry && typeof entry === 'object'
              ? Object.getOwnPropertyDescriptor(entry, 'checkId')?.value : undefined;
            if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('Invalid or duplicate check ID.');
            ids.add(id);
            return { id, entry };
          });
          tagged.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          entries = tagged.map(record => record.entry);
        }
        return `[${entries.map(entry => encode(entry, '', depth + 1)).join(',')}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('Only plain JSON objects are supported.');
      return `{${Object.getOwnPropertyNames(item).sort().map(name => {
        const descriptor = Object.getOwnPropertyDescriptor(item, name)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('Object accessors are not JSON.');
        return `${JSON.stringify(name)}:${encode(descriptor.value, name, depth + 1)}`;
      }).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}

/** Parse before keys can be discarded by JSON.parse, including escaped-equivalent keys. */
export function parseStrictJson(raw: string): JsonValue {
  if (typeof raw !== 'string') throw new Error('Expected JSON text.');
  let offset = 0;
  const fail = (): never => { throw new Error('Invalid JSON or duplicate object key.'); };
  const whitespace = () => { while (/[\x20\t\r\n]/.test(raw[offset] ?? '') && offset < raw.length) offset++; };
  function string(): string {
    const start = offset++;
    while (offset < raw.length) {
      const character = raw[offset++];
      if (character === '"') {
        try { return JSON.parse(raw.slice(start, offset)) as string; } catch { return fail(); }
      }
      if (character === '\\') offset++;
    }
    return fail();
  }
  function value(depth: number): JsonValue {
    if (depth > 128) return fail();
    whitespace();
    const character = raw[offset];
    if (character === '"') return string();
    if (character === '{') {
      offset++;
      const object: { [key: string]: JsonValue } = {};
      const keys = new Set<string>();
      whitespace();
      if (raw[offset] === '}') { offset++; return object; }
      while (offset < raw.length) {
        whitespace();
        if (raw[offset] !== '"') return fail();
        const key = string();
        if (keys.has(key)) return fail();
        keys.add(key);
        whitespace();
        if (raw[offset++] !== ':') return fail();
        Object.defineProperty(object, key, { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
        whitespace();
        const separator = raw[offset++];
        if (separator === '}') return object;
        if (separator !== ',') return fail();
      }
      return fail();
    }
    if (character === '[') {
      offset++;
      const array: JsonValue[] = [];
      whitespace();
      if (raw[offset] === ']') { offset++; return array; }
      while (offset < raw.length) {
        array.push(value(depth + 1));
        whitespace();
        const separator = raw[offset++];
        if (separator === ']') return array;
        if (separator !== ',') return fail();
      }
      return fail();
    }
    for (const [token, parsed] of [['true', true], ['false', false], ['null', null]] as const) {
      if (raw.startsWith(token, offset)) { offset += token.length; return parsed; }
    }
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(raw.slice(offset))?.[0];
    if (!token) return fail();
    offset += token.length;
    const number = Number(token);
    if (!Number.isFinite(number)) return fail();
    return number;
  }
  const result = value(0);
  whitespace();
  if (offset !== raw.length) return fail();
  return result;
}

/** Hash exact UTF-8 text or bytes, with no reserialization and no Node-only imports. */
export async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashCanonical(value: unknown): Promise<string> {
  return sha256(canonicalize(value));
}
