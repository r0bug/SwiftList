// Express 5 / strict-TS helpers — both req.query[k] and (with
// noUncheckedIndexedAccess) req.params[k] need light coercion.

export function qstr(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

export function pstr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  throw new Error('Missing path param');
}
