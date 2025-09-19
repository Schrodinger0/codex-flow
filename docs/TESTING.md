Last updated: 2025-09-19

# Testing Guide

Framework
- Node’s built‑in test runner (`node --test`). No extra deps.
- Unit tests live under `tests/codex/*.test.mjs`.
- Run all: `npm test`.

What’s covered
- Converter: schema fields and triggers (deterministic).
- Router: keyword/regex/file patterns.
- Adapter: strict‑tools policy.
- Providers: OpenAI/Anthropic adapters with a fake `fetch` (no network).
- Server: Local `/run` endpoint (demo/stream) end‑to‑end.

Environment
- No external network required. For provider unit tests, a fake `fetch` is installed.
- Integration with real providers is purposefully excluded from CI; add your own `.local.test.mjs` if needed.

Tips
- Keep tests deterministic and filesystem‑local.
- Prefer fakes/mocks over external calls.
- When adding a new provider, mirror the openai/anthropic tests and update docs.
- To assert decomposer validation in orchestrator runs, set `PLANNER_TEST_FORCE_INVALID=1` to force a known‑bad plan and verify a `decomposer_invalid` event in `data/logs/events.jsonl`.
