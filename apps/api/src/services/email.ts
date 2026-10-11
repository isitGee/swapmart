import { loadConfig } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { query } from '../db/pool.ts';
import { escapeHtml } from '../lib/http.ts';

/**
 * Transactional email.
 *
 * Two transports are supported and the active one is always reported honestly:
 *   * `smtp` — real delivery through nodemailer when SMTP_URL is configured.
 *   * `log`  — development transport. Messages are persisted to the
 *              `email_outbox` table (so verification links can be retrieved by
 *              the developer or by an automated test) and printed to the
 *              server log. It never claims to have delivered anything.
 *
 * When no transport is configured the admin system-status panel and the
 * registration screen state that email delivery is unavailable, instead of
 * pretending a message was sent.
 */
const config = loadConfig();

export type EmailTemplate =
  | 'verify_email'
  | 'password_reset'
  | 'password_changed'
  | 'listing_decision'
  | 'listing_submitted'
  | 'new_message'
  | 'exchange_update'
  | 'transaction_update'
  | 'report_update'
  | 'dispute_update'
  | 'account_status';

export interface SendEmailInput {
  to: string;
  subject: string;
  template: EmailTemplate;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface EmailResult {
  delivered: boolean;
  transport: 'smtp' | 'log';
  outboxId: string | null;
  error?: string;
}

let smtpTransport: { sendMail: (options: Record<string, unknown>) => Promise<unknown> } | null = null;
let smtpChecked = false;

async function getSmtpTransport(): Promise<{ sendMail: (options: Record<string, unknown>) => Promise<unknown> } | null> {
  if (smtpChecked) return smtpTransport;
  smtpChecked = true;
  if (config.email.transport !== 'smtp' || !config.email.smtpUrl) return null;
  try {
    const nodemailer = (await import('nodemailer')) as unknown as {
      default?: { createTransport: (url: string) => { sendMail: (options: Record<string, unknown>) => Promise<unknown> } };
      createTransport?: (url: string) => { sendMail: (options: Record<string, unknown>) => Promise<unknown> };
    };
    const factory = nodemailer.default ?? nodemailer;
    const createTransport = factory?.createTransport;
    if (typeof createTransport !== 'function') throw new Error('nodemailer did not expose createTransport');
    smtpTransport = createTransport(config.email.smtpUrl);
    logger.info({ transport: 'smtp' }, 'email transport ready');
  } catch (error) {
    logger.error({ err: error }, 'SMTP transport could not be created; email delivery is unavailable');
    smtpTransport = null;
  }
  return smtpTransport;
}

async function recordOutbox(input: SendEmailInput, status: 'sent' | 'failed' | 'logged', error?: string): Promise<string | null> {
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO email_outbox (to_email, subject, body_text, template, status, transport, error, metadata, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $5 IN ('sent','logged') THEN now() ELSE NULL END)
       RETURNING id`,
      [input.to, input.subject, input.text, input.template, status, config.email.transport, error ?? null, JSON.stringify(input.metadata ?? {})],
    );
    return result.rows[0]?.id ?? null;
  } catch (dbError) {
    logger.error({ err: dbError }, 'failed to record outbound email');
    return null;
  }
}

export async function sendEmail(input: SendEmailInput): Promise<EmailResult> {
  const transport = await getSmtpTransport();
  if (transport) {
    try {
      await transport.sendMail({
        from: config.email.mailFrom,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">${escapeHtml(
          input.text,
        ).replace(/\n/g, '<br />')}</div>`,
      });
      const outboxId = await recordOutbox(input, 'sent');
      return { delivered: true, transport: 'smtp', outboxId };
    } catch (error) {
      const message = (error as Error).message;
      const outboxId = await recordOutbox(input, 'failed', message);
      logger.error({ err: error, template: input.template }, 'email delivery failed');
      return { delivered: false, transport: 'smtp', outboxId, error: message };
    }
  }

  const outboxId = await recordOutbox(input, 'logged');
  logger.info({ template: input.template, to: input.to }, 'email transport is "log": message recorded, not delivered');
  if (config.env === 'development') {
    // Printed only in development so verification links are usable locally.
    process.stdout.write(`\n--- SWAPMART email (log transport) ---\nTo: ${input.to}\nSubject: ${input.subject}\n${input.text}\n---\n\n`);
  }
  return { delivered: false, transport: 'log', outboxId };
}

export interface EmailConfigurationStatus {
  transport: 'smtp' | 'log';
  requestedTransport: string;
  configured: boolean;
  verificationRequired: boolean;
  notices: string[];
}

export function emailConfigurationStatus(): EmailConfigurationStatus {
  const notices: string[] = [];
  if (config.email.transport === 'smtp') {
    notices.push('Transactional email is delivered through the configured SMTP server.');
  } else {
    notices.push(
      'No SMTP server is configured, so verification and recovery emails are recorded in the email outbox (development transport) and are not delivered. Set SMTP_URL before demonstrating with real users.',
    );
  }
  if (!config.email.verificationRequired) {
    notices.push('Email verification is disabled by configuration (EMAIL_VERIFICATION_REQUIRED=false).');
  }
  return {
    transport: config.email.transport,
    requestedTransport: config.email.requestedTransport,
    configured: config.email.transport === 'smtp',
    verificationRequired: config.email.verificationRequired,
    notices,
  };
}

/** Used by the development-only outbox endpoint and the automated tests. */
export async function latestOutboxEntry(email: string, template?: EmailTemplate) {
  const result = await query<{ id: string; subject: string; body_text: string; template: string; created_at: Date }>(
    `SELECT id, subject, body_text, template, created_at FROM email_outbox
     WHERE to_email = $1 AND ($2::text IS NULL OR template = $2)
     ORDER BY created_at DESC LIMIT 1`,
    [email, template ?? null],
  );
  return result.rows[0] ?? null;
}
