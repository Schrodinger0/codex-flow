# PRD Update — Codex Flow to "Claude Code Flow" Parity

Purpose
- Evolve the current orchestrator, router, and runners to a production‑ready, Claude Code Flow–like system with streaming, deterministic routing → execution, memory/state, policy enforcement, and observability.

Quickstart (Simplicity First)
- Initialize once (register local agents):
  - `codex-flow init`
- Run orchestrations (defaults to examples file if not specified):
  - `codex-flow run`
  - `codex-flow run --example`
  - `codex-flow run --prompt "Build a todo app" --yes --plan`
- Start a free‑form swarm (planner‑first):
  - `codex-flow swarm "Ship a Markdown CRM MVP"`

Goals (V1 parity)
- Deterministic routing feeds the orchestrator automatically.
- Strict tool/policy enforcement with per‑alias isolation.
- Streaming execution with structured events (chunks/tools/status).
- Minimal shared memory with redact/sharing policy.
- Basic telemetry/metrics to inform future learning.

Non‑Goals (for this PRD)
- Semantic routing or bandit learning (tracked as V2).
- Complex sandboxes/containers beyond a basic per‑alias workspace.
- External DBs or centralized observability stacks.

Milestones & Staged Plan

1) Repo Hygiene & Tests (M0)
- Fix duplication in `scripts/bootstrap.mjs` (keep the validated bootstrap only).
- Add tests:
  - Router determinism for keywords/regex/file patterns.
  - Orchestrator concurrency cap (with a fake task runner).
- Deliverables: green `npm test`; docs mention bootstrap command.

2) Router → Orchestrator Wiring + Strict Tools (M1)
- Orchestrator CLI accepts routing inputs:
  - `--route "<text>"` and `--route-files <paths...>` to expand into `{ aliasOrAgent: [tasks...] }` via `src/router`.
- Add `--strict-tools` flag; deny tasks that request tools outside `capabilities.detail.tools.allowed` with clear error.
- Deliverables: `scripts/orchestrator.mjs` supports flags; docs updated; tests for strict tools path.

3) Memory & Context Bus (M2)
- Per‑alias memory: append‑only JSONL at `data/memory/<alias>.jsonl` respecting `memory.retention` TTL.
- Context bus: in‑process pub/sub (`publish({alias, agentId, data})`, `subscribe(filter)`) gated by `memory.sharing_policy.share_with`; auto‑redact fields listed in `memory.redact`.
- Deliverables: adapter writes a completion record; orchestrator can pass prior context to tasks; docs page section.

4) Streaming Providers & Event Surface (M3)
- Providers: add streaming for Ollama (`/api/chat` stream) and OpenAI (`chat.completions` stream).
- Adapter: `executeTask(def, task, { onEvent })` emits `task_started`, `tool_start/end`, `chunk`, `task_complete`, `task_error`.
- Orchestrator: `--verbose` prints incremental chunks; `--json` can emit an event stream.
- Deliverables: chunked logs during runs; sample transcript; fallback to non‑streaming preserved.

5) Planner Improvements (M4)
- Freeform mode becomes phased: plan → execute → synthesize → revise.
- Enforce strict JSON from planner with auto‑retry on schema mismatch (show diff/hint to the planner).
- Deliverables: `--prompt` produces a 2‑3 phase plan and drives phases; artifact summarization handed to next phase.

6) Observability & Metrics (M5)
- Telemetry: structured JSON lines at `data/logs/events.jsonl` (one line per event with timestamps, alias, agentId, taskId, ms, ok, engine).
- Metrics: compute per‑agent aggregates (tasks, success rate, avg/percentile latency) to `data/metrics/agents.json` after runs.
- Deliverables: `bin/codex-flow.mjs load` prints summary; docs add “Observability” section; foundation for future learning.

7) Runner Hardening & Isolation (M6)
- Per‑alias working directories under `.runs/<alias>/<taskId>` cleared after completion (configurable retention).
- Optional command whitelist per agent for local CLI actions.
- Deliverables: policy doc; safe‑by‑default execution surfaces.

8) Docs & Examples (M7)
- Update `docs/ORCHESTRATOR.md` and `docs/RUNNER.md` with routing flags, streaming, memory, and events.
- Add example: routed run `npm run orchestrate -- --route "Review src/runtime/adapter.mjs" --plan --verbose`.
- Deliverables: concise quickstart diffs; before/after demo recording (optional).

Acceptance Criteria
- Routing: `--route`/`--route-files` produces an execution plan referencing actual agents and respects concurrency caps.
- Tools: with `--strict-tools`, tasks requesting disallowed tools fail fast with a helpful message.
- Streaming: users see incremental chunks in `--verbose`; the same run emits a JSON event stream with `--json`.
- Memory: per‑alias JSONL logs exist; redaction applied; contexts can be passed to subsequent tasks when policy allows.
- Telemetry: `data/logs/events.jsonl` and `data/metrics/agents.json` are populated; `bin/codex-flow load` reports counts.
- Tests: new tests cover router determinism and orchestrator concurrency; CI is green.

Risks & Mitigations
- Streaming surface complexity: start with Ollama and OpenAI only; keep a non‑streaming fallback.
- Policy brittleness: ship `--strict-tools` opt‑in initially; log violations by default.
- Memory growth: cap JSONL file sizes and honor TTL; add `--no-memory` flag for ephemeral runs.

Rollout Plan
- Ship M1 and M3 as separate PRs (high impact, low coupling).
- Follow with M2 (memory) and M6 (observability) in one PR if small.
- Planner (M5) can be incremental; keep current fallback.

Owner & Timeline (suggested)
- M1 (routing/strict tools): 1–2 days
- M3 (streaming/events): 2–3 days
- M2 (memory/bus): 1–2 days
- M6 (observability): 1 day
- M5 (planner): 1–2 days
- Docs/tests polish: ongoing per milestone

Appendix — Touch Points by Milestone
- M1: `scripts/orchestrator.mjs`, `src/router/index.mjs`, `bin/codex-flow.mjs`, tests under `tests/codex/*`.
- M2: `src/runtime/adapter.mjs`, new `src/runtime/memory.mjs` (helper), `docs/RUNNER.md` updates.
- M3: `src/runtime/providers.mjs`, `src/runtime/adapter.mjs`, `scripts/orchestrator.mjs` event printing.
- M5: `scripts/orchestrator.mjs` planner path, stricter JSON parsing/retry.
- M6: `src/runtime/adapter.mjs`, new `data/logs/`, `data/metrics/` conventions, `bin/codex-flow.mjs load` enhancement.
