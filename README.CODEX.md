Last updated: 2025-09-19

This README is for Codex purposes

# Codex Flow: Systems‑Level Integration & Provider Agnosticism

- Mission: Ship a provider‑agnostic agent kit: pre‑indexed registry, deterministic routing, parallel orchestrator, policy/memory/observability — and adapters for OpenAI/Anthropic/Ollama/CLI so you can switch providers, benchmark them, and fail over with minimal change.
- Artifacts: `codex/agents/**.codex.yaml` (definitions), `index.json` (fleet index), `triggers.json` (routing), optional briefs (`.md`), demo orchestrator, and a deterministic converter pipeline.

## System Model (Control/Data/Execution Planes)
- Control plane: `index.json`, per-agent `runtime`, `metrics`, `testing`, `observability`, `hooks` — informs admission, scheduling, SLOs, smoke gates.
- Data plane: `capabilities`, `responsibilities`, `triggers` — informs routing, context sharing, and delegation edges.
- Execution plane: runner bindings; enforce `concurrency`, `resource_limits`, and `timeout_ms`; sandbox tools per `capabilities.detail.tools`.
- Lifecycle: watch `.claude/agents` → convert → validate → publish `codex/agents` → warm caches → run.

## Smartness Loop (Self-Optimization)
- Signals: `metrics.tracked` + task outcomes + latency; maintain per-agent reward R = f(success_rate, -latency, quality proxies).
- Routing weights: maintain W[trigger→agent] and update via contextual bandits; prefer high R under constraints (domain match, tools, memory policy).
- Autonomy tuning: adapt `runtime.autonomy_level` per alias via EMA of interventions, capped by policy; raise for low-risk, lower on failures.
- Concurrency tuning: auto-derive `max_parallel_tasks*` = min(model, infra quota, observed queue depth/latency SLA).
- Delegation graph: use `triggers.delegations.prefers/complements` as priors; reinforce edges that reduce retries/latency.
- Memory shaping: bias reuse where `memory.sharing_policy.share_with` allows; decay or redact per policy.

## Routing Architecture (Deterministic, Fast)
- Stage 0 (files): match `triggers.file_patterns` on event paths; compile to globset; route immediately.
- Stage 1 (keywords): build Aho–Corasick automaton over `triggers.keywords`; collect candidate IDs.
- Stage 2 (regex): precompile to DFA/NFA sets; short-circuit on first K matches.
- Stage 3 (semantic, optional): embedding or rule-based fallback only if Stages 0–2 empty.
- Scoring: S = α·keyword_hit + β·regex_hit + γ·domain_affinity + δ·R(agent) − penalties(policy/conflicts); pick top-n.

## Efficiency Playbook (Hot Path)
- Parsing: load `index.json` once; parse YAML once per agent → freeze; store in `registry: id→def`.
- Caching: hotset LRU for agents by frequency; memoized triggers; prebuilt automata; lazy-load cold domains.
- Zero-copy: keep raw YAML string + parsed object; avoid stringify/parse churn; use structuredClone for per-alias overrides.
- Pooling: worker/thread pools sized to CPU; bound queues per alias by `max_parallel_tasks`; apply backpressure.
- Affinity: co-schedule tasks with shared `memory.namespaces` or `share_with` to reduce context I/O; avoid mixing redact-incompatible tasks.
- Cold start: warm regex + keyword automata and preload N most frequent agents from `index.json.keywords` frequency.

## Enforcement Surfaces (Safety/Policy)
- Tools: deny-by-default; allow only `capabilities.detail.tools.allowed`; audit `restricted` attempts.
- Resources: treat `resource_limits` and `timeout_ms` as hard caps; enforce sandbox quotas per process.
- Memory: enforce `sharing_policy.share_with`/`redact`; segregate per-alias scratch + namespaces; TTL from `retention`.
- Hooks: run `hooks.pre_task`/`post_task`/`failure` in restricted contexts; log to `observability.log_channels`.

## Runner Wiring (Minimal Contracts)
- Registry bootstrap
```js
import fs from 'node:fs'; import path from 'node:path'; import yaml from 'js-yaml';
const DIR = 'codex/agents';
const idx = JSON.parse(fs.readFileSync(path.join(DIR,'index.json'),'utf8'));
const reg = new Map();
for (const e of idx.agents) {
  const p = path.join(DIR, e.domain, ...(e.subdomain?[e.subdomain]:[]), `${e.id}.codex.yaml`);
  reg.set(e.id, yaml.load(fs.readFileSync(p,'utf8')));
}
```
- Trigger matcher
```js
const trig = JSON.parse(fs.readFileSync(path.join(DIR,'triggers.json'),'utf8'));
export function candidates(task){
  const t=String(task||'').toLowerCase(); const set=new Set();
  for (const [k,ids] of Object.entries(trig.keywords)) if (t.includes(k)) ids.forEach(id=>set.add(id));
  for (const r of trig.regex) if (new RegExp(r.pattern,'i').test(t)) r.agents.forEach(id=>set.add(id));
  return [...set];
}
```
- Execution shell (replace with real runtime)
```js
async function exec(def, task){
  return codexRuntime.run({ agent:def.agent.id, task, options:{ alias:def.agent.instance_alias, timeoutMs:def.runtime.timeout_ms }});
}
```

## Orchestrator & CLI (Aliases, Concurrency)
- Aliases: `alias -> { id, overrides? }`; instance-level overrides without mutating base defs.
- Concurrency: enforce `runtime.concurrency.max_parallel_tasks` per alias; inter-alias concurrency is independent.
- CLI:
  - `codex-flow init` — validate/register local agents
  - `codex-flow run` — orchestrate tasks (supports `--route`, `--route-files`, `--strict-tools`, `--stream`, `--prompt`, `--revise-plan`, `--provider`, `--fallback`)
  - `codex-flow swarm "<goal>"` — planner-first multi-agent run
  - `codex-flow cleanup` — prune `.runs/**` and truncate logs
  - `codex-flow bench` — compare providers on the same prompt (JSON/MD/CSV)
  - Legacy: `codex-flow quickstart` and `npm run orchestrate*` remain available

## Planning Modes (Selector + Decomposer)
- Selector: `--selector heuristic|tiny` (deterministic by default)
- Decomposer: `--decomposer heuristic|llm|tiny|cloud` (llm is BYOM via your configured runner: OpenAI, Anthropic, Ollama, CLI, Codex HTTP)
- Contracts: strict JSON with validation + one retry, then fallback to heuristic decompose.

## Providers & Selection
- Supported: OpenAI, Anthropic, Ollama, CLI (your binary), and Codex HTTP via local server.
- Select per run: `codex-flow run --provider openai|anthropic|ollama|cli`.
- Server default: `RUNNER=openai|anthropic|ollama|cli`.
- See `docs/PROVIDERS.md` for environment variables and streaming support.

## Bench & Pricing
- Compare providers on a single prompt: `codex-flow bench --prompt "..." --providers openai,anthropic,ollama`.
- Outputs JSON/Markdown/CSV under `data/bench/` with latency, tokens, and cost.
- Configure rates (USD/1K tokens): `OPENAI_PRICE_IN/OUT`, `ANTHROPIC_PRICE_IN/OUT`, `OLLAMA_PRICE_IN/OUT`.

## Failover Policy (Non‑Streaming)
- CLI: `codex-flow run --provider openai --fallback anthropic,ollama`.
- Server tries providers in order with small backoff/jitter; logs failovers; returns first successful result.
- Streaming failover is best‑effort (primary only) — future work to resume on fallback.

## Prompt Profiles (Planned)
- Optional per‑provider prompt templates to preserve performance without lowest‑common‑denominator prompting.
- Bench can surface deltas with/without profiles for tuning.

## Regeneration & CI
- Input: `.claude/agents/**/*.md` (front-matter → schema fields; body → description/brief).
- Convert: `npm run convert` → rewrites `codex/agents/**`, `index.json`, `triggers.json`.
- Validate: `npm test` (schema fields, triggers, determinism).
- Pipeline: on change → convert → test → publish → warm caches → reload registry.

## Schema Surfaces (Operational Subset)
- agent: `id`, `name`, `classification{domain,subdomain?,tier}`, `description`, `long_description?`.
- runtime: `execution_mode`, `autonomy_level`, `concurrency{max_parallel_tasks,queue_strategy}`, `resource_limits{cpu,memory_mb,disk_mb}`, `heartbeat_interval_ms`, `timeout_ms`.
- capabilities: `core[]`, `detail{languages[],frameworks[],domains[],tools{allowed[],restricted[]}}`, `quality{reliability,responsiveness,quality}`.
- responsibilities: `primary[]`, `secondary[]`.
- triggers: `keywords[]`, `regex[{pattern,priority}]`, `file_patterns[]`, `delegations{prefers[],complements[]}`.
- workflow: `startup_script`, `setup_tasks[]`, `teardown_tasks[]`, `dependencies{runtime[],packages[]}`.
- memory: `retention{short_term,long_term}`, `namespaces[]`, `sharing_policy{share_with[],redact[]}`.
- metrics: `tracked[]`, `thresholds{heartbeat_miss,failure_rate_pct}`, `escalation{notify[]}`.
- hooks: `pre_task[]`, `post_task[]`, `failure[]`; testing: `smoke?`, `integration?`, `verification_policy`; observability: `log_level`, `log_channels[]`, `tracing{enabled,sample_rate}`.

## Failure Modes & Guards
- Missing agent: fall back to generalist tier; escalate via `metrics.escalation.notify`.
- Stale index: validate `generatedAt`; hot-reload with version gate.
- Regex blowups: cap regex count per task; precompile; timeout matchers.
- Overcommit: backpressure queues; reject when queue > threshold; emit `heartbeat_miss` if starved.

## Learning Hooks (Make Codex More Efficient)
- Maintain per-agent scorecards: success, retries, mean/percentile latencies, tool errors.
- Update routing priors: shift traffic toward agents with higher task-specific performance.
- Auto-derive capabilities: mine `responsibilities.primary` lists to extend `capabilities.core` when consistent across successes.
- Instance shaping: duplicate agents under new aliases for hot paths; reduce max_parallel for tail-heavy agents.

## Observability Mapping
- Logs: stream to `observability.log_channels` with `agent.id`, `alias`, `task_hash`, `ms`, `ok`.
- Tracing: sample at `tracing.sample_rate`; span names `agent:<id>`; attributes include autonomy, concurrency, queue wait, tool calls.
- Metrics: export `tasks_completed`, `avg_latency_ms`, `success_rate`; alert on `failure_rate_pct` > threshold.

## Minimal End‑to‑End
- Use bundle as-is: point loader at `codex/agents`.
- Route: `codex-flow route --files a b` or `codex-flow run --route "..."` to deterministically dispatch.
- Execute: honor concurrency/limits; enforce policy; record outcomes to feed smartness loop.
- Memory: set `MEM_REDIS_URL` to enable Redis-backed windows; falls back to file JSONL.
- Providers: pick with `--provider`; compare with `codex-flow bench`; failover with `--fallback`.

## Pointers
- Providers: `docs/PROVIDERS.md`
- Bench Guide: `docs/BENCH.md`
- Failover Policy: `docs/FAILOVER.md`
- Prompt Profiles: `docs/PROMPT-PROFILES.md`
