import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAgents, decompose, validateDecompose } from '../../src/planner/index.mjs';
import { validateDAG } from '../../src/planner/dag.mjs';

const catalog = [
  { id: 'system-architect', capabilities: { core: ['architecture','design'] } },
  { id: 'backend-dev', capabilities: { core: ['api','server'] } },
  { id: 'coder', capabilities: { core: ['ui','react'] } },
  { id: 'tester', capabilities: { core: ['test','qa'] } },
  { id: 'api-docs', capabilities: { core: ['openapi','docs'] } },
];

test('finite selector picks roles deterministically', async () => {
  const r = await selectAgents({ goal: 'Design architecture and build API with tests', catalog, mode: 'finite' });
  const ids = r.agents.map(a=>a.id);
  assert.ok(ids.includes('system-architect'));
  assert.ok(ids.includes('backend-dev'));
  assert.ok(ids.includes('tester'));
});

test('finite decomposer emits valid plan and orders and passes DAG validation', async () => {
  const sel = await selectAgents({ goal: 'Build a small web app with API and UI', catalog, mode: 'finite' });
  const dec = await decompose({ goal: 'Build a small web app with API and UI', agents: sel.agents, catalog, mode: 'finite' });
  const v = validateDecompose(dec);
  assert.equal(v.ok, true, v.error || 'invalid');
  const dag = validateDAG({ agents: sel.agents, plan: dec.plan, orders: dec.orders });
  assert.equal(dag.ok, true, dag.error || 'invalid');
});

