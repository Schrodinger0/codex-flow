Last updated: 2025-09-19

# Bench Guide — Compare Providers

Run the same prompt across providers and produce JSON, Markdown, and CSV summaries with latency, token usage, and cost.

Example
```bash
codex-flow bench \
  --prompt "Summarize our README" \
  --providers openai,anthropic,ollama \
  --stream
```

Output
- JSON: `data/bench/bench-<ts>.json`
- MD: `data/bench/bench-<ts>.md`
- CSV: `data/bench/bench-<ts>.csv`

Pricing
- Configure USD per 1K tokens via env:
  - `OPENAI_PRICE_IN` / `OPENAI_PRICE_OUT`
  - `ANTHROPIC_PRICE_IN` / `ANTHROPIC_PRICE_OUT`
  - `OLLAMA_PRICE_IN` / `OLLAMA_PRICE_OUT` (defaults 0)

Notes
- Streaming disables precise token usage for some APIs; for precise cost, run without `--stream` once to capture usage.
- Add your own smoke checks on content to score quality.
