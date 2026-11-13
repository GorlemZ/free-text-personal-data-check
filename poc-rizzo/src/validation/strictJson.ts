// JSON.parse validates syntax; a separate iterative token walk preserves keys
// before JSON.parse's last-value-wins semantics can hide duplicates.
export function parseUniqueJSON(source: string): unknown {
  const payload: unknown = JSON.parse(source);
  const stack: (Set<string> | null)[] = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && /^[\x20\t\r\n]*:/.test(source.slice(match.index + token.length))) {
      const key: string = JSON.parse(token);
      // JSON.parse already established that key tokens occur inside objects.
      const keys = stack.at(-1)!;
      if (keys.has(key)) throw new Error('duplicate_key');
      keys.add(key);
    }
  }
  return payload;
}
