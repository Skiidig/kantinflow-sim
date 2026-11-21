import { ApiError } from '../api-error.mjs';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ApiError) {
    const error = { code: err.code };
    if (err.fields) error.fields = err.fields;
    return res.status(err.status).json({ error });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE' } });
  }
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR' } });
}
