import { Router } from 'express';
import { healthCheck } from '../db/pool.ts';
import { loadConfig, APP_VERSION } from '../config/env.ts';
import { externalProviderStatus } from '../services/verification/providers.ts';
import { emailConfigurationStatus } from '../services/email.ts';
import { mediaConfigurationStatus } from '../services/media/storage.ts';
import { adminRouter } from './admin.routes.ts';
import { authRouter } from './auth.routes.ts';
import { catalogueRouter } from './catalogue.routes.ts';
import { dashboardRouter } from './dashboard.routes.ts';
import { mediaRouter } from './media.routes.ts';

/**
 * API surface index. Every router is mounted under `/api/v1`, which the Next.js
 * frontend reaches through a same-origin rewrite so that session cookies stay
 * first-party and no backend host is exposed to the browser.
 */
export const apiRouter = Router();

const config = loadConfig();

apiRouter.get('/health', async (_req, res) => {
  const database = await healthCheck();
  res.status(database.ok ? 200 : 503).json({
    status: database.ok ? 'ok' : 'degraded',
    version: APP_VERSION,
    environment: config.env,
    database,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

/**
 * Deployment capability report. Consumed by the web app to show honest
 * "not configured" states instead of pretending external services exist.
 */
apiRouter.get('/system/status', (_req, res) => {
  const email = emailConfigurationStatus();
  const media = mediaConfigurationStatus();
  const stolenCheck = externalProviderStatus();
  res.json({
    environment: config.env,
    version: APP_VERSION,
    email: { transport: email.transport, configured: email.configured, verificationRequired: email.verificationRequired, notices: email.notices },
    media: { driver: media.driver, configured: media.configured, notices: media.notices },
    stolenCheck: { provider: stolenCheck.provider, configured: stolenCheck.configured, status: stolenCheck.status, notices: stolenCheck.notices },
    security: {
      identifierStorage: 'AES-256-GCM encrypted at rest, HMAC-SHA256 fingerprints for duplicate detection',
      developmentSecretsInUse: config.security.usingDevelopmentSecrets,
    },
  });
});

apiRouter.use(authRouter);
apiRouter.use(catalogueRouter);
apiRouter.use(dashboardRouter);
// Media delivery lives under `/api/v1/media/*` so the URLs the API hands out
// (`/api/v1/media/private/:id`, `DELETE /api/v1/media/:id`) resolve exactly.
apiRouter.use('/media', mediaRouter);
apiRouter.use('/admin', adminRouter);
