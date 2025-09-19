# PRD: Multi-Agent Orchestration & Selection Engine

## Problem Statement
Codex Flow currently lacks an intelligent, explainable mechanism for selecting which agents to run when given a natural language goal (e.g., 'Build me a SaaS app for bees'). Current routing is brittle (regex/keywords only) and fails on unfamiliar inputs. Claude Flow solved this partially with keyword rules, but we want a simpler, more explainable, and five times more robust system.

## Goals
1. Natural language → agents: Map freeform goals into the right 2–5 agents.
2. Explainability: Always print which agents were selected and why.
3. Task planning: Decompose goals into a DAG, not just a list.
4. Execution: Run tasks through Codex CLI (or provider) with handoffs.
5. Memory & metrics: Persist per-agent memory, success/failure, latency.
6. Observability: Stream events and store JSON logs.
7. Parallelism: Support concurrent execution of independent tasks.
8. Simplicity: Keep implementation under ~500 LOC across modules.

## Key Features
1. **Hybrid Agent Selection**: Rule-based keywords, semantic similarity, bandit learning.  
2. **Task Graph Planning**: Directed acyclic graph ensures dependencies respected.  
3. **Capability Matching**: Hard constraints based on YAML-defined tools.  
4. **Memory & Metrics**: Redis + file fallback for agent memory and performance tracking.  
5. **Observability**: JSONL logs, SSE stream, CLI tables.  
6. **Execution**: DAG scheduler with concurrency, retries, and handoffs.  
7. **Parallelism**: Multiple tasks run concurrently, respecting dependencies.

## Execution Model & Scheduler
- Maintain PENDING, READY, RUNNING sets.  
- Concurrency default = 3; per-agent max = 1.  
- Scheduling policy: prioritize short-effort tasks, then criticality, then ID.  
- Isolation: tasks in `.runs/<runId>/<taskId>/`.  
- Handoffs: Git commit + Redis stream + file JSON fallback.  
- Retry on transient errors; hard failures block dependents.  
- Deterministic: tie-breakers ensure reproducibility.

## Memory & Metrics
- Memory stored per agent (Redis or JSONL fallback).  
- Metrics updated after each run: success rate, avg latency, quality score, workload.  
- Bandit-based selection improves over time.

## Observability
- Events: plan_generated, agents_selected, task_started, task_completed, task_failed, handoff.  
- Logs: `.runs/<runId>/events.jsonl`.  
- Console: live table of agent selection and progress.  
- End summary: Gantt-like chart with task durations and outcomes.

## Interface Changes
- Orchestrator CLI gains: `--concurrency`, `--max-per-agent`, `--timeout-ms`, `--retries`, `--mode seq|par`.  
- Runner contract unchanged (`POST /run {agentId, task}`).

## Acceptance Criteria
1. Any freeform goal always selects ≥2 agents.  

2. System prints a plan + reasons.  

3. Executes DAG with parallelism where possible.  

4. Logs and memory persisted correctly.  

5. Failures retried once; dependents blocked with clear reason.

   when routing yields no candidates, auto‑invoke the planner.  

## Testing Strategy
1. **Unit Tests**:  
   - Selector: rule/semantic/bandit scoring.  
   - Planner: DAG generation from sample goals.  
   - Scheduler: parallelism, retries, max-per-agent.  
   - Memory/metrics: Redis + fallback store.  

2. **Integration Tests**:  
   - Full swarm run with mock agents, verify correct selection, plan, and logs.  
   - Concurrency: tasks scheduled in parallel without deadlocks.  
   - Observability: JSONL logs contain expected events.  

3. **Failure Injection**:  
   - Simulate timeout, crash, invalid output → system retries/fails gracefully.  
   - Lock contention on files (two tasks modify same path).  

4. **Determinism**:  
   - Same input with same seed produces same plan and agent set.  
   - Logs match expected sequence.  

5. **Performance**:  
   - Stress test with 20+ tasks and CONCURRENCY=5.  
   - Verify system maintains throughput and respects constraints.

## Future Enhancements
- Streaming partial outputs.  
- Self-reflective re-planning.  
- Weighted context bus between agents.  
- TUI dashboard for live monitoring.

---

## Status & Next Steps (Implementation Plan)

What’s implemented (repo):
- Selector: Rules + capability/text similarity + success/latency priors; reasons are printed when used.
- Planner: Heuristic default; Tiny (Ollama phi3:3.8b) optional with strict JSON, one retry, then fallback.
- Execution: Phase‑based parallelism with per‑agent concurrency; safe patch applier + fallback scaffold generator.
- Review path: File contents bundled in payload for runner‑agnostic code reviews; clean summaries (no binary noise).
- Observability: Events JSONL + per‑phase summaries; quick metrics snapshot.

Next steps to finish v1:
1) DAG Scheduler: Replace phase buckets with a true DAG (dependsOn, parallelizable) honoring plan edges. Expose `--concurrency` and per‑agent caps.
2) Orders→Tasks: Map tiny planner `orders` to rich alias tasks (frontend/backend/docs/tester/scaffold) with file‑output contract.
3) Bandits: Persist per‑agent rewards (success, latency) and shift selection weights over time (Thompson sampling). CLI flag to print weights.
4) Tests: Unit for selector/planner/patch applier; integration smokes (build + review) with golden outputs.
5) Docs: Full doc sweep to reflect planner‑first fallback, rules stacks, file contract, and novice examples.

Acceptance (v1):
- Free‑form goals → ≥2 agents with reasons; plan prints; DAG respects edges; artifacts created under `--scaffold-dir`.
- Code review works across providers (bundled files), readable summaries.
- Events + metrics emitted; runs reproducible with fixed seeds/settings.
