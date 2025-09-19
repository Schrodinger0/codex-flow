import fs from 'node:fs';
import path from 'node:path';
import { appendEvent, ensureRunWorkspace, redactObject, cleanupRuns } from './memory.mjs';
import { getMemory } from '../memory/adapter.mjs';

export function admit(def) {
  if (!def || !def.agent || !def.agent.id) throw new Error('Invalid agent definition');
}

export async function enforce(def, task, fn) {
  const timeoutMs = def?.runtime?.timeout_ms ?? 600_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fn({ signal: controller.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

export function telemetry(def, result) {
  const entry = {
    ts: new Date().toISOString(),
    kind: 'telemetry',
    agentId: def?.agent?.id,
    alias: def?.agent?.instance_alias,
    ok: !!result?.ok,
    ms: result?.ms,
    engine: result?.engine,
  };
  appendEvent(entry);
}

function checkTools(def, task) {
  const allowed = def?.capabilities?.detail?.tools?.allowed || [];
  if (!allowed.length) return null;
  const requested = Array.isArray(task?.tools) ? task.tools : [];
  const disallowed = requested.filter(t => !allowed.includes(t));
  if (disallowed.length) {
    console.warn(`[policy] Tool(s) not allowed for ${def.agent.id}: ${disallowed.join(', ')} (allowed: ${allowed.join(', ')})`);
  }
  return { allowed, requested, disallowed };
}

export async function executeTask(def, task, { runtime = 'stub', verbose = false, codexUrl = null, codexKey = null, strictTools = false, onEvent = null, provider = null, fallback = [] } = {}) {
  admit(def);
  const start = Date.now();
  const alias = def.agent?.instance_alias || def.agent?.id || 'agent';
  const agentId = def.agent?.id;
  const toolPolicy = checkTools(def, task);
  if (strictTools && toolPolicy && toolPolicy.disallowed && toolPolicy.disallowed.length) {
    const msg = `Disallowed tool(s) requested for ${agentId}: ${toolPolicy.disallowed.join(', ')} (allowed: ${toolPolicy.allowed.join(', ')})`;
    const res = { alias, agentId, task, ok: false, ms: 0, engine: runtime, summary: msg, output: { error: 'strict-tools', details: msg } };
    const ev = { ts: new Date().toISOString(), kind: 'policy_violation', alias, agentId, detail: 'strict-tools', disallowed: toolPolicy.disallowed };
    appendEvent(ev);
    if (onEvent) try { onEvent(ev); } catch {}
    return res;
  }

  const taskId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = ensureRunWorkspace(alias, taskId);
  try { fs.writeFileSync(path.join(runDir, 'input.json'), JSON.stringify(task, null, 2)); } catch {}
  const memory = await getMemory();
  const sessionId = taskId;

  const startedEv = { ts: new Date().toISOString(), kind: 'task_started', alias, agentId, taskId };
  appendEvent(startedEv);
  if (onEvent) try { onEvent(startedEv); } catch {}

  return await enforce(def, task, async () => {
    if (runtime === 'codex') {
      if (!codexUrl) {
        if (verbose) console.warn('[warn] --runtime codex set, but no CODEX_URL/--codex-url. Falling back to stub.');
      } else {
        try {
          const res = await fetch(`${codexUrl.replace(/\/$/, '')}/run`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(codexKey ? { authorization: `Bearer ${codexKey}` } : {}),
            },
            body: JSON.stringify({ agentId, alias, task, provider, fallback }),
          });
          const data = await res.json().catch(() => ({}));
          const result = { alias, agentId, task, ok: res.ok, ms: Date.now() - start, engine: 'codex', summary: data?.summary || `Codex responded ${res.status}`, output: data?.output };
          try { fs.writeFileSync(path.join(runDir, 'output.json'), JSON.stringify(result, null, 2)); } catch {}
          const redactKeys = (def?.memory?.sharing_policy?.redact) || [];
          await memory.append({ def, alias, namespace: 'default', sessionId }, { taskId, agentId, summary: result.summary, ok: result.ok, output: redactObject(result.output, redactKeys) }, { redact: redactKeys });
          const doneEv = { ts: new Date().toISOString(), kind: 'task_complete', alias, agentId, taskId, ok: result.ok, ms: result.ms };
          appendEvent(doneEv);
          if (onEvent) try { onEvent(doneEv); } catch {}
          telemetry(def, result);
          return result;
        } catch (e) {
          if (verbose) console.warn(`[warn] Codex call failed: ${e?.message || e}. Falling back to stub.`);
        }
      }
    }

    if (verbose) console.log(`[start] ${alias} (${agentId}) – ${String(task).slice(0, 120)}`);
    const output = await simulateWork(task);
    if (verbose) console.log(`[done ] ${alias} (${agentId}) – ${Date.now() - start}ms`);
    const result = { alias, agentId, task, ok: true, ms: Date.now() - start, engine: 'stub', summary: `Simulated by ${alias} (${agentId})`, output };
    try { fs.writeFileSync(path.join(runDir, 'output.json'), JSON.stringify(result, null, 2)); } catch {}
    const redactKeys = (def?.memory?.sharing_policy?.redact) || [];
    await memory.append({ def, alias, namespace: 'default', sessionId }, { taskId, agentId, summary: result.summary, ok: result.ok, output: redactObject(result.output, redactKeys) }, { redact: redactKeys });
    const doneEv = { ts: new Date().toISOString(), kind: 'task_complete', alias, agentId, taskId, ok: result.ok, ms: result.ms };
    appendEvent(doneEv);
    if (onEvent) try { onEvent(doneEv); } catch {}
    telemetry(def, result);
    // Cleanup excess runs for this alias
    try { cleanupRuns(alias, { maxPerAlias: Number(process.env.RUNS_MAX_PER_ALIAS || 10) }); } catch {}
    return result;
  });
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

async function simulateWork(task) {
  if (typeof task === 'object' && task !== null) {
    if (task.type === 'code.review') {
      const files = Array.isArray(task.files) ? task.files : (task.file ? [task.file] : []);
      const findings = {};
      for (const f of files) findings[f] = quickFileHeuristics(f);
      return { kind: 'code.review', files: Object.keys(findings), findings };
    }
    if (task.type === 'design.proposal') {
      return { kind: 'design.proposal', title: task.title || 'Architecture Outline', bullets: designOutline(task.topic || 'module') };
    }
  }
  if (typeof task === 'string') {
    const m = task.match(/^\s*Review\s+(.+?)\s*$/i);
    if (m) {
      const file = m[1];
      const info = quickFileHeuristics(file);
      return { kind: 'code.review', files: [file], findings: { [file]: info } };
    }
    const d = task.match(/^\s*Propose architecture for\s+(.+?)\s*$/i);
    if (d) return { kind: 'design.proposal', title: `Architecture for ${d[1]}`, bullets: designOutline(d[1]) };
  }
  await new Promise((r) => setTimeout(r, 60));
  return { note: 'no-op', details: String(task).slice(0, 200) };
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
