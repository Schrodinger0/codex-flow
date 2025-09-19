Last updated: 2025-09-19

# Current Goal (What We’re Solving Now)
- Get a basic app built by agents — actually calling agents through Codex CLI and having agents write code files (not just a fallback scaffold).
- Verify end‑to‑end: server (CLI) → agents run (exit 0) → agent‑produced files appear under a scaffold dir → app runs.

# Immediate Next Steps (Agent‑built, no fallback)

Option A — Direct‑write via Codex CLI (workspace write, no approvals)
- Start server from a trusted Git repo (repo root):
```bash
cd /home/xanacan/Dropbox/code/codexflow1
export CODEX_AGENTS_DIR=/home/xanacan/Dropbox/code/codexflow1/codex/agents
codex-flow serve --runner cli --port 8787 \
  --run-cmd 'codex exec --json --full-auto --ask-for-approval never -'
```
- Run build with fallback disabled so only agent writes count:
```bash
codex-flow run \
  --prompt "Build a SaaS app for butterflies with supabase auth under scaffold/butterflies (frontend/, server/, docs/)" \
  --yes --plan \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --selector finite --decomposer llm \
  --apply-dry-run \
  --verbose
```
- Verify files were written directly by Codex in the repo (no fallback):
```bash
ls -la scaffold/butterflies
```

Option B — Files‑contract (agents return files[], orchestrator writes)
- Keep server as above, then force file outputs from builder roles:
```bash
cat << 'JSON' | codex-flow run --yes --plan \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/butterflies \
  --selector finite --decomposer llm \
  --verbose -f -
{
  "coder": [
    {
      "type": "work.request",
      "role": "coder",
      "goal": "Create a minimal Next.js page and a simple Express API",
      "constraints": [
        "No shell or network access; do not attempt localhost",
        "Do not modify files directly; return files via JSON"
      ],
      "output_contract": {
        "kind": "files",
        "schema": "{ \"files\": [ { \"path\": \"relative/path.ext\", \"content\": \"...\" } ] }",
        "alt": "```file:relative/path.ext\n<content>```"
      },
      "root_dir": "scaffold/butterflies",
      "instruction": "Return STRICT JSON only: {\\\"files\\\":[{\\\"path\\\":\\\"...\\\",\\\"content\\\":\\\"...\\\"}]}. Paths must be relative to \\\"scaffold/butterflies\\\" and prefer frontend/, server/, docs/."
    }
  ],
  "backend-dev": [
    {
      "type": "work.request",
      "role": "backend",
      "goal": "Add Express /api/health route and starter",
      "constraints": ["Return files via JSON only"],
      "output_contract": { "kind":"files","schema":"{ \"files\": [ { \"path\": \"relative/path.ext\", \"content\": \"...\" } ] }","alt":"```file:relative/path.ext\n<content>```" },
      "root_dir": "scaffold/butterflies",
      "instruction": "Return STRICT JSON only with files. Use server/index.mjs for Express and ensure /api/health returns { ok: true }."
    }
  ],
  "api-docs": [
    {
      "type": "work.request",
      "role": "docs",
      "goal": "Write brief run instructions",
      "constraints": ["Return files via JSON only"],
      "output_contract": { "kind":"files","schema":"{ \"files\": [ { \"path\": \"relative/path.ext\", \"content\": \"...\" } ] }","alt":"```file:relative/path.ext\n<content>```" },
      "root_dir": "scaffold/butterflies",
      "instruction": "Return STRICT JSON only with files. Create docs/README.md explaining how to run frontend and API."
    }
  ]
}
JSON
```
- Expected: events show `applied_patches` (no fallback line), files land under scaffold/butterflies.

# Smoke to Confirm CLI Path
```bash
which codex && codex --version && codex whoami
printf 'USER:\nReview the text "hello world"\n\nASSISTANT:\n' | codex exec --json --skip-git-repo-check -
```

# Next Actions: Clean Test Pass for Codex Flow

This is a practical checklist to verify the current system end‑to‑end from a fresh machine. It assumes zero prior state and focuses on producing a real scaffolded project and a clean code‑review run.

## 0) Prereqs
- Node.js: 18+
- Git: latest
- Optional (recommended): Codex CLI installed and logged in (`codex --version`, `codex whoami`). If Codex isn’t installed, you can still run with OpenAI/Ollama, but this guide defaults to Codex CLI to avoid per‑call fees.

## 1) Fresh Install
```bash
git clone <this-repo-url> codexflow-clean
cd codexflow-clean
npm ci
```

## 2) Register/Update Agents (includes the new Scaffold agent)
```bash
npm run convert
```
Expected: `codex/agents/**`, `codex/agents/index.json`, and `codex/agents/triggers.json` regenerate.

## 3) Start the Local Helper (Codex runner)
```bash
node bin/codex-flow.mjs serve
```
- Default runner is `cli` (Codex CLI). Leave this terminal open.
- Check at `http://localhost:8787/` — you should see `{ ok: true, runner: "cli", ... }`.

If you don’t have Codex CLI: start with Ollama instead (has to be installed separately):
```bash
node bin/codex-flow.mjs serve --runner ollama --model llama3
```

## 4) Sanity: Built‑in Orchestrator Demo (stub)
```bash
npm run orchestrate:example
```
Expected: a quick parallel run in “stub” mode with a summary printed.

## 5) End‑to‑End: Three Novice Scenarios (copy/paste)

A. “Build a SaaS app for butterflies” (creates a folder with a runnable starter)
```bash
node bin/codex-flow.mjs run \
  --route "Build a SaaS app for butterflies with supabase auth" \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/butterflies --verbose
```
Expected:
- A plan prints, then files appear under `scaffold/butterflies` (either from agents or the fallback scaffolder).
- You should see lines like `files: frontend/app/page.tsx, server/index.mjs, prisma/schema.prisma ...` in the summary.
- Inspect:
```bash
ls -la scaffold/butterflies
```

B. “Review the code in this repo” (bundles file contents so the agent can read them)
```bash
node bin/codex-flow.mjs run \
  --route-files src/runtime/adapter.mjs src/router/index.mjs \
  --runtime codex --codex-url http://localhost:8787 --provider cli --verbose
```
Expected:
- Clean summary (no numeric noise), with findings for each file. We embed file text automatically so the agent never needs to shell out.

C. “Write a book on the letter h” (no scaffolding; pure generation)
```bash
node bin/codex-flow.mjs run \
  --prompt "Write a short book outline on the letter H: history, usage, humor" \
  --yes --runtime codex --codex-url http://localhost:8787 --provider cli --verbose
```
Expected:
- The plan prints (Plan → Execute). Output is textual and summarized in the console; artifacts (if any) are saved under `.runs/**`.

D. Same as A, but using the Tiny Planner (CPU‑only via Ollama)
```bash
# In a third terminal, ensure Ollama is available and CPU mode is set
export OLLAMA_NUM_GPU=0
export OLLAMA_URL=http://127.0.0.1:11434

node bin/codex-flow.mjs run \
  --route "Build a SaaS app for butterflies with supabase auth" \
  --planner tiny \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/butterflies-tiny --verbose
```
Expected:
- Plan is produced by the tiny planner (or auto‑fallback to heuristic) and files are written under `scaffold/butterflies-tiny`.

## 6) Review Code With Embedded Content

Test the “review code” path so the runner doesn’t need FS access (we bundle file contents automatically):
```bash
node bin/codex-flow.mjs run \
  --route "Review src/runtime/adapter.mjs" \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --verbose
```
Expected: the payload includes the file text; the summary prints concise findings (no binary noise). For multiple files:
```bash
node bin/codex-flow.mjs run \
  --route-files src/runtime/adapter.mjs src/router/index.mjs \
  --runtime codex --codex-url http://localhost:8787 --provider cli
```

Tip: Disable bundling and rely on the runner’s local read (if it supports it): add `--no-bundle-files`.

Tiny Planner quick validation (optional):
```bash
ollama list            # expect to see phi3:3.8b
curl -s $OLLAMA_URL/api/tags | jq '.models[].name' | head
```

## 7) Try More Stacks
- tRPC: include “trpc” in your goal — rules select `next+trpc+prisma`.
- Turborepo: include “turborepo” or “monorepo”.
- PlanetScale: include “planetscale” — rules select `next+planetscale+prisma`.
- shadcn/ui: include “shadcn” — Tailwind/shadcn baseline files added.

Example:
```bash
node bin/codex-flow.mjs run \
  --route "Scaffold a monorepo Turborepo with Next.js web and shared UI package" \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/turbo-monorepo
```

## 8) Observability + Artifacts
- Events: `tail -n 100 data/logs/events.jsonl`
- Metrics snapshot: `cat data/metrics/agents.json`
- Run outputs: `.runs/<alias>/<taskId>/output.json`

## 9) Troubleshooting
- “codex-flow: command not found”: run via Node directly (`node bin/codex-flow.mjs ...`) or `npm link` once to install the CLI globally.
- Server banner says “local server”: That is correct — it proxies to your chosen runner. Check GET `/` to confirm `runner=model`.
- No files written: Ensure you passed `--apply-patches` (remove `--apply-dry-run` which is off by default here). The fallback scaffolder writes a baseline if no agent returns files.
- Noisy numeric output: We sanitize summaries; if you still see noise, omit `--verbose` for a cleaner log.

## 10) Optional: Convert Agents (make Scaffold visible)
We added a source at `.claude/agents/scaffold.md`. To include it in the registry and triggers:
```bash
npm run convert
```

## 11) Cleanup & Re‑run
```bash
rm -rf scaffold/dungbeetlesaas .runs data/logs/events.jsonl
node bin/codex-flow.mjs run \
  --route "Build a next+trpc+prisma starter with auth" \
  --runtime codex --codex-url http://localhost:8787 --provider cli \
  --apply-patches --scaffold-dir scaffold/trpc-starter
```

---

If you want me to script a “smoke” command that validates the scaffold (e.g., checks expected files and prints next steps), say the word and I’ll add `npm run smoke:scaffold`.
