import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/http.ts';
import { AppError } from '../lib/errors.ts';
import { requireAuth } from '../middleware/auth.ts';
import { params, validate } from '../middleware/validate.ts';
import { mediaDriver, readLocalMedia } from '../services/media/storage.ts';
import { resolvePrivateAsset, softDeleteAsset } from '../services/media-service.ts';
import { queryOne } from '../db/pool.ts';
import { recordAudit } from '../lib/audit.ts';
import type { AuthenticatedUser } from '../types/express.d.ts';

/**
 * Media delivery.
 *
 *   * `/media/*` serves *public* listing images when the local storage driver is
 *     active (Cloudinary assets are delivered from its CDN instead). The path is
 *     checked against the database so the directory cannot be walked and private
 *     files can never be reached this way.
 *   * `/media/private/:id` streams or redirects to a private asset only after an
 *     ownership/role check, and records the access in the audit log.
 */
export const mediaRouter = Router();
export const publicMediaRouter = Router();

publicMediaRouter.get(
  '/*path',
  asyncHandler(async (req, res) => {
    const pathname = decodeURIComponent((req.params as Record<string, string>).path ?? '');
    if (pathname.includes('..')) throw AppError.forbidden('Invalid media path');
    if (mediaDriver().name !== 'local') {
      throw AppError.notFound('Media is served by the configured CDN on this deployment');
    }
    // Only assets registered as public may be served.
    const asset = await queryOne<{ id: string; storage_key: string; mime_type: string }>(
      `SELECT id, storage_key, mime_type FROM media_assets
        WHERE storage_key = $1 AND visibility = 'public' AND deleted_at IS NULL`,
      [pathname],
    );
    if (!asset) throw AppError.notFound('Media not found');
    const buffer = await readLocalMedia(asset.storage_key);
    res.setHeader('Content-Type', asset.mime_type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  }),
);

mediaRouter.get(
  '/private/:id',
  requireAuth,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const asset = await resolvePrivateAsset(id, { id: user.id, isAdmin: user.role === 'admin' });
    if (asset.signedUrl) {
      res.redirect(302, asset.signedUrl);
      return;
    }
    if (!asset.localBuffer) throw AppError.notFound('File content is unavailable');
    res.setHeader('Content-Type', asset.mimeType);
    // Private files must never be cached by shared caches.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${asset.id}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(asset.localBuffer);
  }),
);

/**
 * Access log for evidence views. Called by the web client immediately before it
 * renders a private asset so that "who looked at this evidence" is recorded.
 */
mediaRouter.post(
  '/private/:id/access-log',
  requireAuth,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    const asset = await queryOne<{ id: string; purpose: string; owner_id: string | null }>(
      'SELECT id, purpose, owner_id FROM media_assets WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!asset) throw AppError.notFound('File not found');
    const isOwner = asset.owner_id === user.id;
    await recordAudit({
      actorId: user.id,
      actorRole: user.role,
      action: isOwner ? 'media.viewed_own' : 'evidence.viewed',
      entityType: 'media_asset',
      entityId: id,
      metadata: { purpose: asset.purpose, isOwner },
    });
    res.json({ data: { logged: true } });
  }),
);

mediaRouter.delete(
  '/:id',
  requireAuth,
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const user = req.auth?.user as AuthenticatedUser;
    const { id } = params<{ id: string }>(req);
    await softDeleteAsset(id, user.id);
    res.json({ data: { deleted: true } });
  }),
);
