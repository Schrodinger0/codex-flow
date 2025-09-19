Last updated: 2025-09-19

# Prompt Profiles (Draft)

Goal: Preserve performance while staying portable by allowing provider-specific prompt templates with a canonical fallback.

Approach
- Canonical schema: `{ system, messages[], tools? }` used by default.
- Optional per-provider profiles:
  - `prompt.templates.openai.{system,user}`
  - `prompt.templates.anthropic.{system,user}`
  - `prompt.templates.ollama.{system,user}`

Usage (planned)
- Add templates to agent YAML or pass via overrides.
- Bench can surface deltas in latency/cost when switching profiles.

Status
- Template hooks will be added to providers; until then, canonical prompts are used for all providers.
