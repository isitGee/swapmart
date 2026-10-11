import { pino } from 'pino';
import { loadConfig } from './env.ts';

/**
 * Structured logging. Sensitive values (identifiers, tokens, password material,
 * evidence URLs) are never logged: callers pass `redact`-safe fields only, and
 * the serialisers below strip request bodies, authorization headers and cookies.
 */
const config = loadConfig();

export const logger = pino({
  level: config.env === 'test' ? 'silent' : config.logLevel,
  base: { service: 'swapmart-api', env: config.env },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'newPassword',
      'currentPassword',
      'token',
      'identifier',
      '*.password',
      '*.token',
      '*.identifierValue',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: undefined,
});

export type Logger = typeof logger;
