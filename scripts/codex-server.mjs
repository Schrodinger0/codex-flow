#!/usr/bin/env node
// Minimal local Codex HTTP endpoint for demos.
// Exposes POST /run receiving { agentId, alias, task } and returns { summary, output }.

import http from 'node:http';
import url from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { runWithOllama, runWithOpenAI, runWithCLI, runWithAnthropic } from '../src/runtime/providers.mjs';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const RUNNER = String(process.env.RUNNER || 'cli');
const MODEL = String(process.env.MODEL || (RUNNER === 'ollama' ? 'llama3' : RUNNER === 'openai' ? 'gpt-4o-mini' : RUNNER === 'anthropic' ? 'claude-3-5-sonnet-20240620' : 'codex-cli'));

// --- Load registry (same as orchestrator) ---
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
const index = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, 'index.json'), 'utf8'));
const registry = new Map();
for (const e of index.agents) {
  const defPath = path.join(AGENTS_DIR, e.domain, ...(e.subdomain ? [e.subdomain] : []), `${e.id}.codex.yaml`);
  const def = yaml.load(fs.readFileSync(defPath, 'utf8'));
  registry.set(e.id, def);
}

function designOutline(topic) {
  return [
    `Goals and scope of ${topic}`,
    'Current constraints and assumptions',
    'Proposed components and data flow',
    'Interfaces/APIs and contracts',
    'Performance, reliability, and security considerations',
    'Testing and rollout plan',
  ];
}

function quickFileHeuristics(filePath) {
  try {
    const abs = path.resolve(filePath);
    const text = fs.readFileSync(abs, 'utf8');
    const lines = text.split(/\r?\n/);
    const longLines = lines.reduce((n, l, i) => (l.length > 120 ? n.concat(i + 1) : n), []);
    const todos = lines.reduce((n, l, i) => (/TODO|FIXME/.test(l) ? n.concat({ line: i + 1, text: l.trim() }) : n), []);
    const consoleLogs = lines.reduce((n, l, i) => (/console\./.test(l) ? n.concat(i + 1) : n), []);
    return { exists: true, lines: lines.length, longLines, todos, consoleLogs };
  } catch {
    return { exists: false, error: 'file not found', path: filePath };
  }
}

async function simulateWork(task) {
  if (typeof task === 'object' && task !== null) {
    if (task.type === 'code.review') {
      const files = Array.isArray(task.files) ? task.files : (task.file ? [task.file] : []);
      const findings = {};
      for (const f of files) findings[f] = quickFileHeuristics(f);
      return { summary: `Reviewed ${files.length} file(s)`, output: { kind: 'code.review', files, findings } };
    }
    if (task.type === 'design.proposal') {
      return { summary: `Proposed architecture for ${task.topic || task.title || 'module'}`, output: { kind: 'design.proposal', title: task.title || 'Architecture Outline', bullets: designOutline(task.topic || 'module') } };
    }
  }
  if (typeof task === 'string') {
    const m = task.match(/^\s*Review\s+(.+?)\s*$/i);
    if (m) {
      const file = m[1];
      const info = quickFileHeuristics(file);
      return { summary: `Reviewed 1 file`, output: { kind: 'code.review', files: [file], findings: { [file]: info } } };
    }
    const d = task.match(/^\s*Propose architecture for\s+(.+?)\s*$/i);
    if (d) return { summary: `Proposed architecture for ${d[1]}`, output: { kind: 'design.proposal', title: `Architecture for ${d[1]}`, bullets: designOutline(d[1]) } };
  }
  return { summary: 'No-op', output: { note: 'no-op', input: String(task).slice(0, 200) } };
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || '', true);
  const pathname = parsed.pathname || req.url;
  const q = parsed.query || {};
  if (req.method === 'POST' && pathname === '/run') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const { agentId, alias, task, provider, fallback } = JSON.parse(raw || '{}');
        const def = registry.get(agentId);
        if (!def) return sendJSON(res, 404, { error: `Unknown agentId: ${agentId}` });
        const stream = String(q.stream || '') === '1' || String(q.stream || '') === 'true';
        if (!stream) {
          const providers = buildProviderOrder(provider || q.provider, fallback || (q.fallback ? String(q.fallback).split(',') : []));
          const { summary, output } = await runWithFailover(def, task, providers);
          sendJSON(res, 200, { summary, output });
          return;
        }
        // SSE streaming response (best-effort)
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
        try {
          const runner = String((provider || q.provider || process.env.RUNNER || 'demo')).toLowerCase();
          if (runner === 'demo') {
            send({ event: 'start' });
            const { summary, output } = await simulateWork(task);
            // naive chunking for demo
            const s = (summary || '').toString();
            for (let i = 0; i < s.length; i += 32) send({ event: 'chunk', content: s.slice(i, i + 32) });
            send({ event: 'complete', summary, output });
            res.end();
            return;
          }
          const messages = buildMessages(def, task);
          if (runner === 'ollama') {
            await runWithOllama({ messages, model: process.env.MODEL || 'llama3', timeoutMs: Number(process.env.TIMEOUT_MS || def?.runtime?.timeout_ms || 600000), stream: true, onChunk: (c) => send({ event: 'chunk', ...c }) });
          } else if (runner === 'openai') {
            await runWithOpenAI({ messages, model: process.env.MODEL || 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY, timeoutMs: Number(process.env.TIMEOUT_MS || def?.runtime?.timeout_ms || 600000), apiBase: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1', stream: true, onChunk: (c) => send({ event: 'chunk', ...c }) });
          } else if (runner === 'anthropic') {
            await runWithAnthropic({ messages, model: process.env.MODEL || 'claude-3-5-sonnet-20240620', apiKey: process.env.ANTHROPIC_API_KEY, timeoutMs: Number(process.env.TIMEOUT_MS || def?.runtime?.timeout_ms || 600000), apiBase: process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com/v1', stream: true, onChunk: (c) => send({ event: 'chunk', ...c }) });
          } else {
            // CLI runner non-streaming fallback
            const { summary, output } = await runTaskWithProvider(def, task);
            send({ event: 'complete', summary, output });
            res.end();
            return;
          }
          send({ event: 'complete' });
          res.end();
        } catch (err) {
          send({ event: 'error', message: String(err?.message || err) });
          res.end();
        }
      } catch (e) {
        sendJSON(res, 400, { error: 'Invalid JSON body', details: String(e?.message || e) });
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/') {
    sendJSON(res, 200, { ok: true, message: 'Codex local server', runner: RUNNER, model: MODEL, routes: ['POST /run'] });
    return;
  }
  sendJSON(res, 404, { error: 'Not found' });
});

export function startServer(port = PORT) {
  return server.listen(port, () => {
    console.log(`Codex local server listening on http://localhost:${port} (runner=${RUNNER}, model=${MODEL})`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(PORT);
}

// --- Provider wiring ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CLI_RUNNER = `node ${path.join(PKG_ROOT, 'scripts', 'codex-cli-runner.mjs')}`;
function buildMessages(def, task) {
  const system = [
    `You are ${def?.agent?.name || def?.agent?.id}.`,
    def?.agent?.description ? `Description: ${def.agent.description}` : '',
    def?.responsibilities?.primary?.length ? `Primary responsibilities: ${def.responsibilities.primary.join('; ')}` : '',
    def?.responsibilities?.secondary?.length ? `Secondary: ${def.responsibilities.secondary.join('; ')}` : '',
    'Constraints: no direct shell commands against the user machine, no filesystem writes, no network access to localhost. Do not try to reach http://localhost or run local binaries.',
    'If code or files are needed, return them in one of these formats: (1) JSON: {"files":[{"path":"relative/path.ext","content":"..."}, ...]}, or (2) fenced blocks: ```file:relative/path.ext\n<content>```.',
    'Be concise. Do not include commentary if a strict JSON format is requested by the task.',
    'Follow policies: respect timeouts and tool allowlists when provided.',
  ].filter(Boolean).join('\n');
  const user = typeof task === 'string' ? task : JSON.stringify(task);
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function buildProviderOrder(primary, fallback = []) {
  const base = [];
  if (primary) base.push(String(primary).toLowerCase());
  for (const f of fallback) {
    const v = String(f||'').toLowerCase(); if (v && !base.includes(v)) base.push(v);
  }
  if (!base.length) base.push(String(process.env.RUNNER || 'demo').toLowerCase());
  return base;
}

async function runTaskWithProvider(def, task, providerOverride = null) {
  const runner = String((providerOverride || process.env.RUNNER || 'demo')).toLowerCase();
  const model = process.env.MODEL || 'llama3';
  const timeoutMs = Number(process.env.TIMEOUT_MS || def?.runtime?.timeout_ms || 600000);
  if (runner === 'demo') return simulateWork(task); // existing demo behavior
  const messages = buildMessages(def, task);
  if (runner === 'ollama') {
    const { ok, content, raw } = await runWithOllama({ messages, model, timeoutMs });
    return { summary: ok ? 'Completed via ollama' : 'Ollama error', output: content || raw };
  }
  if (runner === 'openai') {
    const { ok, content, raw } = await runWithOpenAI({ messages, model, timeoutMs, apiKey: process.env.OPENAI_API_KEY });
    return { summary: ok ? 'Completed via openai' : 'OpenAI error', output: content || raw };
  }
  if (runner === 'anthropic') {
    const { ok, content, raw } = await runWithAnthropic({ messages, model, timeoutMs, apiKey: process.env.ANTHROPIC_API_KEY });
    return { summary: ok ? 'Completed via anthropic' : 'Anthropic error', output: content || raw };
  }
  if (runner === 'cli') {
    const cmd = process.env.RUN_CMD || DEFAULT_CLI_RUNNER;
    const input = JSON.stringify({ agentId: def.agent.id, task });
    const { ok, content, err, code } = await runWithCLI({ command: cmd, input });
    return { summary: ok ? `CLI exited 0` : `CLI exited ${code}`, output: content || err };
  }
  return { summary: 'Unknown runner', output: { runner } };
}

async function runWithFailover(def, task, providers) {
  const errors = [];
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    try {
      const res = await runTaskWithProvider(def, task, p);
      // Treat non-informative errors
      if (res && typeof res.summary === 'string' && !/^Unknown runner|OpenAI error|Anthropic error|Ollama error$/.test(res.summary)) {
        return res;
      }
      if (res && res.summary && !/error/i.test(res.summary)) return res;
      errors.push({ provider: p, error: res?.summary || 'error' });
    } catch (e) {
      errors.push({ provider: p, error: String(e?.message || e) });
    }
    // backoff with jitter
    await new Promise(r => setTimeout(r, 100 + Math.floor(Math.random()*150)));
  }
  return { summary: `All providers failed`, output: { errors } };
}
