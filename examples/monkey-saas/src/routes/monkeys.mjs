import { verify } from '../utils/jwt.mjs';
import { createMonkey, listMonkeys, getMonkey, updateMonkey, deleteMonkey } from '../store.mjs';

const DEV_SECRET = process.env.JWT_SECRET || 'DEV_SECRET_CHANGE_ME';

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function requireAuth(req, res, tenantId) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { error: () => json(res, 401, { error: 'missing_bearer_token' }) };
  try {
    const claims = verify(token, DEV_SECRET);
    if (claims.tenantId !== tenantId) return { error: () => json(res, 403, { error: 'wrong_tenant' }) };
    return { claims };
  } catch (e) {
    return { error: () => json(res, 401, { error: 'invalid_token', detail: e.message }) };
  }
}

export async function list(req, res, tenantId) {
  const a = requireAuth(req, res, tenantId); if (a.error) return a.error();
  return ok(res, listMonkeys(tenantId));
}

export async function create(req, res, tenantId) {
  const a = requireAuth(req, res, tenantId); if (a.error) return a.error();
  try {
    const body = await readJson(req);
    const { name, species } = body || {};
    if (!name) return bad(res, 'name required');
    return created(res, createMonkey(tenantId, { name, species }));
  } catch (e) { return error(res, e); }
}

export async function show(req, res, tenantId, id) {
  const a = requireAuth(req, res, tenantId); if (a.error) return a.error();
  const m = getMonkey(tenantId, id);
  if (!m) return notFound(res, 'monkey not found');
  return ok(res, m);
}

export async function patch(req, res, tenantId, id) {
  const a = requireAuth(req, res, tenantId); if (a.error) return a.error();
  try {
    const body = await readJson(req);
    const next = updateMonkey(tenantId, id, body || {});
    if (!next) return notFound(res, 'monkey not found');
    return ok(res, next);
  } catch (e) { return error(res, e); }
}

export async function destroy(req, res, tenantId, id) {
  const a = requireAuth(req, res, tenantId); if (a.error) return a.error();
  const okDel = deleteMonkey(tenantId, id);
  return okDel ? noContent(res) : notFound(res, 'monkey not found');
}

function ok(res, body) { json(res, 200, body); }
function created(res, body) { json(res, 201, body); }
function noContent(res) { res.writeHead(204); res.end(); }
function bad(res, msg) { json(res, 400, { error: msg }); }
function notFound(res, msg) { json(res, 404, { error: msg }); }
function error(res, e) { json(res, 500, { error: 'server_error', detail: e.message }); }
function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

