import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function runNode(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

test('orchestrator honors selector/decomposer flags (heuristic/heuristic) and prints plan JSON', async () => {
  const eventsPath = path.resolve('data/logs/events.jsonl');
  try { fs.rmSync(eventsPath, { force: true }); } catch {}
  const { code, out, err } = await runNode([
    path.resolve('scripts/orchestrator.mjs'),
    '--prompt', 'Build a minimal API and tests',
    '--yes', '--plan', '--json',
    '--selector', 'heuristic',
    '--decomposer', 'heuristic',
  ]);
  assert.equal(code, 0, err);
  // Find the first JSON line and parse
  assert.ok(/"kind"\s*:\s*"scenario-plan"/.test(out), `missing scenario-plan in output: ${out.slice(0,200)}`);
});

test('orchestrator logs decomposer_invalid when LLM returns bad DAG', async () => {
  const eventsDir = path.resolve('data/logs');
  const eventsPath = path.join(eventsDir, 'events.jsonl');
  fs.mkdirSync(eventsDir, { recursive: true });
  try { fs.rmSync(eventsPath, { force: true }); } catch {}
  const RUN_CMD = "printf '%s' '{\"plan\":[{\"id\":\"A\",\"title\":\"A\",\"dependsOn\":[\"Z\"],\"parallelizable\":false}],\"orders\":[]}'";
  const { code, out, err } = await runNode([
    path.resolve('scripts/orchestrator.mjs'),
    '--prompt', 'Force invalid DAG',
    '--yes', '--plan', '--json',
    '--selector', 'heuristic',
    '--decomposer', 'llm',
  ], { RUN_CMD, PLANNER_TEST_FORCE_INVALID: '1' });
  assert.equal(code, 0, err);
  // Allow a brief flush time
  await new Promise((r)=>setTimeout(r,200));
  const lines = fs.readFileSync(eventsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const evs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  // Sanity: planner stages logged
  assert.ok(evs.find((e)=>e.kind==='selector_generated'));
  assert.ok(evs.find((e)=>e.kind==='decomposer_generated'));
  assert.ok(evs.find((e)=>e.kind==='dag_valid') || evs.find((e)=>e.kind==='decomposer_invalid'));
  const invalid = evs.find((e) => e.kind === 'decomposer_invalid');
  assert.ok(invalid, 'expected decomposer_invalid event');
  // Also verify the scenario-plan JSON includes dag error (string match to avoid multi-line parse fragility)
  assert.ok(/"kind"\s*:\s*"scenario-plan"/.test(out));
  assert.ok(/"dag"\s*:\s*\{/.test(out));
  assert.ok(/"ok"\s*:\s*false/.test(out));
});
