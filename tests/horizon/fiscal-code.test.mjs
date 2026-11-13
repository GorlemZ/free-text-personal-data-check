import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPlausibleFiscalCode } from '../../poc-horizon/dist/fiscal-code.js';

// All examples are fabricated for this suite; no real taxpayer identifiers.
const sample = 'ZZZQQQ99A01X000Z';

test('recognizes canonical shape in Italian context, with case variants and either final letter', () => {
  for (const text of [sample, `Codice fiscale: ${sample}.`, sample.toLowerCase(),
    'ZZZQQQ99T71X000Z', 'ZZZQQQ99A41X000A', 'ZZZQQQ99A31X000Z',
    'ZZZQQQ99A71X000Z', 'ZZZQQQ99A01X000A']) {
    assert.equal(hasPlausibleFiscalCode(text), true, text);
  }
});

test('rejects wrong length, month, day, positions and omocodia', () => {
  for (const text of ['ZZZQQQ99A01X000', 'ZZZQQQ99A01X000ZX',
    'ZZZQQQ99F01X000Z', 'ZZZQQQ99A00X000Z', 'ZZZQQQ99A32X000Z',
    'ZZZQQQ99A40X000Z', 'ZZZQQQ99A72X000Z', 'ZZZQQQ9AA01X000Z',
    'ZZZQQQ99A01X00LZ', 'ZZZQQQ99A01X0001']) {
    assert.equal(hasPlausibleFiscalCode(text), false, text);
  }
});

test('does not accept a CF-shaped substring inside a longer token', () => {
  for (const text of [`x${sample}`, `${sample}9`, `_${sample}`, `${sample}_`,
    `è${sample}`, `${sample}é`, `１２${sample}`,
    `x\u0301${sample}`, `${sample}\u0301x`]) {
    assert.equal(hasPlausibleFiscalCode(text), false, text);
  }
});
