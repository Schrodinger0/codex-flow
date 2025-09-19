// Simple in-memory store keyed by tenantId
// Replace with a real DB (e.g., Postgres) later.

const tenants = new Map(); // tenantId -> { users: Map, monkeys: Map }

function ensureTenant(tenantId) {
  if (!tenants.has(tenantId)) tenants.set(tenantId, { users: new Map(), monkeys: new Map(), counters: { user: 0, monkey: 0 } });
  return tenants.get(tenantId);
}

export function createUser(tenantId, { email, name }) {
  const t = ensureTenant(tenantId);
  const id = `u_${++t.counters.user}`;
  const user = { id, email, name: name || email, createdAt: new Date().toISOString() };
  t.users.set(id, user);
  return user;
}

export function findUserByEmail(tenantId, email) {
  const t = ensureTenant(tenantId);
  for (const u of t.users.values()) if (u.email === email) return u;
  return null;
}

export function createMonkey(tenantId, { name, species }) {
  const t = ensureTenant(tenantId);
  const id = `m_${++t.counters.monkey}`;
  const monkey = { id, name, species: species || 'unknown', createdAt: new Date().toISOString() };
  t.monkeys.set(id, monkey);
  return monkey;
}

export function listMonkeys(tenantId) {
  const t = ensureTenant(tenantId);
  return Array.from(t.monkeys.values());
}

export function getMonkey(tenantId, id) {
  const t = ensureTenant(tenantId);
  return t.monkeys.get(id) || null;
}

export function updateMonkey(tenantId, id, patch) {
  const t = ensureTenant(tenantId);
  const cur = t.monkeys.get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, id: cur.id };
  t.monkeys.set(id, next);
  return next;
}

export function deleteMonkey(tenantId, id) {
  const t = ensureTenant(tenantId);
  return t.monkeys.delete(id);
}

