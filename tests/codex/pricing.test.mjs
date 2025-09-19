import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCost } from '../../src/runtime/pricing.mjs';

test('computeCost openai default pricing', () => {
  const usd = computeCost({ provider: 'openai', model: 'gpt-4o-mini', usage: { prompt_tokens: 1000, completion_tokens: 1000 } });
  // 0.005 + 0.015 = 0.02 per combined 2k tokens -> $0.02
  assert.equal(usd, 0.02);
});

test('computeCost anthropic default pricing', () => {
  const usd = computeCost({ provider: 'anthropic', model: 'claude-3-5-sonnet-20240620', usage: { input_tokens: 1000, output_tokens: 1000 } });
  // 0.003 + 0.015 = 0.018 -> $0.02 rounded
  assert.equal(usd, 0.02);
});

