export function installFakeFetch(handlers = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init?.method || 'GET').toUpperCase();
    const key = `${method} ${new URL(url, 'http://localhost').pathname}`;
    const handler = handlers[key] || handlers['*'];
    if (!handler) throw new Error(`No fake fetch handler for ${key}`);
    return handler({ url, method, init });
  };
  return () => { globalThis.fetch = original; };
}

export function jsonResponse(obj, { status = 200, headers = {} } = {}) {
  const body = JSON.stringify(obj);
  return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
}

