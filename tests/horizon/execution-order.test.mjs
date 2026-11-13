import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from './create-test-app.mjs';

async function requestWith(overrides) {
  const server = createServer(createHandler({
    ready: async () => true,
    prepare: text => ({ text }),
    recognize: () => [],
    infer: async () => [],
    ...overrides,
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [{ fieldId: 'description', text: 'NEUTRAL' }] }),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const unavailable = { status: 503, body: { code: 'detector_unavailable' } };

test('a malformed recognizer return still runs inference before failing closed', async () => {
  for (const rules of [null, {}, [{ source: 'invalid' }]]) {
    const events = [];
    const result = await requestWith({
      recognize: () => { events.push('collect'); return rules; },
      infer: async () => { events.push('infer'); return []; },
    });
    assert.deepEqual(result, unavailable);
    assert.deepEqual(events, ['collect', 'infer']);
  }
});

test('a recognizer exception prevents inference for the current field', async () => {
  const events = [];
  const result = await requestWith({
    recognize: () => { events.push('collect'); throw Error('fixture recognizer error'); },
    infer: async () => { events.push('infer'); return []; },
  });
  assert.deepEqual(result, unavailable);
  assert.deepEqual(events, ['collect']);
});

test('an inference exception leaves collected rule candidates uninterpreted', async () => {
  const events = [];
  const rule = { get source() { events.push('interpret-rule'); return 'rule'; } };
  const result = await requestWith({
    recognize: () => { events.push('collect'); return [rule]; },
    infer: async () => { events.push('infer'); throw Error('fixture inference error'); },
  });
  assert.deepEqual(result, unavailable);
  assert.deepEqual(events, ['collect', 'infer']);
});

test('both raw collection shapes are checked before interpreting rule candidates', async () => {
  const events = [];
  const rule = { get source() { events.push('interpret-rule'); return 'rule'; } };
  const result = await requestWith({
    recognize: () => { events.push('collect'); return [rule]; },
    infer: async () => { events.push('infer'); return {}; },
  });
  assert.deepEqual(result, unavailable);
  assert.deepEqual(events, ['collect', 'infer']);
});

test('rule interpretation follows inference and precedes model interpretation', async () => {
  const events = [];
  const rule = {
    get source() { events.push('interpret-rule'); return 'rule'; },
    category: 'PERSON', start: 0, end: 7, check: 'not_checked',
  };
  const model = {
    get entity_group() { events.push('interpret-model'); return 'PERSON'; },
    score: 0.9, start: 0, end: 7,
  };
  const result = await requestWith({
    recognize: () => { events.push('collect'); return [rule]; },
    infer: async () => { events.push('infer'); return [model]; },
  });
  assert.deepEqual(result, { status: 200, body: {
    verdict: 'rejected', findings: [{ fieldId: 'description', category: 'PERSON' }],
  } });
  assert.equal(events[0], 'collect');
  assert.equal(events[1], 'infer');
  assert.ok(events.indexOf('interpret-rule') > events.indexOf('infer'));
  assert.ok(events.lastIndexOf('interpret-rule') < events.indexOf('interpret-model'));
});
