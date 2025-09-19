# Repository Guidelines

## Project Structure & Module Organization
- `codex/agents/`: Generated Codex definitions. Do not hand‑edit. Includes `index.json` (registry) and `triggers.json` (routing).
- `src/tools/codex/agent-converter.js`: Converter core that transforms Claude Markdown agents into Codex YAML/JSON.
- `scripts/`: Utilities — `convert-agents-to-codex.mjs`, `orchestrator.mjs`, `codex-server.mjs`.
- `tests/codex/`: Lightweight regression tests (Node test runner).
- `docs/`: Orchestrator overview and plain‑English guide.
- `examples/orchestrator-tasks.json`: Sample tasks for the demo orchestrator.

## Build, Test, and Development Commands
- `npm run convert`: Rebuilds `codex/agents/**`, `index.json`, and `triggers.json`. Requires `.claude/agents` present at repo root.
- `npm test`: Runs converter tests via Node’s built‑in test runner.
- `npm run orchestrate:example`: Runs the parallel orchestrator with built‑in example tasks.
- `npm run orchestrate`: Runs orchestrator against `examples/orchestrator-tasks.json`.
- `npm run codex:serve`: Serves the generated bundle for local consumption.

## Coding Style & Naming Conventions
- Language: Node.js (ESM). Use `.mjs` for executable scripts; `.js` modules use `"type": "module"`.
- Indentation: 2 spaces; keep lines focused and self‑documenting.
- Agents: YAML files live at `codex/agents/<domain>/<id>.codex.yaml` (kebab‑case IDs).
- Lint/format: No enforced tool in repo; keep consistent style. If adding one, prefer Prettier defaults.

## Testing Guidelines
- Framework: Node’s test runner (`node --test`).
- Location: `tests/codex/*.test.mjs`.
- Conventions: Name tests `<topic>.test.mjs`; keep them deterministic and file‑system local.
- Run: `npm test`.

## Commit & Pull Request Guidelines
- Commits: Imperative mood, scoped when helpful (e.g., `convert: handle empty front‑matter`, `docs: clarify triggers`).
- PRs: Include purpose, summary of changes, and impact. Link issues; add before/after examples for agent routing or YAML output when relevant. Update tests when modifying the converter.

## Agent‑Specific Instructions
- Source of truth is `.claude/agents`. Edit Markdown there; regenerate with `npm run convert`.
- Avoid manual edits under `codex/agents/**`; they are derived artifacts.
- After converting, verify `codex/agents/index.json` and `triggers.json` diff as expected and optionally sanity‑run `npm run orchestrate:example`.

## Security & Configuration Tips (Optional)
- Do not commit secrets in Markdown or YAML. If `.claude/agents` is private, keep it out of version control.
- Use Node 18+ for ESM and the built‑in test runner.

