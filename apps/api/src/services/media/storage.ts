import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../../config/env.ts';
import { logger } from '../../config/logger.ts';
import { AppError } from '../../lib/errors.ts';

/**
 * Media storage abstraction.
 *
 * Two drivers implement the same contract:
 *   * `cloudinary` — used in production. Public listing images are delivered
 *     from Cloudinary's CDN; verification evidence is uploaded as a *private*
 *     asset and is only ever reachable through a short-lived signed URL that the
 *     API issues to the owner or a moderator.
 *   * `local` — development/demonstration fallback when Cloudinary credentials
 *     are absent. Public files are served by the API from an immutable path;
 *     private files are streamed only through an access-controlled endpoint.
 *
 * The active driver is reported in the admin system-status panel, and the UI
 * states plainly which one is in use so no deployment pretends to have CDN
 * storage it does not have.
 */
export type StorageDriverName = 'cloudinary' | 'local';

export interface StoredMedia {
  driver: StorageDriverName;
  key: string;
  url: string | null;
  providerMeta: Record<string, unknown>;
  width: number | null;
  height: number | null;
}

export interface UploadInput {
  buffer: Buffer;
  mimeType: string;
  /** 'listing_image' | 'evidence' | 'avatar' | 'dispute_attachment' */
  purpose: string;
  ownerId: string;
  extension: string;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  upload(input: UploadInput): Promise<StoredMedia>;
  remove(key: string): Promise<void>;
  /** Public URL for a publicly visible asset. */
  publicUrl(key: string, meta: Record<string, unknown>): string | null;
  /** Time-limited URL for a private asset (owner/moderator access only). */
  privateUrl(key: string, meta: Record<string, unknown>, ttlSeconds: number): string | null;
}

const config = loadConfig();

/* ------------------------------ Cloudinary --------------------------------- */

function cloudinarySignature(params: Record<string, string>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}

class CloudinaryDriver implements StorageDriver {
  readonly name = 'cloudinary' as const;

  private get credentials(): { cloudName: string; apiKey: string; apiSecret: string } {
    const { cloudName, apiKey, apiSecret } = config.media.cloudinary;
    if (!cloudName || !apiKey || !apiSecret) {
      throw AppError.notConfigured(
        'Cloudinary media storage',
        'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or switch MEDIA_STORAGE to "local" for development.',
      );
    }
    return { cloudName, apiKey, apiSecret };
  }

  async upload(input: UploadInput): Promise<StoredMedia> {
    const { cloudName, apiKey, apiSecret } = this.credentials;
    const isPrivate = input.purpose !== 'listing_image' && input.purpose !== 'avatar';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = `${config.media.cloudinary.folder}/${input.purpose}`;
    const params: Record<string, string> = {
      folder,
      timestamp,
      // `authenticated` keeps evidence out of public CDN paths entirely.
      ...(isPrivate ? { type: 'authenticated' } : {}),
    };
    const signature = cloudinarySignature(params, apiSecret);

    const form = new FormData();
    form.append('file', `data:${input.mimeType};base64,${input.buffer.toString('base64')}`);
    form.append('api_key', apiKey);
    form.append('timestamp', timestamp);
    form.append('folder', folder);
    if (isPrivate) form.append('type', 'authenticated');
    form.append('signature', signature);

    const resourceType = input.mimeType === 'application/pdf' ? 'raw' : 'image';
    const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.media.cloudinary.timeoutMs);
    try {
      const response = await fetch(endpoint, { method: 'POST', body: form, signal: controller.signal });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const message = typeof payload.error === 'object' && payload.error && 'message' in payload.error
          ? String((payload.error as { message: unknown }).message)
          : `Cloudinary responded with status ${response.status}`;
        throw new Error(message);
      }
      const publicId = String(payload.public_id ?? '');
      const deliveryType = String(payload.type ?? (isPrivate ? 'authenticated' : 'upload'));
      return {
        driver: 'cloudinary',
        key: publicId,
        url: isPrivate ? null : String(payload.secure_url ?? ''),
        providerMeta: {
          publicId,
          resourceType,
          deliveryType,
          format: payload.format ?? null,
          version: payload.version ?? null,
          bytes: payload.bytes ?? input.buffer.length,
          folder,
        },
        width: typeof payload.width === 'number' ? payload.width : null,
        height: typeof payload.height === 'number' ? payload.height : null,
      };
    } catch (error) {
      const reason = error instanceof Error && error.name === 'AbortError' ? 'timed out' : (error as Error).message;
      logger.error({ err: error, purpose: input.purpose }, 'cloudinary upload failed');
      throw AppError.serviceUnavailable(
        `The media service could not store the file (${reason}). Please retry; if the problem persists an administrator must check the Cloudinary configuration.`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async remove(key: string): Promise<void> {
    // Deletion is best-effort: an orphaned CDN asset is not a correctness issue,
    // but it must be logged so it can be cleaned up.
    logger.warn({ key }, 'cloudinary asset deletion is manual: remove the asset from the Cloudinary console');
  }

  publicUrl(key: string, meta: Record<string, unknown>): string | null {
    const { cloudName } = config.media.cloudinary;
    if (!cloudName) return null;
    const resourceType = String(meta.resourceType ?? 'image');
    const deliveryType = String(meta.deliveryType ?? 'upload');
    const version = meta.version ? `v${String(meta.version)}/` : '';
    return `https://res.cloudinary.com/${cloudName}/${resourceType}/${deliveryType}/${version}${key}`;
  }

  /** Cloudinary authenticated delivery: signed URL valid for `ttlSeconds`. */
  privateUrl(key: string, meta: Record<string, unknown>, ttlSeconds: number): string | null {
    const { cloudName, apiSecret } = config.media.cloudinary;
    if (!cloudName || !apiSecret) return null;
    const resourceType = String(meta.resourceType ?? 'image');
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const toSign = `${key}?__cld_token__=exp=${expiresAt}${apiSecret}`;
    const token = createHmac('sha256', apiSecret).update(toSign).digest('base64url');
    return `https://res.cloudinary.com/${cloudName}/${resourceType}/authenticated/__cld_token__=exp=${expiresAt}~hmac=${token}/${key}`;
  }
}

/* -------------------------------- Local ------------------------------------ */

class LocalDriver implements StorageDriver {
  readonly name = 'local' as const;
  private readonly baseDir = config.media.localStorageDir;

  async upload(input: UploadInput): Promise<StoredMedia> {
    const key = `${input.purpose}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${input.extension}`;
    const target = path.join(this.baseDir, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.buffer, { mode: 0o640 });
    const isPrivate = input.purpose !== 'listing_image' && input.purpose !== 'avatar';
    return {
      driver: 'local',
      key,
      url: isPrivate ? null : `${config.apiUrl}/media/${key}`,
      providerMeta: { localPath: key },
      width: null,
      height: null,
    };
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(path.join(this.baseDir, key));
    } catch (error) {
      logger.warn({ err: error, key }, 'local media deletion failed');
    }
  }

  publicUrl(key: string): string {
    return `${config.apiUrl}/media/${key}`;
  }

  privateUrl(): string {
    // Private local files are streamed by an authenticated API endpoint rather
    // than exposed through a URL that could leak.
    return `${config.apiUrl}/api/v1/media/private`;
  }

  resolvePath(key: string): string {
    const resolved = path.resolve(this.baseDir, key);
    if (!resolved.startsWith(path.resolve(this.baseDir))) {
      throw AppError.forbidden('Invalid media path');
    }
    return resolved;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.resolvePath(key));
  }
}

/* ------------------------------- Selection --------------------------------- */

let driver: StorageDriver | null = null;

export function mediaDriver(): StorageDriver {
  if (driver) return driver;
  driver = config.media.driver === 'cloudinary' ? new CloudinaryDriver() : new LocalDriver();
  return driver;
}

export function isLocalDriver(): boolean {
  return mediaDriver().name === 'local';
}

export function readLocalMedia(key: string): Promise<Buffer> {
  const active = mediaDriver();
  if (!(active instanceof LocalDriver)) {
    throw AppError.notFound('Media not found');
  }
  return active.read(key);
}

export interface MediaConfigurationStatus {
  driver: StorageDriverName;
  requested: string;
  configured: boolean;
  notices: string[];
}

export function mediaConfigurationStatus(): MediaConfigurationStatus {
  const notices: string[] = [];
  const cloudinaryConfigured = Boolean(
    config.media.cloudinary.cloudName && config.media.cloudinary.apiKey && config.media.cloudinary.apiSecret,
  );
  if (config.media.driver === 'local') {
    notices.push(
      cloudinaryConfigured
        ? 'MEDIA_STORAGE is set to "local": uploads are stored on this server instead of Cloudinary.'
        : 'Cloudinary is not configured, so uploads are stored on the local filesystem (development fallback). Files are lost if the container is rebuilt — configure CLOUDINARY_* before demonstrating with real users.',
    );
  } else {
    notices.push('Uploads are stored in Cloudinary; private evidence is uploaded as an authenticated asset.');
  }
  return {
    driver: config.media.driver,
    requested: config.media.requestedDriver,
    configured: config.media.driver === 'cloudinary' ? cloudinaryConfigured : true,
    notices,
  };
}
