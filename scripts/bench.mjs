#!/usr/bin/env node
// Simple provider benchmark: run a prompt across providers and emit a JSON report.

import fs from 'node:fs';
import path from 'node:path';
import { runWithOpenAI, runWithAnthropic, runWithOllama } from '../src/runtime/providers.mjs';
import { computeCost } from '../src/runtime/pricing.mjs';

function usage(){
  console.log(`Usage:\n  node scripts/bench.mjs --prompt "<text>" --providers openai,anthropic,ollama [--model-openai m] [--model-anthropic m] [--model-ollama m] [--stream]\n`);
}

function parseFlags(argv){
  const out = { prompt: '', providers: ['openai','anthropic','ollama'], stream: false };
  for (let i=2;i<argv.length;i++){
    const a = argv[i];
    if (a === '--prompt') out.prompt = argv[++i] || '';
    else if (a === '--providers') out.providers = String(argv[++i]||'').split(',').map(s=>s.trim()).filter(Boolean);
    else if (a === '--model-openai') out.modelOpenAI = argv[++i] || undefined;
    else if (a === '--model-anthropic') out.modelAnthropic = argv[++i] || undefined;
    else if (a === '--model-ollama') out.modelOllama = argv[++i] || undefined;
    else if (a === '--stream') out.stream = true;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  }
  return out;
}

function toMessages(text){ return [{ role: 'user', content: String(text) }]; }

async function main(){
  const args = parseFlags(process.argv);
  if (!args.prompt) { usage(); process.exit(1); }
  const messages = toMessages(args.prompt);
  const started = Date.now();
  const report = { prompt: args.prompt, startedAt: new Date().toISOString(), providers: {} };
  for (const p of args.providers){
    const t0 = Date.now();
    try {
      if (p === 'openai'){
        const model = args.modelOpenAI || process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const { ok, content, usage } = await runWithOpenAI({ messages, model, apiKey: process.env.OPENAI_API_KEY, stream: args.stream });
        const costUsd = usage ? computeCost({ provider: 'openai', model, usage }) : null;
        report.providers[p] = { ok, ms: Date.now()-t0, tokensIn: usage?.prompt_tokens, tokensOut: usage?.completion_tokens, costUsd, contentPreview: String(content||'').slice(0,200) };
      } else if (p === 'anthropic'){
        const model = args.modelAnthropic || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20240620';
        const { ok, content, usage } = await runWithAnthropic({ messages, model, apiKey: process.env.ANTHROPIC_API_KEY, stream: args.stream });
        const costUsd = usage ? computeCost({ provider: 'anthropic', model, usage }) : null;
        report.providers[p] = { ok, ms: Date.now()-t0, tokensIn: usage?.input_tokens, tokensOut: usage?.output_tokens, costUsd, contentPreview: String(content||'').slice(0,200) };
      } else if (p === 'ollama'){
        const model = args.modelOllama || process.env.OLLAMA_MODEL || 'llama3';
        const { ok, content } = await runWithOllama({ messages, model, url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434', stream: args.stream });
        const costUsd = computeCost({ provider: 'ollama', model, usage: { prompt_tokens: 0, completion_tokens: 0 } });
        report.providers[p] = { ok, ms: Date.now()-t0, costUsd, contentPreview: String(content||'').slice(0,200) };
      } else {
        report.providers[p] = { ok: false, ms: Date.now()-t0, error: 'unknown provider' };
      }
    } catch (e) {
      report.providers[p] = { ok: false, ms: Date.now()-t0, error: String(e?.message||e) };
    }
  }
  report.elapsedMs = Date.now() - started;
  const outDir = path.resolve('data/bench');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `bench-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outFile}`);
  // Markdown summary
  const md = [
    `# Bench Report`,
    `Prompt: ${report.prompt}`,
    `Started: ${report.startedAt}`,
    '',
    '| Provider | OK | ms | Tokens In | Tokens Out | Cost (USD) | Preview |',
    '|---|---:|---:|---:|---:|---:|---|'
  ];
  for (const [prov, r] of Object.entries(report.providers)){
    md.push(`| ${prov} | ${r.ok?'1':'0'} | ${r.ms||''} | ${r.tokensIn||''} | ${r.tokensOut||''} | ${r.costUsd??''} | ${String(r.contentPreview||'').replace(/\|/g,'\|')} |`);
  }
  const mdFile = path.join(outDir, `bench-${Date.now()}.md`);
  fs.writeFileSync(mdFile, md.join('\n'));
  // CSV summary
  const csvHeader = 'provider,ok,ms,tokens_in,tokens_out,cost_usd\n';
  const csvRows = Object.entries(report.providers).map(([prov, r]) => `${prov},${r.ok?1:0},${r.ms||''},${r.tokensIn||''},${r.tokensOut||''},${r.costUsd??''}`).join('\n');
  const csvFile = path.join(outDir, `bench-${Date.now()}.csv`);
  fs.writeFileSync(csvFile, csvHeader + csvRows + '\n');
  for (const [prov, r] of Object.entries(report.providers)){
    console.log(`- ${prov}: ${r.ok?'ok':'fail'} in ${r.ms}ms`);
  }
}

main();
