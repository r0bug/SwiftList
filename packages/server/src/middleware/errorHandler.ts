import type { ErrorRequestHandler } from 'express';
import { logger } from '../util/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  const message = err?.message || 'Internal server error';
  if (status >= 500) logger.error({ err }, 'unhandled error');
  res.status(status).json({ error: message, code: err?.code });
};
