// Read-only API client (same origin only; CSP connect-src 'self').
export class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
export async function get(path, params = {}) {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== '' && v !== null && v !== undefined) u.searchParams.set(k, v);
  let r;
  try { r = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }); }
  catch (_) { throw new ApiError('Sunucuya ulaşılamadı. `python3 server.py` çalışıyor mu?', 0); }
  let body = null; try { body = await r.json(); } catch (_) { /* non-JSON */ }
  if (!r.ok) throw new ApiError((body && body.error) || `HTTP ${r.status}`, r.status);
  return body;
}
