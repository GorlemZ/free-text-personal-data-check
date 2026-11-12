import { detect } from '../src/detector.mjs';
import { createServer } from 'node:http';
import { createHandler } from '../src/server.mjs';
import { pathToFileURL } from 'node:url';

export async function smoke({ detectText = detect, handler = createHandler() } = {}) {
const result = await detectText('Contattare Ada Verdi a ada.verdi@example.com.');
const tail = await detectText('Servizio digitale per consultazione. '.repeat(32) +
  'Scrivere a prova.sintetica@example.com.');
let tokenLimitRejected = false;
try { await detectText('x '.repeat(1000)); }
catch (error) { tokenLimitRejected = error.message === 'TOKEN_BUDGET_EXCEEDED'; }
if (!Array.isArray(result) || !Array.isArray(tail) || !tokenLimitRejected)
  throw new Error('Real model smoke failed');
const server = createServer(handler);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let fiscalCodeDetected = false;
let fiscalCodeFailClosed = false;
try {
  const url = `http://127.0.0.1:${server.address().port}/v1/analyze`;
  const post = async text => {
    const response = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [{ fieldId: 'description', text, allowedCategories: [] }] }),
    });
    return { status: response.status, body: await response.json() };
  };
  const valid = await post('Codice fiscale sintetico: RSSMRA85M01H501Q.');
  fiscalCodeDetected = valid.status === 200 &&
    valid.body.findings.some(x => x.category === 'IT_FISCAL_CODE');
  const tooLong = await post('x-'.repeat(600) + 'RSSMRA85M01H501Q');
  fiscalCodeFailClosed = tooLong.status === 503 &&
    tooLong.body.code === 'detector_unavailable';
  if (!fiscalCodeDetected || !fiscalCodeFailClosed)
    throw new Error('Fiscal-code HTTP smoke failed');
} finally {
  await new Promise(resolve => server.close(resolve));
}
return {
  loaded: true, labels: result.map(x => x.entity_group), count: result.length,
  tailEmailDetected: tail.some(x => x.entity_group === 'EMAIL'), tokenLimitRejected, fiscalCodeDetected, fiscalCodeFailClosed,
  rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await smoke()));
