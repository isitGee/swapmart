import { randomBytes, timingSafeEqual } from 'node:crypto';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { loadConfig } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { AppError } from '../lib/errors.ts';
import { clientIp, requestId } from '../lib/http.ts';
import { CSRF_COOKIE, cookieOptions } from './auth.ts';

const config = loadConfig();

/** Correlation id + structured request logging (bodies are never logged). */
export const requestContext = [
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const incoming = req.headers['x-request-id'];
    req.requestId = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomBytes(8).toString('hex');
    res.setHeader('x-request-id', req.requestId);
    next();
  },
  pinoHttp({
    logger,
    genReqId: (req) => (req as express.Request).requestId,
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/health/ready',
    },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: { id?: string; method?: string; url?: string; remoteAddress?: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  }),
];

/** Security headers. The API returns JSON, so a strict CSP is appropriate. */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true, preload: false } : false,
});

/**
 * CORS. Only the configured web origin(s) may call the API with credentials.
 * Browsers on other origins receive no CORS headers, so their requests are
 * blocked; the check is not merely cosmetic.
 */
export const corsMiddleware = cors({
  origin(origin, callback) {
    // Same-origin requests (the Next.js rewrite proxy) have no Origin header.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    // Sandbox/preview hosts of this deployment are permitted so the app works
    // when served from a generated preview URL, but never with credentials from
    // an unrelated third-party site.
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-request-id'],
  exposedHeaders: ['x-request-id'],
  maxAge: 600,
});

export const bodyParsers = [
  express.json({ limit: '1mb' }),
  express.urlencoded({ extended: false, limit: '1mb' }),
  cookieParser(),
  compression(),
];

/* --------------------------------- Limits ---------------------------------- */

function limiter(max: number, message: string, windowMs = config.security.rateLimit.windowMs) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Memory store is adequate for a single API instance; a multi-instance
    // production deployment must move to a shared store (documented in
    // docs/DEPLOYMENT.md). Limits are still applied per client IP.
    message: { error: { code: 'rate_limited', message } },
    keyGenerator: (req) => clientIp(req as express.Request),
    skip: () => config.env === 'test',
  });
}

export const globalLimiter = limiter(config.security.rateLimit.max, 'Too many requests. Please slow down.');
export const authLimiter = limiter(
  config.security.rateLimit.authMax,
  'Too many authentication attempts. Please wait before trying again.',
);
export const sensitiveLimiter = limiter(
  config.security.rateLimit.sensitiveMax,
  'Too many requests to a sensitive endpoint. Please wait before trying again.',
);

/* ---------------------------------- CSRF ----------------------------------- */

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection for cookie-authenticated requests.
 *
 * Two independent checks are applied to state-changing requests:
 *   1. If the browser sent an `Origin`, it must be an allowed origin.
 *   2. When a session cookie is present, the double-submit token must match
 *      (`swapmart_csrf` cookie + `x-csrf-token` header).
 *
 * Requests authenticated with an `Authorization: Bearer` header are exempt:
 * they are not sent automatically by browsers, so they are not forgeable in the
 * way cookies are. In this version the API uses cookie sessions; the exemption
 * keeps the endpoint usable by trusted server-side scripts.
 */
export function csrfProtection(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.length > 0 && !config.corsOrigins.includes(origin)) {
    next(AppError.forbidden('Requests from this origin are not allowed'));
    return;
  }

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    next();
    return;
  }

  const sessionCookie = req.cookies?.swapmart_session ?? req.cookies?.['__Host-swapmart_session'];
  if (!sessionCookie) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || typeof headerToken !== 'string') {
    next(new AppError('csrf_failed', 403, 'This request is missing its security token. Reload the page and try again.'));
    return;
  }
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    next(new AppError('csrf_failed', 403, 'This request failed its security check. Reload the page and try again.'));
    return;
  }
  next();
}

/** Issues the readable CSRF token cookie when it is absent. */
export function issueCsrfCookie(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!req.cookies?.[CSRF_COOKIE]) {
    res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), {
      ...cookieOptions(),
      httpOnly: false, // must be readable by the SPA to be echoed in the header
    });
  }
  next();
}

/** Small helper used by the media routes to mark immutable responses. */
export function immutableCache(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
}

export { requestId };
