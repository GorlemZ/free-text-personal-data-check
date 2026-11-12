// JSON.parse silently accepts duplicate object keys; reject them before parsing.
export function strictParse(text) {
  const value = JSON.parse(text);
  let at = 0;
  const skip = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') {
        const value = JSON.parse(text.slice(start, at));
        // Check every decoded string, including keys, before schema projection.
        if (!value.isWellFormed()) throw new SyntaxError('Invalid Unicode string');
        return value;
      }
    }
    throw new SyntaxError('Unterminated JSON string');
  }
  function visit() {
    skip();
    if (text[at] === '{') {
      at++; skip();
      const keys = new Set();
      while (text[at] !== '}') {
        skip();
        const key = string();
        if (keys.has(key)) throw new SyntaxError('Duplicate JSON key');
        keys.add(key); skip(); at++; // colon already validated by JSON.parse
        visit(); skip();
        if (text[at] === ',') { at++; continue; }
        break;
      }
      at++;
    } else if (text[at] === '[') {
      at++; skip();
      while (text[at] !== ']') {
        visit(); skip();
        if (text[at] === ',') { at++; continue; }
        break;
      }
      at++;
    } else if (text[at] === '"') string();
    else while (at < text.length && !/[,}\]\s]/.test(text[at])) at++;
  }
  visit();
  return value;
}
