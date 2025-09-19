// scripts/bootstrap.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { load as yamlLoad } from "js-yaml";

const root = process.cwd();
const agentDir = path.join(root, "codex", "agents");

// Find optional index in codex/ or codex/agents/
const indexCandidates = [
  path.join(root, "codex", "index.json"),
  path.join(root, "codex", "index.yaml"),
  path.join(root, "codex", "index.yml"),
  path.join(agentDir, "index.json"),
  path.join(agentDir, "index.yaml"),
  path.join(agentDir, "index.yml"),
  path.join(agentDir, "triggers.json")
];
const indexPath = indexCandidates.find((p) => fs.existsSync(p)) || null;

if (!fs.existsSync(agentDir)) {
  console.error(`No agents directory found at ${agentDir}`);
  process.exit(1);
}

function walkYamlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkYamlFiles(p));
    else if (entry.isFile() && (p.endsWith(".yaml") || p.endsWith(".yml"))) out.push(p);
  }
  return out;
}

const files = walkYamlFiles(agentDir);
let ok = 0, bad = 0;
for (const p of files) {
  try {
    const y = yamlLoad(fs.readFileSync(p, "utf8"));
    if (y?.id) ok++;
  } catch (e) {
    bad++;
    console.warn(`Invalid YAML skipped: ${p} (${e.message})`);
  }
}

console.log(`Validating agents under ${agentDir}\n✓ ${ok} agent definition(s) validated.`);
if (bad) console.log(`⚠️ ${bad} file(s) had YAML errors (skipped).`);

const homeCfg = path.join(os.homedir(), ".codex");
fs.mkdirSync(homeCfg, { recursive: true });

const envLines = [
  `CODEX_AGENT_HOME=${agentDir}`,
  ...(indexPath ? [`CODEX_AGENT_INDEX=${indexPath}`] : [])
];
fs.writeFileSync(path.join(homeCfg, "env"), envLines.join("\n") + "\n", "utf8");

const registry = { version: 1, agentRoot: agentDir, ...(indexPath ? { agentIndexPath: indexPath } : {}) };
fs.writeFileSync(path.join(homeCfg, "registry.json"), JSON.stringify(registry, null, 2), "utf8");

console.log(`Wrote ${path.join(homeCfg, "registry.json")}`);
console.log(`Wrote ${path.join(homeCfg, "env")}`);
console.log('Done. You can now run: npm run swarm -- "<goal>"');

