import { sign } from '../utils/jwt.mjs';
import { createUser, findUserByEmail } from '../store.mjs';

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

export async function signup(req, res, tenantId) {
  try {
    const body = await readJson(req);
    const { email, name } = body || {};
    if (!email) return bad(res, 'email required');
    const existing = findUserByEmail(tenantId, email);
    if (existing) return conflict(res, 'user exists');
    const user = createUser(tenantId, { email, name });
    const token = sign({ sub: user.id, tenantId }, DEV_SECRET, { expiresInSec: 60 * 60 * 24 * 7 });
    return ok(res, { user, token });
  } catch (e) {
    return error(res, e);
  }
}

export async function login(req, res, tenantId) {
  try {
    const body = await readJson(req);
    const { email } = body || {};
    if (!email) return bad(res, 'email required');
    const user = findUserByEmail(tenantId, email);
    if (!user) return notFound(res, 'user not found');
    const token = sign({ sub: user.id, tenantId }, DEV_SECRET, { expiresInSec: 60 * 60 * 24 * 7 });
    return ok(res, { user, token });
  } catch (e) {
    return error(res, e);
  }
}

function ok(res, body) { json(res, 200, body); }
function bad(res, msg) { json(res, 400, { error: msg }); }
function notFound(res, msg) { json(res, 404, { error: msg }); }
function conflict(res, msg) { json(res, 409, { error: msg }); }
function error(res, e) { json(res, 500, { error: 'server_error', detail: e.message }); }
function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

