import { spawn } from 'node:child_process';

export async function runWithOllama({ messages, model = 'llama3', timeoutMs = 60000, url = 'http://127.0.0.1:11434', stream = false, onChunk = null }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: Boolean(stream) }),
      signal: controller.signal,
    });
    if (!stream) {
      const data = await res.json();
      const content = data?.message?.content ?? '';
      return { ok: res.ok, content, raw: data };
    }
    // Streaming: Ollama emits NDJSON per line
    const reader = res.body?.getReader?.();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    if (!reader) return { ok: res.ok, content: '', raw: null };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const chunk = obj?.message?.content || '';
          if (chunk) {
            text += chunk;
            if (onChunk) try { onChunk({ type: 'chunk', content: chunk }); } catch {}
          }
        } catch {}
      }
    }
    return { ok: res.ok, content: text, raw: null };
  } finally {
    clearTimeout(t);
  }
}

export async function runWithOpenAI({ messages, model = 'gpt-4o-mini', timeoutMs = 60000, apiKey = process.env.OPENAI_API_KEY, stream = false, onChunk = null, apiBase = 'https://api.openai.com/v1' }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for openai runner');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0, stream: Boolean(stream) }),
      signal: controller.signal,
    });
    if (!stream) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      const usage = data?.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens, total_tokens: data.usage.total_tokens } : null;
      return { ok: res.ok, content, raw: data, usage };
    }
    // Streaming: SSE lines starting with data:
    const reader = res.body?.getReader?.();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    if (!reader) return { ok: res.ok, content: '', raw: null };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const m = line.match(/^data:\s*(.*)$/);
        if (!m) continue;
        if (m[1] === '[DONE]') break;
        try {
          const obj = JSON.parse(m[1]);
          const delta = obj?.choices?.[0]?.delta?.content || '';
          if (delta) {
            text += delta;
            if (onChunk) try { onChunk({ type: 'chunk', content: delta }); } catch {}
          }
        } catch {}
      }
    }
    return { ok: res.ok, content: text, raw: null };
  } finally {
    clearTimeout(t);
  }
}

export async function runWithAnthropic({ messages, model = 'claude-3-5-sonnet-20240620', timeoutMs = 60000, apiKey = process.env.ANTHROPIC_API_KEY, stream = false, onChunk = null, apiBase = 'https://api.anthropic.com/v1', version = '2023-06-01' }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for anthropic runner');
  // Convert OpenAI-style messages to Anthropic format (role: user/assistant)
  const input = {
    model,
    max_tokens: 1024,
    messages: (messages || []).map((m) => ({ role: m.role === 'system' ? 'user' : (m.role || 'user'), content: String(m.content ?? '') })),
  };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, '')}/messages${stream ? '?stream=true' : ''}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': version,
      },
      body: JSON.stringify({ ...input, stream }),
      signal: controller.signal,
    });
    if (!stream) {
      const data = await res.json();
      // Anthropic content is in content[0].text
      const content = data?.content?.[0]?.text ?? '';
      const usage = data?.usage ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } : null;
      return { ok: res.ok, content, raw: data, usage };
    }
    // Streaming SSE lines, events include content_block_delta with { delta: { text } }
    const reader = res.body?.getReader?.();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    if (!reader) return { ok: res.ok, content: '', raw: null };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const m = line.match(/^data:\s*(.*)$/);
        if (!m) continue;
        if (m[1] === '[DONE]') break;
        try {
          const obj = JSON.parse(m[1]);
          const ev = obj?.type || obj?.event;
          if ((ev === 'content_block_delta' || ev === 'message_delta') && obj?.delta?.text) {
            const delta = obj.delta.text;
            text += delta;
            if (onChunk) try { onChunk({ type: 'chunk', content: delta }); } catch {}
          }
        } catch {}
      }
    }
    return { ok: res.ok, content: text, raw: null };
  } finally {
    clearTimeout(t);
  }
}

export async function runWithCLI({ command, input = '' }) {
  return await new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-lc', command], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      resolve({ ok: code === 0, content: stdout.trim(), err: stderr.trim(), code });
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}
