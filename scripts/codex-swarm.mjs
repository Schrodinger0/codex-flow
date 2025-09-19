// scripts/codex-swarm.mjs
// Free-form multi-agent orchestration for Codex CLI (planner-first, explainable selection).
// Usage: npm run swarm -- "<free-form goal>"

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { load as yamlLoad } from "js-yaml";

const PLANNER_IDS = ["swarm-planner", "planner"]; // support either
const MIN_AGENTS = Number(process.env.SWARM_MIN || 2);
const MAX_AGENTS = Number(process.env.SWARM_MAX || 5);

// ---------- helpers ----------
function readEnv() {
  const p = path.join(os.homedir(), ".codex", "env");
  if (!fs.existsSync(p)) throw new Error("Missing ~/.codex/env. Run `npm run codex:bootstrap` first.");
  return Object.fromEntries(
    fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => l.split("=").map((s) => s.trim()))
  );
}
function walkYamlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkYamlFiles(p));
    else if (entry.isFile() && (p.endsWith(".yaml") || p.endsWith(".yml") || p.endsWith(".codex.yaml"))) out.push(p);
  }
  return out;
}
function loadAgentsRecursive(root) {
  const files = walkYamlFiles(root);
  const agents = [];
  for (const p of files) {
    try {
      const y = yamlLoad(fs.readFileSync(p, "utf8"));
      if (y?.id) agents.push({ id: y.id, spec: y, file: p });
    } catch (e) {
      console.warn(`Skipping invalid YAML: ${p} (${e.message})`);
    }
  }
  return agents;
}
function isDefault(spec) {
  const candidates = [spec?.swarm?.enabled_by_default, spec?.swarm?.default, spec?.enabled_by_default];
  const v = candidates.find((x) => x !== undefined);
  if (typeof v === "string") return ["true", "yes", "on", "1"].includes(v.toLowerCase());
  return Boolean(v);
}
function runCodexOnce(promptText, { timeoutMs = 60000 } = {}) {
  const envSafe = { ...process.env, TERM: "dumb", CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  const proc = spawnSync("codex", [promptText], {
    encoding: "utf8",
    env: envSafe,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    const msg = (proc.stderr || proc.stdout || "").trim();
    throw new Error(msg || `codex exited ${proc.status}`);
  }
  return (proc.stdout || "").trim();
}
function spawnCodex(promptText) {
  const envSafe = { ...process.env, TERM: "dumb", CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
  return spawn("codex", [promptText], { stdio: "inherit", env: envSafe });
}

// ---------- heuristic chooser (when planner is missing/weak) ----------
function tokenizeGoal(goal) {
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_/]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}
function capabilityKeywords(spec) {
  const caps = []
    .concat(spec?.capabilities?.core || [])
    .concat(spec?.capabilities?.extended || []);
  return caps.map((c) => String(c).toLowerCase());
}
const SYNONYMS = new Map([
  ["build", ["scaffold", "implement", "generate", "create", "compose"]],
  ["review", ["lint", "critique", "audit", "improve", "refactor"]],
  ["test", ["tests", "pytest", "unit", "integration", "qa"]],
  ["plan", ["decompose", "design", "architecture", "spec"]],
  ["ship", ["bundle", "deploy", "package", "release"]],
  ["doc", ["document", "readme", "explain"]],
]);
function scoreAgent(agent, goalTokens) {
  const id = agent.id.toLowerCase();
  const name = (agent.spec?.name || "").toLowerCase();
  const text = id + " " + name;
  const caps = capabilityKeywords(agent.spec);
  let score = 0;
  const reasons = [];

  // defaults are strong hints (but not the only factor)
  if (isDefault(agent.spec)) {
    score += 3;
    reasons.push("default");
  }
  // capability matches
  for (const tok of goalTokens) {
    // exact capability hit
    if (caps.some((c) => c.includes(tok))) {
      score += 2;
      reasons.push(`capability(match:${tok})`);
    }
    // synonym hit
    for (const [root, alts] of SYNONYMS) {
      if (tok === root || alts.includes(tok)) {
        if (caps.some((c) => c.includes(root) || alts.some((a) => c.includes(a)))) {
          score += 2;
          reasons.push(`capability(syn:${root})`);
        }
      }
    }
    // id/name contains token
    if (text.includes(tok)) {
      score += 1;
      reasons.push(`id/name(${tok})`);
    }
  }
  // light diversity bias: prefer agents with distinct first capability
  const firstCap = caps[0] || "";
  return { id: agent.id, score, reasons: Array.from(new Set(reasons)), firstCap };
}
function chooseByHeuristic(goal, agents, excludeIds, { min = MIN_AGENTS, max = MAX_AGENTS } = {}) {
  const toks = tokenizeGoal(goal);
  const pool = agents.filter((a) => !excludeIds.has(a.id));
  const scored = pool.map((a) => scoreAgent(a, toks));

  // sort by score desc, then prefer diversity by firstCap, then id
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.firstCap !== b.firstCap) return a.firstCap.localeCompare(b.firstCap);
    return a.id.localeCompare(b.id);
  });

  const out = [];
  const seenCaps = new Set();
  for (const s of scored) {
    if (out.length >= max) break;
    // mild cap diversification
    if (s.firstCap && seenCaps.has(s.firstCap) && out.length + 1 < max) {
      // allow duplicates later if we still need to fill
      continue;
    }
    out.push(s);
    if (s.firstCap) seenCaps.add(s.firstCap);
  }
  if (out.length < min) {
    // if diversity made us too strict, just take top-K
    return scored.slice(0, Math.min(max, Math.max(min, scored.length)));
  }
  return out;
}

// ---------- main ----------
try {
  const env = readEnv();
  const agentHome = env.CODEX_AGENT_HOME;
  if (!agentHome || !fs.existsSync(agentHome)) throw new Error("CODEX_AGENT_HOME not set or folder missing.");

  const goal = process.argv.slice(2).join(" ").trim();
  if (!goal) {
    console.error('Usage: npm run swarm -- "<free-form goal>"');
    process.exit(1);
  }

  const agents = loadAgentsRecursive(agentHome);
  if (agents.length === 0) throw new Error(`No *.yaml agents found under ${agentHome}`);
  const byId = new Map(agents.map((a) => [a.id, a]));

  const plannerId = PLANNER_IDS.find((id) => byId.has(id));
  if (!plannerId) throw new Error(`Planner not found. Add ${PLANNER_IDS[0]}.yaml (or planner.yaml).`);

  // Build planner prompt (reuse planner.system if given)
  const plannerSpec = byId.get(plannerId).spec || {};
  const plannerSystem =
    plannerSpec?.prompt?.system ||
    "You are the Swarm Planner. Select the smallest useful set of agents to achieve the GOAL and explain why.";
  const catalog = agents
    .map((a) => {
      const caps = capabilityKeywords(a.spec);
      const def = isDefault(a.spec) ? " (default)" : "";
      return `- ${a.id}${def} :: ${caps.join(", ")}`;
    })
    .join("\n");

  const plannerPrompt = `${plannerSystem}

GOAL:
${goal}

AGENT CATALOG (ids and capabilities):
${catalog}

REQUIREMENTS:
Return ONLY a single JSON object (no Markdown fences, no extra text) with schema:
{
  "agents": [
    {"id":"<agentId>","reason":"<why this agent fits the goal>"},
    ...
  ]
}
- Include between ${MIN_AGENTS} and ${MAX_AGENTS} agents.
- Use only ids that exist in the catalog.
- If uncertain, include agents marked "(default)".
`;

  // Run planner with retry
  let plan;
  try {
    const out = runCodexOnce(plannerPrompt, { timeoutMs: 90000 });
    const cleaned = out.replace(/```json|```/g, "").trim();
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1 || last < first) throw new Error("Planner did not return JSON.");
    plan = JSON.parse(cleaned.slice(first, last + 1));
  } catch (e) {
    // Fallback: heuristic chooser from entire catalog (excluding planner)
    const exclude = new Set([plannerId]);
    const chosen = chooseByHeuristic(goal, agents, exclude, { min: MIN_AGENTS, max: MAX_AGENTS });
    plan = {
      agents: chosen.map((s) => ({
        id: s.id,
        reason: `heuristic: ${s.reasons.join(", ") || "best-match"}`
      }))
    };
  }

  // Normalize + supplement if planner picked too few
  let selections = (plan?.agents || [])
    .map((a) => (a?.id && byId.has(a.id) && a.id !== plannerId ? { id: a.id, reason: a.reason || "planner" } : null))
    .filter(Boolean);

  if (selections.length < MIN_AGENTS) {
    const exclude = new Set([plannerId, ...selections.map((s) => s.id)]);
    const extras = chooseByHeuristic(goal, agents, exclude, { min: MIN_AGENTS - selections.length, max: MAX_AGENTS });
    selections = selections.concat(
      extras.map((s) => ({ id: s.id, reason: `supplement: ${s.reasons.join(", ") || "default"}` }))
    );
  }
  // Cap to MAX_AGENTS
  selections = selections.slice(0, MAX_AGENTS);

  if (selections.length === 0) {
    console.error("No runnable agents selected. Ensure you have non-planner agents and try again.");
    process.exit(1);
  }

  // ---- announce plan (who + why)
  console.log(`Goal: ${goal}`);
  console.log("Selected agents:");
  const rows = selections.map((s) => ({ id: s.id, reason: s.reason }));
  // pretty print table without external deps
  const idWidth = Math.max(...rows.map((r) => r.id.length), "id".length);
  const reasonWidth = Math.max(
    ...rows.map((r) => r.reason.length),
    "reason".length,
    20
  );
  const pad = (str, w) => (str + " ".repeat(w)).slice(0, w);
  console.log(`${pad("id", idWidth)} | ${pad("reason", reasonWidth)}`);
  console.log(`${"-".repeat(idWidth)}-+-${"-".repeat(reasonWidth)}`);
  rows.forEach((r) => console.log(`${pad(r.id, idWidth)} | ${pad(r.reason, reasonWidth)}`));

  // ---- run all selected in parallel
  function composePrompt(spec, goalText) {
    const sys = spec?.prompt?.system || `You are agent ${spec?.id}.`;
    const tmpl = spec?.prompt?.user_template || "TASK: {{goal}}";
    const user = tmpl.replace(/{{\s*goal\s*}}/gi, goalText);
    return `${sys}\n\n${user}`;
  }

  const procs = selections.map((s) => {
    const spec = byId.get(s.id).spec;
    const prompt = composePrompt(spec, goal);
    return spawnCodex(prompt);
  });

  await Promise.all(
    procs.map(
      (p) =>
        new Promise((res, rej) => {
          p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`codex exited ${code}`))));
        })
    )
  );

  console.log("✓ swarm complete");
  process.exit(0);
} catch (err) {
  console.error("swarm error:", err.message);
  process.exit(1);
}

