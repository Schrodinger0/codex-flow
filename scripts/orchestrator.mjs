#!/usr/bin/env node
// Codex parallel orchestrator with alias support, plan, verbose progress,
// and a switchable runtime: stub (default) or codex (HTTP endpoint).

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { executeTask as adapterExecuteTask } from '../src/runtime/adapter.mjs';
import { appendEvent } from '../src/runtime/memory.mjs';
import { selectAgents as plannerSelect, decompose as plannerDecompose } from '../src/planner/index.mjs';
import { validateDAG as validateUnifiedDAG, planToScenario as unifiedPlanToScenario } from '../src/planner/dag.mjs';
import { routeTask as routeTextTask, routeFiles as routeFilePaths } from '../src/router/index.mjs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

// ---------- Config: define aliases (role names) ----------
// Map alias -> { id: baseAgentId, overrides?: partialDefinition }
const aliases = {
  // Code review example
  reviewer:  { id: 'code-analyzer', overrides: { runtime: { autonomy_level: 0.7 } } },
  reviewer2: { id: 'code-analyzer', overrides: { runtime: { autonomy_level: 0.9 } } },
  architect: { id: 'system-architect' },
  // Build-a-todo scenario
  planner:   { id: 'task-orchestrator' },
  frontend:  { id: 'coder' },
  backend:   { id: 'backend-dev' },
  docs:      { id: 'api-docs' },
  tester:    { id: 'tester' },
  validator: { id: 'production-validator' },
  scaffold:  { id: 'coder' },
};

// ---------- Utilities ----------
function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function readYAML(p) { return yaml.load(fs.readFileSync(p, 'utf8')); }
function deepClone(v) { return JSON.parse(JSON.stringify(v)); }
function deepMerge(target, source) {
  if (!source) return target;
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = deepMerge(target[k] ? { ...target[k] } : {}, v);
    else target[k] = v;
  }
  return target;
}

function withLimit(limit, items, worker) {
  const queue = [...items];
  const running = new Set();
  const results = [];
  return new Promise((resolve, reject) => {
    const launch = () => {
      while (running.size < limit && queue.length) {
        const item = queue.shift();
        const p = Promise.resolve().then(() => worker(item))
          .then((r) => results.push(r))
          .catch(reject)
          .finally(() => { running.delete(p); launch(); });
        running.add(p);
      }
      if (!queue.length && running.size === 0) resolve(results);
    };
    launch();
  });
}

function slugifyProjectName(text, fallback = 'project') {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
  if (!s) return fallback;
  return s.length > 40 ? s.slice(0, 40).replace(/-+$/,'') : s;
}

// ---------- Safe IO helpers ----------
function safeJoin(root, p) {
  const abs = path.resolve(root, p.replace(/^\/+/, ''));
  const normRoot = path.resolve(root);
  if (!abs.startsWith(normRoot)) throw new Error(`Unsafe path outside root: ${p}`);
  return abs;
}

// ---------- Registry loading ----------
function findAgentsDir(override = null) {
  if (override) return path.resolve(override);
  const env = process.env.CODEX_AGENTS_DIR;
  if (env && fs.existsSync(env)) return path.resolve(env);
  const home = process.env.HOME || process.env.USERPROFILE || null;
  if (home) {
    const p = path.join(home, '.codex', 'agents');
    if (fs.existsSync(p)) return p;
  }
  return path.resolve('codex', 'agents');
}

let AGENTS_DIR = findAgentsDir();
let index = readJSON(path.join(AGENTS_DIR, 'index.json'));

const registry = new Map();
for (const e of index.agents) {
  const defPath = path.join(AGENTS_DIR, e.domain, ...(e.subdomain ? [e.subdomain] : []), `${e.id}.codex.yaml`);
  const def = readYAML(defPath);
  registry.set(e.id, def);
}

// Load planner rules (optional)
const RULES_PATH = path.resolve('config/planner-rules.json');
let plannerRules = null;
try { plannerRules = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8')); } catch { plannerRules = null; }

function resolveAgent(idOrAlias) {
  const binding = aliases[idOrAlias];
  const baseId = binding ? binding.id : idOrAlias;
  const base = registry.get(baseId);
  if (!base) throw new Error(`Agent not found: ${baseId} (from ${idOrAlias})`);
  const def = deepClone(base);
  if (binding?.overrides) deepMerge(def, binding.overrides);
  def.agent = def.agent || {};
  def.agent.instance_alias = binding ? idOrAlias : undefined;
  return def;
}

// ---------- Free‑form agent selection (hybrid heuristic) ----------
function tokenizeGoal(goal) {
  return String(goal || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/:.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function capabilityKeywords(spec) {
  const caps = []
    .concat(spec?.capabilities?.core || [])
    .concat(spec?.capabilities?.extended || [])
    .concat(spec?.responsibilities?.primary || [])
    .concat(spec?.responsibilities?.secondary || []);
  return caps.map((c) => String(c).toLowerCase());
}

const SYNONYMS = new Map([
  ['build', ['scaffold', 'implement', 'generate', 'create', 'compose', 'ship']],
  ['review', ['lint', 'critique', 'audit', 'improve', 'refactor', 'analyze']],
  ['test', ['tests', 'pytest', 'unit', 'integration', 'qa', 'smoke']],
  ['plan', ['decompose', 'design', 'architecture', 'spec', 'roadmap']],
  ['ship', ['bundle', 'deploy', 'package', 'release', 'publish']],
  ['doc', ['document', 'readme', 'explain', 'write docs', 'api docs']],
  ['api', ['endpoint', 'rest', 'graphql', 'route', 'controller', 'service']],
  ['mobile', ['react native', 'ios', 'android', 'expo']]
]);

// Precompute agent profile terms for light semantic similarity
const agentProfiles = new Map(); // id -> { terms: Map(term -> tf), text: string }
const df = new Map(); // term -> doc frequency
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/:.]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
function buildAgentProfiles() {
  for (const [id, spec] of registry.entries()) {
    const parts = [];
    parts.push(id);
    parts.push(spec?.agent?.name || '');
    parts.push(spec?.agent?.description || '');
    (spec?.capabilities?.core || []).forEach((s) => parts.push(String(s)));
    (spec?.capabilities?.extended || []).forEach((s) => parts.push(String(s)));
    (spec?.responsibilities?.primary || []).forEach((s) => parts.push(String(s)));
    (spec?.responsibilities?.secondary || []).forEach((s) => parts.push(String(s)));
    const text = parts.join(' \n ');
    const terms = new Map();
    for (const t of tokenize(text)) terms.set(t, (terms.get(t) || 0) + 1);
    agentProfiles.set(id, { terms, text });
    // update DF
    const seen = new Set(terms.keys());
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
}
buildAgentProfiles();

function idf(term) {
  const N = Math.max(1, registry.size);
  const d = df.get(term) || 0;
  return Math.log(1 + N / (1 + d));
}
function semanticScore(agentId, goalTokens) {
  const prof = agentProfiles.get(agentId);
  if (!prof) return 0;
  let s = 0;
  for (const t of goalTokens) {
    if (prof.terms.has(t)) s += idf(t);
  }
  return s;
}

function scoreAgentForGoal(agentId, spec, goalTokens) {
  const id = String(agentId || '').toLowerCase();
  const name = String(spec?.agent?.name || '').toLowerCase();
  const text = `${id} ${name}`;
  const caps = capabilityKeywords(spec);
  let score = 0;
  const reasons = [];
  // semantic overlap (tf-idf style)
  const sem = semanticScore(agentId, goalTokens);
  if (sem > 0) { score += sem * 1.5; reasons.push('semantic'); }
  // character n-gram similarity (broad matching)
  const ng = ngramSimilarity(agentId, goalTokens.join(' '));
  if (ng > 0) { score += ng * 2.0; reasons.push('ngrams'); }
  // capability matches and synonyms
  for (const tok of goalTokens) {
    if (caps.some((c) => c.includes(tok))) { score += 2; reasons.push(`capability:${tok}`); }
    for (const [root, alts] of SYNONYMS) {
      if (tok === root || alts.includes(tok)) {
        if (caps.some((c) => c.includes(root) || alts.some((a) => c.includes(a)))) { score += 2; reasons.push(`syn:${root}`); }
      }
    }
    if (text.includes(tok)) { score += 1; reasons.push(`name/id:${tok}`); }
  }
  // light priors by domain common roles
  const domain = String(spec?.agent?.classification?.domain || '').toLowerCase();
  if (/architect/.test(id) || caps.some(c => /architecture|design/.test(c))) { score += 1; }
  if (/backend|api/.test(id) || domain === 'backend') { score += 1; }
  if (/docs|api-?docs/.test(id)) { score += 1; }
  // light performance prior from data/metrics/agents.json (lower avgMs gets a nudge)
  try {
    const metrics = JSON.parse(fs.readFileSync(path.resolve('data/metrics/agents.json'), 'utf8'));
    const m = metrics?.agents?.[agentId];
    if (m && typeof m.avgMs === 'number' && m.avgMs > 0) {
      const boost = 1 / Math.sqrt(m.avgMs); // diminishing returns
      score += boost;
      reasons.push('perf');
    }
  } catch {}
  // success-rate prior from logs
  const perf = getPerf(agentId);
  if (perf) {
    score += (perf.successRate || 0) * 1.0;
    reasons.push('success');
  }
  return { id: agentId, score, reasons: Array.from(new Set(reasons)) };
}

function selectAgentsForGoal(goal, { min = 2, max = 5 } = {}) {
  const toks = tokenizeGoal(goal);
  const CORE_IDS = new Set([
    'system-architect','coder','backend-dev','api-docs','tester','production-validator','cicd-engineer','mobile-dev','ml-developer','code-analyzer'
  ]);
  const pool = [];
  for (const [id, spec] of registry.entries()) {
    if (CORE_IDS.size && !CORE_IDS.has(id)) continue; // prefer core set when available
    pool.push({ id, spec });
  }
  // If core pool is empty (ids missing), fall back to all
  const entries = pool.length ? pool : Array.from(registry.entries()).map(([id, spec]) => ({ id, spec }));
  const scored = entries.map(({ id, spec }) => scoreAgentForGoal(id, spec, toks));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const top = scored.filter(s => s.score > 0).slice(0, Math.max(min, Math.min(max, scored.length)));
  // If no positive scores, fall back to a few sensible defaults if present
  if (!top.length) {
    const defaults = ['system-architect', 'coder', 'backend-dev', 'api-docs', 'tester'].filter(id => registry.has(id)).slice(0, max);
    return defaults.map(id => ({ id, score: 1, reasons: ['default'] }));
  }
  return top;
}

// ---------- Lightweight similarity (character n-grams) ----------
function charNgrams(text, n = 3) {
  const s = String(text || '').toLowerCase();
  const grams = new Map();
  for (let i = 0; i <= Math.max(0, s.length - n); i++) {
    const g = s.slice(i, i + n);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  return grams;
}
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) dot += (a.get(k) || 0) * (b.get(k) || 0);
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const agentNgrams = new Map(); // id -> Map(ngram->count)
function buildAgentNgrams() {
  for (const [id, prof] of agentProfiles.entries()) {
    agentNgrams.set(id, charNgrams(prof.text, 3));
  }
}
buildAgentNgrams();

function ngramSimilarity(agentId, goal) {
  const a = agentNgrams.get(agentId);
  if (!a) return 0;
  const g = charNgrams(goal, 3);
  return cosineSim(a, g);
}

// ---------- Task execution ----------
async function executeTask(def, task, opts) { return adapterExecuteTask(def, task, opts); }

// Wrap plain string tasks with an explicit output contract so agents produce files we can apply
function buildTaskPayload(alias, def, task, { applyPatches, stack, root, bundleFiles = true, bundleMaxBytes = 65536 }) {
  if (typeof task === 'object' && task !== null) return task; // already structured
  const goal = String(task || '');
  // Special handling for code review: optionally embed file contents to ensure consistent behavior across runners
  const isCodeReviewer = (def?.agent?.id === 'code-analyzer') || alias === 'reviewer' || /review/i.test(goal);
  const m = goal.match(/^\s*Review\s+(.+?)\s*$/i);
  if (isCodeReviewer && m && bundleFiles) {
    const filePath = m[1];
    let content = '';
    try {
      const abs = path.resolve(filePath);
      const data = fs.readFileSync(abs);
      content = data.slice(0, bundleMaxBytes).toString('utf8');
    } catch {}
    return { type: 'code.review', files: [filePath], contents: { [filePath]: content } };
  }
  if (!applyPatches) return goal; // leave simple if not applying for non-review tasks
  const requiresFiles = ['frontend','backend','docs','tester'].includes(alias) || /(implement|scaffold|write|generate|create)/i.test(goal);
  if (!requiresFiles && alias !== 'scaffold') return goal;
  const chosenStack = stack || 'next+nest+prisma+postgres';
  return {
    type: 'work.request',
    role: alias,
    goal,
    constraints: [
      'No shell or network access to user machine; do not attempt localhost calls',
      'Do not modify files directly; instead, return generated files in the specified format',
    ],
    output_contract: {
      kind: 'files',
      schema: '{ "files": [ { "path": "relative/path.ext", "content": "..." } ] }',
      alt: 'You may also return fenced blocks: ```file:relative/path.ext\n<content>```',
    },
    stack: chosenStack,
    root_dir: String(root || 'scaffold/app'),
    instruction: alias === 'scaffold'
      ? `Generate a minimal, runnable starter for stack "${chosenStack}" as a set of files under the project root "${root || 'scaffold/app'}". Use subfolders when relevant: frontend/, server/, prisma/, supabase/, mobile/, docs/. Include: Next.js frontend with page and API route (/api/health) if web, server with Express if backend, README with run steps, .env.example, docker-compose if Postgres. Return STRICT JSON only: {"files":[{"path":"...","content":"..."}]}.`
      : `Return STRICT JSON only: {"files":[{"path":"...","content":"..."}]}. Paths must be relative to "${root || 'scaffold/app'}" and prefer subfolders frontend/, server/, prisma/, supabase/, mobile/, docs/. No commentary.`,
  };
}

async function runParallel(taskBatchesByAlias, { runtime = 'stub', verbose = false, codexUrl = null, codexKey = null, strictTools = false, stream = false, applyPatches = false, scaffoldDir = 'scaffold', applyDryRun = true, retries = 1, stack = null, bundleFiles = true, bundleMaxBytes = 65536 } = {}) {
  const entries = Object.entries(taskBatchesByAlias);
  const perAliasRuns = entries.map(async ([alias, tasks]) => {
    const def = resolveAgent(alias);
    const limit = def?.runtime?.concurrency?.max_parallel_tasks ?? 1;
    let applied = 0;
    const results = await withLimit(limit, tasks, async (t) => {
      const payload = buildTaskPayload(alias, def, t, { applyPatches, stack, root: scaffoldDir, bundleFiles, bundleMaxBytes });
      let r = await executeTask(def, payload, {
        runtime,
        verbose,
        codexUrl,
        codexKey,
        strictTools,
        stream,
      onEvent: (ev) => {
        if (!verbose) return;
        if (ev.kind === 'policy_violation') console.log(`[policy] ${alias}/${def.agent?.id}: ${ev.detail} (${(ev.disallowed||[]).join(',')})`);
        if (ev.event === 'chunk' || ev.kind === 'chunk') {
          const c = ev.content || ev.delta || '';
          if (c) console.log(`[chunk] ${alias}: ${String(c).slice(0, 160)}`);
        }
        if (ev.kind === 'task_started') console.log(`[start] ${alias} (${def.agent?.id})`);
        if (ev.kind === 'task_complete') console.log(`[done ] ${alias} (${def.agent?.id}) in ${ev.ms || '?'}ms`);
      },
      });
      // simple retry on failure
      let attempts = 0;
      while (!r.ok && attempts < retries) {
        attempts++;
        if (verbose) console.warn(`[retry] ${alias} attempt ${attempts}/${retries}`);
        r = await executeTask(def, payload, { runtime, verbose, codexUrl, codexKey, strictTools, stream });
      }

      if (applyPatches && r && r.ok) {
        try {
          const files = await applyPatchesFromResult(alias, r, { dir: scaffoldDir, dryRun: applyDryRun });
          if (files && files.length) {
            applied += files.length;
            if (!verbose) console.log(`[apply] ${alias}: ${applyDryRun ? 'would write' : 'wrote'} ${files.length} file(s) to ${scaffoldDir}`);
            appendEvent({ ts: new Date().toISOString(), kind: 'applied_patches', alias, agentId: def.agent?.id, dryRun: applyDryRun, dir: scaffoldDir, files });
          }
        } catch (e) {
          console.warn(`[apply] ${alias}: ${e.message}`);
        }
      }
      return r;
    });
    return { alias, agentId: def.agent?.id, limit, results, appliedFiles: applied };
  });
  const settled = await Promise.allSettled(perAliasRuns);
  return settled.map((r) => r.status === 'fulfilled' ? r.value : r.reason);
}

// ---------- Output helpers ----------
function indent(text, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return text.split(/\r?\n/).map((l) => pad + l).join('\n');
}

// ---------- CLI ----------
function usage() {
  console.log(`Usage:
  node scripts/orchestrator.mjs --example [--verbose]
  node scripts/orchestrator.mjs --prompt "<freeform request>" [--yes] [--verbose]
  node scripts/orchestrator.mjs -f examples/orchestrator-tasks.json [--verbose]
  echo '{"reviewer":["Review A"],"architect":["Design B"]}' | node scripts/orchestrator.mjs -f -

Flags:
  --plan        Print an execution plan before running (default on)
  --no-plan     Skip plan output
  --dry-run     Print plan and exit without executing
  --prompt s    Freeform request; planner generates a multi-phase plan
  --yes         Auto-confirm executing the generated plan (freeform mode)
  --route s     Deterministically route free-text via triggers and run
  --route-files f..  Route files via triggers and run (as "Review <file>")
  --verbose     Print per-task start/finish lines
  --no-output   Hide per-task output in summary
  --runtime x   Execution mode: "stub" (default) or "codex"
  --codex-url u Codex HTTP endpoint (or set CODEX_URL)
  --codex-key k API key for Codex endpoint (or set CODEX_API_KEY)
  --strict-tools  Enforce tool allowlists; reject disallowed
  --stream      In codex mode, consume streaming chunks (print with --verbose)
  --apply-patches  Parse agent outputs for file blocks and write to scaffold dir
  --scaffold-dir d Target dir for generated files (default: scaffold)
  --apply-dry-run  Do not write files; print summary only
  --no-apply-dry-run  Write files when applying patches (default)
  --retries N     Retry failed tasks up to N times (default 1)
  --bundle-files  Embed file contents for code review tasks (default on)
  --bundle-max-bytes B  Max bytes per file when bundling (default 65536)
  --selector m  Selector mode: heuristic|tiny (default: heuristic)
  --decomposer m  Decomposer mode: heuristic|llm|tiny|cloud (default: heuristic)
  --agents-dir PATH  Override agents bundle directory (or set CODEX_AGENTS_DIR)
  --revise-plan Ask planner to revise next phases based on previous outputs
  --json        Emit machine-readable JSON instead of human logs
  -f, --file    Read JSON task map from file path or '-' for stdin
`);
}

function parseArgs(argv) {
  const args = { file: null, example: false, prompt: null, route: null, routeFiles: [], yes: false, plan: true, dryRun: false, verbose: false, showOutput: true, json: false, runtime: 'stub', codexUrl: process.env.CODEX_URL || null, codexKey: process.env.CODEX_API_KEY || null, strictTools: false, stream: false, provider: null, fallback: [], applyPatches: false, scaffoldDir: 'scaffold', applyDryRun: false, retries: 1, bundleFiles: true, bundleMaxBytes: 65536, selectorMode: process.env.SELECTOR_MODE || 'heuristic', decomposerMode: process.env.DECOMPOSER_MODE || 'heuristic', agentsDir: process.env.CODEX_AGENTS_DIR || null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--example') args.example = true;
    else if (a === '--prompt') args.prompt = argv[++i] || '';
    else if (a === '--yes') args.yes = true;
    else if (a === '--route') args.route = argv[++i] || '';
    else if (a === '--route-files') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) args.routeFiles.push(argv[++i]); }
    else if (a === '-f' || a === '--file') args.file = argv[++i] || null;
    else if (a === '--plan') args.plan = true;
    else if (a === '--no-plan') args.plan = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--no-output') args.showOutput = false;
    else if (a === '--json') args.json = true;
    else if (a === '--runtime') args.runtime = argv[++i] || 'stub';
    else if (a === '--codex-url') args.codexUrl = argv[++i] || args.codexUrl;
    else if (a === '--codex-key') args.codexKey = argv[++i] || args.codexKey;
    else if (a === '--strict-tools') args.strictTools = true;
    else if (a === '--stream') args.stream = true;
    else if (a === '--apply-patches') args.applyPatches = true;
    else if (a === '--scaffold-dir') args.scaffoldDir = argv[++i] || 'scaffold';
    else if (a === '--apply-dry-run') args.applyDryRun = true;
    else if (a === '--no-apply-dry-run') args.applyDryRun = false;
    else if (a === '--retries') args.retries = Math.max(0, Number(argv[++i] || 1));
    else if (a === '--bundle-files') args.bundleFiles = true;
    else if (a === '--no-bundle-files') args.bundleFiles = false;
    else if (a === '--bundle-max-bytes') args.bundleMaxBytes = Math.max(1024, Number(argv[++i] || 65536));
    else if (a === '--provider') args.provider = argv[++i] || null;
    else if (a === '--selector') args.selectorMode = String(argv[++i] || args.selectorMode);
    else if (a === '--decomposer') args.decomposerMode = String(argv[++i] || args.decomposerMode);
    else if (a === '--agents-dir') args.agentsDir = String(argv[++i] || args.agentsDir);
    else if (a === '--fallback') { const v = argv[++i] || ''; args.fallback = String(v).split(',').map(s=>s.trim()).filter(Boolean); }
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else { console.warn(`Unknown arg: ${a}`); }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.agentsDir || process.env.CODEX_AGENTS_DIR) {
    try {
      AGENTS_DIR = findAgentsDir(args.agentsDir);
      index = readJSON(path.join(AGENTS_DIR, 'index.json'));
      registry.clear();
      for (const e of index.agents) {
        const defPath = path.join(AGENTS_DIR, e.domain, ...(e.subdomain ? [e.subdomain] : []), `${e.id}.codex.yaml`);
        const def = readYAML(defPath);
        registry.set(e.id, def);
      }
    } catch (e) {
      console.error(`[agents] Failed to load from ${args.agentsDir || process.env.CODEX_AGENTS_DIR}: ${e?.message || e}`);
      process.exit(2);
    }
  }

  let taskMap;
  if (args.example) {
    const scenario = buildTodoScenario();
    await runScenario(scenario, args);
    return;
  } else if (args.prompt) {
    const scenario = await buildFreeformScenario(args.prompt, args);
    // Always show plan for confirmation unless --yes or --dry-run
    const proceed = await confirmScenario(scenario, args);
    if (!proceed) { console.log('Cancelled.'); return; }
    await runScenario(scenario, args);
    return;
  } else if (args.route || (args.routeFiles && args.routeFiles.length)) {
    let map = {};
    if (args.route) {
      const r = routeTextTask(args.route);
      for (const id of (r.candidates || [])) {
        if (!map[id]) map[id] = [];
        map[id].push(args.route);
      }
    }
    if (args.routeFiles && args.routeFiles.length) {
      const r = routeFilePaths(args.routeFiles);
      for (const id of (r.candidates || [])) {
        if (!map[id]) map[id] = [];
        for (const f of args.routeFiles) map[id].push(`Review ${f}`);
      }
    }
    if (!Object.keys(map).length && args.route) {
      // Planner-first fallback for freeform goals: build a small plan and run it
      if (!args.json) console.log('No trigger match. Planning tasks from the goal...');
      try { appendEvent({ ts: new Date().toISOString(), kind: 'no_trigger_match', goal: String(args.route) }); } catch {}
      const scenario = await buildFreeformScenario(args.route, args);
      // In route-fallback, auto-confirm and run the scenario end-to-end
      // Derive a project folder if applying patches and no custom dir provided
      let derivedDir = args.scaffoldDir;
      if (args.applyPatches && (!derivedDir || derivedDir === 'scaffold')) {
        const slug = slugifyProjectName(args.route, 'app');
        derivedDir = path.join('scaffold', slug);
      }
      // Attach project dir to scenario meta so payloads can reference it
      scenario.meta = scenario.meta || {};
      scenario.meta.projectDir = derivedDir;
      await runScenario(scenario, { ...args, plan: true, scaffoldDir: derivedDir });
      return; // we handled execution already
    }
    if (!Object.keys(map).length) { console.error('Routing produced no candidates.'); process.exit(2); }
    taskMap = map;
  } else if (args.file) {
    if (args.file === '-') {
      const text = fs.readFileSync(0, 'utf8');
      taskMap = JSON.parse(text);
    } else {
      taskMap = readJSON(path.resolve(args.file));
    }
  } else {
    usage();
    process.exit(1);
  }

  // Plan output
  const plan = [];
  if (args.plan || args.dryRun) {
    for (const [alias, tasks] of Object.entries(taskMap)) {
      const def = resolveAgent(alias);
      const limit = def?.runtime?.concurrency?.max_parallel_tasks ?? 1;
      plan.push({ alias, agentId: def.agent?.id, limit, tasks });
    }
    try { appendEvent({ ts: new Date().toISOString(), kind: 'plan_generated', runtime: args.runtime, endpoint: args.codexUrl || null, items: plan }); } catch {}
    if (args.json) {
      console.log(JSON.stringify({ kind: 'plan', runtime: args.runtime, endpoint: args.codexUrl || null, plan }, null, 2));
      if (args.dryRun) return;
    } else {
      console.log('=== Execution Plan ===');
      console.log(`Runtime: ${args.runtime} (${args.runtime === 'stub' ? 'no external Codex calls' : 'calls Codex HTTP endpoint'})`);
      for (const p of plan) {
        console.log(`- ${p.alias} → ${p.agentId} (limit=${p.limit})`);
        p.tasks.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
      }
      if (args.dryRun) { console.log('\nDry run: no tasks executed.'); return; }
      console.log('=== Starting Execution ===');
    }
  }

  const started = Date.now();
  const results = await runParallel(taskMap, {
    runtime: args.runtime,
    verbose: args.verbose,
    codexUrl: args.codexUrl,
    codexKey: args.codexKey,
    strictTools: args.strictTools,
    provider: args.provider,
    fallback: args.fallback,
    stream: args.stream,
    applyPatches: args.applyPatches,
    scaffoldDir: args.scaffoldDir,
    applyDryRun: args.applyDryRun,
  });
  // Note: streaming chunks printed live when --stream and --verbose are used

  const flat = [];
  for (const group of results) for (const r of group.results || []) flat.push({ alias: group.alias, agentId: group.agentId, ...r });

  const summary = {
    runtime: args.runtime,
    endpoint: args.runtime === 'codex' ? (args.codexUrl || null) : null,
    aliases: results.map(r => ({ alias: r.alias, agentId: r.agentId, limit: r.limit })),
    totalTasks: flat.length,
    elapsedMs: Date.now() - started,
    resultsByAlias: {},
  };

  const byAlias = new Map();
  for (const r of flat) {
    if (!byAlias.has(r.alias)) byAlias.set(r.alias, []);
    byAlias.get(r.alias).push(r);
  }
  for (const [alias, arr] of byAlias.entries()) {
    const ms = arr.reduce((a, b) => a + b.ms, 0);
    const okCount = arr.filter(r => r.ok).length;
    const successRate = arr.length ? okCount / arr.length : 0;
    summary.resultsByAlias[alias] = { agentId: arr[0].agentId, count: arr.length, ok: okCount, successRate: Number(successRate.toFixed(3)), avgMs: Math.round(ms / arr.length), tasks: arr.map(r => ({ summary: r.summary, ms: r.ms, ok: r.ok, output: args.showOutput ? r.output : undefined })) };
  }
  if (args.json) {
    console.log(JSON.stringify({ kind: 'summary', ...summary }, null, 2));
  } else {
    console.log('\n=== Orchestration Summary ===');
    console.log(`Runtime: ${summary.runtime} (${summary.runtime === 'stub' ? 'no external calls' : `endpoint=${summary.endpoint || 'n/a'}`})`);
    console.log(`Aliases: ${summary.aliases.map(a => `${a.alias}→${a.agentId}(limit=${a.limit})`).join(', ')}`);
    console.log(`Total tasks: ${summary.totalTasks}, Elapsed: ${summary.elapsedMs}ms`);
    for (const [alias, group] of Object.entries(summary.resultsByAlias)) {
      console.log(`- ${alias} (${group.agentId}): ${group.count} tasks, avg ${group.avgMs}ms`);
      for (const t of group.tasks) {
        console.log(`   ✓ ${t.summary} – ${t.ms}ms`);
        if (args.showOutput && t.output) {
          const snippet = formatOutputForDisplay(t.output);
          if (snippet) console.log(`     output:\n${indent(snippet, 6)}`);
        }
      }
    }
  }

  // Write simple per-agent metrics snapshot
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outDir = path.resolve('data/metrics');
    fs.default.mkdirSync(outDir, { recursive: true });
    const agents = {};
    for (const [alias, group] of Object.entries(summary.resultsByAlias)) {
      const id = group.agentId;
      if (!agents[id]) agents[id] = { tasks: 0, totalMs: 0, avgMs: 0, ok: 0, successRate: 0 };
      agents[id].tasks += group.count;
      agents[id].totalMs += group.count * group.avgMs;
      agents[id].ok += group.ok || 0;
    }
    for (const id of Object.keys(agents)) {
      const a = agents[id];
      a.avgMs = a.tasks ? Math.round(a.totalMs / a.tasks) : 0;
      a.successRate = a.tasks ? Number((a.ok / a.tasks).toFixed(3)) : 0;
    }
    fs.default.writeFileSync(path.resolve(outDir, 'agents.json'), JSON.stringify({ generatedAt: new Date().toISOString(), agents }, null, 2));
  } catch {}
}

main().catch((err) => { console.error(err); process.exitCode = 1; });

// ---------- Scenario: Build a To‑Do app (phased) ----------
function buildTodoScenario() {
  // Why each agent
  const why = {
    architect: 'Define architecture: React + shadcn UI + Markdown storage strategy',
    planner:   'Break work into parallelizable tasks and dependencies',
    frontend:  'Scaffold React app, shadcn UI, To‑Do components, Markdown persistence adapter',
    backend:   'Expose minimal API for To‑Dos (optional if purely local), file-backed Markdown',
    docs:      'Generate API/usage docs (OpenAPI if API is used) and README instructions',
    tester:    'Add unit and E2E smoke tests for core flows',
    validator: 'Validate production readiness: build, lint, basic a11y, packaging',
  };

  const phases = [
    {
      name: 'Phase 1 — Plan (sequential)',
      parallel: false,
      tasks: {
        architect: [
          'Architect a To‑Do web app using React + shadcn/ui; store each To‑Do as a Markdown file with front‑matter (id, createdAt, done) and body = description. Decide on local-only vs API-based.'
        ],
        planner: [
          'Produce a task breakdown for frontend (React+shadcn, components, Markdown adapter), optional backend (file-backed API), docs, tests, and validation; annotate which can run in parallel.'
        ],
      },
    },
    {
      name: 'Phase 2 — Build (parallel)',
      parallel: true,
      tasks: {
        frontend: [
          'Scaffold React app with shadcn/ui; implement To‑Do list, add, toggle done; persist to Markdown files via a simple adapter (or call API if present). Include basic styling.'
        ],
        backend: [
          'If API path chosen: implement minimal endpoints (GET/POST/PATCH) that read/write Markdown files under data/todos/*.md with front‑matter.'
        ],
        docs: [
          'Generate README quickstart and usage; if API present, output OpenAPI YAML for To‑Dos.'
        ],
      },
    },
    {
      name: 'Phase 3 — Test & Validate (parallel)',
      parallel: true,
      tasks: {
        tester: [
          'Add unit tests for Markdown adapter and components; add smoke test that adds a To‑Do and toggles it.'
        ],
        validator: [
          'Validate production readiness: build succeeds, lints clean, basic a11y check passes, package.json scripts documented.'
        ],
      },
    },
  ];

  return { title: 'Build a To‑Do app (React + shadcn, Markdown storage)', why, phases };
}

async function runScenario(scenario, args) {
  if (args.json) {
    const plan = scenario.phases.map((p, i) => ({ index: i + 1, name: p.name, parallel: p.parallel, tasks: p.tasks }));
    console.log(JSON.stringify({ kind: 'scenario-plan', title: scenario.title, why: scenario.why, phases: plan }, null, 2));
  } else if (args.plan || args.dryRun) {
    console.log(`Scenario: ${scenario.title}`);
    console.log('Why each agent:');
    for (const [alias, reason] of Object.entries(scenario.why)) console.log(`- ${alias}: ${reason}`);
    console.log('\nPhases:');
    scenario.phases.forEach((p, i) => {
      console.log(` ${i + 1}. ${p.name} ${p.parallel ? '(parallel)' : '(sequential)'}`);
      for (const [alias, tasks] of Object.entries(p.tasks)) {
        const def = resolveAgent(alias);
        const limit = def?.runtime?.concurrency?.max_parallel_tasks ?? 1;
        console.log(`    - ${alias} → ${def.agent?.id} (limit=${limit})`);
        tasks.forEach((t, idx) => console.log(`       ${idx + 1}. ${t}`));
      }
    });
    if (args.dryRun) return;
  }

  // Execute each phase in order. Within a phase, tasks execute in parallel by alias.
  const overall = [];
  for (let i = 0; i < scenario.phases.length; i++) {
    const phase = scenario.phases[i];
    const taskMap = phase.tasks;
    if (!args.json) {
      console.log(`\n=== ${phase.name} ===`);
    }
    const started = Date.now();
    const results = await runParallel(taskMap, { runtime: args.runtime, verbose: args.verbose, codexUrl: args.codexUrl, codexKey: args.codexKey, stream: args.stream, strictTools: args.strictTools, applyPatches: args.applyPatches, scaffoldDir: args.scaffoldDir, applyDryRun: args.applyDryRun, retries: args.retries, stack: scenario?.meta?.stack || null });
    

    // Summarize per phase
    const flat = [];
    for (const group of results) for (const r of group.results || []) flat.push({ alias: group.alias, agentId: group.agentId, ...r });
    const summary = {
      phase: phase.name,
      elapsedMs: Date.now() - started,
      aliases: results.map(r => ({ alias: r.alias, agentId: r.agentId, limit: r.limit })),
      totals: flat.length,
      byAlias: {},
    };
    const byAlias = new Map();
    for (const r of flat) {
      if (!byAlias.has(r.alias)) byAlias.set(r.alias, []);
      byAlias.get(r.alias).push(r);
    }
    for (const [alias, arr] of byAlias.entries()) {
      const ms = arr.reduce((a, b) => a + b.ms, 0);
      summary.byAlias[alias] = { agentId: arr[0].agentId, count: arr.length, avgMs: Math.round(ms / arr.length), tasks: arr.map(r => ({ summary: r.summary, ms: r.ms, output: args.showOutput ? r.output : undefined })) };
    }

    overall.push(summary);

    // If this is an execution phase and nothing was written, generate a default starter when requested
    const phaseIdx = i + 1;
    if (args.applyPatches && /build|execute/i.test(phase.name) && !args.applyDryRun) {
      const appliedCount = (results || []).reduce((n, g) => n + (g?.appliedFiles || 0), 0);
      if (appliedCount === 0) {
        const stack = scenario?.meta?.stack || pickStackFromRules(scenario?.title || 'app', plannerRules);
        const wrote = await generateDefaultStarter(args.scaffoldDir || 'scaffold/app', stack, { goal: scenario?.title || '' });
        if (!args.json) console.log(`[scaffold] No files from agents; wrote ${wrote.length} starter file(s) to ${args.scaffoldDir}`);
        appendEvent({ ts: new Date().toISOString(), kind: 'fallback_scaffold', dir: args.scaffoldDir, files: wrote, stack });
      }
    }
    if (args.json) {
      console.log(JSON.stringify({ kind: 'phase-summary', ...summary }, null, 2));
    } else {
      console.log(`Runtime: ${args.runtime} (${args.runtime === 'stub' ? 'no external calls' : `endpoint=${args.codexUrl || 'n/a'}`})`);
      console.log(`Aliases: ${summary.aliases.map(a => `${a.alias}→${a.agentId}(limit=${a.limit})`).join(', ')}`);
      console.log(`Total tasks: ${summary.totals}, Elapsed: ${summary.elapsedMs}ms`);
      for (const [alias, group] of Object.entries(summary.byAlias)) {
        console.log(`- ${alias} (${group.agentId}): ${group.count} tasks, avg ${group.avgMs}ms`);
        for (const t of group.tasks) {
          console.log(`   ✓ ${t.summary} – ${t.ms}ms`);
          if (args.showOutput && t.output) {
            const pretty = typeof t.output === 'string' ? t.output : JSON.stringify(t.output, null, 2);
            const snippet = pretty.split(/\r?\n/).slice(0, 8).join('\n');
            console.log(`     output:\n${indent(snippet, 6)}`);
          }
        }
      }
    }

    // Optional: revise plan for subsequent phases based on outputs
    if (args.revisePlan && i < scenario.phases.length - 1) {
      try {
        const def = resolveAgent('planner');
        const feedback = JSON.stringify(summary);
        const revisePrompt = {
          type: 'planning.revise',
          instruction: 'Given the phase summary JSON, update ONLY the remaining phases to reflect new insights. Output STRICT JSON: {"phases":[{"name":string,"parallel":boolean,"tasks":{alias:[string]}}...]}',
          summary: summary,
        };
        const res = await executeTask(def, revisePrompt, { runtime: args.runtime, verbose: args.verbose, codexUrl: args.codexUrl, codexKey: args.codexKey });
        const updated = tryParseJSON(res.output);
        if (updated && Array.isArray(updated.phases) && updated.phases.length) {
          const before = scenario.phases.slice(0, i + 1);
          scenario.phases = before.concat(updated.phases);
          if (!args.json) console.log('Plan revised for subsequent phases.');
        }
      } catch {}
    }
  }
  if (args.json) console.log(JSON.stringify({ kind: 'scenario-complete', phases: overall.map(o => ({ phase: o.phase, elapsedMs: o.elapsedMs })) }, null, 2));
}

// ---------- Freeform planning ----------
async function buildFreeformScenario(prompt, args) {
  // Build catalog then run selector → decomposer per configured modes
  const catalog = Array.from(registry.entries()).map(([id, def])=>({ id, name: def?.agent?.name, capabilities: { core: def?.capabilities?.core||[] }, default: /architect|coder|backend-dev|api-docs|tester/i.test(id) }));
  const t0 = Date.now();
  const sel = await plannerSelect({ goal: String(prompt), catalog, mode: args.selectorMode });
  const t1 = Date.now();
  try { appendEvent({ ts: new Date().toISOString(), kind: 'selector_generated', mode: args.selectorMode, ms: t1 - t0, count: sel?.agents?.length || 0 }); } catch {}
  let dec = await plannerDecompose({ goal: String(prompt), agents: sel.agents || [], catalog, mode: args.decomposerMode });
  if (String(process.env.PLANNER_TEST_FORCE_INVALID || '') === '1') {
    dec = { plan: [ { id: 'A', title: 'A', dependsOn: ['Z'], parallelizable: false } ], orders: [] };
  }
  const t2 = Date.now();
  try { appendEvent({ ts: new Date().toISOString(), kind: 'decomposer_generated', mode: args.decomposerMode, ms: t2 - t1, plan: (dec.plan||[]).length, orders: (dec.orders||[]).length }); } catch {}
  // Validate DAG before proceeding
  const v = validateUnifiedDAG({ agents: sel.agents || [], plan: dec.plan || [], orders: dec.orders || [] });
  if (!v.ok) {
    appendEvent({ ts: new Date().toISOString(), kind: 'decomposer_invalid', error: v.error });
  } else {
    appendEvent({ ts: new Date().toISOString(), kind: 'dag_valid' });
  }
  const combined = { agents: sel.agents || [], plan: dec.plan || [], orders: dec.orders || [] };
  const scenario = unifiedPlanToScenario({ title: String(prompt), ...combined });
  scenario.meta = scenario.meta || {};
  scenario.meta.dag = { ok: !!v.ok, error: v.error || null };
  if (scenario) return scenario;
  // Fallback: simple heuristic phases if conversion failed
  const goal = String(prompt);
  return { title: `Plan for: ${prompt}`, why: {}, phases: [
    { name: 'Phase 1 — Plan', parallel: false, tasks: { architect: [goal] } },
    { name: 'Phase 2 — Execute', parallel: true, tasks: {} },
    { name: 'Phase 3 — Test & Validate', parallel: true, tasks: { tester: ['Write tests/smoke'], validator: ['Validate build & packaging'] } },
  ]};
}

function tryParseJSON(output) {
  if (!output) return null;
  let text = typeof output === 'string' ? output : JSON.stringify(output);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

async function confirmScenario(scenario, args) {
  // Print plan like in --plan
  if (args.json) {
    const plan = scenario.phases.map((p, i) => ({ index: i + 1, name: p.name, parallel: p.parallel, tasks: p.tasks }));
    const dag = scenario.meta?.dag || null;
    console.log(JSON.stringify({ kind: 'scenario-plan', title: scenario.title, why: scenario.why, dag, phases: plan }, null, 2));
    return args.yes || args.dryRun ? !args.dryRun : await askYesNo('Proceed with this plan? [y/N] ');
  }
  console.log(`Scenario: ${scenario.title}`);
  console.log('Why each agent:');
  for (const [alias, reason] of Object.entries(scenario.why)) console.log(`- ${alias}: ${reason}`);
  const dag = scenario.meta?.dag;
  if (dag) {
    if (dag.ok) {
      console.log('DAG: OK');
    } else {
      console.log(`DAG: INVALID (${dag.error || 'unknown'})`);
      console.log('Remediation:');
      const hint = remediationHint(dag.error||'');
      console.log(`- ${hint}`);
    }
  }
  console.log('\nPhases:');
  scenario.phases.forEach((p, i) => {
    console.log(` ${i + 1}. ${p.name} ${p.parallel ? '(parallel)' : '(sequential)'}`);
    for (const [alias, tasks] of Object.entries(p.tasks)) {
      const def = resolveAgent(alias);
      const limit = def?.runtime?.concurrency?.max_parallel_tasks ?? 1;
      console.log(`    - ${alias} → ${def.agent?.id} (limit=${limit})`);
      tasks.forEach((t, idx) => console.log(`       ${idx + 1}. ${t}`));
    }
  });
  if (args.dryRun) return false;
  if (args.yes) return true;
  return await askYesNo('Proceed with this plan? [y/N] ');
}

async function askYesNo(question) {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = (await rl.question(question)).trim().toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

function remediationHint(code) {
  const c = String(code||'');
  if (c.startsWith('unknown_dep:')) return 'Fix dependsOn to reference existing task IDs (or remove the bad edge).';
  if (c.startsWith('unknown_agent:')) return 'Ensure orders reference selected agents only, or include the agent in selection.';
  if (c === 'cycle_detected') return 'Remove cyclic dependencies so tasks can be topologically ordered.';
  if (c === 'empty_plan') return 'Provide at least one task in the plan or switch to heuristic decomposer.';
  if (c === 'missing_task_id') return 'Assign unique IDs to all plan tasks.';
  return 'Review plan structure for invalid dependencies or references.';
}

// ---------- Patch application (safe scaffolding) ----------
async function applyPatchesFromResult(alias, result, { dir = 'scaffold', dryRun = true } = {}) {
  const files = [];
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  const out = result?.output;

  function considerFiles(arr) {
    for (const f of arr || []) {
      if (!f || !f.path) continue;
      const rel = String(f.path).replace(/^\/+/, '');
      const abs = safeJoin(root, rel);
      files.push({ path: rel, bytes: Buffer.byteLength(String(f.content || ''), 'utf8') });
      if (!dryRun) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(f.content || ''), 'utf8');
      }
    }
  }

  // 1) Structured object
  if (out && typeof out === 'object' && Array.isArray(out.files)) considerFiles(out.files);

  // 2) JSON within string
  if (typeof out === 'string') {
    const parsed = tryParseJSON(out);
    if (parsed && Array.isArray(parsed.files)) considerFiles(parsed.files);
  }

  // 3) Fenced blocks ```file:path\n...```
  const text = typeof out === 'string' ? out : JSON.stringify(out || '');
  const re = /```file:([^\n]+)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    considerFiles([{ path: m[1].trim(), content: m[2] }]);
  }

  return files;
}

// ---------- Performance snapshot from logs ----------
let PERF_CACHE = null;
function loadPerf() {
  if (PERF_CACHE) return PERF_CACHE;
  const p = path.resolve('data/logs/events.jsonl');
  const perf = new Map(); // agentId -> { total, ok }
  try {
    const data = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).slice(-5000);
    for (const line of data) {
      try {
        const ev = JSON.parse(line);
        if (ev && ev.kind === 'task_complete') {
          const id = ev.agentId || ev.alias;
          if (!id) continue;
          if (!perf.has(id)) perf.set(id, { total: 0, ok: 0 });
          const s = perf.get(id);
          s.total += 1;
          if (ev.ok) s.ok += 1;
        }
      } catch {}
    }
  } catch {}
  PERF_CACHE = perf;
  return perf;
}
function getPerf(agentId) {
  const perf = loadPerf();
  const s = perf.get(agentId);
  if (!s || !s.total) return null;
  return { successRate: s.ok / s.total };
}

// unified plan conversion implemented in src/planner/dag.mjs

// ---------- Output formatting (suppress noisy numeric chunks) ----------
function stripChunkArrays(line) {
  // Remove sequences like "chunk":[116,111,...]
  return line.replace(/"chunk"\s*:\s*\[(?:\d+\s*,\s*)*\d+\s*\]/g, '"chunk":[…]');
}
function extractFromJsonLine(obj) {
  // Prefer meaningful agent messages and file summaries
  const pl = obj?.payload;
  const parts = [];
  if (pl?.files && Array.isArray(pl.files)) {
    const names = pl.files.map(f => f && f.path).filter(Boolean).slice(0, 6);
    if (names.length) parts.push(`files: ${names.join(', ')}${pl.files.length > names.length ? ` (+${pl.files.length - names.length} more)` : ''}`);
  }
  const msg = pl?.msg;
  if (msg) {
    if (typeof msg.message === 'string' && msg.type === 'agent_message') parts.push(msg.message);
    if (typeof msg.last_agent_message === 'string' && msg.type === 'task_complete') parts.push(msg.last_agent_message);
    if (typeof msg.text === 'string' && /agent_reasoning/.test(String(msg.type||''))) {
      // include short reasoning snippets only
      const t = msg.text.trim();
      if (t && t.length <= 280) parts.push(t);
    }
  }
  return parts;
}
function formatOutputForDisplay(out) {
  try {
    // If structured files output, show a short list
    if (out && typeof out === 'object' && Array.isArray(out.files)) {
      const names = out.files.map(f => f && f.path).filter(Boolean).slice(0, 8);
      return names.length ? `files: ${names.join(', ')}` : JSON.stringify(out, null, 2);
    }
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    const lines = text.split(/\r?\n/).slice(0, 200);
    const keep = [];
    for (const raw of lines) {
      const line = stripChunkArrays(raw.trim());
      if (!line) continue;
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const obj = JSON.parse(line);
          const parts = extractFromJsonLine(obj);
          if (parts.length) keep.push(...parts);
        } catch {
          // keep minimal non-binary JSON line
          if (line.length <= 240) keep.push(line);
        }
      } else {
        // filter obvious binary-like noise
        if (/^(?:\d+,\s*)+\d+$/.test(line)) continue;
        keep.push(line);
      }
      if (keep.length >= 12) break; // cap display
    }
    return keep.slice(0, 12).join('\n');
  } catch {
    return typeof out === 'string' ? out.slice(0, 400) : '';
  }
}

// ---------- Planner rules application ----------
function pickStackFromRules(goal, rules) {
  if (!rules || !Array.isArray(rules.patterns)) return 'next+nest+prisma+postgres';
  const g = goal.toLowerCase();
  for (const p of rules.patterns) {
    const keys = (p.match_any || []).map(String).map(s => s.toLowerCase());
    if (keys.some(k => g.includes(k))) return p.stack || 'next+nest+prisma+postgres';
  }
  return 'next+nest+prisma+postgres';
}
function applyPlannerRules(scenario, goal, rules) {
  if (!rules || !Array.isArray(rules.patterns)) return false;
  const g = goal.toLowerCase();
  const match = rules.patterns.find(p => (p.match_any||[]).some(k => g.includes(String(k).toLowerCase())));
  if (!match) { scenario.meta = { stack: pickStackFromRules(goal, rules) }; return false; }
  // Merge alias tasks into Execute phase
  const exec = scenario.phases[1];
  for (const [alias, tasks] of Object.entries(match.aliases || {})) {
    exec.tasks[alias] = (exec.tasks[alias] || []).concat(tasks);
  }
  scenario.meta = { stack: match.stack || pickStackFromRules(goal, rules), features: match.features || [] };
  // Ensure a dedicated scaffold step to generate baseline files
  exec.tasks.scaffold = exec.tasks.scaffold || [];
  exec.tasks.scaffold.push(`Generate baseline starter files for stack ${scenario.meta.stack}. Return as {files:[{path,content}]}.`);
  return true;
}

// ---------- Default starter generator (no-LLM fallback) ----------
async function generateDefaultStarter(rootDir, stack, { goal = '' } = {}) {
  const files = [];
  fs.mkdirSync(rootDir, { recursive: true });
  function write(rel, content) {
    const abs = safeJoin(rootDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    files.push(rel);
  }
  // Shared README
  write('README.md', `# Starter\n\nGoal: ${goal}\n\nStack: ${stack}\n\n- Install: npm install\n- Dev: npm run dev\n- See subfolders frontend/ and server/\n`);
  if (stack.startsWith('next')) {
    // Frontend Next.js minimal (no deps install here; just files)
    const nextPkg = { name: 'frontend', private: true, scripts: { dev: 'next dev', build: 'next build', start: 'next start' }, dependencies: { next: '14.2.3', react: '18.2.0', 'react-dom': '18.2.0' } };
    if (stack.includes('supabase')) nextPkg.dependencies['@supabase/supabase-js'] = '^2.45.0';
    if (stack.includes('shadcn')) { nextPkg.devDependencies = { ...(nextPkg.devDependencies||{}), tailwindcss: '^3.4.1', autoprefixer: '^10.4.18', postcss: '^8.4.35' }; }
    write('frontend/package.json', JSON.stringify(nextPkg, null, 2));
    write('frontend/next.config.mjs', `/** @type {import('next').NextConfig} */\nexport default { reactStrictMode: true };\n`);
    write('frontend/app/page.tsx', `export default function Page(){return (<main style={{padding:20}}><h1>Welcome</h1><p>Starter for: ${goal}</p></main>);}\n`);
    write('frontend/app/api/health/route.ts', `export async function GET(){ return Response.json({ ok: true }); }\n`);
    write('frontend/tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'preserve', module: 'esnext', target: 'es2020', strict: true } }, null, 2));
    if (stack.includes('supabase')) {
      write('frontend/.env.local.example', `NEXT_PUBLIC_SUPABASE_URL=your-url\nNEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key\n`);
      write('frontend/app/(auth)/login/page.tsx', `"use client";\nimport { useState } from 'react';\nimport { supabase } from '@/lib/supabase';\nexport default function Login(){\n  const [email,setEmail]=useState('');\n  async function send(){ await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '/' } }); alert('Check your email'); }\n  return (<main style={{padding:20}}><h1>Login</h1><input placeholder='email' value={email} onChange={e=>setEmail(e.target.value)} /><button onClick={send}>Send Magic Link</button></main>);\n}\n`);
      write('frontend/app/dashboard/page.tsx', `export default async function Dashboard(){ return (<main style={{padding:20}}><h1>Dashboard</h1><p>Protected area.</p></main>); }\n`);
      write('frontend/middleware.ts', `import { NextResponse } from 'next/server';\nexport function middleware(req){ const { pathname } = req.nextUrl; if (pathname.startsWith('/dashboard')) { /* add auth cookie check with supabase if desired */ } return NextResponse.next(); }\n`);
      write('frontend/lib/supabase.ts', `import { createClient } from '@supabase/supabase-js';\nexport const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);\n`);
    }
    if (stack.includes('shadcn')) {
      write('frontend/postcss.config.js', `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {}, }, };\n`);
      write('frontend/tailwind.config.js', `module.exports = { content: ['./app/**/*.{ts,tsx}','./components/**/*.{ts,tsx}'], theme: { extend: {} }, plugins: [] };\n`);
      write('frontend/app/layout.tsx', `import './globals.css'; export default function RootLayout({ children }:{children:React.ReactNode}){ return (<html><body>{children}</body></html>);} \n`);
      write('frontend/app/globals.css', `@tailwind base;@tailwind components;@tailwind utilities;\n`);
      write('frontend/components/ui/button.tsx', `export function Button({children}:{children:React.ReactNode}){ return <button className='px-3 py-1 rounded bg-black text-white'>{children}</button>; }\n`);
    }
  }
  if (stack.includes('prisma') || stack.includes('postgres') || stack.includes('express')) {
    write('server/package.json', JSON.stringify({ name: 'server', private: true, type: 'module', scripts: { dev: 'node index.mjs' }, dependencies: { express: '^4.19.2', '@prisma/client': '^5.18.0' }, devDependencies: { prisma: '^5.18.0' } }, null, 2));
    write('server/index.mjs', `import express from 'express';\nconst app = express();\napp.get('/api/health', (req,res)=>res.json({ok:true}));\napp.listen(3001, ()=>console.log('API on :3001'));\n`);
    write('prisma/schema.prisma', `datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n generator client { provider = "prisma-client-js" }\n model User { id Int @id @default(autoincrement()) email String @unique }\n`);
    write('server/prismaClient.mjs', `import pkg from '@prisma/client';\nconst { PrismaClient } = pkg;\nexport const prisma = new PrismaClient();\n`);
    write('docs/MIGRATIONS.md', `# Prisma Migrations\n\n- Copy .env.example to .env and set DATABASE_URL.\n- Start DB: docker compose up -d db\n- Install deps: npm i -w server -D @prisma/client prisma\n- Generate: npx prisma generate\n- Create migration: npx prisma migrate dev --name init\n`);
    write('.env.example', `DATABASE_URL=postgresql://user:pass@localhost:5432/app\n`);
    write('docker-compose.yml', `version: '3.8'\nservices:\n  db:\n    image: postgres:15\n    ports: ['5432:5432']\n    environment:\n      POSTGRES_USER: user\n      POSTGRES_PASSWORD: pass\n      POSTGRES_DB: app\n    volumes: ['db-data:/var/lib/postgresql/data']\nvolumes: { db-data: {} }\n`);
  }
  if (stack.includes('supabase')) {
    write('supabase/README.md', `# Supabase Local\n\n- Install Supabase CLI: https://supabase.com/docs/guides/cli\n- Run: supabase start\n- Get env: supabase status --output json\n- Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local\n`);
    write('supabase/seed.sql', `-- Example policy and seed\ncreate table if not exists public.profiles ( id uuid primary key, email text );\nalter table public.profiles enable row level security;\ncreate policy "+r" on public.profiles for select using ( auth.uid() = id );\n`);
    const pkgPath = safeJoin(rootDir, 'frontend/package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.dependencies = { ...(pkg.dependencies||{}), '@supabase/supabase-js': '^2.45.0' };
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    } catch {}
  }
  if (stack.includes('expo')) {
    write('mobile/App.tsx', `import { Text, View } from 'react-native'; export default function App(){ return (<View style={{padding:40}}><Text>Expo Starter</Text></View>); }`);
    write('mobile/package.json', JSON.stringify({ name: 'mobile', private: true, scripts: { start: 'expo start' }, dependencies: { expo: '^51.0.0', react: '18.2.0', 'react-native': '0.74.0' } }, null, 2));
  }
  return files;
}
