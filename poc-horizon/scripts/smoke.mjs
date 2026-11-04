import { detect } from '../src/detector.mjs';
const result = await detect('Contattare Ada Verdi a ada.verdi@example.com.');
const tail = await detect('Servizio digitale per consultazione. '.repeat(32) +
  'Scrivere a prova.sintetica@example.com.');
let tokenLimitRejected = false;
try { await detect('x '.repeat(1000)); }
catch (error) { tokenLimitRejected = error.message === 'TOKEN_BUDGET_EXCEEDED'; }
if (!tail.some(x => x.entity_group === 'EMAIL') || !tokenLimitRejected)
  throw new Error('Real model smoke failed');
console.log(JSON.stringify({
  loaded: true, labels: result.map(x => x.entity_group), count: result.length,
  tailEmailDetected: true, tokenLimitRejected,
  rssMiB: +(process.memoryUsage().rss / 1048576).toFixed(1),
}));
