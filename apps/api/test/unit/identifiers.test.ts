/**
 * Unit tests — identifier normalisation, validation, masking and crypto.
 *
 * These are the guarantees behind the requirements that (a) the same device
 * typed in different ways is recognised as a duplicate, (b) an identifier can
 * never be read back out of the database in plaintext by an administrator, and
 * (c) a password is never stored in a recoverable form.
 */
import { describe, expect, it } from 'vitest';
import {
  describeRule,
  maskIdentifierValue,
  normaliseIdentifierValue,
  validateIdentifier,
} from '../../src/lib/identifiers.ts';
import {
  decryptIdentifier,
  encryptIdentifier,
  fingerprintIdentifier,
  generateToken,
  hashPassword,
  hashToken,
  passwordHashNeedsUpgrade,
  safeEqual,
  sha256Hex,
  verifyPassword,
} from '../../src/lib/crypto.ts';

/** Valid IMEI: 15 digits with a correct Luhn check digit. */
const VALID_IMEI = '356938035643809';

describe('identifier normalisation', () => {
  it('strips punctuation and spacing from an IMEI so formatting cannot defeat duplicate detection', () => {
    for (const raw of ['356938 035643-809', '356938035643809', '35 69 38 03 56 43 80 9']) {
      expect(normaliseIdentifierValue('imei', raw)).toBe(VALID_IMEI);
    }
  });

  it('normalises MAC addresses to colon-separated uppercase pairs', () => {
    expect(normaliseIdentifierValue('mac_address', '3c22fb0a11b2')).toBe('3C:22:FB:0A:11:B2');
    expect(normaliseIdentifierValue('mac_address', '3C-22-FB-0A-11-B2')).toBe('3C:22:FB:0A:11:B2');
  });

  it('uppercases serials and removes whitespace', () => {
    expect(normaliseIdentifierValue('serial', '  c02x k3jd md6t ')).toBe('C02XK3JDMD6T');
  });
});

describe('identifier validation', () => {
  it('accepts a well-formed IMEI and reports it as plausible', () => {
    const result = validateIdentifier('imei', VALID_IMEI);
    expect(result.valid).toBe(true);
    expect(result.plausible).toBe(true);
    expect(result.last4).toBe('3809');
  });

  it('rejects an IMEI whose Luhn check digit is wrong', () => {
    const result = validateIdentifier('imei', '356938035643800');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('check-digit');
  });

  it('rejects an IMEI of the wrong length', () => {
    const result = validateIdentifier('imei', '12345');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Expected format');
  });

  it('rejects a serial with characters that cannot appear in one', () => {
    const result = validateIdentifier('serial', 'BAD SERIAL #$%^');
    expect(result.valid).toBe(false);
  });

  it('requires a value', () => {
    const result = validateIdentifier('imei', '   ');
    expect(result.valid).toBe(false);
  });

  it('flags a synthetic-looking identifier as implausible but still records it', () => {
    // This IMEI has a correct check digit, so it passes the format test, but it
    // uses the placeholder prefix 123456 and must be flagged as implausible.
    const result = validateIdentifier('imei', '123456789012347');
    expect(result.valid).toBe(true);
    expect(result.plausible).toBe(false);
    expect(result.plausibilityReason).toBeDefined();
  });

  it('explains the expected format to the seller', () => {
    expect(describeRule('imei')).toContain('15 digits');
    expect(describeRule('serial')).toContain('5–32 characters');
  });
});

describe('identifier masking', () => {
  it('never exposes more than the last four characters of an IMEI', () => {
    const { masked, last4 } = maskIdentifierValue('imei', VALID_IMEI);
    expect(masked).toBe('•••• •••• •••• 3809');
    expect(masked).not.toContain('356938');
    expect(last4).toBe('3809');
  });

  it('keeps a serial rebuildable enough for an owner to recognise while hiding the bulk', () => {
    const { masked } = maskIdentifierValue('serial', 'C02XK3JDMD6T');
    expect(masked).toBe('C••••••MD6T');
    expect(masked).not.toContain('02XK3JD');
  });
});

describe('identifier cryptography', () => {
  it('round-trips an identifier through AES-256-GCM', () => {
    const envelope = encryptIdentifier(VALID_IMEI);
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(envelope).not.toContain(VALID_IMEI);
    expect(decryptIdentifier(envelope)).toBe(VALID_IMEI);
  });

  it('produces a different ciphertext every time (random IV)', () => {
    expect(encryptIdentifier(VALID_IMEI)).not.toBe(encryptIdentifier(VALID_IMEI));
  });

  it('refuses to decrypt a tampered envelope', () => {
    const envelope = encryptIdentifier(VALID_IMEI);
    const parts = envelope.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${(parts[3] as string).slice(0, -2)}aa`].join('.');
    expect(() => decryptIdentifier(tampered)).toThrow();
  });

  it('produces a stable, keyed fingerprint for duplicate detection', () => {
    expect(fingerprintIdentifier(VALID_IMEI)).toBe(fingerprintIdentifier(VALID_IMEI));
    expect(fingerprintIdentifier(VALID_IMEI)).not.toBe(fingerprintIdentifier('356938035643808'));
    expect(fingerprintIdentifier(VALID_IMEI)).not.toContain(VALID_IMEI);
    expect(fingerprintIdentifier(VALID_IMEI)).toHaveLength(64);
  });

  it('hashes data with SHA-256 in hex', () => {
    expect(sha256Hex('swapmart')).toHaveLength(64);
    expect(sha256Hex('swapmart')).toBe(sha256Hex('swapmart'));
  });
});

describe('password hashing', () => {
  it('stores an Argon2id hash that verifies but cannot be reversed', async () => {
    const hash = await hashPassword('Swapmart#Demo2026');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('Swapmart#Demo2026');
    expect(await verifyPassword(hash, 'Swapmart#Demo2026')).toBe(true);
    expect(await verifyPassword(hash, 'Swapmart#Demo2027')).toBe(false);
  });

  it('produces a different hash for the same password (per-password salt)', async () => {
    expect(await hashPassword('same-password-value')).not.toBe(await hashPassword('same-password-value'));
  });

  it('does not accept a weak or malformed stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('recognises hashes created with weaker parameters', async () => {
    const current = await hashPassword('a-long-enough-password');
    expect(passwordHashNeedsUpgrade(current)).toBe(false);
    expect(passwordHashNeedsUpgrade('$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$aGFzaA')).toBe(true);
  });

  it('issues opaque tokens but stores only their hash', () => {
    const { token, hash } = generateToken();
    expect(token).not.toBe(hash);
    expect(hash).toBe(hashToken(token));
    expect(hash).toHaveLength(64);
  });

  it('compares secrets in constant time', () => {
    expect(safeEqual('token-value', 'token-value')).toBe(true);
    expect(safeEqual('token-value', 'token-valuf')).toBe(false);
    expect(safeEqual('short', 'longer-value')).toBe(false);
  });
});
