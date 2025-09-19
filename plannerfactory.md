Last updated: 2025-09-18

# Planner Factory — Selector + Decomposer (Pluggable)

Goal: Establish a clean seam with two pluggable stages: a fast, deterministic Selector (chooses agents) and a Decomposer (builds a DAG plan + orders). Each stage can be heuristic, tiny‑LLM, or cloud‑LLM. Provide strict JSON contracts, validation, retries, and telemetry.

## Interfaces
```ts
type Catalog = Array<{ id: string; name?: string; capabilities?: { core?: string[] }; default?: boolean }>;
type Reason = string;
type Weight = number; // [0,1]
type TinyCfg = { model?: string; url?: string; temperature?: number; maxTokens?: number };

// Stage 1: Selector
type SelectorResult = {
  agents: Array<{ id: string; reason: Reason; weight?: Weight }>;
  coordination?: Array<string>; // optional high-level phases, e.g., ["Plan","Execute","Test"]
};
async function selectAgents(opts: { goal: string; catalog: Catalog; mode?: 'heuristic'|'finite'|'tiny'|'cloud'; tiny?: TinyCfg; min?: number; max?: number }): Promise<SelectorResult>

// Stage 2: Decomposer
type PlanTask = { id: string; title: string; dependsOn: string[]; parallelizable: boolean };
type Order = { order_id: string; agent_id: string; objectives: string[]; constraints: string[]; expected_outputs: string[]; handoff: string[] };
type DecomposerResult = { plan: PlanTask[]; orders: Order[] };
// `mode='llm'` is provider‑agnostic and uses your configured runner
// (OpenAI, Anthropic, Ollama, CLI, Codex HTTP, etc.).
// `mode='tiny'` is a preset of `llm` with local defaults (e.g., Ollama phi3).
// `mode='cloud'` is a preset of `llm` targeting a remote provider.
async function decompose(opts: { goal: string; agents: SelectorResult['agents']; catalog: Catalog; mode?: 'heuristic'|'finite'|'llm'|'tiny'|'cloud'; tiny?: TinyCfg }): Promise<DecomposerResult>

// Composite (convenience) — orchestrates both stages
type Combined = { agents: SelectorResult['agents']; plan: PlanTask[]; orders: Order[]; meta?: { selector: { mode: string; ms: number }; decomposer: { mode: string; ms: number } } };
async function composePlan(opts: { goal: string; catalog: Catalog; selectorMode?: 'heuristic'|'finite'|'tiny'|'cloud'; decomposerMode?: 'heuristic'|'finite'|'llm'|'tiny'|'cloud'; tiny?: TinyCfg }): Promise<Combined>
```

## JSON Contracts (Strict)
- SelectorResult JSON must include 2–5 agents with reasons; weights optional.
- DecomposerResult JSON must include ≤7 tasks, each with `dependsOn[]` and `parallelizable`.
- Orders must reference only selected agents and valid task dependencies (checked post‑gen).

## Modes & Config Resolution
- New flags: `--selector <heuristic|finite|tiny|cloud>`, `--decomposer <heuristic|finite|llm|tiny|cloud>`.
- Env: `SELECTOR_MODE`, `DECOMPOSER_MODE`. Backward compatible `PLANNER_MODE` maps to both when set.
- File config (optional): `config/planner.json` with `{ selector: {mode,...}, decomposer: {mode,...} }`.
- Tiny defaults: `TINY_MODEL_ID=phi3:3.8b`, `OLLAMA_URL=http://127.0.0.1:11434`, `PLANNER_TEMPERATURE=0.2`, `PLANNER_JSON_MAXTOKENS=512`.
 - LLM (BYOM): decompose via your configured runner (OpenAI/Anthropic/Ollama/CLI/Codex HTTP, etc.).
 - Finite: deterministic finite‑state selector/decomposer (offline); 3‑step plan with role‑specific orders.

### Recommended Default Profile (plannerf2)
- Selector: `heuristic` (deterministic, fast)
- Decomposer: `llm` (BYOM; any LLM, including tiny via Ollama or a cloud provider)
- Rationale: aligns with plannerf2.md — lean stack, provider‑agnostic, schema safety per stage.

## Guardrails
- JSON‑only outputs (use provider "format=json" when supported); low temperature for tiny/cloud.
- Schema validation per stage; one retry on invalid output, then fallback to heuristic.
- Selector must return at least `min=2` agents; if not, degrade to catalog defaults.
- Decomposer must produce acyclic DAG; validate edges against task IDs; reject unknown agent references.

## Reference Implementations
- Heuristic Selector: rules + token similarity over `capabilities.core`, `name`, `id`; boost agent defaults; diversity filter; prints reasons and weights.
- Tiny Selector (optional): small LLM to refine or re‑rank a heuristic shortlist (strict JSON, capped tokens).
- Heuristic Decomposer: 2–3 phase template (Plan → Execute → Test) producing minimal valid DAG + generic orders.
- Tiny Decomposer: tiny‑LLM prompt that consumes `{goal, agents}` and emits `{plan, orders}` strictly, with validation+retry.

## Orchestrator Wiring
- When `--plan` is enabled, orchestrator calls `selectAgents()` then `decompose()`; combines results for execution.
- Preserve current single‑shot `plan()` path as `composePlan()` for backward compatibility until callers migrate.

## Observability
- Emit `selector_requested/generated` and `decomposer_requested/generated` with mode and latencies; append to `data/logs/events.jsonl`.
- Counters: `selector_tiny_success`, `selector_tiny_fallbacks`, `decomposer_tiny_success`, `decomposer_tiny_fallbacks`.

## Testing
- Unit: selector ranking (keywords/regex/semantic), decomposer schema/DAG validator, tiny retry paths.
- Integration: composePlan on sample goals; verify valid agents, DAG and orders; ensure fallbacks trigger correctly.

## Migration Notes
- Current `src/planner/index.mjs` implements a single‑shot planner. Introduce `selectAgents()` and `decompose()` exports behind the same module to maintain a single import site, then refactor callers.
- CLI: add `--selector/--decomposer` flags; keep `--planner` as a convenience that sets both.
