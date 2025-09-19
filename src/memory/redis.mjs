// Redis-backed memory adapter. Requires @redis/client (Node Redis v4) or ioredis.

let RedisClient = null;
let isNodeRedis = false;

async function loadRedis() {
  try {
    const mod = await import('@redis/client');
    isNodeRedis = true;
    return mod;
  } catch {}
  try {
    const mod = await import('ioredis');
    isNodeRedis = false;
    return mod;
  } catch (e) {
    throw new Error('Neither @redis/client nor ioredis is installed');
  }
}

function key({ agentId, alias, namespace = 'default', sessionId = '_' }) {
  const prefix = process.env.MEM_REDIS_PREFIX || 'mem';
  const a = agentId || '_';
  const al = alias || '_';
  const ns = namespace || 'default';
  const sess = sessionId || '_';
  return `${prefix}:${a}:${al}:${ns}:${sess}`;
}

export async function createRedisMemory() {
  const url = process.env.MEM_REDIS_URL;
  if (!url) throw new Error('MEM_REDIS_URL not set');
  const mod = await loadRedis();
  let client;
  if (isNodeRedis) {
    client = mod.createClient({ url });
    client.on('error', (err) => console.error('[redis]', err.message));
    await client.connect();
  } else {
    client = new mod.default(url);
  }
  const maxWindow = Number(process.env.MEM_REDIS_MAX_WINDOW || 200);
  const ttl = parseTtl(process.env.MEM_REDIS_TTL_DEFAULT || '7d');

  return {
    async beginSession({ def, alias }) {
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // touch a key for session bookkeeping (optional)
      const k = key({ agentId: def?.agent?.id, alias, namespace: 'session', sessionId });
      await client.set(k, '1', { EX: ttl });
      return { sessionId };
    },
    async endSession() { return; },
    async append({ def, alias, namespace = 'default', sessionId }, entry) {
      const k = key({ agentId: def?.agent?.id, alias, namespace, sessionId });
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      await client.rPush(k, line);
      await client.lTrim(k, -maxWindow, -1);
      await client.expire(k, ttl);
      return { ok: true };
    },
    async window({ def, alias, namespace = 'default', sessionId }, { limit = 50 } = {}) {
      const k = key({ agentId: def?.agent?.id, alias, namespace, sessionId });
      const arr = await client.lRange(k, -limit, -1);
      return arr.map((s) => { try { return JSON.parse(s); } catch { return { raw: s }; } });
    },
    async dispose() { try { if (client?.disconnect) await client.disconnect(); else if (client?.quit) await client.quit(); } catch {} },
  };
}

function parseTtl(s) {
  // supports s,m,h,d
  const m = String(s).trim().match(/^(\d+)([smhd])$/i);
  if (!m) return 60 * 60 * 24 * 7; // 7d default
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 's') return n;
  if (u === 'm') return n * 60;
  if (u === 'h') return n * 3600;
  if (u === 'd') return n * 86400;
  return 604800;
}

