import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMemory } from '../../src/memory/adapter.mjs';

test('file-backed memory window returns recent entries', async () => {
  const mem = await getMemory();
  const def = { agent: { id: 'unit-agent' } };
  const alias = 'unit-alias';
  const session = await mem.beginSession({ alias, def });
  await mem.append({ def, alias, sessionId: session.sessionId }, { summary: 'one' });
  await mem.append({ def, alias, sessionId: session.sessionId }, { summary: 'two' });
  const win = await mem.window({ def, alias }, { limit: 2 });
  assert.ok(Array.isArray(win) && win.length >= 2);
});

