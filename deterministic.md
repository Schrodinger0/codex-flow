 “deterministic tool adapters” into your planner/agent stack so small models can **request** deterministic actions and your runtime can **verify** them (count → act → re-count), all CPU-only.

# PRD Addendum: Deterministic Tool Adapters (DTAs)

## Purpose

Give the tiny planner (or heuristic planner) a way to **enforce determinism** in agents by routing side-effectful tasks through **Deterministic Tool Adapters** with:

* explicit **pre-measurements**,
* **JSON-only** results,
* a **self-check** verifier (e.g., Python) that confirms outcomes.

This turns instructions like *“update all links in the website to point here”* into a measurable pipeline: **discover → propose → apply → verify**, with machine-checkable evidence.

---

## Concepts

### Deterministic Tool Adapter (DTA)

A sandboxed adapter with a **strict contract**:

* **Inputs**: structured JSON (no free text).
* **Preconditions**: measurable baseline (counts, hashes, file lists).
* **Action**: deterministic transformation with fixed seed/ordering.
* **Outputs**: JSON summary + artifact manifest.
* **Verifier**: separate, reproducible checker (e.g., Python) that recomputes the measurement to confirm success.

### Enforcement

* Orchestrator runs agents with `--strict-tools`.
* Any side-effectful step **must** call an approved DTA; free-form edits are blocked.
* The run only proceeds if the DTA’s **verifier passes**.

---

## Planner & Factory Integration

* **Planner output** may include `tool_requests[]` (each maps to a DTA by `name`).
* If catalog lacks a suitable agent/tool, **PlannerFactory** can propose a derived agent **only** if it uses approved DTAs.
* Orchestrator schedules DTA tasks in the DAG (often parallelizable), gating downstream steps on `verified: true`.

---

## DTA Contract (Common Schema)

**Invocation (tool input)**

```json
{
  "tool": "link_updater",
  "version": "1.0",
  "mode": "dry-run|apply",
  "target": { "repo_path": "path/to/site", "glob": "site/**/*.html" },
  "params": {
    "from_hosts": ["http://old.example.com", "https://old.example.com"],
    "to_host":   "https://new.example.com"
  },
  "constraints": { "max_files": 5000, "timeout_ms": 300000, "seed": 42 }
}
```

**Adapter Output**

```json
{
  "tool": "link_updater",
  "ok": true,
  "phase": "verify|apply|dry-run",
  "baseline": { "files_scanned": 1234, "links_total": 9876, "links_to_update": 214 },
  "proposed_changes": { "files": 180, "link_updates": 214 },
  "applied_changes": { "files": 0, "link_updates": 0 },   // 0 for dry-run
  "artifacts": ["reports/link_updater/proposed.patch", "reports/link_updater/baseline.json"],
  "verifier": { "passed": true, "checks": ["counts_match", "no_404s_sampled"], "sample_size": 100 }
}
```

**Verifier Recipe (adapter-owned)**

* Runs **in a separate step** (same sandbox) and recomputes:

  * pre/post **counts** (links, files touched),
  * **hashes** for changed files,
  * optional **HTTP sample checks** (bounded, parallelizable),
  * returns `passed: true|false` with explicit failure reasons.

> All DTA outputs are **JSON only**. No prose.

---

## Reference DTA: `link_updater`

**Phases**

1. `discover`: count files & links; collect candidates (`baseline`).
2. `propose`: emit a unified `patch` and JSON plan (no side effects yet).
3. `apply`: apply patch (atomic), write manifest.
4. `verify`: re-count and **must** show `links_to_update → 0` for targeted hosts. Sample HTTP checks optional.

**Determinism rules**

* Fixed `seed`, deterministic file ordering (e.g., sorted paths), stable regex engine/version.
* Fail if repo changes mid-run (check working tree clean).

**Self-check**

* Verifier re-scans and compares counts; if mismatch, `verifier.passed=false` and the orchestrator **blocks** downstream tasks.

---

## Other Useful DTAs (examples)

* `json_schema_migrator`: ensures all `*.json` match a provided schema; proposes/apply fixes; verifies via re-validation.
* `rename_refactor`: renames symbols across codebase; counts occurrences before/after; verifies with grep/AST.
* `intra_repo_link_fixer`: fixes relative doc links; verifies by parsing all Markdown and checking local link targets exist.

Each DTA ships with:

* **Adapter** (deterministic action),
* **Verifier** (independent re-measurement),
* **Schema** for input/output,
* **Policy** (allowed paths, timeouts, rate limits).

---

## Policy & Safety

* **Approved DTAs only** (whitelist in config).
* **Allowed paths** per run (`src/**`, `docs/**`, etc.).
* **Dry-run first** by default; human or policy gates may be required before `apply`.
* **Soft locks** for files (avoid conflicts with parallel tasks).
* **Atomic apply**: apply patch or rollback; never partial writes.

---

## DAG & Parallelism

* DTAs are just **nodes** in the plan; set `parallelizable: true` when inputs don’t overlap.
* Typical flow for “update links”:

  ```
  P2 Scaffold ──▶ P3 LinkUpdater (dry-run) ──▶ Gate ──▶ P4 LinkUpdater (apply) ──▶ P5 Verify ──▶ P6 Docs/Release
  ```
* Multiple DTAs (e.g., link update + JSON schema fix) can run in parallel if globs don’t overlap; otherwise the scheduler serializes.

---

## Orchestrator Enforcement

* `--strict-tools` mode requires agents to **call DTAs** for side-effects.
* Orchestrator **rejects** agent outputs that attempt free-form writes when a DTA exists for that domain.
* Downstream tasks only start if `adapter.ok && verifier.passed`.

---

## Planner/Orders Additions

**Planner JSON gets a `tool_requests` list**:

```json
"tool_requests": [
  {
    "id": "T1",
    "tool": "link_updater",
    "reason": "Normalize domain move to new.example.com",
    "inputs_ref": "reports/planning/links-to-change.json"
  }
]
```

**Orders to agents include** a directive like:

```
Use the link_updater DTA in dry-run mode first.
Attach the generated patch to your PR summary and wait for Gate.
Do NOT write files directly; only through the adapter.
```

---

## Acceptance Criteria

1. For any side-effect task flagged by the planner, the agent uses a **DTA** (not ad-hoc edits).
2. Each DTA run emits **valid JSON** with `baseline`, `proposed_changes`, optional `applied_changes`, and `verifier`.
3. The verifier **must pass** before dependent nodes run.
4. Dry-run → Gate → Apply is supported and observable in logs.
5. Parallel DTA runs don’t corrupt files; soft locks prevent overlap.
6. End-of-run report lists: counts before/after, files changed, verifier status.

---

## Observability

* Stream events: `dta_started`, `dta_proposed`, `dta_applied`, `dta_verified`, `dta_failed`.
* Persist: `.runs/<runId>/dta/<tool>/<ts>-{baseline,proposed,applied,verify}.json`.
* CLI prints a compact table of before/after counts and verifier checks.

---

## Testing Plan (focused)

**Unit**

* Input/output schema validation for each DTA.
* Deterministic ordering & seed honored (same patch across runs).
* Verifier catches tampered outputs.

**Integration**

* Dry-run then apply; verify re-count matches expectations.
* Failure injection: mismatch counts → block downstream; proper error messaging.
* Parallel DTAs on disjoint path sets → both succeed; on overlapping sets → one defers via lock.

**Performance**

* CPU-only execution completes within configured `timeout_ms` on a laptop for typical repos (e.g., ≤ 5k files).

---

## Why this helps (and why a tiny model is useful)

* The **tiny model** doesn’t perform edits; it **requests** the right DTA and provides parameters.
* DTAs make side effects **predictable, auditable, and reversible**—critical when you’re “better at building,” continuously testing, and shipping distribution from day 0.
* You can still run **heuristic-only planning**; DTAs work either way.

---

If you want, I can fold this addendum into the existing **Planner (CPU-only) PRD** file and the **PlannerFactory PRD**, so your docs remain a single source of truth.

