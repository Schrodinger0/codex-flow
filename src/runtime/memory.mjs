import fs from 'node:fs';
import path from 'node:path';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

const MEM_ROOT = path.resolve('data/memory');
const LOG_ROOT = path.resolve('data/logs');

export function redactObject(obj, keys = []) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? obj.map((v) => redactObject(v, keys)) : { ...obj };
  for (const k of keys) if (k in out) out[k] = '[REDACTED]';
  for (const [k, v] of Object.entries(out)) if (v && typeof v === 'object') out[k] = redactObject(v, keys);
  return out;
}

export function appendMemory(alias, entry, { redact = [] } = {}) {
  ensureDir(MEM_ROOT);
  const p = path.join(MEM_ROOT, `${alias}.jsonl`);
  const line = JSON.stringify(redactObject(entry, redact));
  fs.appendFileSync(p, line + '\n', 'utf8');
}

export function appendEvent(event) {
  ensureDir(LOG_ROOT);
  const p = path.join(LOG_ROOT, 'events.jsonl');
  fs.appendFileSync(p, JSON.stringify(event) + '\n', 'utf8');
}

export function ensureRunWorkspace(alias, taskId) {
  const dir = path.resolve('.runs', alias, taskId);
  ensureDir(dir);
  return dir;
}

export function cleanupRuns(alias, { maxPerAlias = 10 } = {}) {
  try {
    const dir = path.resolve('.runs', alias);
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, p: path.join(dir, e.name), mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (entries.length <= maxPerAlias) return;
    const toDelete = entries.slice(maxPerAlias);
    for (const e of toDelete) {
      try {
        // shallow remove folder recursively
        fs.rmSync(e.p, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

export async function readLastLines(alias, limit = 50) {
  try {
    const p = path.resolve('data/memory', `${alias}.jsonl`);
    const data = fs.readFileSync(p, 'utf8');
    const lines = data.trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch {
    return [];
  }
}
