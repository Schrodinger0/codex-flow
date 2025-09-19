#!/usr/bin/env node
// Bootstraps Codex agent discovery for the Codex CLI.
// - Validates codex/index.json and referenced codex/agents/**.codex.yaml files
// - Writes ~/.codex/registry.json and ~/.codex/env with absolute paths

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';

function die(msg) { console.error(`Error: ${msg}`); process.exit(1); }
function ok(msg) { console.log(msg); }

function resolveRepoPaths() {
  const repoRoot = process.cwd();
  const agentsRoot = path.resolve(repoRoot, 'codex', 'agents');
  const indexPath = path.resolve(agentsRoot, 'index.json');
  if (!fs.existsSync(agentsRoot)) die(`Missing agents directory: ${agentsRoot}`);
  if (!fs.existsSync(indexPath)) die(`Missing index.json: ${indexPath}`);
  return { repoRoot, agentsRoot, indexPath };
}

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { die(`Failed to read JSON ${p}: ${e.message}`); }
}

function validateAgents(indexPath, agentsRoot) {
  const idx = readJSON(indexPath);
  const problems = [];
  const checked = [];
  if (!Array.isArray(idx.agents)) die('index.json missing "agents" array');
  for (const e of idx.agents) {
    const parts = [agentsRoot, e.domain];
    if (e.subdomain) parts.push(e.subdomain);
    const defPath = path.join(...parts, `${e.id}.codex.yaml`);
    if (!fs.existsSync(defPath)) { problems.push(`Missing: ${defPath}`); continue; }
    try { yaml.load(fs.readFileSync(defPath, 'utf8')); } catch (err) { problems.push(`YAML error in ${defPath}: ${err.message}`); }
    checked.push(defPath);
  }
  return { problems, checked };
}

function writeRegistry({ indexPath, agentsRoot }) {
  const home = os.homedir();
  const codexDir = path.join(home, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const registryPath = path.join(codexDir, 'registry.json');
  const envPath = path.join(codexDir, 'env');
  const registry = {
    version: 1,
    agentIndexPath: indexPath,
    agentRoot: agentsRoot,
  };
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  const envText = [
    `CODEX_AGENT_INDEX=${indexPath}`,
    `CODEX_AGENT_HOME=${agentsRoot}`,
  ].join('\n') + '\n';
  fs.writeFileSync(envPath, envText, 'utf8');
  return { registryPath, envPath };
}

function main() {
  const { agentsRoot, indexPath } = resolveRepoPaths();
  ok(`Validating agents from ${indexPath}`);
  const { problems, checked } = validateAgents(indexPath, agentsRoot);
  if (problems.length) {
    console.error('Validation failed:');
    problems.forEach((p) => console.error(`- ${p}`));
    process.exit(2);
  }
  ok(`✓ ${checked.length} agent definition(s) validated.`);
  const { registryPath, envPath } = writeRegistry({ indexPath, agentsRoot });
  ok(`Wrote ${registryPath}`);
  ok(`Wrote ${envPath}`);
  ok('Done. You can now run: codex swarm "build a todo app"');
}

main();

