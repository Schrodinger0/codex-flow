Last updated: 2025-09-19

# Provider Matrix

Supported providers and configuration:

| Provider | Streaming | Env vars | Notes |
|---|---|---|---|
| OpenAI | Yes | `OPENAI_API_KEY`, `OPENAI_MODEL` (optional), `OPENAI_API_BASE` (optional) | Chat Completions API; usage tokens available for cost calc |
| Anthropic | Yes | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional), `ANTHROPIC_API_BASE` (optional) | Messages API; usage tokens available for cost calc |
| Ollama | Yes | `OLLAMA_URL` (default `http://127.0.0.1:11434`), `OLLAMA_MODEL` | Local models; cost defaults to $0 unless set via env |
| CLI | n/a | `RUN_CMD` | Any binary that reads JSON from stdin `{agentId, alias, task}` and writes text to stdout |

Provider selection:
- Per run: `codex-flow run --provider openai|anthropic|ollama|cli`
- Server default: `RUNNER=openai|anthropic|ollama|cli`

Cost calculation:
- OpenAI: `OPENAI_PRICE_IN`, `OPENAI_PRICE_OUT` (USD per 1K tokens)
- Anthropic: `ANTHROPIC_PRICE_IN`, `ANTHROPIC_PRICE_OUT`
- Ollama/CLI: `OLLAMA_PRICE_IN`, `OLLAMA_PRICE_OUT` (defaults: 0)

See also: `docs/BENCH.md` for benchmarking providers.

## Tiny Planner (Ollama)

Optional local planner to turn a free‑form goal into a phase plan before execution. Runs CPU‑only with a small model (e.g., `phi3:3.8b`).

Setup
```bash
ollama pull phi3:3.8b
export OLLAMA_NUM_GPU=0
export OLLAMA_URL=http://127.0.0.1:11434
```

Use in a run
```bash
node bin/codex-flow.mjs serve  # keep running
node bin/codex-flow.mjs run \
  --route "Build a SaaS app for butterflies" \
  --planner tiny \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/butterflies
```

Notes
- If tiny planner output is invalid JSON, we retry once, then fall back to heuristics automatically.
- If agents don’t return files, a baseline starter is generated in `--scaffold-dir`.

## Decomposer (LLM) Provider Selection (BYOM)

The `llm` decomposer auto-detects configured providers in this order:

1) `OPENAI_API_KEY` → OpenAI Chat Completions
2) `ANTHROPIC_API_KEY` → Anthropic Messages API
3) `OLLAMA_URL` → Ollama `/api/generate` with `format=json`
4) `RUN_CMD` → Your CLI (reads prompt on stdin; returns JSON on stdout)

Control per run with `--decomposer llm|tiny|cloud|heuristic`.
