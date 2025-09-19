import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAgents, decompose, validateDecompose } from '../../src/planner/index.mjs';

const catalog = [
  { id: 'architect', name: 'System Architect', capabilities: { core: ['design', 'architecture', 'spec'] }, default: true },
  { id: 'backend-dev', name: 'Backend Developer', capabilities: { core: ['api', 'server', 'db'] } },
  { id: 'coder', name: 'Frontend Coder', capabilities: { core: ['react', 'ui', 'nextjs'] } },
  { id: 'tester', name: 'QA Tester', capabilities: { core: ['test', 'qa', 'unit'] } },
  { id: 'api-docs', name: 'API Docs', capabilities: { core: ['openapi', 'docs'] } },
];

test('selector (heuristic) returns 2–5 agents with reasons', async () => {
  const r = await selectAgents({ goal: 'Build a todo app with API and tests', catalog, mode: 'heuristic', min: 2, max: 5 });
  assert.ok(Array.isArray(r.agents));
  assert.ok(r.agents.length >= 2 && r.agents.length <= 5, `len=${r.agents.length}`);
  for (const a of r.agents) {
    assert.ok(a.id && typeof a.reason === 'string');
  }
});

test('decomposer (heuristic) produces schema-valid plan and orders', async () => {
  const sel = await selectAgents({ goal: 'Ship a small API', catalog, mode: 'heuristic' });
  const dec = await decompose({ goal: 'Ship a small API', agents: sel.agents, catalog, mode: 'heuristic' });
  const v = validateDecompose(dec);
  assert.equal(v.ok, true, v.error || 'invalid');
  assert.ok(dec.plan.length >= 1);
  assert.ok(dec.orders.length >= 1);
});

test('decomposer (llm) parses provider responses (stubbed)', async (t) => {
  const sel = await selectAgents({ goal: 'Build and test a web app', catalog, mode: 'heuristic' });
  // Stub fetch to emulate an OpenAI-style response
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    async json() {
      return {
        choices: [{ message: { content: JSON.stringify({
          plan: [ { id: 'P1', title: 'Plan', dependsOn: [], parallelizable: false } ],
          orders: sel.agents.slice(0,2).map((a, i)=>({ order_id: `O${i+1}`, agent_id: a.id, objectives: ['do work'], constraints: ['policy'], expected_outputs: ['summary'], handoff: [] }))
        }) } }],
      };
    }
  });
  try {
    process.env.OPENAI_API_KEY = 'sk-test';
    const dec = await decompose({ goal: 'Build and test a web app', agents: sel.agents, catalog, mode: 'llm' });
    const v = validateDecompose(dec);
    assert.equal(v.ok, true, v.error || 'invalid');
  } finally {
    delete process.env.OPENAI_API_KEY;
    globalThis.fetch = orig;
  }
});

test('decomposer (llm, anthropic) parses provider responses (stubbed)', async () => {
  const sel = await selectAgents({ goal: 'Plan and execute tasks', catalog, mode: 'heuristic' });
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    async json() {
      return {
        content: [ { text: JSON.stringify({
          plan: [ { id: 'P1', title: 'Plan', dependsOn: [], parallelizable: false } ],
          orders: sel.agents.slice(0,2).map((a, i)=>({ order_id: `O${i+1}`, agent_id: a.id, objectives: ['do work'], constraints: ['policy'], expected_outputs: ['summary'], handoff: [] }))
        }) } ],
      };
    }
  });
  try {
    process.env.ANTHROPIC_API_KEY = 'key-test';
    const dec = await decompose({ goal: 'Plan and execute tasks', agents: sel.agents, catalog, mode: 'llm' });
    const v = validateDecompose(dec);
    assert.equal(v.ok, true, v.error || 'invalid');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = orig;
  }
});

test('validator catches bad dependsOn', () => {
  const bad = { plan: [ { id: 'A', title: 'A', dependsOn: ['Z'], parallelizable: false } ], orders: [] };
  const v = validateDecompose(bad);
  assert.equal(v.ok, false);
});
