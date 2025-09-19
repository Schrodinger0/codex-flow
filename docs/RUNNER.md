Last updated: 2025-09-19

# Runtime Adapter (executeTask)

Purpose
- Provide a single seam to plug a real Codex runner while keeping policy and telemetry consistent.

API
- `admit(def)`: basic definition checks.
- `enforce(def, task, fn)`: wraps `fn` with timeouts using `def.runtime.timeout_ms` (default 600s).
- `executeTask(def, task, opts)`: stub or codex (HTTP) mode, with events and policy enforcement.
- `telemetry(def, result)`: writes structured event JSON (see Observability).

Modes
- Stub: local, fast, no external calls. Produces tangible `output` for demo tasks (code.review, design.proposal, or free‑text “Review <path>”).
- Codex: HTTP POST to `{CODEX_URL}/run` with `{ agentId, alias, task }`, returns `{ summary, output }`.

Tool allowlists
- If `capabilities.detail.tools.allowed` is not empty and `task.tools` lists tools outside that set:
  - By default, a warning event is logged.
  - With `--strict-tools`, execution is rejected; summary explains which tools were disallowed.

Events, memory, and artifacts
- Events: JSONL lines are appended to `data/logs/events.jsonl` for `task_started`, `policy_violation`, and `task_complete`.
- Memory: Short‑term memory prefers Redis when configured; otherwise falls back to per‑alias JSONL in `data/memory/<alias>.jsonl` (redacting keys from `def.memory.sharing_policy.redact`).
  - Enable Redis by setting `MEM_REDIS_URL` (and optionally `MEM_BACKEND=redis`, `MEM_REDIS_PREFIX`, `MEM_REDIS_TTL_DEFAULT=7d`, `MEM_REDIS_MAX_WINDOW=200`).
  - The adapter auto‑detects and uses `@redis/client` or `ioredis` if installed; otherwise it warns and falls back to file memory.
- Artifacts: Input/output for each run are written under `.runs/<alias>/<taskId>/`.

Providers and configuration
- OpenAI: set `OPENAI_API_KEY` (optional `OPENAI_API_BASE`, `OPENAI_MODEL`).
- Anthropic: set `ANTHROPIC_API_KEY` (optional `ANTHROPIC_API_BASE`, `ANTHROPIC_MODEL`).
- Ollama: set `OLLAMA_URL` (default `http://127.0.0.1:11434`), `OLLAMA_MODEL`.
- CLI: set `RUN_CMD` to your binary; stdin receives `{agentId, alias, task}` JSON.

Provider selection & failover
- Select per run: `codex-flow run --provider openai|anthropic|ollama|cli` (for `--runtime codex`, it’s passed to the local server as `provider`).
- Server default: `RUNNER=openai|anthropic|ollama|cli` env.
- (Next) Failover policy: list ordered providers and thresholds for cost/latency/error; automatic fallback.

Cost tracking
- Bench mode computes cost per provider using configurable pricing (USD per 1K tokens):
  - OpenAI: `OPENAI_PRICE_IN`, `OPENAI_PRICE_OUT`
  - Anthropic: `ANTHROPIC_PRICE_IN`, `ANTHROPIC_PRICE_OUT`
  - Ollama/CLI: `OLLAMA_PRICE_IN`, `OLLAMA_PRICE_OUT` (default 0)
- Results written to `data/bench/*.json` plus `.md` and `.csv` summaries.

Replace with your runner
```js
import { executeTask } from './src/runtime/adapter.mjs';
const result = await executeTask(def, { type: 'code.review', files: ['src/main.ts'], tools: ['Read'] }, {
  runtime: 'codex',
  codexUrl: process.env.CODEX_URL,
  codexKey: process.env.CODEX_API_KEY,
  strictTools: true,
  onEvent: (e) => process.env.DEBUG && console.log(e)
});
```

## Planner Modes

You can choose how free‑form goals are planned into a phase plan before execution.

- Heuristic (default): rules + similarity, no external dependencies, deterministic.
- Tiny (optional): calls a small local model via Ollama (CPU‑only) to produce strict JSON; if invalid, we retry once then fall back to Heuristic.

Usage
```bash
node bin/codex-flow.mjs serve  # keep running
node bin/codex-flow.mjs run --route "Build a SaaS app for butterflies" --planner tiny \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/butterflies

## Planning Decomposer (LLM BYOM)

The `llm` decomposer is provider‑agnostic (BYOM) and auto‑detects configured providers:

- OpenAI via `OPENAI_API_KEY` (optional `OPENAI_API_BASE`, `MODEL`)
- Anthropic via `ANTHROPIC_API_KEY` (optional `ANTHROPIC_API_BASE`, `ANTHROPIC_API_VERSION`, `MODEL`)
- Ollama via `OLLAMA_URL` (optional `MODEL` or `TINY_MODEL_ID`)
- CLI via `RUN_CMD` (reads combined system+user prompt on stdin; returns JSON on stdout)

Run with:
```bash
codex-flow run --prompt "Ship an MVP" --selector heuristic --decomposer llm --yes
```
```
