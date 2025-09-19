#!/usr/bin/env node
// Spin up a "swarm" for intent X by generating visible artifacts you can open now.
// Usage: node scripts/swarm.mjs "Build me a todo app"

import fs from 'node:fs';
import path from 'node:path';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s, 'utf8'); }
function slug(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }

function generateSpec(intent) {
  return `# Plan — ${intent}\n\nGoals:\n- Ship a minimal app that reaches first users fast and makes the first dollar.\n- Operate in Markdown where possible for portability and speed.\n\nTracks:\n- Architecture: minimal services, simple storage, zero-ops if possible.\n- Data: focus on leads, interactions, tasks.\n- UX: one-page dashboard, fast capture, simple flows.\n- Distribution: lead capture, outreach templates, clear CTA.\n- Monetization: one-off and simple subscription.\n`;
}

function generateSchema() {
  return `-- Minimal schema suitable for SQLite/Postgres
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT CHECK (status IN ('todo','doing','done','blocked')) DEFAULT 'todo',
  due DATE,
  tags TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
`;
}

function generateSeed() {
  return JSON.stringify({ items: [
    { id: 'it_001', title: 'Define ICP', status: 'doing', due: null, tags: 'gtm' },
    { id: 'it_002', title: 'Draft outreach template', status: 'todo', due: null, tags: 'distribution' },
    { id: 'it_003', title: 'Set pricing tiers', status: 'todo', due: null, tags: 'pricing' }
  ] }, null, 2);
}

function generateApp(title) {
  return `<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
  <title>${title}</title>
  <style>body{font-family:system-ui;margin:0}header{padding:12px 16px;background:#111;color:#fff}
  main{padding:16px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #eee;padding:6px 8px;text-align:left}
  </style></head><body>
  <header><strong>${title}</strong></header>
  <main>
    <h2>Items</h2>
    <table id='items'><thead><tr><th>Title</th><th>Status</th><th>Tags</th></tr></thead><tbody></tbody></table>
  </main>
  <script>
    fetch('../data/seed.json').then(r=>r.json()).then(d=>{
      const tbody=document.querySelector('#items tbody');
      d.items.forEach(x=>{ const tr=document.createElement('tr'); tr.innerHTML=\`<td>\${x.title}</td><td>\${x.status}</td><td>\${x.tags||''}</td>\`; tbody.appendChild(tr); });
    });
  </script>
  </body></html>`;
}

function generateGTM(intent) {
  return `# Go-To-Market\n\nIntent: ${intent}\n\n1) Lead capture: Markdown form → JSON append\n2) Outreach: personalized DM/email templates\n3) Demo/offer: tighten pitch, collect feedback\n4) First dollar: collect payment (Stripe link)\n5) Flywheel: ship wins, drive more leads\n`; }

function main() {
  const intent = process.argv.slice(2).join(' ').trim() || 'Build a Markdown-based to-do app';
  const s = slug(intent);
  const root = path.resolve('swarm', s);

  write(path.join(root, 'spec', 'PLAN.md'), generateSpec(intent));
  write(path.join(root, 'db', 'schema.sql'), generateSchema());
  write(path.join(root, 'data', 'seed.json'), generateSeed());
  write(path.join(root, 'app', 'index.html'), generateApp(`Swarm — ${intent}`));
  write(path.join(root, 'distribution', 'GTM.md'), generateGTM(intent));

  console.log('✅ Swarm generated artifacts:');
  console.log(`- Open ${path.join('swarm', s, 'app', 'index.html')} in your browser`);
  console.log(`- Edit ${path.join('swarm', s, 'spec', 'PLAN.md')} and refresh`);
}

main();
