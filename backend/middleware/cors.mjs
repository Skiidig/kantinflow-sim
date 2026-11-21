const DEFAULT_ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,OPTIONS';
const DEFAULT_ALLOWED_HEADERS = 'Authorization,Content-Type,Idempotency-Key';

export function parseCorsOrigins(rawOrigin = 'http://localhost:5173') {
  return String(rawOrigin)
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/u, ''))
    .filter(Boolean);
}

export function createCorsMiddleware(rawOrigin) {
  const allowedOrigins = parseCorsOrigins(rawOrigin || 'http://localhost:5173');
  const allowAll = allowedOrigins.includes('*');
  const allowedSet = new Set(allowedOrigins);

  return function corsMiddleware(req, res, next) {
    const requestOrigin = req.get('Origin');
    const normalizedOrigin = requestOrigin ? requestOrigin.replace(/\/+$/u, '') : '';
    const isAllowed = Boolean(normalizedOrigin) && (allowAll || allowedSet.has(normalizedOrigin));

    res.append('Vary', 'Origin');

    if (isAllowed) {
      res.set('Access-Control-Allow-Origin', allowAll ? '*' : requestOrigin);
      res.set('Access-Control-Allow-Methods', DEFAULT_ALLOWED_METHODS);
      res.set('Access-Control-Allow-Headers', DEFAULT_ALLOWED_HEADERS);
      res.set('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    return next();
  };
}
