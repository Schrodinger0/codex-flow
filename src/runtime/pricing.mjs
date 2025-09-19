// Simple, configurable pricing maps (USD per 1K tokens).
// Override via env, e.g., OPENAI_PRICE_IN=0.005, OPENAI_PRICE_OUT=0.015, ANTHROPIC_PRICE_IN=0.003, ANTHROPIC_PRICE_OUT=0.015

const num = (v, d) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : d);

export function computeCost({ provider, model, usage }) {
  if (!usage) return null;
  const p = String(provider || '').toLowerCase();
  if (p === 'openai') return costOpenAI(model, usage);
  if (p === 'anthropic') return costAnthropic(model, usage);
  // ollama/cli considered $0 unless configured
  const inK = usage.prompt || usage.input || usage.input_tokens || usage.prompt_tokens || 0;
  const outK = usage.completion || usage.output || usage.output_tokens || usage.completion_tokens || 0;
  const inUsd = num(process.env.OLLAMA_PRICE_IN, 0) * (inK / 1000);
  const outUsd = num(process.env.OLLAMA_PRICE_OUT, 0) * (outK / 1000);
  return round2(inUsd + outUsd);
}

function costOpenAI(model, usage) {
  const m = String(model || '').toLowerCase();
  const inK = usage.prompt_tokens || usage.input_tokens || 0;
  const outK = usage.completion_tokens || usage.output_tokens || 0;
  // Defaults; override globally via env if set
  let priceIn = num(process.env.OPENAI_PRICE_IN, null);
  let priceOut = num(process.env.OPENAI_PRICE_OUT, null);
  if (priceIn == null || priceOut == null) {
    // Rough defaults; keep conservative
    if (m.includes('gpt-4o-mini')) { priceIn = 0.005; priceOut = 0.015; }
    else if (m.includes('gpt-4o')) { priceIn = 0.005; priceOut = 0.015; }
    else { priceIn = 0.005; priceOut = 0.015; }
  }
  return round2((priceIn * (inK / 1000)) + (priceOut * (outK / 1000)));
}

function costAnthropic(model, usage) {
  const m = String(model || '').toLowerCase();
  const inK = usage.input_tokens || usage.prompt_tokens || 0;
  const outK = usage.output_tokens || usage.completion_tokens || 0;
  let priceIn = num(process.env.ANTHROPIC_PRICE_IN, null);
  let priceOut = num(process.env.ANTHROPIC_PRICE_OUT, null);
  if (priceIn == null || priceOut == null) {
    // Rough defaults for Claude 3.5; adjust via env for precision
    if (m.includes('sonnet')) { priceIn = 0.003; priceOut = 0.015; }
    else if (m.includes('haiku')) { priceIn = 0.0008; priceOut = 0.004; }
    else { priceIn = 0.003; priceOut = 0.015; }
  }
  return round2((priceIn * (inK / 1000)) + (priceOut * (outK / 1000)));
}

function round2(n) { return Math.round(n * 100) / 100; }

