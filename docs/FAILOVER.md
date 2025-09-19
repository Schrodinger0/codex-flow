Last updated: 2025-09-19

# Failover Policy (Draft)

Goal: Keep runs resilient by switching providers on errors/limits, with optional thresholds for cost/latency.

Concept
- Declare primary and fallback providers: `[openai, anthropic, ollama]`.
- Set retry/backoff and circuit-breaker rules for 429/5xx/timeouts.
- Optional thresholds: `maxLatencyMs`, `maxCostUsd` (per task), `retries`.

CLI
```bash
codex-flow run \
  --route "Review src/runtime/adapter.mjs" \
  --runtime codex --codex-url http://localhost:8787 \
  --provider openai --fallback anthropic,ollama \
  --stream --verbose
```

Server behavior
- On provider error/limit, try next provider after backoff with jitter.
- Log failover events to `data/logs/events.jsonl`.
- Optional: prefer local Ollama when all cloud providers fail.

Status
- Basic failover implemented for non‑streaming requests on the local server.
- Streaming failover remains best‑effort (primary only); future work to resume on fallback.
