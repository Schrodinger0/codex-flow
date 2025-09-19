import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDAG, planToScenario } from '../../src/planner/dag.mjs';

test('validateDAG passes on simple acyclic plan', () => {
  const plan = [ { id: 'A', dependsOn: [] }, { id: 'B', dependsOn: ['A'] } ];
  const orders = [ { order_id: 'O1', agent_id: 'backend-dev', objectives: ['Implement API'], constraints: [], expected_outputs: [], handoff: [] } ];
  const agents = [ { id: 'backend-dev' } ];
  const v = validateDAG({ agents, plan, orders });
  assert.equal(v.ok, true, v.error || 'invalid');
});

test('validateDAG fails on unknown dependsOn', () => {
  const v = validateDAG({ plan: [ { id: 'A', dependsOn: ['Z'] } ], orders: [] });
  assert.equal(v.ok, false);
});

test('validateDAG fails on unknown agent in orders', () => {
  const v = validateDAG({ agents: [ { id: 'good' } ], plan: [ { id: 'A', dependsOn: [] } ], orders: [ { order_id: 'O1', agent_id: 'bad', objectives: [], constraints: [], expected_outputs: [], handoff: [] } ] });
  assert.equal(v.ok, false);
});

test('planToScenario converts orders into execute-phase tasks', () => {
  const sc = planToScenario({ title: 'Goal', agents: [ { id: 'backend-dev', reason: 'backend' } ], plan: [ { id: 'A', dependsOn: [] } ], orders: [ { order_id: 'O1', agent_id: 'backend-dev', objectives: ['Build endpoint'], constraints: [], expected_outputs: [], handoff: [] } ] });
  assert.ok(sc && Array.isArray(sc.phases) && sc.phases.length === 3);
  assert.ok(sc.phases[1].tasks['backend'] || sc.phases[1].tasks['backend-dev']);
});

