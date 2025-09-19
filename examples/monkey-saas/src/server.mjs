import http from 'node:http';
import { getTenantId } from './utils/tenant.mjs';
import * as Auth from './routes/auth.mjs';
import * as Monkeys from './routes/monkeys.mjs';

const PORT = process.env.PORT || 4000;

function notFound(res) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'not_found' })); }
function bad(res, msg) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: msg })); }
function ok(res, body) { const data = JSON.stringify(body); res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }); res.end(data); }

const server = http.createServer(async (req, res) => {
  // Basic CORS for ease of local testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') return ok(res, { status: 'ok' });

  const tenantId = getTenantId(req);
  if (!tenantId) return bad(res, 'missing x-tenant-id');

  // Auth routes
  if (req.method === 'POST' && req.url === '/v1/auth/signup') return Auth.signup(req, res, tenantId);
  if (req.method === 'POST' && req.url === '/v1/auth/login') return Auth.login(req, res, tenantId);

  // Monkeys collection
  if (req.url === '/v1/monkeys' && req.method === 'GET') return Monkeys.list(req, res, tenantId);
  if (req.url === '/v1/monkeys' && req.method === 'POST') return Monkeys.create(req, res, tenantId);

  // Monkeys item routes: /v1/monkeys/:id
  const m = req.url.match(/^\/v1\/monkeys\/([^\/]+)$/);
  if (m) {
    const id = m[1];
    if (req.method === 'GET') return Monkeys.show(req, res, tenantId, id);
    if (req.method === 'PATCH') return Monkeys.patch(req, res, tenantId, id);
    if (req.method === 'DELETE') return Monkeys.destroy(req, res, tenantId, id);
  }

  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`Monkey SaaS API listening on http://localhost:${PORT}`);
});

