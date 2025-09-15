# Codex Flow

Codex Flow turns Claude Flow’s Markdown agents into a drop-in Codex registry. It ships with a ready-made bundle of Codex agents (already generated) and a converter script for rebuilding them whenever you update `.claude/agents`.

## What problem does it solve?
Claude Flow stores agents as Markdown with ad-hoc front-matter. That’s great for humans but rough on orchestration engines: every run they have to parse YAML, infer capabilities, build routing tables, and guess runtime policies. Codex Flow does that work once, producing structured YAML/JSON assets that Codex can ingest instantly.

## Why use it?
- **Plug-and-play**: 60+ Claude agents already converted; just point Codex at the bundle.
- **Rich metadata**: Capabilities, triggers, resource limits, memory policies, metrics, hooks—everything codified for automation.
- **Instant routing**: Keywords/regex/file-pattern tables ready for task dispatch.
- **Regenerates in seconds**: Modify a Markdown agent, re-run the converter, and you’re done.

## Quick start (ready-to-use mode)
You don’t need the original Claude repo to benefit. The bundle inside `codex/agents` is already converted.

### 1. Load agents into Codex runtime
In your Codex app (Node example):

```js
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const CODex_DIR = path.resolve('codex/agents');
const index = JSON.parse(fs.readFileSync(path.join(CODex_DIR, 'index.json'), 'utf8'));

for (const entry of index.agents) {
  const defPath = path.join(CODex_DIR, entry.domain, `${entry.id}.codex.yaml`);
  const definition = yaml.load(fs.readFileSync(defPath, 'utf8'));
  codexAgentRegistry.register(definition); // Implement register() for your runtime
}
```

If you’re using a service that supports bulk import, simply upload all `*.codex.yaml` files or the `index.json`.

### 2. Wire up trigger routing
`codex/agents/triggers.json` maps every keyword, regex, and file pattern to agent IDs.

```js
const triggers = JSON.parse(fs.readFileSync(path.join(CODex_DIR, 'triggers.json'), 'utf8'));

function matchAgent(task) {
  const text = task.toLowerCase();
  for (const keyword of Object.keys(triggers.keywords)) {
    if (text.includes(keyword)) {
      return triggers.keywords[keyword]; // array of agent IDs
    }
  }
  for (const rule of triggers.regex) {
    const regex = new RegExp(rule.pattern, 'i');
    if (regex.test(task)) {
      return rule.agents;
    }
  }
  return [];
}
```

Use this inside your dispatcher to auto-delegate tasks. File-based triggers (e.g. `**/*.test.ts`) are exposed in `triggers.file_patterns` for filesystem watchers or change-detection pipelines.

## Scenarios
- **Standalone Codex boost**: Duplicate this repo into your Codex deployment, load the index, and you instantly inherit Claude’s specialist swarm.
- **Internal catalogue**: Publish `codex/` as a browsable registry for other teams—no need to expose the original Markdown.
- **CI validation**: Run `npm run convert && npm test` in a pipeline to ensure agent edits stay schema-compliant.
- **Analytics dashboards**: Leverage the uniform metrics/memory sections to build health or SLA monitors.

## Regenerating from a Claude repo
If you have access to the original Markdown agents:

```bash
# Copy .claude/agents next to this project (or run in the Claude repo directly)
cp -R /path/to/claude-code-flow/.claude .

# Rebuild the Codex bundle
npm run convert

# Optional regression test
npm test
```

The converter rewrites `codex/agents/**`, `codex/agents/index.json`, and `codex/agents/triggers.json` in place.

## Project layout
```
codex/
├── agents/                  # Ready-made Codex definitions (YAML + briefs)
│   ├── index.json           # Fleet summary (load this first)
│   └── triggers.json        # Keyword/regex/file-pattern routing map
├── scripts/convert-agents-to-codex.mjs
├── src/tools/codex/agent-converter.js
├── tests/codex/agent-converter.test.mjs
└── README.md                # You are here
```

## CLI commands
```bash
npm run convert   # Regenerate Codex bundle (requires .claude/agents present)
npm test          # Lightweight regression test for the converter
```

## Building on top
- **Use the runner**: incorporate the code snippets above in your Codex bootstrap script.
- **Extend metadata**: add your own fields to the YAML and adjust the converter if you need custom tooling or permissions.
- **Automate routing**: persist the trigger map into your message bus or task orchestrator to keep delegations automatic.

## Contributing
1. `git clone` and `cd` into the project.
2. `npm install`
3. Update `src/tools/codex/agent-converter.js` or add tests.
4. `npm test`
5. Open a pull request.

## License
MIT

