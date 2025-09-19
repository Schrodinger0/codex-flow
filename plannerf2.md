 Here’s a clean PRD artifact for **Heuristic Selector + Codex Decomposer + Codex Executor**. This keeps your stack lean, avoids overcomplicating with a tiny local model, and still gives you safety + parallelism.
 
 Important: In this PRD codex the CLI for openai could be any LLM!
 

---

# PRD: Heuristic Selector + Codex Decomposer + Codex Executor + Orchestrator

**Scope:** Codex Flow Orchestration Layer
**Owner:** Orchestration Team
**Date:** 2025-09

---

## 1. Problem

The problem with agentic systems is that they’re usually tied to a single provider (Anthropic, OpenAI, etc.). This creates lock-in, brittle integrations, and heavy SDK dependencies.

We want a **BYOM** (“Bring Your Own Model”) orchestrator that:

* Works with *any* underlying LLM (via Codex CLI / APIs).
* Lets users run multi-agent workflows **simply** (two commands max).
* Ensures predictability, parallelism, and valid outputs.

---

## 2. Goals

* Separate orchestration into **clear, auditable stages**.
* Each stage has its own contract (input → output).
* Guarantee schema-valid JSON at all boundaries.
* Provide clear logging: which agents were selected, why, what the plan was, and how execution ran.
* Enable **parallelism** where possible, sequential execution where needed.

---

## 3. Architecture Overview

Pipeline:

```
User → Orchestrator → Selector → Decomposer → Executor → Orchestrator → User
```

### Components

#### A) Orchestrator

* **What:** The central control loop. Orchestrates flow between Selector, Decomposer, and Executor. Validates outputs. Collects logs. Returns results.
* **Why:** Without this, you get “loose scripts” that don’t connect. The Orchestrator enforces discipline: one entry point, one control plane, one logging format. It separates *process management* from *planning/execution*.

---

#### B) Heuristic Selector

* **What:** A lightweight rule-based system (keywords, regex) that picks candidate agents and suggests coordination phases. Runs instantly (<50ms).
* **Why:** Determinism. Users shouldn’t wait for an LLM just to figure out “you need a builder + tester.” A heuristic selector is fast, transparent, and easy to extend. It keeps the system responsive even offline.

---

#### C) Codex Decomposer (or any LLM)

* **What:** Given a goal + selected agents + coordination skeleton, the Decomposer outputs a strict JSON plan (DAG) and starting orders for each agent.
* **Why:** LLMs are excellent at breaking vague requests into steps. By isolating decomposition into this stage, we let Codex do what it’s best at (pattern expansion, ordering) while containing risk: outputs must pass schema validation.

---

#### D) Codex Executor (or any LLM)

* **What:** Executes tasks defined in the DAG. Respects `dependsOn` rules and parallelizes tasks where possible. Logs structured events (`task_start`, `task_complete`, `task_error`).
* **Why:** Execution is messy — failures, retries, partial results. Separating it from planning ensures we don’t mix “what to do” with “how it’s running.” Executor can evolve independently (e.g. retries, sandboxing, observability).

---

#### E) Validation + Observability Layer

* **What:** JSON schema validators + logs for each boundary.
* **Why:** LLMs are probabilistic. We need a deterministic guardrail between stages. Validation ensures downstream components never receive malformed data. Observability gives users confidence that orchestration is doing the right thing.

---

## 4. Deliverables

1. **Orchestrator CLI/API**

   * Single entry point.
   * Commands: `bootstrap`, `swarm "<goal>"`.
   * Wraps Selector → Decomposer → Executor.

2. **Selector**

   * Ruleset:

     * “build/create/implement” → builder
     * “test/validate/check” → tester
     * “analyze/review/document” → reviewer
   * Always returns 2–5 agents + reasons.

3. **Decomposer (Codex)**

   * Input: `{goal, agents, coordination}`
   * Output: `{plan, orders}`
   * Rules enforced: ≤7 tasks, DAG acyclic, parallelizable flagged.

4. **Executor (Codex)**

   * Input: `{plan, orders}`
   * Runs tasks with DAG awareness.
   * Logs progress to console + JSONL.

5. **Validation Layer**

   * JSON Schema enforced at Selector → Decomposer, Decomposer → Executor.
   * Automatic retry if schema invalid.

6. **Observability**

   * Console summary:

     ```
     🧩 Agents selected: builder, tester, reviewer
     📑 Coordination: Design → Scaffold → Implement/Test → Review
     📂 DAG: 5 tasks, 2 parallelizable
     ✅ Run complete
     ```
   * Persisted logs: `selector.jsonl`, `decomposer.jsonl`, `executor.jsonl`.

---

## 5. Acceptance Criteria

* Orchestrator runs Selector → Decomposer → Executor deterministically.
* Selector always returns schema-valid agent list.
* Decomposer always returns schema-valid JSON (retry ≤2).
* DAG is valid (acyclic, dependencies satisfied).
* Executor honors parallelism/sequencing.
* Logs show selection, DAG, and execution clearly.

---

## 6. Testing Plan

* **Unit tests**

  * Selector keyword→agent correctness.
  * Schema validation edge cases.
  * DAG validator (detect cycles, invalid dependsOn).

* **Integration tests**

  * Full pipeline on sample goals.
  * Verify logs + artifacts.
  * Parallelism confirmed with mock agents.

* **Failure injection**

  * Decomposer returns malformed JSON → schema retry.
  * Missing agent in plan → fallback safe default.
  * Executor task error → dependent tasks skipped.

---

## 7. Non-Goals

* No persistent memory across runs.
* No dynamic agent creation (future: PlannerFactory).
* No streaming/tool enforcement yet.

---

## 8. Future Work

* Add PlannerFactory (dynamic agent creation).
* Add Redis memory + context bus.
* Add structured observability (JSON logs + metrics).
* Add streaming providers for interactive runs.

---

✅ With this separation, you get:

* **Selector** = fast, deterministic filter (what’s relevant).
* **Decomposer** = flexible LLM brain (how to break it down).
* **Executor** = disciplined runner (how to actually run it).
* **Orchestrator** = the conductor (keeps everything in sync).

This is simple, explainable, and model-agnostic.

---

Do you want me to now **sketch a visual (Mermaid DAG diagram)** of this architecture with the *What/Why* inline so you can drop it into your repo docs?

