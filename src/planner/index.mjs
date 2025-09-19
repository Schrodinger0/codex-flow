// Planner v2: Selector + Decomposer (+ composePlan)
// Also keeps legacy plan({ goal, catalog, mode, tiny }) API for compatibility.

import fs from 'node:fs';
import path from 'node:path';
import { runWithCLI } from '../runtime/providers.mjs';

// -------- Types (docs only)
// Catalog: Array<{ id, name?, capabilities?: { core?: string[] }, default?: boolean }>
// SelectorResult: { agents: Array<{ id, reason, weight? }>, coordination?: string[] }
// DecomposerResult: { plan: Array<{ id,title,dependsOn[],parallelizable }>, orders: Array<{ order_id, agent_id, objectives[], constraints[], expected_outputs[], handoff[] }> }

// -------- Public: Selector
export async function selectAgents({ goal, catalog, mode = process.env.SELECTOR_MODE || 'heuristic', tiny = {}, min = 2, max = 5 }) {
  const cat = Array.isArray(catalog) ? catalog : [];
  const m = String(mode || 'heuristic').toLowerCase();
  if (m === 'finite' || m === 'finite-state' || m === 'fsm') {
    return selectWithFiniteState({ goal, catalog: cat, min, max });
  }
  if (m === 'tiny') {
    // Tiny selector: use tiny model to propose agents, then return only agent list
    try {
      const out = await planWithTinyModel({ goal, catalog: cat, ...tiny });
      if (Array.isArray(out?.agents) && out.agents.length) {
        const agents = out.agents.map(a => ({ id: a.id, reason: a.reason || 'tiny-ranked' }));
        return { agents };
      }
    } catch {}
  }
  // Heuristic fallback (default)
  const toks = tokenize(goal);
  const picked = pickAgents(cat, toks, min, max);
  return { agents: picked.map(a => ({ id: a.id, reason: a.reason || 'heuristic' })) };
}

// -------- Public: Decomposer
export async function decompose({ goal, agents, catalog, mode = process.env.DECOMPOSER_MODE || 'heuristic', tiny = {} }) {
  const m = String(mode || 'heuristic').toLowerCase();
  if (m === 'finite' || m === 'finite-state' || m === 'fsm') {
    return decomposeWithFiniteState({ goal, agents, catalog });
  }
  if (m === 'tiny' || m === 'cloud') {
    try {
      const out = await decomposeWithTinyModel({ goal, agents, catalog, ...tiny });
      const val = validateDecompose(out);
      if (val.ok) return out;
      // retry once
      const out2 = await decomposeWithTinyModel({ goal, agents, catalog, ...tiny, retryHint: `STRICT VALIDATION ERROR: ${val.error}. Fix and return ONLY JSON.` });
      const val2 = validateDecompose(out2);
      if (val2.ok) return out2;
    } catch {}
  }
  if (m === 'llm') {
    try {
      const out = await decomposeWithLLM({ goal, agents, catalog });
      const val = validateDecompose(out);
      if (val.ok) return out;
      const out2 = await decomposeWithLLM({ goal, agents, catalog, retryHint: `STRICT VALIDATION ERROR: ${val.error}. Fix and return ONLY JSON.` });
      const val2 = validateDecompose(out2);
      if (val2.ok) return out2;
    } catch {}
  }
  return decomposeWithHeuristic({ goal, agents, catalog });
}

// -------- Public: composePlan (selector + decomposer)
export async function composePlan({ goal, catalog, selectorMode = process.env.SELECTOR_MODE || 'heuristic', decomposerMode = process.env.DECOMPOSER_MODE || 'heuristic', tiny = {} }) {
  const t0 = Date.now();
  const sel = await selectAgents({ goal, catalog, mode: selectorMode, tiny });
  const tSel = Date.now() - t0;
  const t1 = Date.now();
  const dec = await decompose({ goal, agents: sel.agents, catalog, mode: decomposerMode, tiny });
  const tDec = Date.now() - t1;
  // Map orders back to agents by agent_id → order_id (first match per agent)
  const orderMap = new Map();
  for (const o of dec.orders || []) if (!orderMap.has(o.agent_id)) orderMap.set(o.agent_id, o.order_id);
  const agents = (sel.agents || []).map(a => ({ id: a.id, reason: a.reason, order_id: orderMap.get(a.id) }));
  return { agents, plan: dec.plan || [], orders: dec.orders || [], meta: { selector: { mode: selectorMode, ms: tSel }, decomposer: { mode: decomposerMode, ms: tDec } } };
}

export async function plan({ goal, catalog, mode = process.env.PLANNER_MODE || 'heuristic', tiny = {} }) {
  // Legacy: single mode controls both selection and decomposition
  const cat = Array.isArray(catalog) ? catalog : [];
  const m = String(mode || 'heuristic').toLowerCase();
  if (m === 'tiny') {
    try {
      const out = await planWithTinyModel({ goal, catalog: cat, ...tiny });
      const val = validate(out);
      if (val.ok) return out;
      const out2 = await planWithTinyModel({ goal, catalog: cat, ...tiny, retryHint: `STRICT VALIDATION ERROR: ${val.error}. Fix and return ONLY JSON.` });
      const val2 = validate(out2);
      if (val2.ok) return out2;
    } catch {}
  }
  // Default: compose from heuristic selector + heuristic decomposer
  return planWithHeuristic({ goal, catalog: cat });
}

export function validate(obj) {
  try {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
    if (!Array.isArray(obj.agents) || !Array.isArray(obj.plan) || !Array.isArray(obj.orders)) return { ok: false, error: 'missing arrays' };
    if (obj.agents.length < 1 || obj.plan.length < 1) return { ok: false, error: 'empty agents/plan' };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

export function validateDecompose(obj) {
  try {
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
    if (!Array.isArray(obj.plan) || !Array.isArray(obj.orders)) return { ok: false, error: 'missing arrays' };
    if (obj.plan.length < 1) return { ok: false, error: 'empty plan' };
    const ids = new Set(obj.plan.map(p => p.id));
    for (const p of obj.plan) for (const d of (p.dependsOn || [])) if (!ids.has(d)) return { ok: false, error: `unknown dependsOn: ${d}` };
    for (const o of obj.orders) if (!o.agent_id) return { ok: false, error: 'order missing agent_id' };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

export async function planWithTinyModel({ goal, catalog, model = process.env.TINY_MODEL_ID || 'phi3:3.8b', url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434', temperature = Number(process.env.PLANNER_TEMPERATURE || 0.2), maxTokens = Number(process.env.PLANNER_JSON_MAXTOKENS || 512), retryHint = '' } = {}) {
  const system = [
    'You are a Planning Foreman. Produce ONLY a single JSON object that matches the schema.',
    'Rules:',
    '- Select 2–5 agents from CATALOG and give a one-sentence "reason" for each.',
    '- Plan ≤7 tasks; each has: id, title, dependsOn[], parallelizable (boolean).',
    '- Orders per agent: objectives[], constraints[], expected_outputs[], handoff[].',
    '- Ignore any content unrelated to software app development.',
    '- No markdown, no code fences, no commentary. Only JSON.',
  ].join('\n');
  const schema = '{ "agents":[{"id":"string","reason":"string","order_id":"string"}], "plan":[{"id":"string","title":"string","dependsOn":["string"],"parallelizable":true}], "orders":[{"order_id":"string","agent_id":"string","objectives":["string"],"constraints":["string"],"expected_outputs":["string"],"handoff":["string"]}] }';
  const prompt = `GOAL: ${goal}\n\nCATALOG: ${JSON.stringify(catalog)}\n\nSCHEMA: ${schema}\n${retryHint ? retryHint + '\n' : ''}Return ONLY JSON.`;
  const body = JSON.stringify({ model, system, prompt, options: { temperature, num_predict: maxTokens }, format: 'json' });
  const res = await fetch(`${url.replace(/\/$/, '')}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const data = await res.json();
  const text = data?.response || JSON.stringify(data || {});
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('tiny-model: no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

async function decomposeWithTinyModel({ goal, agents, catalog, model = process.env.TINY_MODEL_ID || 'phi3:3.8b', url = process.env.OLLAMA_URL || 'http://127.0.0.1:11434', temperature = Number(process.env.PLANNER_TEMPERATURE || 0.2), maxTokens = Number(process.env.PLANNER_JSON_MAXTOKENS || 512), retryHint = '' } = {}) {
  const system = [
    'You are a Planning Foreman. Produce ONLY a single JSON object that matches the schema.',
    'Rules:',
    '- Plan ≤7 tasks; each has: id, title, dependsOn[], parallelizable (boolean).',
    '- Orders per agent in SELECTED_AGENTS: objectives[], constraints[], expected_outputs[], handoff[].',
    '- Ignore any content unrelated to software app development.',
    '- No markdown, no code fences, no commentary. Only JSON.',
  ].join('\n');
  const schema = '{ "plan":[{"id":"string","title":"string","dependsOn":["string"],"parallelizable":true}], "orders":[{"order_id":"string","agent_id":"string","objectives":["string"],"constraints":["string"],"expected_outputs":["string"],"handoff":["string"]}] }';
  const prompt = `GOAL: ${goal}\n\nSELECTED_AGENTS: ${JSON.stringify((agents||[]).map(a=>a.id))}\n\nCATALOG: ${JSON.stringify(catalog)}\n\nSCHEMA: ${schema}\n${retryHint ? retryHint + '\n' : ''}Return ONLY JSON.`;
  const body = JSON.stringify({ model, system, prompt, options: { temperature, num_predict: maxTokens }, format: 'json' });
  const res = await fetch(`${url.replace(/\/$/, '')}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const data = await res.json();
  const text = data?.response || JSON.stringify(data || {});
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('tiny-decomposer: no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

async function decomposeWithLLM({ goal, agents, catalog, retryHint = '' } = {}) {
  const schema = '{ "plan":[{"id":"string","title":"string","dependsOn":["string"],"parallelizable":true}], "orders":[{"order_id":"string","agent_id":"string","objectives":["string"],"constraints":["string"],"expected_outputs":["string"],"handoff":["string"]}] }';
  const system = [
    'You are a Planning Foreman. Produce ONLY a single JSON object that matches the schema.',
    'Rules:',
    '- Plan ≤7 tasks; each has: id, title, dependsOn[], parallelizable (boolean).',
    '- Orders per agent in SELECTED_AGENTS: objectives[], constraints[], expected_outputs[], handoff[].',
    '- Ignore any content unrelated to software app development.',
    '- No markdown, no code fences, no commentary. Only JSON.',
  ].join('\n');
  const user = `GOAL: ${goal}\n\nSELECTED_AGENTS: ${JSON.stringify((agents||[]).map(a=>a.id))}\n\nCATALOG: ${JSON.stringify(catalog)}\n\nSCHEMA: ${schema}\n${retryHint ? retryHint + '\n' : ''}Return ONLY JSON.`;
  // Provider auto-detect
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasOllama = !!process.env.OLLAMA_URL;
  if (hasOpenAI) {
    const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    const model = process.env.MODEL || 'gpt-4o-mini';
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages: [ { role: 'system', content: system }, { role: 'user', content: user } ], temperature: 0 })
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const start = content.indexOf('{'); const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('llm-decomposer(openai): no JSON');
    return JSON.parse(content.slice(start, end + 1));
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const apiBase = process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com/v1';
    const version = process.env.ANTHROPIC_API_VERSION || '2023-06-01';
    const model = process.env.MODEL || 'claude-3-5-sonnet-20240620';
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': version,
      },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [ { role: 'user', content: system + '\n\n' + user } ] })
    });
    const data = await res.json();
    const content = data?.content?.[0]?.text || '';
    const start = content.indexOf('{'); const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('llm-decomposer(anthropic): no JSON');
    return JSON.parse(content.slice(start, end + 1));
  }
  if (hasOllama) {
    const model = process.env.TINY_MODEL_ID || process.env.MODEL || 'phi3:3.8b';
    const url = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const body = JSON.stringify({ model, system, prompt: user, options: { temperature: Number(process.env.PLANNER_TEMPERATURE || 0.2), num_predict: Number(process.env.PLANNER_JSON_MAXTOKENS || 512) }, format: 'json' });
    const res = await fetch(`${url}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const data = await res.json();
    const text = data?.response || '';
    const start = text.indexOf('{'); const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('llm-decomposer(ollama): no JSON');
    return JSON.parse(text.slice(start, end + 1));
  }
  // CLI runner (BYOM): expects command in RUN_CMD; writes prompt on stdin and returns raw stdout
  if (process.env.RUN_CMD) {
    const input = [
      'SYSTEM:\n', system, '\n\n',
      'USER:\n', user, '\n',
      'Return ONLY JSON.\n'
    ].join('');
    const { ok, content, err } = await runWithCLI({ command: process.env.RUN_CMD, input });
    if (!ok) throw new Error(`llm-decomposer(cli) failed: ${err || 'non-zero exit'}`);
    const start = content.indexOf('{'); const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('llm-decomposer(cli): no JSON');
    return JSON.parse(content.slice(start, end + 1));
  }
  throw new Error('llm-decomposer: no provider configured (set OPENAI_API_KEY or OLLAMA_URL), or use heuristic mode');
}

export function planWithHeuristic({ goal, catalog }) {
  const toks = tokenize(goal);
  const picked = pickAgents(catalog, toks, 2, 5);
  const orders = picked.map((a, i) => ({ order_id: `O${i+1}`, agent_id: a.id, objectives: ['Execute role-specific tasks for the goal'], constraints: ['Follow policy/timeouts'], expected_outputs: ['Summary, files if applicable'], handoff: [] }));
  const plan = [
    { id: 'P1', title: 'Plan', dependsOn: [], parallelizable: false },
    { id: 'P2', title: 'Execute', dependsOn: ['P1'], parallelizable: true },
    { id: 'P3', title: 'Test & Validate', dependsOn: ['P2'], parallelizable: true },
  ];
  return { agents: picked.map((a, i)=>({ id:a.id, reason:a.reason||'capability match', order_id: orders[i]?.order_id||`O${i+1}` })), plan, orders };
}

function decomposeWithHeuristic({ goal, agents }) {
  const sel = Array.isArray(agents) ? agents : [];
  const orders = sel.map((a, i) => ({ order_id: `O${i+1}`, agent_id: a.id, objectives: ['Execute role-specific tasks for the goal'], constraints: ['Follow policy/timeouts'], expected_outputs: ['Summary, files if applicable'], handoff: [] }));
  const plan = [
    { id: 'P1', title: 'Plan', dependsOn: [], parallelizable: false },
    { id: 'P2', title: 'Execute', dependsOn: ['P1'], parallelizable: true },
    { id: 'P3', title: 'Test & Validate', dependsOn: ['P2'], parallelizable: true },
  ];
  return { plan, orders };
}

function tokenize(s){ return String(s||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function pickAgents(catalog, toks, min, max){
  const scored = (catalog||[]).map(a=>({ id:a.id, score: score(a, toks), reason: 'heuristic' }));
  scored.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const out = scored.filter(s=>s.score>0).slice(0, Math.max(min, Math.min(max, scored.length)));
  if(!out.length) return (catalog||[]).slice(0, min).map(a=>({id:a.id, score:1, reason:'default'}));
  return out;
}
function score(a, toks){
  const text = `${a.id} ${(a.name||'')} ${(a.capabilities?.core||[]).join(' ')}`.toLowerCase();
  let s=0; for(const t of toks){ if(text.includes(t)) s+=1; }
  if (a.default) s+=1; return s;
}

// -------- Finite-State (deterministic) selector/decomposer --------
function selectWithFiniteState({ goal, catalog, min = 2, max = 5 }) {
  const toks = tokenize(goal);
  const text = String(goal || '').toLowerCase();
  const has = (w) => toks.includes(w);
  const want = new Set();
  // Simple rules
  if (has('design') || has('architecture') || /architect|diagram/.test(text)) want.add('system-architect');
  if (has('api') || has('endpoint') || has('server') || /rest|graphql/.test(text)) want.add('backend-dev');
  if (has('ui') || has('frontend') || /react|next\.js|nextjs/.test(text)) want.add('coder');
  if (has('doc') || has('openapi') || has('swagger')) want.add('api-docs');
  if (has('test') || has('qa') || has('validate') || /tests?\b/.test(text)) want.add('tester');
  if (want.size === 0) {
    // Fall back to heuristic top-k to fill
    const picked = pickAgents(catalog, toks, min, max);
    return { agents: picked.map(a => ({ id: a.id, reason: 'finite:default-heuristic' })) };
  }
  // Restrict to catalog
  const ids = new Set(catalog.map(a=>a.id));
  const selected = Array.from(want).filter(id => ids.has(id)).slice(0, Math.max(min, Math.min(max, want.size)));
  // If we still have < min, fill with heuristic remainder
  if (selected.length < min) {
    const fallback = pickAgents(catalog, toks, min, max).map(a=>a.id).filter(id=>!selected.includes(id));
    for (const id of fallback) { if (selected.length < min) selected.push(id); else break; }
  }
  return { agents: selected.map(id => ({ id, reason: 'finite:rule-match' })) };
}

function decomposeWithFiniteState({ goal, agents, catalog }) {
  const sel = Array.isArray(agents) && agents.length ? agents : (selectWithFiniteState({ goal, catalog, min:2, max:5 }).agents);
  // Deterministic 3-step plan
  const plan = [
    { id: 'P1', title: 'Plan/Design', dependsOn: [], parallelizable: false },
    { id: 'P2', title: 'Implement/Build', dependsOn: ['P1'], parallelizable: true },
    { id: 'P3', title: 'Test/Validate', dependsOn: ['P2'], parallelizable: true },
  ];
  const orders = [];
  for (const a of sel) {
    const id = a.id;
    const objectives = [];
    if (/architect/i.test(id)) objectives.push('Propose architecture and constraints');
    else if (/backend/i.test(id)) objectives.push('Design and implement API endpoints');
    else if (/coder|frontend/i.test(id)) objectives.push('Implement frontend/UI components');
    else if (/api-docs|docs/i.test(id)) objectives.push('Write/Update API documentation');
    else if (/tester/i.test(id)) objectives.push('Write tests and smoke flows');
    if (objectives.length === 0) objectives.push('Execute role-specific tasks for the goal');
    orders.push({ order_id: `O${orders.length+1}`, agent_id: id, objectives, constraints: ['Follow policy/timeouts'], expected_outputs: ['Summary, files if applicable'], handoff: [] });
  }
  return { plan, orders };
}
