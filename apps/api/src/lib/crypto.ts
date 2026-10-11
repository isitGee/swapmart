import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import argon2 from '@node-rs/argon2';
import { loadConfig } from '../config/env.ts';

/**
 * Cryptographic primitives.
 *
 * Password hashing : Argon2id via the maintained Rust implementation
 *                    (@node-rs/argon2), parameters m=19456 KiB, t=2, p=1, which
 *                    match the OWASP Password Storage Cheat Sheet guidance.
 * Session tokens   : 32 random bytes; only a SHA-256 hash is stored, so a
 *                    database disclosure does not yield usable sessions.
 * Device identifiers: AES-256-GCM (authenticated encryption) for the value that
 *                    an authorised seller or moderator may need to re-read, and
 *                    HMAC-SHA256 for the duplicate-detection fingerprint. A
 *                    fingerprint cannot be brute forced from the stored value,
 *                    and the plaintext identifier is never written to disk in
 *                    the clear.
 */
const config = loadConfig();

const ARGON2_OPTIONS = {
  algorithm: 2 as const, // Argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** True when a stored hash used weaker parameters than the current policy. */
export function passwordHashNeedsUpgrade(hash: string): boolean {
  const match = /m=(\d+),t=(\d+),p=(\d+)/.exec(hash);
  if (!match) return true;
  const [, memoryCost, timeCost, parallelism] = match;
  return (
    Number(memoryCost) < ARGON2_OPTIONS.memoryCost ||
    Number(timeCost) < ARGON2_OPTIONS.timeCost ||
    Number(parallelism) < ARGON2_OPTIONS.parallelism
  );
}

export interface GeneratedToken {
  token: string;
  hash: string;
}

/** Opaque, URL-safe token (sessions, email verification, password reset). */
export function generateToken(bytes = 32): GeneratedToken {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function randomId(): string {
  return randomUUID();
}

/** Constant-time comparison for token/hash verification. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/* --------------------------- Device identifiers ---------------------------- */

const ENVELOPE_VERSION = 'v1';

/**
 * Encrypts a normalised identifier. Output format: `v1.<iv>.<tag>.<ciphertext>`
 * with base64url parts, which keeps the value portable across PostgreSQL and
 * future storage engines.
 */
export function encryptIdentifier(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.security.identifierEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENVELOPE_VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptIdentifier(envelope: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Unsupported identifier ciphertext envelope');
  }
  const iv = Buffer.from(parts[1] as string, 'base64url');
  const tag = Buffer.from(parts[2] as string, 'base64url');
  const ciphertext = Buffer.from(parts[3] as string, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', config.security.identifierEncryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Keyed fingerprint used for duplicate detection and the unique index. HMAC with
 * a server-side secret means fingerprints cannot be recomputed by an attacker
 * who only holds a database copy, which also protects low-entropy values such
 * as short model numbers from dictionary attacks.
 */
export function fingerprintIdentifier(normalisedValue: string): string {
  return createHmac('sha256', config.security.identifierHashSecret).update(normalisedValue).digest('hex');
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Random, unguessable storage key for uploaded media. */
export function mediaStorageKey(prefix: string, extension: string): string {
  return `${prefix}/${new Date().toISOString().slice(0, 7)}/${randomBytes(16).toString('hex')}.${extension.replace(/[^a-z0-9]/gi, '')}`;
}
