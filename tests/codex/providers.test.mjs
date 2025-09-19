import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFetch, jsonResponse } from '../helpers/fake-fetch.mjs';
import { runWithOpenAI, runWithAnthropic } from '../../src/runtime/providers.mjs';

let restore;
beforeEach(() => { restore = installFakeFetch({
  'POST /v1/chat/completions': ({ init }) => {
    return jsonResponse({
      choices: [{ message: { content: 'Hello from OpenAI' } }],
      usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
    });
  },
  'POST /v1/messages': ({ init }) => {
    return jsonResponse({
      content: [{ text: 'Hello from Anthropic' }],
      usage: { input_tokens: 120, output_tokens: 12 },
    });
  },
}); });
afterEach(() => restore && restore());

test('runWithOpenAI returns content and usage', async () => {
  const { ok, content, usage } = await runWithOpenAI({ messages: [{ role: 'user', content: 'Hi' }], model: 'gpt-4o-mini', apiKey: 'x' });
  assert.equal(ok, true);
  assert.equal(content, 'Hello from OpenAI');
  assert.deepEqual(usage, { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 });
});

test('runWithAnthropic returns content and usage', async () => {
  const { ok, content, usage } = await runWithAnthropic({ messages: [{ role: 'user', content: 'Hi' }], model: 'claude-3-5-sonnet-20240620', apiKey: 'x' });
  assert.equal(ok, true);
  assert.equal(content, 'Hello from Anthropic');
  assert.deepEqual(usage, { input_tokens: 120, output_tokens: 12 });
});

