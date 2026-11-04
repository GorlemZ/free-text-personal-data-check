import { detect } from '../src/detector.mjs';
import { createServer } from 'node:http';
import { createHandler } from '../src/server.mjs';
const result = await detect('Contattare Ada Verdi a ada.verdi@example.com.');
const tail = await detect('Servizio digitale per consultazione. '.repeat(32) +
  'Scrivere a prova.sintetica@example.com.');
let tokenLimitRejected = false;
try { await detect('x '.repeat(1000)); }
catch (error) { tokenLimitRejected = error.message === 'TOKEN_BUDGET_EXCEEDED'; }
if (!tail.some(x => x.entity_group === 'EMAIL') || !tokenLimitRejected)
  throw new Error('Real model smoke failed');
const server = createServer(createHandler());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let fiscalCodeDetected = false;
let fiscalCodeFailClosed = false;
try {
  const url = `http://127.0.0.1:${server.address().port}/v1/analyze`;
  const post = async text => {
    const response = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [{ fieldId: 'description', text, allowedEntityTypes: [] }] }),
    });
    return { status: response.status, body: await response.json() };
  };
  const valid = await post('Codice fiscale sintetico: ZZZQQQ99A01X000Z.');
  fiscalCodeDetected = valid.status === 200 &&
    valid.body.findings.some(x => x.entityType === 'IT_FISCAL_CODE');
  const tooLong = await post('x '.repeat(600) + 'ZZZQQQ99A01X000Z');
  fiscalCodeFailClosed = tooLong.status === 503 &&
    tooLong.body.code === 'ANALYZER_UNAVAILABLE';
  if (!fiscalCodeDetected || !fiscalCodeFailClosed)
    throw new Error('Fiscal-code HTTP smoke failed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({
  loaded: true, labels: result.map(x => x.entity_group), count: result.length,
  tailEmailDetected: true, tokenLimitRejected, fiscalCodeDetected, fiscalCodeFailClosed,
  rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
}));
