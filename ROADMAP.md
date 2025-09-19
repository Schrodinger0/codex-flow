Last updated: 2025-09-19

## Legend
- [x] Done  •  [~] Partial  •  [ ] Todo

## Tracks (Converged Plan)
- Track A — Planner Factory & Modes
  - [x] Split planner into Selector + Decomposer (10a)
  - [x] Decomposer (LLM BYOM: OpenAI/Anthropic/Ollama/CLI) with strict JSON + retry (10/10a)
  - [~] Lightweight/offline finite‑state mode (folded from item 1)
  - [ ] Formal adapters + config file + env/CLI resolution (10)
- Track B — Orders→Tasks DAG Scheduler
  - [ ] Unified DAG scheduler (replaces tinyToScenario) with dependsOn/parallelizable validation (12)
  - [ ] Pre‑exec hard validation + error surfacing in summaries
- Track C — Orchestrator UX & Observability
  - [x] Wire --selector/--decomposer, per‑stage telemetry, DAG validation pre‑exec
  - [ ] Surface DAG errors in UI summaries with clear remediation
- Track D — Routing & Selection
  - [ ] Bandit‑based agent selection (2)
  - [ ] Semantic routing fallback (embedding/ngram hybrid) (3)
- Track E — Providers & Bench
  - [x] Bench baseline + pricing (7)
  - [ ] Prompt profiles per provider (7)
- Track F — Policy & DTAs
  - [x] Strict tools enforcement + redaction (8)
  - [ ] Queue/backpressure policies at orchestrator (8)
  - [ ] Deterministic Tool Adapters (DTAs) with verify gates (15)
- Track G — UX Layers
  - [ ] Scenario Builder UX (guided product builder) (5)
  - [ ] Streaming dashboard (TUI/Web) (6)
- Track H — Hygiene & Tests
  - [x] README/README.CODEX path fixes; docs sweep (env/flags)
  - [ ] Memory adapter window() import + unit test
  - [ ] Bundle hygiene: review stray files under codex/agents root
  - [ ] Doc snippet test to prevent drift

## Convergence Summary
- Item 1 (Lightweight Planning Model) is folded into Track A as a finite‑state selector/decomposer mode under the Planner Factory.
- Item 12 (Orders→Tasks Mapping) becomes the unified DAG Scheduler (Track B) and replaces ad‑hoc `tinyToScenario` logic.
- Item 7 consolidates Bench and Prompt Profiles into a single track.

# Roadmap — Raising the Bar for Agentic Orchestration

This roadmap lists high‑leverage improvements, why they matter, and confidence that they move the needle in the agentic space.

## 1) Lightweight Planning Model (local or on‑device)
- What: Add a tiny planning model (or distilled rules engine) to convert goals → phase plans offline, replacing heuristic fallback when an LLM is not available.
- Why: Removes dependency on a provider for planning; faster, cheaper, deterministic on common scenarios.
- How: Finite‑state planner with stack templates + constraint solver; optional small LM (e.g., 1–3B) for tie‑breaks.
- Status: Partial — heuristic baseline + tiny available; finite‑state planner TBD. Tracked under Planner Factory (Track A) as an additional mode.
- Confidence: High — improves reliability and speed in the hottest path (planning) without lock‑in.

## 2) Bandit‑Based Agent Selection
- What: Online learning of per‑agent performance (success, latency, quality) to shift traffic toward better agents.
- Why: Automatic adaptation improves outcomes and lowers cost/latency over time.
- How: Thompson sampling over tokens/capabilities; cache rewards; decay stale data; expose weights in events.
- Confidence: High — proven technique; transparent tie‑in to our existing metrics.

## 3) Semantic Routing Stage
- What: Add a compact embedding/char‑ngram hybrid to route novel phrasing when keywords/regex fail.
- Why: Raises recall without losing determinism (explainability remains via scores/reasons).
- How: Local n‑gram vectors (done) + optional small embeddings; cap cost; lattice with triggers.
- Confidence: Medium‑High — balances performance and determinism.

## 4) First‑Class Scaffold Agents & Templates
- What: Ship curated scaffold agents (Next+Supabase, tRPC, Turborepo, PlanetScale, shadcn/ui) with rich file templates.
- Why: Guarantees “first run wins” — users always see real artifacts.
- How: Expand `.claude/agents/scaffold*.md`; add stricter file schemas; enrich fallback generator.
- Confidence: High — immediate value and clear differentiation.

## 5) Scenario Builder UX
- What: CLI “scenario product builder” that stages goals → plans → artifacts → README/DELIVERY map.
- Why: Turns the kit into a reusable production path (repeatable outcomes with diffs and artifacts).
- How: Guided prompts + rules + checkpoints; export to docs/DELIVERY-MAP.md.
- Confidence: Medium — strong user utility; modest complexity.

## 6) Streaming UI (TUI/Web)
- What: Minimal dashboard for real‑time plan view, per‑alias streams, artifacts, and retry controls.
- Why: Improves transparency and control for multi‑agent sessions.
- How: TUI (blessed/ink) or tiny web UI over SSE; reuse events.jsonl.
- Confidence: Medium — quality of life; not a blocker.

## 7) Provider Bench and Profiles
- What: Profile prompt templates per provider; bench side‑by‑side with pricing/speed.
- Why: Data‑driven selection; cost control.
- How: docs/PROMPT-PROFILES.md + bench exports; tie usage reports to delivery maps.
- Status: Bench/pricing done; prompt profiles TBD.
- Confidence: Medium‑High — practical and measurable.

## 8) Policy & Safety Surfaces
- What: Tooling policy checkers, redaction rules, and queue backpressure at the orchestrator.
- Why: Safer operation at higher concurrency.
- How: Enforce stricter tool allowlists per alias; propagate policy events.
- Status: Strict tools + redact implemented; orchestrator backpressure TBD.
- Confidence: High — aligns with enterprise requirements.

## 9) Test Matrix & Smoke Commands
- What: Add `npm run smoke:*` tasks to validate scaffolds and routing.
- Why: Fast verification of end‑to‑end value.
- How: Scripts that check file presence, compile Next.js/Express locally (optional), and print next steps.
- Status: Unit tests expanded (planner/orchestrator); smoke scripts TBD.
- Confidence: High — reduces support friction.
-
## 10) Planner Factory (plannerfactory.md)
- What: A pluggable factory for planners with a stable contract and hot‑swappable backends (heuristic, tiny via Ollama, cloud LLM).
- Why: Lets teams pick the right planner per environment (offline, local CPU, or cloud) without touching orchestrator code.
- How: `plannerfactory.md` spec: interface, config resolution (env + file), validation/guardrails, telemetry, and selection rules.
- Status: Spec updated to Selector + Decomposer; partial implementation via new planner module; CLI/env wiring added.
- Confidence: High — formalizes the seam and reduces integration friction.

### 10a) Split Planner into Selector + Decomposer
- What: Separate fast, deterministic agent selection (Selector) from goal decomposition into a DAG and orders (Decomposer).
- Why: Improves explainability and control; enables heterogeneous strategies (heuristic selector + BYOM decomposer) and clearer guardrails per stage.
- How: Implement `selectAgents()` and `decompose()` per plannerfactory.md; add CLI flags `--selector` and `--decomposer`; orchestrator calls selector→decomposer when `--plan` is enabled; keep `composePlan()` for backward compatibility.
- Defaults (plannerf2): Selector=heuristic; Decomposer=llm (BYOM via configured runner — OpenAI/Anthropic/Ollama/CLI/Codex HTTP).
- Deliverables:
  - Heuristic Selector v1 (rules + similarity + capability gating + reasons/weights).
  - LLM Decomposer v1 (strict JSON, one retry then fallback to heuristic decomposer). Works with any LLM, including tiny via Ollama.
  - DAG validator (acyclic, valid edges, agent refs) and schema checks.
  - Telemetry events per stage; counters for decomposer success/fallbacks.
- Status: Selector/Decomposer implemented with validations/telemetry; tiny/cloud presets wired; BYOM `llm` mode added.
- Acceptance:
  1) Selector returns 2–5 agents with reasons on diverse prompts; no empty outputs.
  2) Decomposer produces ≤7 tasks with correct dependsOn; orders reference only selected agents.
  3) Orchestrator executes respecting DAG; summaries print stage modes and latencies.
  4) Fallbacks engage on invalid JSON without aborting runs.

## 11) Bootstrap Flow (codex:bootstrap)
- What: A guided setup that detects providers, offers planner selection, and performs a smoke test.
- Why: Onboards novices quickly; ensures tiny planner is installed and usable.
- How: Prompt user; if tiny selected, verify Ollama, pull model if missing; write config (`PLANNER_MODE=tiny`), run a planning smoke, show next commands.
- Status: Basic bootstrap present (validate/register/load). Expand to planner selection/validation.
- Confidence: High — reduces setup friction; increases early success rate.

## 12) Orders→Tasks DAG Scheduler
- What: Convert planner `{agents, plan, orders}` into an executable DAG with per‑alias queues; validate acyclicity and references; replace any ad‑hoc `tinyToScenario` mapping.
- Why: Improves quality of Execute phase without hand authoring.
- How: Alias lexicon + role templates; constrain to file‑output contract for scaffold agents; strict validator (dependsOn, agent refs) and clear error surfacing.
- Status: Planned — existing `tinyToScenario` is a stopgap; implement unified scheduler and retire the stopgap.
- Confidence: Medium‑High — immediate quality bump; low risk.

## 13) Finish Multi‑Agent v1 (from multiagent.md + multiagentclaude.md)
- What: Ship a robust, explainable multi‑agent flow covering selection → planning → execution → artifacts.
- Why: Core value prop — turn free‑form goals into tangible outcomes with transparent routing and safe scaffolding.
- How (deliverables):
  - Selector: Hybrid (rules + tf‑idf + n‑gram) with performance priors + capability gating; print reasons. [partially done]
  - Planner: Heuristic default + Tiny (Ollama) optional with strict JSON + retry + fallback. [done]
  - DAG execution: Respect dependsOn + parallelizable; expose `--concurrency`, per‑agent caps. [phase executor; expand to DAG]
  - Scaffold path: File‑output contract + patch applier + fallback starter; scaffold agents per stack. [done/minimal]
  - Memory: append per‑alias, redact; optional Redis; share/handoff hints. [done]
  - Observability: events, per‑phase summaries, live SSE (optional), metrics. [done/minimal]
  - Tests: routing/selectors, planner validation, patch applier, smoke scripts. [planned]
- Status: Most pieces done; finalize DAG execution + smoke tests to close v1.
- Acceptance Criteria:
  1) Free‑form goal always yields ≥2 agents with printed reasons.
  2) Plan prints with parallelizable steps; execution respects ordering and caps.
  3) On build goals, files are written under a dedicated folder (agents or fallback).
  4) Review goals embed file contents (runner‑agnostic), clean summaries print.
  5) Logs + metrics written; reruns are reproducible.
- Confidence: High — most pieces are present; finalizing DAG + tests will complete v1.

## 14) Bootstrap & Smokes (Assist Novices)

## 15) Deterministic Tool Adapters (from deterministic.md)
- What: Add Deterministic Tool Adapters (DTAs) that perform side‑effectful operations with measurable baselines, strict JSON outputs, and independent verifiers; planners can request DTAs; orchestrator enforces verified results.
- Why: Makes small‑model plans safe and auditable; enables CPU‑only, deterministic apply/verify loops (discover → propose → apply → verify).
- How: Implement reference DTA `link_updater` (discover/propose/apply/verify); add `tool_requests` to planner JSON; schedule DTAs in DAG; enforce `--strict-tools` and block downstream until verifier passes.
- Status: Planned.
- Confidence: High — directly addresses reliability for tiny‑model planning.

---

## Implementation Order (recommended)
1) Track B — DAG Scheduler (replace `tinyToScenario`; strict validation; error surfacing)
2) Track C — Orchestrator UX (surface DAG errors; timings; “why selected” reasons)
3) Track A — Planner Factory (finite‑state mode; formal adapters; config/env/CLI resolution)
4) Track D — Routing & Bandits (semantic fallback; priors; reasons/weights)
5) Track F — DTAs & Backpressure (verify gates; queue policies)
6) Track E — Bench & Profiles (optimize providers and prompt templates)
7) Track G — Scenario Builder & TUI (guided UX; live view)
- What: `npm run codex:bootstrap` adds planner choice, validates Ollama/model, writes config (`PLANNER_MODE=tiny|heuristic`), runs a tiny planner smoke, and prints next steps.
- Why: First‑run success (reduce setup friction). 
- How: Interactive script with non‑destructive checks and "copy/paste" commands; exit non‑zero on hard failures.
- Confidence: High — straightforward, valuable onboarding.

---

## Near‑Term Fixes & Hygiene (from recent review)

- README examples: correct var and YAML path
  - Problem: examples use `CODex_DIR` and omit `subdomain` when resolving YAML paths.
  - Action: update both README.md and README.CODEX.md to use `const CODEX_DIR = path.resolve('codex/agents')` and `path.join(domain, ...(subdomain?[subdomain]:[]), id + '.codex.yaml')`.
  - Why: prevents copy‑paste errors and aligns with docs/QUICKSTART.

- Memory adapter: fix window() import
  - Problem: `src/memory/adapter.mjs` imports `../runtime/memory_read.mjs` (missing); `readLastLines` lives in `src/runtime/memory.mjs`.
  - Action: change import to `../runtime/memory.mjs` and call `readLastLines` from there; add a unit test for `.window()`.
  - Why: restores file‑backed memory window and avoids runtime errors without Redis.

- Tests: add small safety nets
  - Memory window test (file backend) to catch regressions in adapters.
  - “Doc snippet” test that evaluates README registry‑load example (with `subdomain`) to prevent future drift.

- Docs: consolidate and surface env/config
  - Add an Environment Variables section (RUNNER, RUN_CMD, PORT, MEM_REDIS_URL, OPENAI_API_KEY, OPENAI_API_BASE, OLLAMA_URL, MODEL, PLANNER_MODE) to QUICKSTART or RUNNER, and cross‑link cleanup locations (`.runs/**`, `data/logs/events.jsonl`, `data/memory/**`).
  - Align wording across README/README.CODEX/QUICKSTART to avoid subtle differences.

- Bundle hygiene (non‑destructive)
  - Observation: stray files exist at `codex/agents/` root (e.g., `filename.txt`, `reviewer.yaml`, `id reviewer name Code.txt`, `swarm-planner.yaml`).
  - Action: add a review step to identify and relocate/remove non‑generated artifacts (e.g., into tests or `.claude/agents`) before conversion; do not modify generated YAMLs. Confirm with owner before deleting.
  - Why: keep the derived bundle deterministic and clean for consumers.o
