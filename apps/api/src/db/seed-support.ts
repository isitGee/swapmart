import { deflateSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Deterministic image generation for demonstration data.
 *
 * The seed needs real image bytes so that listings, thumbnails, the upload
 * pipeline and the duplicate-image check all exercise the same code paths as
 * production uploads. Rather than shipping binary fixtures in the repository,
 * small PNG tiles are generated here (fictional device photographs are simulated
 * as labelled colour tiles — never pictures of real people or real documents).
 */

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** Builds a PNG of the given size with a diagonal two-colour gradient. */
export function generatePng(width: number, height: number, rgbA: [number, number, number], rgbB: [number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const t = (x + y) / (width + height);
      const offset = rowStart + 1 + x * 3;
      raw[offset] = Math.round(rgbA[0] * (1 - t) + rgbB[0] * t);
      raw[offset + 1] = Math.round(rgbA[1] * (1 - t) + rgbB[1] * t);
      raw[offset + 2] = Math.round(rgbA[2] * (1 - t) + rgbB[2] * t);
    }
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function checksumHex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

/** Computes a valid IMEI (14 digits + Luhn check digit) so seeds pass validation. */
export function syntheticImei(prefix = '35', seed = 1): string {
  const base = `${prefix}${String(seed).padStart(6, '0')}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  const fourteen = base.slice(0, 14).padEnd(14, '0');
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    let digit = Number(fourteen[13 - index]);
    if (index % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${fourteen}${checkDigit}`;
}

export function syntheticSerial(prefix: string, index: number): string {
  return `${prefix}-${String(1000 + index)}-SM${String(index).padStart(3, '0')}`;
}
