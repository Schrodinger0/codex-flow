Last updated: 2025-09-19

# Delivery Map — Implemented Capabilities and 10x Alternatives

| Area | What It Does | Why It’s There | How To Use | Innovation (1–5) | 10x Alternative (Idea) |
|---|---|---|---|---:|---|
| Simplified CLI | Single entry: `init`, `run`, `swarm`, `cleanup` | Claude Flow–like simplicity for onboarding and repeatability | `codex-flow init` → `codex-flow run` → `codex-flow swarm` | 4 | Package a zero-config “dev server” that hot-watches repo + agents, auto-routes and streams to a TUI dashboard |
| Deterministic Routing to Execution | Routes free-text and files via triggers into runnable task maps | Make routing explicit, transparent, testable | `codex-flow run --route "..."` or `--route-files a b` | 4 | Add bandit/feedback weighting on top of determinism with opt-in learning and drift guards |
| Strict Tool Enforcement | Deny tasks when requested tools aren’t allowlisted per agent | Safety and policy compliance | `--strict-tools` on `codex-flow run` | 4 | Per-agent policy compilation to an eBPF-like runtime for syscall/tool enforcement across containers |
| Memory (Redis + File Fallback) | Short-term windowed memory via Redis; file JSONL fallback | Fast recall, minimal ops friction | Set `MEM_REDIS_URL` to enable Redis; otherwise fallback is automatic | 3 | Full hybrid per PRD: Redis+Postgres+pgvector with policy-aware queries and streaming joins |
| Events + Artifacts | JSONL events, per-run input/output artifacts | Auditability, easy debugging | Inspect `data/logs/events.jsonl` and `.runs/<alias>/<taskId>/` | 3 | Pluggable OpenTelemetry exporter with span links across agents and artifact catalogs |
| Streaming Providers + SSE Server | Ollama/OpenAI streaming with chunks; local `/run?stream=1` SSE | Live UX parity with modern LLM runtimes | `codex-flow serve` and `--stream --verbose` on runs | 4 | Bi-directional streaming (WebSocket) with tool frames, partial states, and resumable runs |
| Per-Run Metrics | Summaries to `data/metrics/agents.json` | Quick feedback loop on latencies and volumes | Auto-written after each run | 2 | Prometheus-exported metrics with SLO burn alerts and per-agent dashboards |
| Planner (Retry + Revise) | Strict-JSON retry; optional phase revision between stages | More robust plans; adaptive execution | `codex-flow run --prompt "..." --revise-plan` | 3 | Full reflective planner with critique loops, budgeted replanning, and learned templates per domain |
| Orchestrator (Aliases + Concurrency) | Parallel tasks with alias binding and per-agent concurrency caps | Throughput with safety; mirrors agent fleet realities | `scripts/orchestrator.mjs` or `codex-flow run` | 4 | Work-stealing scheduler with per-alias priority queues and QoS-based throttling |
| Runtime Providers | OpenAI, Ollama, or CLI fallback | Flexibility; local-first or cloud | `codex-flow serve --runner ...` | 3 | Pluggable runner registry with capability negotiation and automatic failover |
| Cleanup | Prunes old run artifacts and truncates logs | Keeps local workspace healthy | `codex-flow cleanup ...` | 2 | Background janitor with policy per agent and time/space budgets |
| Tests | Router determinism and strict-tools unit tests | Prevent regressions on core flows | `npm test` | 2 | Scenario simulators and property-based tests for routing and concurrency |

Notes
- Innovation is subjective; ratings reflect novelty versus standard best practices.
- “10x alternatives” aim for strategic leaps; they may require more infra and policy work.

Key Paths
- Events: `data/logs/events.jsonl`
- Memory: Redis (if configured) or `data/memory/<alias>.jsonl`
- Artifacts: `.runs/<alias>/<taskId>/`
- Metrics: `data/metrics/agents.json`
