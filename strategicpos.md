Last updated: 2025-09-18

# Strategic Positioning — Provider-Agnostic Agent Kit (Codex Flow)

## Executive Summary
- Core bet: The main blocker to agentic adoption is provider lock‑in risk, not orchestration mechanics.
- Position: A provider‑agnostic agent kit that makes switching, benchmarking, and failing over between model providers a config‑level concern — with deterministic routing, artifacts, and policy built in.
- Outcome: Teams experiment boldly and ship faster because switching costs drop from days to minutes.

## Problem (Today)
- Switching providers requires re‑plumbing prompts, APIs, streaming, tool schemas, and error handling.
- Orchestration, routing, policy, and observability are typically bespoke per app and brittle.
- Decision paralysis: teams avoid building sophisticated agentic systems because they can’t commit to a single vendor.

## Insight
- “Write once, run anywhere” for agents is the lever that unlocks adoption. Deterministic orchestration is necessary but insufficient; the highest value is vendor optionality with measurable outcomes (latency/cost/quality).

## Product Strategy
1) Provider Abstraction Layer (PAL) as the core
   - Stable I/O contract: messages(+tools) → result(+usage,cost,latency,error), streaming normalized to chunk events.
   - Providers: OpenAI, Anthropic, Ollama, CLI (own binary), Codex HTTP.
   - Prompt profiles: per‑provider templates to maintain performance without LCM (lowest‑common‑denominator) degradation.
2) Deterministic Orchestration as substrate
   - Alias‑level concurrency caps, routing via triggers, strict policy, artifacts, and memory (Redis preferred).
3) Bench + Reports
   - Run the same prompt/agent across providers; produce cost/latency/ok rate comparison + simple quality checks.
4) Failover & Policy
   - Provider lists with circuit breakers and backoff; local fallback (Ollama) for resilience; thresholds for cost/latency.

## Positioning Statement
For teams building agentic systems who fear vendor lock‑in, our kit provides a provider‑agnostic runtime with deterministic routing, streaming, strict policy, and artifacted runs so you can switch providers, benchmark them, and fail over safely — without rewriting your app.

## Target Segments / JTBD
- Platform/Infra teams: “Give product squads an agent runtime that won’t box us into one vendor.”
- App teams with pilots: “Test model options quickly; pick based on measured cost/latency/quality.”
- Regulated/enterprise: “Keep artifacts and policy; run local fallbacks when cloud is unavailable.”

## Competitive Landscape (and Differentiation)
- OpenAI Agents SDK: deep OAI integration; orchestration & portability are app concerns. We add provider optionality, deterministic routing, local artifacts, and policy.
- LiteLLM / OpenRouter (provider proxies): ease of switching per request; lighter on orchestration, artifacts, and deterministic router/policy. We combine provider switching with orchestration, planning, artifacts, and strict tools.
- LangChain/LlamaIndex: rich frameworks; heavier learning curve; less opinionated on deterministic routing + per‑alias policy. We are CLI‑first, ops‑friendly, and deterministic by default.

## MVP Scope (0–2 weeks)
1) Adapters: OpenAI + Anthropic + Ollama (+ CLI already present) with normalized streaming and result envelope.
2) Pricing/usage maps: compute $ cost per run (env‑configurable rates), tokens/latency captured.
3) Bench mode: run across providers; write report JSON + markdown summary; include simple quality signals (regex checks/smoke tests).
4) Failover policy: primary + ordered fallbacks; 429/5xx detection; backoff & jitter; local fallback switch.
5) Prompt profiles: optional provider‑specific templates (system/user tool styles) with fallback to canonical.

## Technical Plan
- Abstraction
  - Canonical request: `{ messages, tools?, options }` → adapter.
  - Canonical response: `{ ok, content, usage:{tokensIn,tokensOut}, costUsd, ms, error? }` + streaming `chunk` frames.
- Providers
  - Add Anthropic adapter (done), verify streaming; integrate pricing calc per token for OAI/Anthropic; configurable for Ollama.
  - CLI adapter stays raw (no cost), allow user to inject cost via env or post‑hooks.
- Bench & Reports
  - Create `data/bench/*.json` + `data/bench/*.md`; include: ms, ok, usage, cost, contentPreview, quality flags.
  - Provide CSV export for BI ingestion.
- Failover
  - Policy syntax: `providers: [openai, anthropic, ollama]` + thresholds (`maxLatencyMs`, `maxCostUsd`, `retries`).
  - Circuit breaker: trip on persistent 429/5xx; cooldown + resume.
- Prompt Profiles
  - Optional per‑provider template packs: role mapping, system priming, tool call formatting.
  - Fallback to canonical; observable differences recorded in bench.

## Validation & Metrics
- Switching Time: measure “change provider” from minutes → seconds (flag/config only).
- Bench Adoption: % of runs executed with `--bench`; # diff reports generated.
- Cost/Latency Delta: distribution of deltas across providers; win/loss counts per prompt class.
- Failover Effectiveness: % of runs rescued by fallback; time to recover.

## Risks & Mitigations
- Prompt Portability: performance varies by provider.
  - Mitigate with template packs + bench guidance; manual overrides allowed per agent.
- Pricing Accuracy: providers change pricing.
  - Make pricing maps configurable; version them and warn on outdated maps.
- Over‑abstraction: lowest common denominator hurts power users.
  - Keep escape hatches: provider‑specific opts and templates; expose raw responses if needed.

## Packaging & Pricing (draft)
- OSS core (current): orchestration, adapters, bench JSON; “batteries included.”
- Team tier (managed or add‑on): automated bench dashboard, cost allocation, failover policies as code, provider secrets vault integration, alerting.

## GTM
- Land: “Switch providers like config” with bench screenshots + case study.
- Expand: deterministic orchestration, policy enforcement, and artifacts that plug into CI and compliance.
- Champions: platform/infra leads, cost owners, reliability owners.

## Timeline (suggested)
- Week 1: Anthropic adapter + normalized envelope + cost maps + `--provider` end‑to‑end + basic bench reports.
- Week 2: Failover policy + CSV/Markdown reports + prompt profiles v1 + docs & examples.

## Near‑Term Deliverables
- Code: pricing integration in bench, failover policy, Anthropic docs, provider profiles.
- Docs: “Provider Matrix”, “Bench Guide”, “Failover Policy”, “Prompt Profiles”.
- Examples: three provider runs for the same agent; markdown comparison.

