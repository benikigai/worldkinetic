import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteTotal } from '../../src/client/workspace/quote-total.js';
test('quote totals keep missing and invalid fees unknown', () => {
  assert.equal(quoteTotal(['95', '12.50', '8.25']), 115.75);
  assert.equal(quoteTotal(['95', '0', '0']), 95);
  for (const value of ['', '-1', 'NaN', '1e3', '2.999']) assert.equal(quoteTotal(['95', value, '0']), null);
  assert.equal(quoteTotal(['0.10', '0.20', '0']), 0.3);
});
