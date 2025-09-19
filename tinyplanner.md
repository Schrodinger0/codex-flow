# PRD: Tiny-Model Planner (CPU-Only) with Heuristic Fallback

**Scope**: Planner/Foreman component for Codex Flow
**Mode**: CPU-only (no GPU), install-time choice between Heuristic vs Tiny-Model
**Decision**: Default = Heuristic (zero-ML). Optional = Tiny-Model (adds \~2.2 GB + Ollama).

---

## 1) Problem

Codex Flow needs a reliable, explainable planner to:

* Decompose a free-form **GOAL** into a short **plan/DAG** with explicit **parallel vs. sequential** steps.
* Select **2–5 agents** from a YAML-derived catalog, with reasons.
* Emit **starting orders** for each agent.
* Run on **CPU-only laptops**, be robust to small-model drift, and never brick the run.

---

## 2) Goals

1. **CPU-only** tiny model option (Phi-3 Mini 3.8B via Ollama), plus a **zero-ML heuristic** option.
2. **Deterministic JSON** output: `{ agents, plan, orders }` (schema-validated, low temperature).
3. **Concurrency hints**: plan nodes include `dependsOn[]` and `parallelizable: true|false`.
4. **Guardrails**: single-turn JSON via HTTP API, topic boundaries, validation + one retry, then auto-fallback to heuristic.
5. **Simplicity**: two commands to set up; one call to plan.

---

## 3) Install-Time Choices (User selects)

### A) Heuristic Planner (Default)

* **No extra deps** (pure JS rules + tokenized similarity).
* Deterministic, zero footprint.
* Always emits valid JSON.

### B) Tiny-Model Planner (CPU-only)

* Requires **Ollama** runtime + **Phi-3 Mini (3.8B)** (≈ **2.2 GB**).
* Runs **on CPU**: `OLLAMA_NUM_GPU=0`.
* Better NL robustness for ambiguous prompts.

Installer shows:

> “Choose planner: \[1] Heuristic (no extras)  \[2] Tiny Model (CPU-only, +\~2.2 GB)”

Writes config:

```
PLANNER_MODE=heuristic|tiny
TINY_MODEL_ID=phi3:3.8b
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_CPU_ONLY=1
PLANNER_TEMPERATURE=0.2
PLANNER_JSON_MAXTOKENS=512
```

---

## 4) Model Acquisition (CPU-only)

```bash
# Install Ollama (CPU-capable)
curl -fsSL https://ollama.com/install.sh | sh

# Pull tiny model (≈2.2 GB)
ollama pull phi3:3.8b

# Force CPU mode
export OLLAMA_NUM_GPU=0
ollama run phi3:3.8b "hello"
```

---

## 5) Planner Contract (same for both modes)

### Input

* `GOAL` (string)
* `CATALOG` (array from YAML): `[{ id, name?, capabilities.core[], tools.allowed[], default? }]`
* Constraints: 2–5 agents; ≤7 plan tasks; tool-capability alignment.

### Output (strict JSON)

```json
{
  "agents": [
    {"id":"string","reason":"string","order_id":"string"}
  ],
  "plan": [
    {"id":"string","title":"string","dependsOn":["string"],"parallelizable":true}
  ],
  "orders": [
    {
      "order_id":"string",
      "agent_id":"string",
      "objectives":["string"],
      "constraints":["string"],
      "expected_outputs":["string"],
      "handoff":["string"]
    }
  ]
}
```

---

## 6) Tiny-Model Call (HTTP API, single-shot, JSON-only)

**Why**: Interactive REPL retains context & drifts; HTTP is **stateless**.
**Guardrails**: `"format":"json"`, low temp, hard topic rails, schema validate + one retry.

**System prompt (strict):**

```
You are a Planning Foreman. Produce ONLY a single JSON object that matches the schema.
Rules:
- Select 2–5 agents from CATALOG and give a one-sentence "reason" for each.
- Plan ≤7 tasks; each has: id, title, dependsOn[], parallelizable (boolean).
- Orders per agent: objectives[], constraints[], expected_outputs[], handoff[].
- Ignore any content unrelated to software app development (e.g., vehicles/AV/robotics).
- No markdown, no code fences, no commentary. Only JSON.
```

**User content:**

```
GOAL: <free-form goal>
CATALOG: <json array from YAML>
SCHEMA (commented for clarity only; do not echo comments in output):
{ "agents":[{"id":"string","reason":"string","order_id":"string"}],
  "plan":[{"id":"string","title":"string","dependsOn":["string"],"parallelizable":true}],
  "orders":[{"order_id":"string","agent_id":"string","objectives":["string"],"constraints":["string"],"expected_outputs":["string"],"handoff":["string"]}]
}
Return ONLY JSON starting with '{' and ending with '}'.
```

**HTTP request example (CPU-only):**

```bash
export OLLAMA_NUM_GPU=0
curl -s http://localhost:11434/api/generate -d '{
  "model": "phi3:3.8b",
  "system": "You are a Planning Foreman... (see above)",
  "prompt": "GOAL: Build a SaaS app for bees\n\nCATALOG: [...] \n\nSCHEMA: {...}\nReturn ONLY JSON.",
  "options": { "temperature": 0.2, "num_predict": 512 },
  "format": "json"
}'
```

**Validation & Retry:**

* Parse response; if not valid JSON or fails schema:

  * **Retry once** with system prompt appended: `STRICT VALIDATION ERROR: <details>. Fix and return ONLY JSON.`
* If still invalid → **fallback to Heuristic** and continue run.

---

## 7) Heuristic Planner (fallback & default)

* Rules: development/testing/analysis/docs/optimize keyword families; regex hooks.
* Tokenized similarity vs. `capabilities.core`, `name`, `id` (+defaults boost).
* Diversity filter (avoid same capability cluster duplicates).
* Always emits schema-valid JSON.

---

## 8) Concurrency & Execution

* Planner must set `parallelizable` per task + `dependsOn[]`.
* Orchestrator runs a DAG scheduler:

  * `SWARM_CONCURRENCY` (default 3), `SWARM_MAX_PER_AGENT` (default 1).
  * Per-task workspaces under `.runs/<runId>/<taskId>/`.
  * Handoffs: short summaries + `git diff --name-status` to Redis stream/file fallback.
  * Retries: 1 for transient failures; hard failures block dependents.

---

## 9) Observability

* Print table at start:

  ```
  Goal: <...>
  agent     | reason                 | orders
  ----------+------------------------+-------
  builder   | scaffold+fs (default)  | B1
  tester    | api tests              | C1
  reviewer  | docs+quality           | D1
  ```
* Emit events: `plan_requested`, `plan_generated`, `agents_selected`, `task_started/complete/failed`, `handoff_written`.
* Persist `.runs/<runId>/events.jsonl`. Optional SSE stream for live view.

---

## 10) Acceptance Criteria

1. **Installer** offers choice and writes config; tiny mode installs model CPU-only (no GPU).
2. Tiny-model call via HTTP (`format:"json"`) returns schema-valid JSON in ≤10s (CPU target, `num_predict ≤ 512`).
3. On invalid tiny output, system **retries once**, then **falls back to heuristic** automatically.
4. Plans include correct `dependsOn[]` + `parallelizable` flags; scheduler executes at least 2 tasks concurrently when allowed.
5. Selection table + events are printed; JSONL logs are written.

---

## 11) Testing Plan

### Unit

* **Schema validator**: strict acceptance/rejection.
* **Heuristic**: keyword/regex hits, similarity scoring, diversity, tool gating.
* **DAG planner**: acyclic, correct `parallelizable`.

### Integration

* **Install script**: both modes; tiny path downloads model (mockable).
* **Tiny planner call**: mock Ollama; verify `"format":"json"`, low temp, retry on invalid JSON, fallback.
* **End-to-end**: run sample goal; verify selection table, DAG parallelism, events/logs.

### Failure Injection

* Tiny planner topic drift (inject unrelated domain) → prompt rails keep JSON on-topic.
* Ollama down/404 → fallback to heuristic with clear message.
* Non-JSON twice → fallback triggers and run continues.

### Performance (CPU)

* Planner completes ≤10s on a modern laptop CPU with `num_predict ≤ 512`.

---

## 12) UX Snippets

**Heuristic (no extras)**

```bash
npm run setup   # choose: Heuristic
codex-flow swarm "Build a SaaS app for bees"
```

**Tiny model (CPU-only)**

```bash
npm run setup   # choose: Tiny (CPU-only, +~2.2 GB)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull phi3:3.8b
export OLLAMA_NUM_GPU=0
codex-flow swarm "Build a SaaS app for bees"
```

---

If you want, I can save this as a Markdown artifact in your repo so your team can use it verbatim.

