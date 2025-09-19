import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTask } from '../../src/runtime/adapter.mjs';

test('strict-tools rejects disallowed tools', async () => {
  const def = {
    agent: { id: 'unit-agent' },
    runtime: { timeout_ms: 2000, concurrency: { max_parallel_tasks: 1 } },
    capabilities: { detail: { tools: { allowed: ['Read'] } } },
    memory: { sharing_policy: { redact: [] } }
  };
  const task = { type: 'noop', tools: ['Write'] };
  const res = await executeTask(def, task, { strictTools: true, runtime: 'stub' });
  assert.equal(res.ok, false);
  assert.match(res.summary, /Disallowed tool/);
});

