import type { ExternalCheckStatus } from '@swapmart/shared';
import { loadConfig } from '../../config/env.ts';
import { logger } from '../../config/logger.ts';

/**
 * External stolen / blacklist verification providers.
 *
 * SWAPMART cannot itself determine whether a device has been reported stolen:
 * that requires an authoritative source (for example a national police
 * register, a GSMA-style device registry, or a manufacturer or insurer feed).
 * This module defines the single place where such a provider is integrated.
 *
 * The default provider is `none`, which means:
 *   * no lookup is performed,
 *   * the verification attempt records `not_configured`/`not_performed` with an
 *     explicit explanatory message,
 *   * the submission continues through the human moderation process.
 *
 * Nothing here ever fabricates a "clear" result. A green "no match found"
 * claim is only produced when a real provider actually answered.
 */

export interface ExternalCheckRequest {
  identifiers: { kind: string; value: string }[];
  listingId: string;
}

export interface ExternalCheckResult {
  status: ExternalCheckStatus;
  provider: string | null;
  performedAt: Date | null;
  /** Provider payload, stored for moderator review (never returned publicly). */
  response?: Record<string, unknown>;
  /** Human-readable explanation surfaced to moderators, and to the seller. */
  message: string;
  /** True only when a provider answered and reported no match. */
  clearedByProvider: boolean;
}

export interface StolenCheckProvider {
  readonly name: string;
  readonly configured: boolean;
  check(request: ExternalCheckRequest): Promise<ExternalCheckResult>;
}

class NoneProvider implements StolenCheckProvider {
  readonly name = 'none';
  readonly configured = false;

  async check(): Promise<ExternalCheckResult> {
    return {
      status: 'not_configured',
      provider: null,
      performedAt: null,
      message:
        'No authorised stolen-device verification provider is configured for this deployment, so no automatic blacklist or stolen-device lookup was performed. The listing has been routed to human moderation.',
      clearedByProvider: false,
    };
  }
}

/**
 * Generic HTTP provider adapter.
 *
 * Contract: POST {url} with { identifiers: [{kind, value}] } and an optional
 * `Authorization: Bearer <key>` header; expect `{ match: boolean, reference?: string,
 * detail?: string }`. Timeouts and non-2xx responses are reported as
 * `timeout`/`error` — never as a pass.
 */
class HttpProvider implements StolenCheckProvider {
  readonly name: string;
  readonly configured = true;
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(url: string, apiKey: string | undefined, timeoutMs: number, label = 'http') {
    this.url = url;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.name = label;
  }

  async check(request: ExternalCheckRequest): Promise<ExternalCheckResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = new Date();
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ identifiers: request.identifiers, listingId: request.listingId }),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
      if (!response.ok) {
        logger.warn({ status: response.status, provider: this.name }, 'stolen-check provider returned an error status');
        return {
          status: 'error',
          provider: this.name,
          performedAt: startedAt,
          response: { status: response.status, body: payload },
          message: `The verification provider responded with status ${response.status}. No conclusion was drawn; the listing requires manual review.`,
          clearedByProvider: false,
        };
      }
      const matched = payload.match === true;
      return {
        status: matched ? 'match' : 'clear',
        provider: this.name,
        performedAt: startedAt,
        response: payload,
        message: matched
          ? 'The verification provider reported a match for one of the submitted identifiers. The listing is withheld from the catalogue pending moderator review.'
          : 'The verification provider returned no match for the submitted identifiers. This is not confirmation of ownership — only that the provider had no record.',
        clearedByProvider: !matched,
      };
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      return {
        status: aborted ? 'timeout' : 'error',
        provider: this.name,
        performedAt: startedAt,
        message: aborted
          ? `The verification provider did not respond within ${this.timeoutMs} ms. No conclusion was drawn; the listing requires manual review.`
          : 'The verification provider could not be reached. No conclusion was drawn; the listing requires manual review.',
        clearedByProvider: false,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

let provider: StolenCheckProvider | null = null;

export function stolenCheckProvider(): StolenCheckProvider {
  if (provider) return provider;
  const config = loadConfig();
  if (config.stolenCheck.provider === 'http' && config.stolenCheck.url) {
    provider = new HttpProvider(config.stolenCheck.url, config.stolenCheck.apiKey, config.stolenCheck.timeoutMs);
  } else {
    provider = new NoneProvider();
  }
  return provider;
}

/** Test seam: allows the suite to inject a deterministic provider. */
export function setStolenCheckProvider(next: StolenCheckProvider | null): void {
  provider = next;
}

export interface ProviderStatus {
  provider: string;
  configured: boolean;
  status: ExternalCheckStatus;
  notices: string[];
}

export function externalProviderStatus(): ProviderStatus {
  const active = stolenCheckProvider();
  const notices: string[] = [];
  if (!active.configured) {
    notices.push(
      'No stolen-device verification provider is configured (STOLEN_CHECK_PROVIDER=none). Automatic blacklist checks are therefore not performed, and the platform does not claim that a device is clear of theft reports: every submission is reviewed by a human moderator and sellers must provide evidence of lawful possession.',
    );
  } else {
    notices.push(
      `Submissions are checked against the configured provider "${active.name}". Provider answers are recorded with their timestamp; a "no match" answer is not proof of ownership.`,
    );
  }
  return {
    provider: active.name,
    configured: active.configured,
    status: active.configured ? 'not_performed' : 'not_configured',
    notices,
  };
}
