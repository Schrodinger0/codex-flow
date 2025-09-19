Last updated: 2025-09-19

# Codex Parallel Orchestrator (with Aliases)

This guide explains, at two levels, how to run multiple Codex agents in parallel using the ready‑made bundle in `codex/agents`. You can try it in minutes and later plug it into a real runtime.

---

## Level 1: Non‑Technical Quick Start

Goal: Run several AI agents at the same time and see a simple summary.

What you’ll do:
1) Use the prebuilt agents in `codex/agents` (already in this repo).
2) Run a small "orchestrator" program that sends tasks to multiple agents concurrently.
3) Use “aliases” (nicknames) so you can run multiple copies of the same agent (e.g., two reviewers) in parallel.

Steps:
- Option A (built‑in example):
  - Run: `npm run orchestrate:example`
  - You’ll see three roles: `reviewer`, `reviewer2` (both are the Code Analyzer agent), and `architect` (System Architect). They run at the same time.

- Option B (custom tasks):
  - Open `examples/orchestrator-tasks.json` and change the task texts.
  - Run: `npm run orchestrate`

What you’ll see:
- A short “Orchestration Summary” with which roles ran, how many tasks each completed, and average time per task.

That’s it. You just orchestrated multiple agents concurrently.

---

## Level 2: Technical Deep Dive

### Glossary (Quick)
- Agent: A structured definition (YAML) for a specialized AI helper.
- Bundle: The folder `codex/agents` containing many agents plus index and triggers.
- Alias: A nickname you assign to an agent to create multiple instances (e.g., two reviewers).
- Concurrency: Max tasks the same agent instance should run at once (`runtime.concurrency.max_parallel_tasks`).
- Task Map: JSON input mapping alias→array of task strings.

Files:
- `scripts/orchestrator.mjs`: The minimal scheduler.
- `codex/agents/**`: The prebuilt agent registry (YAML definitions + index).
- `examples/orchestrator-tasks.json`: Example task map (alias → tasks[]).

### Modes and Flags
- `--runtime stub` (default): Simulates execution locally (no external Codex calls).
- `--runtime codex`: Calls a Codex HTTP endpoint to execute tasks in real time.
  - Configure via flags `--codex-url <url>` and `--codex-key <token>` or env vars `CODEX_URL` and `CODEX_API_KEY`.
- `--plan`/`--no-plan`: Show or hide the execution plan before running.
- `--dry-run`: Print the plan and exit without executing.
- `--verbose`: Print per‑task start/finish and per‑task results in the summary.
- `--stream`: In Codex mode, consume streaming chunks and print live (with `--verbose`).
- `--route "<text>"`: Deterministically route free‑text via triggers and run matching agents.
- `--route-files <paths...>`: Route file paths via triggers; runs with "Review <file>" tasks.
- `--strict-tools`: Enforce tool allowlists, rejecting tasks that ask for disallowed tools.
- `--revise-plan`: After each phase, ask the planner to revise remaining phases based on outputs.
- `--provider`: Select provider (openai|anthropic|ollama|cli) passed to the local server in codex mode.
- Planning split:
  - `--selector heuristic|tiny` — deterministic agent shortlist (default heuristic)
  - `--decomposer heuristic|llm|tiny|cloud` — BYOM LLM or heuristic decomposition
  - DAGs are validated; invalid decompositions are logged as `decomposer_invalid` before conversion.

Examples:
```bash
codex-flow init

# See plan, then run locally with the stub (no external calls)
codex-flow run --example --plan --verbose

# Real‑time Codex mode (HTTP); requires a running endpoint
codex-flow run --example \
  --runtime codex \
  --codex-url http://localhost:8787 \
  --codex-key $CODEX_API_KEY \
  --plan --verbose

# Drive tasks via stdin and dry‑run
echo '{"reviewer":["Check foo"],"architect":["Design bar"]}' | codex-flow run -f - --dry-run

# Route text and files deterministically
codex-flow run --route "Review src/tools/codex/agent-converter.js" --plan
codex-flow run --route-files src/runtime/adapter.mjs src/router/index.mjs --plan
```

No endpoint? Start the local demo endpoint:
```bash
# Terminal A: start demo Codex endpoint (POST /run)
npm run codex:serve   # listens on http://localhost:8787

# Terminal B: point orchestrator at it
node scripts/orchestrator.mjs --example --runtime codex --codex-url http://localhost:8787 --plan --verbose
```

### Minimal Codex Endpoint Shape (used by `--runtime codex`)
This demo expects a very small HTTP contract that you can adapt:

- Request
  - Method: POST
  - URL: `{CODEX_URL}/run`
  - Headers: `content-type: application/json`, optional `authorization: Bearer <CODEX_API_KEY>`
  - Body:
    ```json
    {
      "agentId": "code-analyzer",
      "alias": "reviewer",
      "task": "Review src/tools/codex/agent-converter.js"
    }
    ```
- Response (200 OK)
  - JSON:
    ```json
    {
      "summary": "Reviewed 1 file; 0 TODOs; 2 long lines",
      "output": { "issues": [], "notes": [] },
      "logs": ["...optional..."],
      "usage": { "tokensIn": 1234, "tokensOut": 456 }
    }
    ```
- Non‑200: the orchestrator will surface `res.status` and keep going unless you change the behavior.

If your service uses a different route or payload, adjust the call in `scripts/orchestrator.mjs` (search for `POST {CODEX_URL}/run`). Streaming (SSE/WebSocket) can be added later; this demo uses simple request/response for clarity.

How it works:
- Registry loading: Reads `codex/agents/index.json`, then loads each `*.codex.yaml` to build a `registry` (`id → definition`).
- Aliases: The orchestrator defines a simple map:
  ```js
  const aliases = {
    reviewer:  { id: 'code-analyzer', overrides: { runtime: { autonomy_level: 0.7 } } },
    reviewer2: { id: 'code-analyzer', overrides: { runtime: { autonomy_level: 0.9 } } },
    architect: { id: 'system-architect' },
  };
  ```
  - You can add more roles or point them at any agent `id` in the bundle.
  - `overrides` lets you tweak per‑instance settings (e.g., autonomy, timeouts).

- Concurrency model:
  - Per alias, the orchestrator enforces `runtime.concurrency.max_parallel_tasks` from the agent’s YAML.
  - Different aliases (and thus agents) run at the same time.
  - Implementation detail: `withLimit()` is a small async queue that caps concurrent promises per alias.

- Task input shape:
  - The script accepts a JSON object: `{ "<aliasOrAgentId>": [ "task1", "task2", ... ] }`.
  - Examples:
    - From file: `node scripts/orchestrator.mjs -f examples/orchestrator-tasks.json`
    - From stdin: `echo '{"reviewer":["Review A"],"architect":["Design B"]}' | node scripts/orchestrator.mjs -f -`

- Execution stub and events:
  - `executeTask(def, task, { onEvent })` simulates work in stub mode and emits `task_started`/`task_complete` to `data/logs/events.jsonl`.
  - In real runs (`--runtime codex`), results are persisted and summarized; telemetry entries are also appended.
  - Use `--strict-tools` to deny disallowed tool requests per agent’s allowlist.

Extending to production:
- Real execution: Wire `executeTask()` to your agent runner. The YAML includes useful hints:
  - `agent.id`, `classification`, `capabilities`, `responsibilities`
  - `runtime` (timeouts, desired concurrency, resource hints)
  - `memory.sharing_policy` for safe cross‑agent context sharing
  - `hooks` / `workflow` fields if you want pre/post steps
- Routing: Use `codex/agents/triggers.json` to automatically pick agents from free‑text tasks.
- Isolation: If running multiple instances of the same agent, keep state separate per alias (scratch dirs under `.runs/<alias>/<taskId>`, session IDs, memory namespaces). Share only what `memory.sharing_policy.share_with` allows.
- Backpressure: CPU‑bound tasks should use worker pools (Node Worker Threads/process pool). I/O tasks are fine with async concurrency.
- Codex endpoint contract: The demo calls `POST {CODEX_URL}/run` with `{ agentId, alias, task }` and expects JSON `{ summary, output }`. Adjust to your real service.

### Inter‑Agent Collaboration
This demo runs agents in parallel and collects results; it does not implement agent‑to‑agent messaging. Two simple patterns you can add quickly:
- Shared context bus: Keep an in‑memory array of notes. Each task may `publish({alias, agentId, data})`; later tasks can `subscribe()` to read them. Persist to a file or DB for durability.
- Phased orchestration: Run in stages (e.g., reviewers → architect). After stage 1 completes, synthesize a new task for the architect that includes a summary of reviewer outputs, then run stage 2.

Both patterns can be built on top of `runParallel()` by sequencing calls and passing the prior stage’s outputs into the next stage’s task payload.

Common issues & tips:
- Duplicate agent IDs: The bundle may have the same `id` present in multiple contexts. If your registry requires uniqueness, namespace by domain or rename during registration.
- YAML parsing: The orchestrator prefers `js-yaml` if available. If not, it falls back to a minimal parser (sufficient for the demo). Your production app should use a full YAML parser.
- Safety: Always enforce your own resource limits and timeouts in the runner; the YAML is declarative metadata, not an enforcement boundary.

Quick API sketch (drop‑in):
```js
// Replace the stub in scripts/orchestrator.mjs
async function executeTask(def, task) {
  const result = await codexRuntime.run({ agent: def.agent.id, task, options: { alias: def.agent.instance_alias } });
  return { alias: def.agent.instance_alias || def.agent.id, agentId: def.agent.id, task, ok: true, ms: result.ms, summary: result.summary };
}
```

You now have a tiny, readable starting point for parallel multi‑agent orchestration with clear hand‑off points for a real Codex runtime.

---

## What Changed in This Repo (Plain English)
- We added a small program that can send tasks to several AI helpers at the same time (faster results).
- We added a sample list of tasks you can edit without coding.
- We added two written guides: this technical guide and a plain‑English version (`docs/ORCHESTRATOR-PLAIN.md`).
- We updated `package.json` so you can run demos with short commands.

## Why These Changes Help
- Non‑technical folks can run realistic demos and see value quickly.
- Technical teams get a minimal, understandable starting point to connect a real runtime.
- The project documents both the “why” and the “how,” reducing hand‑offs and confusion.
- Streaming (optional)
  - Request: `POST {CODEX_URL}/run?stream=1`
  - Response: `text/event-stream` (SSE). Events include:
    - `data: {"event":"start"}`
    - `data: {"event":"chunk","content":"..."}` repeated
    - `data: {"event":"complete", "summary":"...", "output":{...}}`
  - Useful for UIs; the included orchestrator still treats Codex calls as request/response.
# Cleanup
Artifacts accumulate over time. Use the built-in cleanup to prune safely:

```bash
codex-flow cleanup --runs-max-per-alias 10 --logs-max-bytes 5242880
```

- Runs: keeps the latest N per alias under `.runs/<alias>/*`.
- Logs: truncates `data/logs/events.jsonl` to the last B bytes.
