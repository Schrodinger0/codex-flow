#!/usr/bin/env node
// Generic CLI runner for Codex tasks (no external API required).
// Reads a single JSON object from stdin: { agentId, alias, task }
// Provider order:
// 1) Codex CLI (pro subscription/login) via `codex exec --json -`
// 2) OPENAI_API_KEY
// 3) Ollama

import { spawn } from 'node:child_process';
import { runWithOpenAI, runWithOllama } from '../src/runtime/providers.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function buildMessages(agentId, payload) {
  const system = `You are agent ${agentId}. Produce a concise result for the user's task.`;
  const user = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return [ { role: 'system', content: system }, { role: 'user', content: user } ];
}

function messagesToPrompt(messages) {
  // Simple text prompt compatible with `codex exec -` stdin
  const parts = [];
  for (const m of messages) {
    const role = m.role || 'user';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    parts.push(`${role.toUpperCase()}:\n${content}`);
  }
  parts.push('ASSISTANT:');
  return parts.join('\n\n');
}

async function runWithCodexCLI({ messages, timeoutMs = 60000 }) {
  return await new Promise((resolve) => {
    const child = spawn('codex', ['exec', '--json', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, content: '', err: err || out });
      const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      // Find a JSON object that has {kind:"phase-summary"} etc OR task_complete with last_agent_message
      let lastMessage = '';
      let filesJsonLine = '';
      for (const line of lines) {
        if (!line.startsWith('{') || !line.endsWith('}')) continue;
        try {
          const obj = JSON.parse(line);
          const msg = obj?.payload?.msg;
          if (msg?.type === 'task_complete' && typeof msg?.last_agent_message === 'string') {
            lastMessage = msg.last_agent_message;
          } else if (msg?.type === 'agent_message' && typeof msg?.message === 'string') {
            lastMessage = msg.message; // keep the latest
          }
          // prefer a structured files payload if present
          const pl = obj?.payload;
          if (!filesJsonLine && pl && (Array.isArray(pl.files) || (pl.output && Array.isArray(pl.output.files)))) {
            filesJsonLine = line;
          }
        } catch {}
      }
      // Return full stdout so downstream can parse JSON blocks or file fences; include lastMessage separately
      const content = out;
      const summary = lastMessage;
      resolve({ ok: true, content, summary });
    });
    const prompt = messagesToPrompt(messages);
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function main() {
  const raw = (await readStdin()) || '{}';
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }
  const { agentId = 'agent', task = '' } = data;
  const messages = buildMessages(agentId, task);
  const model = process.env.MODEL || process.env.OPENAI_MODEL || process.env.OLLAMA_MODEL || 'gpt-4o-mini';

  try {
    // Prefer Codex CLI when available (no external API needed)
    const useCodexCli = process.env.USE_CODEX_CLI !== '0';
    if (useCodexCli) {
      const { ok, content, err } = await runWithCodexCLI({ messages, timeoutMs: Number(process.env.TIMEOUT_MS || 60000) });
      if (ok) {
        process.stdout.write((content || '').toString());
        process.exit(0);
        return;
      }
      // If Codex not installed or failed, continue to next providers
    }
    if (process.env.OPENAI_API_KEY) {
      const { ok, content } = await runWithOpenAI({ messages, model, apiKey: process.env.OPENAI_API_KEY, timeoutMs: Number(process.env.TIMEOUT_MS || 60000) });
      process.stdout.write((content || '').toString());
      process.exit(ok ? 0 : 2);
      return;
    }
    // Try Ollama as fallback
    const { ok, content } = await runWithOllama({ messages, model: process.env.OLLAMA_MODEL || 'llama3', url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434', timeoutMs: Number(process.env.TIMEOUT_MS || 60000) });
    process.stdout.write((content || '').toString());
    process.exit(ok ? 0 : 3);
  } catch (e) {
    process.stderr.write(String(e?.message || e));
    process.exit(1);
  }
}

main();
