#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { routeTask, routeFiles } from '../src/router/index.mjs';
import yaml from 'js-yaml';
import { executeTask } from '../src/runtime/adapter.mjs';

function usage() {
  console.log(`codex-flow commands:
  init                              # validate and register local agents (~/.codex)
  run [--example|-f FILE|--prompt S] [--runtime stub|codex] [--provider P] [--fallback P1,P2] [--codex-url URL] [--codex-key KEY] [--plan] [--verbose] [--json]
  swarm "<goal>"                   # free-form multi-agent swarm via Codex CLI
  cleanup [--runs-max-per-alias N] [--logs-max-bytes B] [--dry-run]
  bench --prompt "<text>" --providers openai,anthropic,ollama [--stream]
  load [--json]                     # print bundle counts, detect duplicates
  route "<task>" | --files a b c   # deterministic router output
  serve [--port 8787] [--runner demo|ollama|openai|cli] [--model NAME] [--run-cmd '...']
`);
}

// Resolve package-relative script paths so global installs work from any CWD
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const pkgPath = (rel) => path.join(PKG_ROOT, rel);

async function cmdQuickstart(argv) {
  const flags = parseFlags(argv, { runtime: 'stub', plan: true, verbose: false, json: false });
  // Minimal quickstart: reuse scripts/orchestrator.mjs via child process to avoid duplicating logic
  const args = [pkgPath('scripts/orchestrator.mjs'), '--example'];
  if (flags.plan) args.push('--plan'); else args.push('--no-plan');
  if (flags.verbose) args.push('--verbose');
  if (flags.runtime) args.push('--runtime', flags.runtime);
  if (flags['codex-url']) args.push('--codex-url', flags['codex-url']);
  if (flags['codex-key']) args.push('--codex-key', flags['codex-key']);
  if (flags.json) args.push('--json');
  await runNode(args);
}

async function cmdInit() {
  // Minimal bootstrap: validates codex/agents, writes ~/.codex/{env,registry.json}
  await runNode([pkgPath('scripts/bootstrap.mjs')]);
}

async function cmdRun(argv) {
  // Friendly wrapper around orchestrator: defaults to examples file if no args
  const flags = parseFlags(argv, { plan: true, verbose: false, json: false, runtime: 'stub' });
  const args = [pkgPath('scripts/orchestrator.mjs')];
  // Default behavior: if no explicit mode, use examples file
  const hasMode = argv.some((a) => ['--example', '-f', '--file', '--prompt'].includes(a));
  if (!hasMode) args.push('-f', 'examples/orchestrator-tasks.json');
  // Pass through friendly flags
  if (flags.example) args.push('--example');
  if (flags.prompt) { args.push('--prompt', String(flags.prompt)); if (flags.yes) args.push('--yes'); }
  if (flags.route) args.push('--route', String(flags.route));
  // Preserve multi-arg forwarding for --route-files by scanning raw argv
  const rfIdx = argv.findIndex((a) => a === '--route-files');
  if (rfIdx !== -1) {
    const files = [];
    for (let i = rfIdx + 1; i < argv.length && !argv[i].startsWith('--'); i++) files.push(argv[i]);
    if (files.length) args.push('--route-files', ...files);
  }
  if (flags.file) args.push('-f', String(flags.file));
  if (flags.plan) args.push('--plan'); else args.push('--no-plan');
  if (flags.verbose) args.push('--verbose');
  if (flags.json) args.push('--json');
  if (flags['strict-tools']) args.push('--strict-tools');
  if (flags['stream']) args.push('--stream');
  if (flags['provider']) args.push('--provider', String(flags['provider']));
  if (flags['fallback']) args.push('--fallback', String(flags['fallback']));
  if (flags['planner']) args.push('--planner', String(flags['planner']));
  if (flags['selector']) args.push('--selector', String(flags['selector']));
  if (flags['decomposer']) args.push('--decomposer', String(flags['decomposer']));
  if (flags.runtime) args.push('--runtime', String(flags.runtime));
  if (flags['codex-url']) args.push('--codex-url', String(flags['codex-url']));
  if (flags['codex-key']) args.push('--codex-key', String(flags['codex-key']));
  if (flags['apply-patches']) args.push('--apply-patches');
  if (flags['scaffold-dir']) args.push('--scaffold-dir', String(flags['scaffold-dir']));
  if (flags['apply-dry-run']) args.push('--apply-dry-run');
  if (flags['retries']) args.push('--retries', String(flags['retries']));
  if (flags['bundle-files']) args.push('--bundle-files');
  if (flags['no-bundle-files']) args.push('--no-bundle-files');
  if (flags['bundle-max-bytes']) args.push('--bundle-max-bytes', String(flags['bundle-max-bytes']));
  if (flags['agents-dir']) args.push('--agents-dir', String(flags['agents-dir']));
  await runNode(args);
}

async function cmdSwarm(argv) {
  const goal = argv.join(' ').trim();
  if (!goal) {
    console.error('Usage: codex-flow swarm "<free-form goal>"');
    process.exit(1);
  }
  await runNode([pkgPath('scripts/codex-swarm.mjs'), goal]);
}

async function cmdCleanup(argv) {
  await runNode([pkgPath('scripts/cleanup.mjs'), ...argv]);
}

async function cmdBench(argv) {
  await runNode([pkgPath('scripts/bench.mjs'), ...argv]);
}

async function cmdLoad(argv) {
  const flags = parseFlags(argv, { json: false });
  const agentsDir = path.resolve('codex/agents');
  const indexPath = path.join(agentsDir, 'index.json');
  const triggersPath = path.join(agentsDir, 'triggers.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const triggers = JSON.parse(fs.readFileSync(triggersPath, 'utf8'));
  const ids = new Map();
  const dupes = [];
  for (const a of index.agents) {
    const key = a.id;
    if (ids.has(key)) dupes.push(key); else ids.set(key, true);
    const defPath = path.join(agentsDir, a.domain, ...(a.subdomain ? [a.subdomain] : []), `${a.id}.codex.yaml`);
    yaml.load(fs.readFileSync(defPath, 'utf8'));
  }
  const out = {
    agents: index.agents.length,
    triggers: {
      keywords: Object.keys(triggers.keywords||{}).length,
      regex: (triggers.regex||[]).length,
      file_patterns: Object.keys(triggers.file_patterns||{}).length,
    },
    duplicates: Array.from(new Set(dupes)),
  };
  if (flags.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Agents: ${out.agents}`);
    console.log(`Triggers: keywords=${out.triggers.keywords} regex=${out.triggers.regex} file_patterns=${out.triggers.file_patterns}`);
    if (out.duplicates.length) console.error(`Duplicate IDs: ${out.duplicates.join(', ')}`);
  }
  if (out.duplicates.length) process.exitCode = 2;
}

async function cmdRoute(argv) {
  const filesIdx = argv.indexOf('--files');
  const flags = parseFlags(argv, { json: false });
  if (filesIdx !== -1) {
    const files = argv.slice(filesIdx + 1);
    const res = routeFiles(files);
    if (flags.json) console.log(JSON.stringify(res, null, 2));
    else console.log(JSON.stringify(res, null, 2));
    return;
  }
  const text = argv[0] || '';
  const res = routeTask(text);
  if (flags.json) console.log(JSON.stringify(res, null, 2));
  else console.log(JSON.stringify(res, null, 2));
}

async function cmdServe(argv) {
  const flags = parseFlags(argv, {});
  const port = flags.port ? Number(flags.port) : (process.env.PORT ? Number(process.env.PORT) : 8787);
  process.env.PORT = String(port);
  // Defaults: prefer CLI runner using our bundled adapter script
  process.env.RUNNER = String(flags.runner || process.env.RUNNER || 'cli');
  if (flags.model) process.env.MODEL = String(flags.model);
  process.env.RUN_CMD = String(flags['run-cmd'] || process.env.RUN_CMD || `node ${pkgPath('scripts/codex-cli-runner.mjs')}`);
  await runNode([pkgPath('scripts/codex-server.mjs')]);
}

function parseFlags(argv, defaults = {}) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`node ${args.join(' ')} exited ${code}`)));
  });
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === '-h' || cmd === '--help') return usage();
  switch (cmd) {
    case 'init':
      await cmdInit();
      break;
    case 'run':
      await cmdRun(rest);
      break;
    case 'swarm':
      await cmdSwarm(rest);
      break;
    case 'cleanup':
      await cmdCleanup(rest);
      break;
    case 'bench':
      await cmdBench(rest);
      break;
    case 'quickstart':
      await cmdQuickstart(rest);
      break;
    case 'load':
      await cmdLoad(rest);
      break;
    case 'route':
      await cmdRoute(rest);
      break;
    case 'serve':
      await cmdServe(rest);
      break;
    default:
      usage();
      process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
