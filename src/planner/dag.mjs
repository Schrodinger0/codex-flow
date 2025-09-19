// DAG Scheduler: validate and convert {agents, plan, orders} to an executable scenario

function topoSort(nodes, edges) {
  const inDeg = new Map();
  nodes.forEach(n => inDeg.set(n, 0));
  for (const [u, vs] of edges) for (const v of vs) inDeg.set(v, (inDeg.get(v) || 0) + 1);
  const q = [];
  for (const [n, d] of inDeg.entries()) if (d === 0) q.push(n);
  const order = [];
  while (q.length) {
    const u = q.shift();
    order.push(u);
    const vs = (edges.get(u) || []);
    for (const v of vs) {
      inDeg.set(v, inDeg.get(v) - 1);
      if (inDeg.get(v) === 0) q.push(v);
    }
  }
  if (order.length !== nodes.length) return { ok: false, error: 'cycle_detected' };
  return { ok: true, order };
}

export function validateDAG({ agents = [], plan = [], orders = [] }) {
  if (!Array.isArray(plan) || !plan.length) return { ok: false, error: 'empty_plan' };
  const ids = new Set(plan.map(p => p.id));
  for (const p of plan) {
    if (!p.id) return { ok: false, error: 'missing_task_id' };
    for (const d of (p.dependsOn || [])) if (!ids.has(d)) return { ok: false, error: `unknown_dep:${d}` };
  }
  // Check that orders reference known/selected agents (when provided)
  const sel = new Set((agents || []).map(a => a.id));
  for (const o of (orders || [])) if (!o.agent_id || (sel.size && !sel.has(o.agent_id))) return { ok: false, error: `unknown_agent:${o.agent_id || 'nil'}` };
  // Build edges and run topo
  const edges = new Map();
  for (const p of plan) edges.set(p.id, []);
  for (const p of plan) for (const d of (p.dependsOn || [])) edges.get(d).push(p.id);
  const t = topoSort(plan.map(p => p.id), edges);
  if (!t.ok) return { ok: false, error: t.error };
  return { ok: true };
}

function aliasFromAgentId(id) {
  if (!id) return null;
  const s = id.toLowerCase();
  if (s.includes('architect')) return 'architect';
  if (s.includes('backend')) return 'backend';
  if (s.includes('coder') || s.includes('frontend')) return 'frontend';
  if (s.includes('docs') || s.includes('api-docs')) return 'docs';
  if (s.includes('tester')) return 'tester';
  if (s.includes('validator')) return 'validator';
  if (s.includes('scaffold')) return 'scaffold';
  return null;
}

// Convert plan+orders to a simple multi-phase scenario
export function planToScenario({ title = '', agents = [], plan = [], orders = [] }) {
  const why = {};
  for (const a of (agents || [])) why[a.id] = a.reason || 'selected';
  // Group tasks by parallelizable flag while respecting dependsOn ordering
  const phases = [];
  const root = { name: 'Phase 1 — Plan', parallel: false, tasks: { architect: [title || 'Define architecture and constraints'] } };
  phases.push(root);
  const exec = { name: 'Phase 2 — Execute', parallel: true, tasks: {} };
  // Derive alias tasks from orders
  for (const o of orders || []) {
    const alias = aliasFromAgentId(o.agent_id) || o.agent_id;
    if (!exec.tasks[alias]) exec.tasks[alias] = [];
    const todo = (o.objectives || []).slice(0, 2);
    exec.tasks[alias].push(...(todo.length ? todo : ['Execute role tasks']));
  }
  phases.push(exec);
  const test = { name: 'Phase 3 — Test & Validate', parallel: true, tasks: { tester: ['Write tests/smoke'], validator: ['Validate build & packaging'] } };
  phases.push(test);
  return { title: title || `Plan for: ${new Date().toISOString()}`, why, phases };
}

