Last updated: 2025-09-19

# Routing (Deterministic)

Deterministic stages, in order:
- File patterns → keywords → regex.
- First stage with any matches wins; results are agent IDs.

CLI
```bash
# Route a free-text task (show candidates)
codex-flow route "Review src/tools/codex/agent-converter.js" --json

# Route by files (show candidates)
codex-flow route --files src/tools/codex/agent-converter.js codex/agents/index.json --json

# Route and RUN in one command (deterministic dispatch)
codex-flow run --route "Review src/tools/codex/agent-converter.js" --plan
codex-flow run --route-files src/runtime/adapter.mjs src/router/index.mjs --plan
```

Library
```js
import { routeTask, routeFiles } from 'src/router/index.mjs';
const a = routeTask('Review README.md');
const b = routeFiles(['src/main.ts']);
```

Trace format
- routeFiles: returns matches with { path, pattern, agents }.
- routeTask: returns stage plus candidate agent IDs.
