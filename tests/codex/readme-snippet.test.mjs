import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

test('README loader snippet path with subdomain works', () => {
  const CODEX_DIR = path.resolve('codex/agents');
  const index = JSON.parse(fs.readFileSync(path.join(CODEX_DIR, 'index.json'), 'utf8'));
  // Try loading a handful of entries including those with subdomain, if any
  const some = index.agents.slice(0, 10);
  for (const entry of some) {
    const defPath = path.join(CODEX_DIR, entry.domain, ...(entry.subdomain ? [entry.subdomain] : []), `${entry.id}.codex.yaml`);
    const txt = fs.readFileSync(defPath, 'utf8');
    const def = yaml.load(txt);
    assert.ok(def && def.agent && def.agent.id);
  }
});

