#!/usr/bin/env node
// Cleanup utilities for runs, logs, and memory artifacts.

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.log(`Usage:
  node scripts/cleanup.mjs [--runs-max-per-alias N] [--logs-max-bytes B] [--dry-run]
`);
}

function pruneRuns(maxPerAlias, dryRun) {
  const root = path.resolve('.runs');
  if (!fs.existsSync(root)) return;
  for (const alias of fs.readdirSync(root)) {
    const dir = path.join(root, alias);
    if (!fs.statSync(dir).isDirectory()) continue;
    const entries = fs.readdirSync(dir)
      .map((name) => ({ name, p: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .filter((e) => fs.statSync(e.p).isDirectory())
      .sort((a, b) => b.mtime - a.mtime);
    const toDelete = entries.slice(maxPerAlias);
    for (const e of toDelete) {
      console.log(`${dryRun ? '[dry] ' : ''}remove ${e.p}`);
      if (!dryRun) fs.rmSync(e.p, { recursive: true, force: true });
    }
  }
}

function tailFile(p, maxBytes) {
  const stat = fs.statSync(p);
  if (stat.size <= maxBytes) return;
  const fd = fs.openSync(p, 'r');
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    // Ensure we start at a line boundary
    let start = 0;
    while (start < buf.length && buf[start] !== 0x0a) start++;
    const sliced = start < buf.length ? buf.slice(start + 1) : buf;
    fs.writeFileSync(p, sliced);
  } finally {
    fs.closeSync(fd);
  }
}

function pruneLogs(maxBytes, dryRun) {
  const p = path.resolve('data/logs/events.jsonl');
  if (!fs.existsSync(p)) return;
  const size = fs.statSync(p).size;
  if (size <= maxBytes) return;
  console.log(`${dryRun ? '[dry] ' : ''}truncate ${p} to last ${maxBytes} bytes (from ${size})`);
  if (!dryRun) tailFile(p, maxBytes);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) return usage();
  let runsMax = Number(process.env.RUNS_MAX_PER_ALIAS || 10);
  let logsMax = Number(process.env.LOGS_MAX_BYTES || 5 * 1024 * 1024);
  let dry = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--runs-max-per-alias') runsMax = Number(args[++i] || runsMax);
    else if (a === '--logs-max-bytes') logsMax = Number(args[++i] || logsMax);
    else if (a === '--dry-run') dry = true;
  }
  pruneRuns(runsMax, dry);
  pruneLogs(logsMax, dry);
}

main();

