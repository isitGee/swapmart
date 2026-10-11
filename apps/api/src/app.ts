import express from 'express';
import { loadConfig } from './config/env.ts';
import { attachAuth } from './middleware/auth.ts';
import { errorHandler, notFoundHandler } from './middleware/error.ts';
import {
  bodyParsers,
  corsMiddleware,
  csrfProtection,
  globalLimiter,
  issueCsrfCookie,
  requestContext,
  securityHeaders,
} from './middleware/security.ts';
import { apiRouter } from './routes/index.ts';
import { publicMediaRouter } from './routes/media.routes.ts';

/**
 * Express application factory. Kept separate from the HTTP listener so the
 * automated tests can drive the API in-process with supertest against a real
 * database and the same middleware stack as production.
 */
export function createApp(): express.Express {
  const config = loadConfig();
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.disable('etag');

  app.use(requestContext);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(bodyParsers);
  app.use(issueCsrfCookie);
  app.use(csrfProtection);
  app.use('/api', globalLimiter);
  app.use(attachAuth);

  // Public media (local storage driver only; Cloudinary serves from its CDN).
  app.use('/media', publicMediaRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
