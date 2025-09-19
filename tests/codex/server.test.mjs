import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, server } from '../../scripts/codex-server.mjs';

const RUN = process.env.RUN_SERVER_TESTS === '1';

(RUN ? test : test.skip)('codex-server /run demo returns summary', async (t) => {
  const s = startServer(8989);
  t.after(() => s.close());
  const res = await fetch('http://127.0.0.1:8989/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'code-analyzer', alias: 'tester', task: 'Review README.md', provider: 'demo' })
  });
  assert.equal(res.ok, true);
  const data = await res.json();
  assert.ok(typeof data.summary === 'string');
});

(RUN ? test : test.skip)('codex-server /run?stream=1 streams SSE', async (t) => {
  const s = startServer(8990);
  t.after(() => s.close());
  const res = await fetch('http://127.0.0.1:8990/run?stream=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'code-analyzer', alias: 'tester', task: 'Review README.md', provider: 'demo' })
  });
  const text = await res.text();
  assert.ok(text.includes('data:'));
});
