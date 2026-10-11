import type { MediaAssetDto } from '@swapmart/shared';
import { queryOne } from '../db/pool.ts';
import { sha256Hex } from '../lib/crypto.ts';
import { num } from './serializers.ts';
import { AppError } from '../lib/errors.ts';
import { mediaDriver } from './media/storage.ts';

/**
 * Upload handling and media access control.
 *
 * Rules enforced here:
 *   * Only images are accepted for listing photographs and avatars; images and
 *     PDFs for verification evidence (validated by signature, not by the
 *     client-declared content type).
 *   * Private assets (evidence, dispute attachments) never receive a public URL.
 *     They are streamed through `/api/v1/media/private/:id`, which checks that
 *     the caller is the owner, a moderator, or a participant of the dispute.
 *   * Every stored byte is hashed (SHA-256) so identical images can be detected
 *     across listings during verification.
 */
export interface UploadResult {
  asset: MediaAssetDto & { byteSize: number };
  checksum: string;
}

export async function storeUpload(options: {
  ownerId: string;
  purpose: 'listing_image' | 'evidence' | 'avatar' | 'dispute_attachment';
  buffer: Buffer;
  mimeType: string;
  extension: string;
  width?: number | null;
  height?: number | null;
}): Promise<UploadResult> {
  const driver = mediaDriver();
  const visibility = options.purpose === 'listing_image' || options.purpose === 'avatar' ? 'public' : 'private';
  const checksum = sha256Hex(options.buffer);

  const stored = await driver.upload({
    buffer: options.buffer,
    mimeType: options.mimeType,
    purpose: options.purpose,
    ownerId: options.ownerId,
    extension: options.extension,
  });

  const row = await queryOne<{
    id: string;
    url: string | null;
    mime_type: string;
    byte_size: number;
    width: number | null;
    height: number | null;
    purpose: string;
    visibility: string;
  }>(
    `INSERT INTO media_assets (owner_id, purpose, visibility, storage_driver, storage_key, provider_meta, url, mime_type,
                               byte_size, width, height, checksum_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, url, mime_type, byte_size, width, height, purpose, visibility`,
    [
      options.ownerId,
      options.purpose,
      visibility,
      stored.driver,
      stored.key,
      JSON.stringify(stored.providerMeta),
      stored.url,
      options.mimeType,
      options.buffer.length,
      stored.width ?? options.width ?? null,
      stored.height ?? options.height ?? null,
      checksum,
    ],
  );
  if (!row) throw AppError.internal('The uploaded file could not be recorded');

  return {
    asset: {
      id: row.id,
      url: row.visibility === 'public' ? (row.url ?? '') : `/api/v1/media/private/${row.id}`,
      width: row.width,
      height: row.height,
      mimeType: row.mime_type,
      purpose: row.purpose,
      visibility: row.visibility === 'public' ? 'public' : 'private',
      byteSize: num(row.byte_size),
    },
    checksum,
  };
}

export interface PrivateAssetAccess {
  id: string;
  storageDriver: 'cloudinary' | 'local';
  storageKey: string;
  providerMeta: Record<string, unknown>;
  mimeType: string;
  purpose: string;
  ownerId: string | null;
  signedUrl: string | null;
  localBuffer?: Buffer;
}

/**
 * Authorises access to a private asset and returns whichever representation the
 * active driver supports: a short-lived signed URL (Cloudinary) or the bytes
 * themselves (local driver).
 */
export async function resolvePrivateAsset(
  mediaId: string,
  viewer: { id: string; isAdmin: boolean },
): Promise<PrivateAssetAccess> {
  const asset = await queryOne<{
    id: string;
    owner_id: string | null;
    purpose: string;
    storage_driver: 'cloudinary' | 'local';
    storage_key: string;
    provider_meta: Record<string, unknown>;
    mime_type: string;
    visibility: string;
    deleted_at: Date | null;
  }>(
    `SELECT id, owner_id, purpose, storage_driver, storage_key, provider_meta, mime_type, visibility, deleted_at
       FROM media_assets WHERE id = $1`,
    [mediaId],
  );
  if (!asset || asset.deleted_at) throw AppError.notFound('The requested file was not found');

  const isOwner = asset.owner_id !== null && asset.owner_id === viewer.id;
  let authorised = isOwner || viewer.isAdmin;

  if (!authorised) {
    // Dispute evidence, evidence on a listing, or a moderation attachment: the
    // counterparty of an open dispute and the seller of the listing may access.
    const related = await queryOne<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM verification_evidence ve
          JOIN listings l ON l.id = ve.listing_id
         WHERE ve.media_asset_id = $1 AND l.seller_id = $2
       ) OR EXISTS (
         SELECT 1 FROM disputes d
          JOIN dispute_messages dm ON dm.dispute_id = d.id
         WHERE dm.attachment_media_id = $1 AND (d.opened_by = $2 OR d.counterparty_id = $2) AND d.status <> 'closed'
       ) AS allowed`,
      [mediaId, viewer.id],
    );
    authorised = related?.allowed === true;
  }

  if (!authorised) {
    throw AppError.forbidden('You do not have access to this file');
  }

  const driver = mediaDriver();
  if (asset.storage_driver === 'cloudinary' && driver.name === 'cloudinary') {
    return {
      id: asset.id,
      storageDriver: asset.storage_driver,
      storageKey: asset.storage_key,
      providerMeta: asset.provider_meta,
      mimeType: asset.mime_type,
      purpose: asset.purpose,
      ownerId: asset.owner_id,
      signedUrl: driver.privateUrl(asset.storage_key, asset.provider_meta, 300),
    };
  }

  const { readLocalMedia } = await import('./media/storage.ts');
  return {
    id: asset.id,
    storageDriver: asset.storage_driver,
    storageKey: asset.storage_key,
    providerMeta: asset.provider_meta,
    mimeType: asset.mime_type,
    purpose: asset.purpose,
    ownerId: asset.owner_id,
    signedUrl: null,
    localBuffer: await readLocalMedia(asset.storage_key),
  };
}

export async function softDeleteAsset(mediaId: string, ownerId: string): Promise<void> {
  const asset = await queryOne<{ id: string; owner_id: string | null }>('SELECT id, owner_id FROM media_assets WHERE id = $1', [mediaId]);
  if (!asset) throw AppError.notFound('File not found');
  if (asset.owner_id !== ownerId) throw AppError.forbidden('You can only delete your own uploads');
  const inUse = await queryOne<{ used: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM listing_images WHERE media_asset_id = $1)
              OR EXISTS (SELECT 1 FROM verification_evidence WHERE media_asset_id = $1)
              OR EXISTS (SELECT 1 FROM dispute_messages WHERE attachment_media_id = $1) AS used`,
    [mediaId],
  );
  if (inUse?.used) {
    // A file that a listing or dispute references is retained: removing it would
    // destroy evidence.
    throw AppError.conflict('This file is attached to a listing or dispute, so it cannot be deleted.');
  }
  await queryOne('UPDATE media_assets SET deleted_at = now() WHERE id = $1 RETURNING id', [mediaId]);
}
