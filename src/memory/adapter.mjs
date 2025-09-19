// MemoryAdapter selector: prefers Redis when configured, falls back to file-backed JSONL.
// API (subset): append, window, beginSession, endSession.

export async function getMemory() {
  const useRedis = process.env.MEM_BACKEND === 'redis' || (!!process.env.MEM_REDIS_URL);
  if (useRedis) {
    try {
      const mod = await import('./redis.mjs');
      return await mod.createRedisMemory();
    } catch (e) {
      console.warn(`[memory] Redis selected but not available (${e?.message || e}). Falling back to file memory.`);
    }
  }
  const mod = await import('../runtime/memory.mjs');
  return createFileMemory(mod);
}

function createFileMemory(fileMod) {
  return {
    async beginSession({ alias }) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${alias || 'sess'}`;
      return { sessionId: id };
    },
    async endSession() { return; },
    async append({ def, alias, namespace = 'default', sessionId }, entry, { redact = [] } = {}) {
      const payload = { ts: new Date().toISOString(), agentId: def?.agent?.id, alias, namespace, sessionId, ...entry };
      fileMod.appendMemory(alias || def?.agent?.id || 'agent', payload, { redact });
      return { ok: true };
    },
    async window({ def, alias, namespace = 'default' }, { limit = 50 } = {}) {
      // naive: read last N lines from data/memory/<alias>.jsonl when present
      const { readLastLines } = await import('../runtime/memory.mjs');
      const name = alias || def?.agent?.id || 'agent';
      return readLastLines(name, limit);
    },
  };
}
