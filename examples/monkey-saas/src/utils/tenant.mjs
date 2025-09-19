export function getTenantId(req) {
  // Prefer explicit header for clarity in early development.
  const header = req.headers['x-tenant-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  // Optionally parse from subdomain: <tenant>.api.example.com
  const host = (req.headers.host || '').split(':')[0];
  const parts = host.split('.');
  if (parts.length > 2) return parts[0];
  return null;
}

