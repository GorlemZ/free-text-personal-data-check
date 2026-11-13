import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isRecord } from '../model/contracts.js';
import { createApp } from '../app.js';
import { transformersAdapterBuilder } from '../adapters/transformersAdapter.js';
import { analysisServiceBuilder } from '../services/analysisService.js';
import { ruleDetectionServiceBuilder } from '../services/ruleDetectionService.js';
import { modelDetectionServiceBuilder } from '../services/modelDetectionService.js';
import { pathToFileURL } from 'node:url';

export async function smoke({ detectText, handler }: Readonly<{
  detectText: (text: string) => Promise<unknown>;
  handler: RequestListener;
}>) {
const result = await detectText('Contattare Ada Verdi a ada.verdi@example.com.');
const tail = await detectText('Servizio digitale per consultazione. '.repeat(32) +
  'Scrivere a prova.sintetica@example.com.');
let tokenLimitRejected = false;
try { await detectText('x '.repeat(1000)); }
catch (error) { tokenLimitRejected = (error as { message?: unknown }).message === 'TOKEN_BUDGET_EXCEEDED'; }
if (!Array.isArray(result) || !Array.isArray(tail) || !tokenLimitRejected)
  throw new Error('Real model smoke failed');
const server = createServer(handler);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
let fiscalCodeDetected = false;
let fiscalCodeFailClosed = false;
try {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/analyze`;
  const post = async (text: string) => {
    const response = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [{ fieldId: 'description', text, allowedCategories: [] }] }),
    });
    const body = await response.json() as { findings: { category: string }[]; code?: string };
    return { status: response.status, body };
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
  await new Promise<void>(resolve => server.close(() => resolve()));
}
const labelOf = (value: unknown): unknown => {
  if (!isRecord(value)) throw new Error('Real model smoke failed');
  return value.entity_group;
};
return {
  loaded: true, labels: result.map(labelOf), count: result.length,
  tailEmailDetected: tail.some(x => labelOf(x) === 'EMAIL'), tokenLimitRejected, fiscalCodeDetected, fiscalCodeFailClosed,
  rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const adapter = transformersAdapterBuilder();
  const ruleDetectionService = ruleDetectionServiceBuilder();
  const modelDetectionService = modelDetectionServiceBuilder(adapter);
  const analysisService = analysisServiceBuilder({ ruleDetectionService, modelDetectionService });
  const handler = createApp({ ready: modelDetectionService.ready, analysisService });
  const detectText = async (text: string): Promise<unknown> => adapter.infer(await adapter.prepare(text));
  console.log(JSON.stringify(await smoke({ handler, detectText })));
}
