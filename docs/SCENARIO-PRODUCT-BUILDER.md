Last updated: 2025-09-19

# Scenario: Distribution‑First Markdown CRM (Product Builder)

Goal: Run a small, visible multi‑agent workflow that plans, designs a DB schema, and generates a static dashboard you can open locally — optimized for first customer/first dollar.

Two modes:
- Demo (no external runtime): Generate artifacts deterministically so you can see results today.
- Real agents: Replace the execution stub with your Codex runner so the same pipeline is agent-driven.

## A) Demo Mode (works now)
- `npm install`
- `node scripts/product-builder.mjs`
- Open `product/app/index.html` in your browser.
- Edit:
  - Spec: `product/spec/PRODUCT.md`
  - Data: `product/data/seed.json` (leads/tasks)
  - DB: `product/db/schema.sql`

## B) Real Agents (wire your runtime)
Replace `executeTask()` in `scripts/orchestrator.mjs` with your Codex runner call, then feed tasks like those in `examples/product-builder-tasks.json` or use the simplified CLI.

Suggested steps:
1) Implement:
```js
async function executeTask(def, task){
  return codexRuntime.run({ agent: def.agent.id, task, options: { alias: def.agent.instance_alias, timeoutMs: def.runtime.timeout_ms } });
}
```
2) Run:
```bash
codex-flow run -f examples/product-builder-tasks.json
```
3) Agents to consider:
- Architect (system design, MVP tradeoffs)
- Backend (DB schema, endpoints)
- Docs (API docs/spec)
- Analyzer (review)
- Validator (smoke tests)

You can then have agents write into `product/**` paths (spec, schema, data, app) as artifacts. Execution events are logged under `data/logs/` and per-run artifacts under `.runs/`.
