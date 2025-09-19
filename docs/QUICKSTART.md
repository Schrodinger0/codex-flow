Last updated: 2025-09-19

# Quickstart — Beginners and Experts

This guide shows how to run real multi‑agent work with Codex Flow, starting with a beginner path and followed by expert integration details.

What this is
- Codex Flow packages a ready‑to‑use registry of agents (YAML + index + triggers) and a lightweight orchestrator. You can point a real Codex endpoint at it and immediately execute tasks with multiple agents in parallel.

Problem this solves
- Agent orchestration needs fast, consistent agent definitions, routing, and runtime policy. Instead of parsing Markdown on every run and guessing capabilities, Codex Flow gives you a pre‑indexed bundle and a small CLI to orchestrate tasks deterministically or in planned phases.

Why you’d use it
- Faster start: run agents immediately without building a registry service first.
- Deterministic routing: keywords/regex/file patterns map tasks to agent IDs.
- Policy: per‑agent concurrency, timeouts, and tool allowlists enforced at runtime.
- Scale: parallel runs with aliasing and Redis‑backed short‑term memory.

## For Beginners (Real Runs, No Stubs)

Prereqs
- Node 18+
- A Codex HTTP endpoint and API key (from your team). Example base URL: `https://codex.company.tld` (must support `POST /run`).

Step 1 — Install and initialize (fresh folder)
```bash
npm install
codex-flow init   # registers local agents to ~/.codex
codex-flow load   # optional: prints bundle counts
```

Step 2 — Connect to Codex and run a task
- The following commands call your real Codex endpoint (no demo stubs).
- Replace `https://codex.company.tld` and `$CODEX_API_KEY` with your values.

Example A — Build a SaaS app (creates a folder with files)
```bash
node bin/codex-flow.mjs serve  # in a separate terminal, keep running
node bin/codex-flow.mjs run \
  --route "Build a SaaS app for butterflies with supabase auth" \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/butterflies --verbose
```
Expected: files under `scaffold/butterflies` (Next.js + API + supabase wiring). See `frontend/.env.local.example`.

Example B — Route a code review and stream output
```bash
codex-flow run \
  --route "Review src/runtime/adapter.mjs" \
  --runtime codex \
  --codex-url https://codex.company.tld \
  --codex-key $CODEX_API_KEY \
  --stream --verbose --plan
```

Example C — Route by files (multiple), with embedded contents
```bash
codex-flow run \
  --route-files src/runtime/adapter.mjs src/router/index.mjs \
  --runtime codex \
  --codex-url https://codex.company.tld \
  --codex-key $CODEX_API_KEY \
  --stream --verbose --plan
```

Example D — Plan → Execute with optional revision
```bash
codex-flow run \
  --prompt "Ship a minimal Markdown CRM MVP" \
  --revise-plan --yes --plan \
  --runtime codex --codex-url https://codex.company.tld --codex-key $CODEX_API_KEY
```

What happens (high level)
- The orchestrator loads agent definitions from `codex/agents/**.codex.yaml` and respects each agent’s concurrency/timeout/tool policy.
- Routing: keywords/regex/file patterns map tasks to agents; if nothing matches, a planner‑first fallback builds a plan and executes it.
- For “build” tasks: agents are asked to return files in a strict JSON format. The orchestrator writes them under `--scaffold-dir`. If none are returned, a baseline starter is generated so you still get a runnable skeleton.
- Results stream live (`--stream --verbose`) and are stored under `.runs/**`, with events in `data/logs/events.jsonl` and memory in Redis (if configured) or `data/memory/**`.

Troubleshooting
- 401/403 from Codex: check `--codex-key` or env var `CODEX_API_KEY`.
- 404 from Codex: confirm your service exposes `POST /run`.
- No candidates: refine the task text or add triggers to `codex/agents/triggers.json`.

## Planning Modes (Selector + Decomposer)
- Use `--selector heuristic|tiny` for agent selection and `--decomposer heuristic|llm|tiny|cloud` for decomposition.
- Default: Selector=heuristic; Decomposer=llm (BYOM via your configured runner: OpenAI/Anthropic/Ollama/CLI).
- All decomposer outputs are validated (strict JSON) with one retry before falling back to heuristic.

## For Experts (Integrate & Extend)

Programmatic registry load
```js
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const DIR = path.resolve('codex/agents');
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));
const registry = new Map();
for (const e of index.agents) {
  const p = path.join(DIR, e.domain, ...(e.subdomain ? [e.subdomain] : []), `${e.id}.codex.yaml`);
  const def = yaml.load(fs.readFileSync(p, 'utf8'));
  registry.set(def.agent.id, def);
}
```

Deterministic router
```js
import { routeTask, routeFiles } from '../src/router/index.mjs';
const a = routeTask('Review src/runtime/adapter.mjs');
const b = routeFiles(['src/runtime/adapter.mjs']);
```

Runtime wiring
- Codex HTTP: orchestrator calls `POST {CODEX_URL}/run` with `{ agentId, alias, task }` and expects `{ summary, output }`.
- Streaming: `POST {CODEX_URL}/run?stream=1` (SSE) with `data: {event:"chunk",content:"..."}` frames, then `complete`.
- Strict tools: `--strict-tools` enforces per‑agent allowlists.
- Memory: set `MEM_REDIS_URL` to enable Redis; otherwise file JSONL fallback is used.

Suggested flags
- `--route/--route-files`: deterministic routing into the orchestrator.
- `--stream --verbose`: live chunks during Codex execution.
- `--revise-plan`: planner revises remaining phases after each phase summary.
- `--strict-tools`: deny disallowed tool requests.

Operational tips
- Use `codex-flow cleanup` to prune `.runs/**` and truncate `data/logs/events.jsonl`.
- Add tests around routing and policy. See `tests/codex/*.test.mjs` for patterns.

## 4) Regenerate Agents from Claude Markdown (Optional)
- If you have `.claude/agents/**.md`:
```bash
cp -R /path/to/.claude .
npm run convert
```
- This rebuilds `codex/agents/**.codex.yaml`, `index.json`, and `triggers.json`.

## FAQ
- “Do I paste this into Codex?”
  - No. You either run the included demo orchestrator, or in your own app you load `index.json` + YAMLs and register them with your Codex runtime.
- “Can I route automatically?”
  - Yes. Use `triggers.json` (keywords/regex/file patterns) via the snippet above.
- “What’s next?”
  - Replace the `executeTask` stub with your runtime; optionally enable the bandit selector and memory per the PRDs.
