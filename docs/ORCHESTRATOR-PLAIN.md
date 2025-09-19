Last updated: 2025-09-19

# Orchestrating Multiple AI Agents — Plain English Guide

This page explains in simple terms what the new pieces are, why we added them, and what it means for you.

## What These Things Are
- Agents: Pre‑defined AI “helpers,” each good at a specific job (e.g., code review, architecture). They live as ready‑to‑use files inside `codex/agents`.
- Bundle: A neatly packed folder of agents so your app (or this project) can load them quickly without guessing their settings.
- Orchestrator: A tiny program that hands tasks to several agents at once so work happens in parallel.
- Aliases: Nicknames for agents. They let you run two copies of the same agent at the same time (like having two reviewers) without confusion.
- Concurrency: How many tasks a single agent can do at once. The agent files suggest a safe number, and the orchestrator respects it.
- Tasks File: A simple list of things you want each agent (or alias) to do. We keep an example at `examples/orchestrator-tasks.json`.
- Package Scripts: Shortcuts you can run with `npm run ...` so you don’t have to remember long commands.

## Why We’re Using Them
- Speed: Multiple agents working in parallel finish faster than one agent doing everything in order.
- Clarity: Different “helpers” for different jobs keeps responsibilities clear and results easier to review.
- Repeatability: A small, readable script makes it easy to run the same process every time.

About the “stub” vs “codex” modes:
- Stub mode: Fast demo mode. Pretends to run work and shows timing so you can see the flow. No external services are contacted.
- Codex mode: Real calls to a Codex endpoint that actually performs the work. You turn this on with a flag when you’re ready.

## What Changed (and What It Does)
- scripts/orchestrator.mjs: New. It loads the agent bundle, understands aliases, obeys each agent’s concurrency setting, and runs tasks in parallel. It includes a tiny “fake” `executeTask` function you can later connect to your real runtime.
- examples/orchestrator-tasks.json: New. A fill‑in‑the‑blanks list of tasks grouped by alias. Edit this to try your own tasks.
- package.json scripts: Updated. We added:
  - orchestrate:example — Runs a built‑in demo (no edits needed).
  - orchestrate — Runs whatever you put in `examples/orchestrator-tasks.json`.
- docs/ORCHESTRATOR.md: New detailed guide (both non‑technical and technical sections). This plain‑English page is a companion.

Simpler commands:
- `codex-flow init` — one-time agent setup
- `codex-flow run` — run tasks (uses the examples file by default)
- `codex-flow swarm "<goal>"` — free‑form swarm
- `codex-flow cleanup` — prune old run artifacts and logs

## What This Means For You
- Non‑technical users: You can run a realistic demo without touching code.
  - Try it: `npm run orchestrate:example`
  - Customize: Edit `examples/orchestrator-tasks.json` then `npm run orchestrate`
- Technical users: You have a tiny, readable starting point to integrate real execution (replace the `executeTask` stub) and plug into your workflows.

## Safety and Limits (Plain Advice)
- The orchestrator is a helper, not a gatekeeper. It won’t “stop” an over‑ambitious task—so keep tasks small and clear.
- Running two copies of the same agent with aliases is fine; keep their work separate so results don’t overwrite each other.
- Timeouts and resource limits written in agent files are guidelines; your actual runtime should enforce them.

## One‑Minute Demo
1) Initialize once: `codex-flow init`
2) Run the demo: `codex-flow run --example`
3) Change tasks in `examples/orchestrator-tasks.json`
4) Run your version: `codex-flow run`
5) Read the summary at the end (who did what, how long it took)

You now have parallel AI helpers working together with minimal setup.

## Switch to Real Codex Calls (Optional)
When you’re ready to call a Codex service in real time:
- Make sure you have a Codex endpoint URL and API key from your team.
- Run with:
  - `codex-flow run --example --runtime codex --codex-url https://your-endpoint --codex-key YOUR_KEY`

## Connect to Codex (step‑by‑step, no jargon)

What is the “built‑in local server”?
- It’s our tiny helper included in this repo. When you start it, it runs at `http://localhost:8787` on your computer.
- The orchestrator sends work to this helper. The helper then asks a provider (your Codex CLI, OpenAI, Anthropic/Claude, Ollama, or another CLI) to do the AI work.
- “Run tasks against it” means: point the orchestrator at it with `--codex-url http://localhost:8787`.

Follow these baby steps:

1) Choose how the AI runs (the provider)
- Codex CLI (default, no extra keys): Uses your Codex CLI Pro locally. No per‑call API fees.
- OpenAI (API key): Hosted models like `gpt-4o-mini`.
- Anthropic/Claude (API key): Hosted models like `claude-3-5-sonnet-20240620`.
- Ollama (no key): Local models running on your machine.
- Custom CLI: Any command that can read from stdin and print a reply.

2) Start the local helper (it connects to your choice)
- This starts the included server and wires it to your provider choice. Open a terminal and run ONE of these:
  - Codex CLI (recommended if you have Pro):
    ```bash
    # Uses your installed Codex CLI under the hood
    codex-flow serve
    ```
    Notes: This default uses the bundled adapter script (`scripts/codex-cli-runner.mjs`) which calls `codex exec --json -`. Make sure `codex` is installed and you’re logged in.
  - OpenAI:
    ```bash
    export OPENAI_API_KEY=your_key_here
    codex-flow serve --runner openai --model gpt-4o-mini
    ```
  - Anthropic (Claude):
    ```bash
    export ANTHROPIC_API_KEY=your_key_here
    codex-flow serve --runner anthropic --model claude-3-5-sonnet-20240620
    ```
  - Ollama (local):
    ```bash
    codex-flow serve --runner ollama --model llama3
    ```
  - Your own CLI:
    ```bash
    # Replace with a command that reads a prompt from stdin and prints a result to stdout
    codex-flow serve --runner cli --run-cmd 'your-command --optional-flags'
    ```
    Plain English: we’ll send a small JSON payload on stdin (task + agent id). Your command writes the answer to stdout.

  Leave this window open; it shows logs.

3) Check it’s running (optional)
- Open `http://localhost:8787/` in a browser. You should see a small JSON message.

4) Run a simple task (in a second terminal)
- Copy/paste:
  ```bash
  codex-flow run \
    --route "Review src/runtime/adapter.mjs" \
    --runtime codex --codex-url http://localhost:8787 \
    --stream --verbose
  ```
- What it does:
  - `--route "..."` lets the router pick the right agent.
  - `--runtime codex --codex-url ...` tells it to use the helper you started.
  - You’ll see live text in the terminal.

Need a real “build a project” example?
```bash
node bin/codex-flow.mjs run \
  --route "Build a SaaS app for butterflies with supabase auth" \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/butterflies --verbose
```
Expected: a new folder `scaffold/butterflies` with frontend/server/prisma/supabase files.

5) Where results go
- Terminal: a summary when it finishes.
- Files: `.runs/...` and `data/logs/events.jsonl` capture details and events.

Want to use a cloud Codex endpoint instead?
- Ask your team for the base URL (e.g., `https://codex.company.tld`) and an API key.
- Run this (no local server needed):
  ```bash
  codex-flow run \
    --route "Review src/router/index.mjs" \
    --runtime codex --codex-url https://codex.company.tld --codex-key $CODEX_API_KEY \
    --provider openai --stream --verbose
  ```

Notes
- Easiest path: just run `codex-flow serve` (uses your Codex CLI) and then the run command above.
- The summary prints `Runtime: codex` and the endpoint so you can confirm which path you used.
- Gemini support is not wired here yet (planned). Use OpenAI, Anthropic (Claude), Ollama, Codex CLI, or your own CLI.
