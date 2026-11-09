// A received malformed response violates the contract; a transport timeout is a technical outcome.
export async function post(url, payload, { timeoutMs = 30000, fetchFn = fetch,
  signal } = {}) {
  const began = performance.now();
  const deadline = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const technical = () => ({ status: 0, body: null,
    ms: Math.round((performance.now() - began) * 100) / 100 });
  let response;
  try {
    response = await fetchFn(`${url}/v1/analyze`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: payload, signal: combined });
  } catch {
    if (signal?.aborted) throw new Error('INTERRUPTED');
    return technical();
  }
  const mediaType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json')
    throw new Error('INVALID_RESPONSE');
  let body;
  try { body = await response.json(); }
  catch {
    if (signal?.aborted) throw new Error('INTERRUPTED');
    if (combined.aborted) return technical();
    throw new Error('INVALID_RESPONSE');
  }
  return { status: response.status, body,
    ms: Math.round((performance.now() - began) * 100) / 100 };
}
