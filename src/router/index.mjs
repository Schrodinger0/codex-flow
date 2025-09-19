import fs from 'node:fs';
import path from 'node:path';

function findAgentsDir() {
  const env = process.env.CODEX_AGENTS_DIR;
  if (env && fs.existsSync(env)) return path.resolve(env);
  const home = process.env.HOME || process.env.USERPROFILE || null;
  if (home) {
    const p = path.join(home, '.codex', 'agents');
    if (fs.existsSync(p)) return p;
  }
  return path.resolve('codex', 'agents');
}

const AGENTS_DIR = findAgentsDir();
const TRIGGERS_PATH = path.join(AGENTS_DIR, 'triggers.json');
const triggers = JSON.parse(fs.readFileSync(TRIGGERS_PATH, 'utf8'));

function wildcardToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLE§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLE§/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

const filePatterns = Object.entries(triggers.file_patterns || {}).map(([pattern, agents]) => ({ regex: wildcardToRegex(pattern), pattern, agents }));
const keywordMap = triggers.keywords || {};
const regexRules = (triggers.regex || []).map(r => ({ ...r, re: new RegExp(r.pattern, 'i') }));

export function routeFiles(paths) {
  const candidates = new Set();
  const matches = [];
  for (const p of paths) {
    const rel = p.replace(/^\.\/?/, '');
    for (const fp of filePatterns) {
      if (fp.regex.test(rel)) {
        fp.agents.forEach(a => candidates.add(a));
        matches.push({ path: rel, pattern: fp.pattern, agents: fp.agents });
      }
    }
  }
  return { stage: candidates.size ? 'file' : 'none', candidates: Array.from(candidates), trace: matches };
}

export function routeTask(text) {
  const trace = [];
  const lc = String(text || '').toLowerCase();
  // keywords
  const kwCandidates = new Set();
  for (const keyword of Object.keys(keywordMap)) {
    if (lc.includes(keyword)) keywordMap[keyword].forEach(a => kwCandidates.add(a));
  }
  if (kwCandidates.size) return { stage: 'keyword', candidates: Array.from(kwCandidates), trace };
  // regex
  const rxCandidates = new Set();
  for (const rule of regexRules) if (rule.re.test(text)) rule.agents.forEach(a => rxCandidates.add(a));
  if (rxCandidates.size) return { stage: 'regex', candidates: Array.from(rxCandidates), trace };
  return { stage: 'none', candidates: [], trace };
}
