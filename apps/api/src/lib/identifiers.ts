import { IDENTIFIER_RULES, identifierLooksPlausible, luhnValid } from '@swapmart/shared';
import type { IdentifierKind } from '@swapmart/shared';

/**
 * Device identifier normalisation and validation.
 *
 * Normalisation happens before any comparison, storage or hashing: an IMEI typed
 * as "35 123456 789012/3" and "351234567890123" must produce the same
 * fingerprint, otherwise duplicate detection is trivially bypassed by adding
 * punctuation.
 */

export interface NormalisedIdentifier {
  kind: IdentifierKind;
  /** Canonical form used for fingerprinting. Never returned to a client. */
  normalised: string;
  /** Safe display form, e.g. "•••• •••• •••• 0123". */
  masked: string;
  last4: string;
  valid: boolean;
  reason?: string;
  /** False when the value passes the format check but looks synthetic. */
  plausible: boolean;
  plausibilityReason?: string;
}

export function normaliseIdentifierValue(kind: IdentifierKind, raw: string): string {
  const trimmed = raw.trim();
  switch (kind) {
    case 'imei':
    case 'meid':
      return trimmed.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    case 'mac_address':
      return trimmed.replace(/[^0-9a-fA-F]/g, '').toUpperCase().replace(/(.{2})(?=.)/g, '$1:');
    case 'serial':
    case 'model_number':
    default:
      return trimmed.replace(/[\s]+/g, '').toUpperCase();
  }
}

export function maskIdentifierValue(kind: IdentifierKind, normalised: string): { masked: string; last4: string } {
  const compact = normalised.replace(/[:\s]/g, '');
  const last4 = compact.slice(-4);
  switch (kind) {
    case 'imei':
      return { masked: `•••• •••• •••• ${last4}`, last4 };
    case 'meid':
      return { masked: `•••• •••• •••• ${last4}`, last4 };
    case 'mac_address':
      return { masked: `••:••:••:••:${compact.slice(-4, -2)}:${last4}`, last4 };
    case 'serial':
      return { masked: `${compact.slice(0, 1)}••••••${last4}`, last4 };
    case 'model_number':
      return { masked: normalised, last4 };
    default:
      return { masked: `••••${last4}`, last4 };
  }
}

export function validateIdentifier(kind: IdentifierKind, raw: string): NormalisedIdentifier {
  const normalised = normaliseIdentifierValue(kind, raw);
  const rule = IDENTIFIER_RULES[kind];
  const { masked, last4 } = maskIdentifierValue(kind, normalised);

  if (normalised.length === 0) {
    return { kind, normalised, masked, last4, valid: false, reason: `${rule.label} is required`, plausible: false };
  }
  if (!rule.pattern.test(normalised)) {
    return {
      kind,
      normalised,
      masked,
      last4,
      valid: false,
      reason: `This does not look like a valid ${rule.label}. Expected format: ${describeRule(kind)}`,
      plausible: false,
    };
  }
  if (kind === 'imei' && !luhnValid(normalised)) {
    return {
      kind,
      normalised,
      masked,
      last4,
      valid: false,
      reason: `${rule.label} failed its check-digit (Luhn) validation — re-read the number from the device or its packaging`,
      plausible: false,
    };
  }

  const plausibility = identifierLooksPlausible(kind, normalised);
  return {
    kind,
    normalised,
    masked,
    last4,
    valid: true,
    plausible: plausibility.plausible,
    plausibilityReason: plausibility.reason,
  };
}

export function describeRule(kind: IdentifierKind): string {
  switch (kind) {
    case 'imei':
      return '15 digits, verified with the Luhn check digit (dial *#06# on the device)';
    case 'meid':
      return '14 hexadecimal characters';
    case 'serial':
      return '5–32 characters: letters, digits, dot, slash or dash';
    case 'mac_address':
      return '6 pairs of hexadecimal characters, e.g. 3C:22:FB:0A:11:B2';
    case 'model_number':
      return '2–32 characters: letters, digits, dot, slash or dash';
    default:
      return 'a valid identifier';
  }
}

/**
 * Identifier kinds that make sense for a category. Used to guide the seller and
 * to require at least one identifier where the device class has one (a phone or
 * laptop can always be identified; a generic accessory may not have one).
 */
export const CATEGORIES_WITHOUT_IDENTIFIER_REQUIREMENT = new Set(['accessories', 'other', 'audio']);

export function identifierSummaryLine(kind: IdentifierKind, masked: string): string {
  return `${IDENTIFIER_RULES[kind].label}: ${masked}`;
}
