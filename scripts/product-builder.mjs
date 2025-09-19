#!/usr/bin/env node
// Product Builder scenario: plans, designs schema, scaffolds a simple Markdown-driven CRM
// Produces visible artifacts under ./product/

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const AGENTS_DIR = path.resolve('codex/agents');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function write(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s, 'utf8'); }

function loadRegistry() {
  const index = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, 'index.json'), 'utf8'));
  const registry = new Map();
  for (const e of index.agents) {
    const defPath = path.join(AGENTS_DIR, e.domain, ...(e.subdomain ? [e.subdomain] : []), `${e.id}.codex.yaml`);
    const def = yaml.load(fs.readFileSync(defPath, 'utf8'));
    registry.set(e.id, def);
  }
  return { index, registry };
}

function nowISO() { return new Date().toISOString(); }

function renderSpec(productName) {
  return `# ${productName} — Distribution‑First Product Builder\n\nGoal: Ship a Markdown‑based CRM/to‑do app optimized for first customer and first dollar.\n\nPrinciples:\n- Distribution‑first: capture leads and tasks from Day 0\n- Simple pipeline: idea → outreach → meeting → offer → paid\n- Operate in Markdown: low friction, portable, automatable\n\nCore Entities:\n- Lead: name, email, source, status, value\n- Interaction: date, channel, notes, next action\n- Task: title, owner, due, status, tags\n- Product: feature, hypothesis, outcome\n\nMVP UX:\n- Inbox (new leads)\n- Kanban (lead stages)\n- Tasks (by due, by tag)\n- Money view (pipeline, conversion, MRR/one‑off)\n\nKPIs:\n- Time‑to‑first‑contact, contact→meeting %, meeting→offer %, offer→paid %\n\n`;
}

function renderSQL() {
  return `-- Schema: Markdown CRM (SQLite/Postgres compatible)
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  source TEXT,
  status TEXT CHECK (status IN ('new','contacted','meeting','offer','won','lost')) DEFAULT 'new',
  est_value_cents INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  channel TEXT CHECK (channel IN ('email','dm','call','meet','other')),
  notes TEXT,
  next_action TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  owner TEXT,
  due DATE,
  status TEXT CHECK (status IN ('todo','doing','done','blocked')) DEFAULT 'todo',
  tags TEXT
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  hypothesis TEXT,
  outcome TEXT,
  status TEXT CHECK (status IN ('idea','building','testing','shipped')) DEFAULT 'idea'
);
`;
}

function renderSeed() {
  return JSON.stringify({
    leads: [
      { id: 'ld_001', name: 'Acme Beta', email: 'cto@acme.test', source: 'twitter', status: 'contacted', est_value_cents: 120000 },
      { id: 'ld_002', name: 'Pioneer Labs', email: 'founder@pioneer.test', source: 'referral', status: 'new', est_value_cents: 50000 }
    ],
    interactions: [
      { id: 'ix_001', lead_id: 'ld_001', ts: nowISO(), channel: 'email', notes: 'Intro email sent', next_action: 'Schedule demo' }
    ],
    tasks: [
      { id: 'tk_001', title: 'Define pricing tiers', owner: 'you', due: null, status: 'todo', tags: 'pricing' },
      { id: 'tk_002', title: 'Draft outreach template', owner: 'you', due: null, status: 'doing', tags: 'distribution' }
    ],
    products: [
      { id: 'pr_001', feature: 'Markdown lead capture', hypothesis: 'Lower friction yields +20% capture', outcome: null, status: 'building' }
    ]
  }, null, 2);
}

function renderMarkdownApp() {
  return `<!doctype html>
<html><head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Markdown CRM — Distribution First</title>
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;}
    header{padding:12px 16px;background:#111;color:#fff}
    main{padding:16px;display:grid;gap:16px;grid-template-columns:1fr 1fr}
    section{border:1px solid #ddd;border-radius:8px;padding:12px}
    h2{margin:0 0 8px 0}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #eee;padding:6px 8px;text-align:left}
    .won{color:green}.lost{color:#999}
  </style>
</head><body>
  <header><strong>Markdown CRM</strong> — distribution-first</header>
  <main>
    <section>
      <h2>Leads</h2>
      <table id="leads"><thead><tr><th>Name</th><th>Status</th><th>Value</th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Tasks</h2>
      <table id="tasks"><thead><tr><th>Title</th><th>Status</th><th>Tags</th></tr></thead><tbody></tbody></table>
    </section>
    <section>
      <h2>Pipeline</h2>
      <div id="pipeline"></div>
    </section>
    <section>
      <h2>How to Use</h2>
      <p>Edit Markdown in <code>product/spec/</code> and JSON in <code>product/data/seed.json</code>. Refresh this file in a browser.</p>
    </section>
  </main>
  <script>
    fetch('../data/seed.json').then(r=>r.json()).then(data=>{
      const tbodyL=document.querySelector('#leads tbody');
      data.leads.forEach(l=>{
        const tr=document.createElement('tr');
        tr.innerHTML=\`<td>\${l.name}</td><td class="\${l.status}">\${l.status}</td><td>$\${(l.est_value_cents/100).toFixed(2)}</td>\`;
        tbodyL.appendChild(tr);
      });
      const tbodyT=document.querySelector('#tasks tbody');
      data.tasks.forEach(t=>{
        const tr=document.createElement('tr');
        tr.innerHTML=\`<td>\${t.title}</td><td>\${t.status}</td><td>\${t.tags||''}</td>\`;
        tbodyT.appendChild(tr);
      });
      const pipe=document.querySelector('#pipeline');
      const stages=['new','contacted','meeting','offer','won','lost'];
      const buckets=Object.fromEntries(stages.map(s=>[s,0]));
      data.leads.forEach(l=>buckets[l.status]=(buckets[l.status]||0)+1);
      pipe.innerHTML = stages.map(s=>\`<div><strong>\${s}</strong>: \${buckets[s]||0}</div>\`).join('');
    });
  </script>
</body></html>`;
}

function renderGTM() {
  return `# Go-To-Market — First Customer, First Dollar

1. Define ICP and sources (Twitter, Maker communities, referrals)
2. Ship lead capture (Markdown form → JSON append)
3. Outreach at scale with personalized templates (DM/email)
4. Book demos; track interactions; iterate pitch
5. Offer simple pricing (one-off + MRR) and accept payments
6. Close loop: success stories → more leads (distribution flywheel)
`;
}

async function main() {
  loadRegistry(); // ensure bundle exists; not used directly here

  const root = path.resolve('product');
  write(path.join(root, 'README.md'), '# Product Builder Output\nOpen app/index.html in your browser.');
  write(path.join(root, 'spec', 'PRODUCT.md'), renderSpec('Markdown CRM'));
  write(path.join(root, 'db', 'schema.sql'), renderSQL());
  write(path.join(root, 'data', 'seed.json'), renderSeed());
  write(path.join(root, 'app', 'index.html'), renderMarkdownApp());
  write(path.join(root, 'distribution', 'GTM.md'), renderGTM());

  console.log('✅ Product scaffolding generated under ./product');
  console.log('- Open product/app/index.html in your browser to see the dashboard');
  console.log('- Edit product/spec/* and product/data/seed.json and refresh');
  console.log('- DB schema in product/db/schema.sql');
}

main().catch((e)=>{ console.error(e); process.exit(1); });

