/**
 * Shared SQL fragments for listing reads.
 *
 * Keeping the projection in one place guarantees that a public card, an owner
 * row and an administrator row are built from the same columns — and that none
 * of them selects identifier ciphertext, fingerprints or moderation notes,
 * which are fetched separately and only where the caller is authorised.
 */
export const LISTING_CARD_SELECT = `
  l.id, l.slug, l.title, l.status, l.availability, l.condition, l.asking_price_tzs, l.negotiable,
  l.exchange_allowed, l.region, l.city, l.published_at, l.created_at, l.updated_at, l.view_count, l.description,
  l.device_id, l.seller_id, l.category_id, l.brand_id, l.review_priority, l.submitted_at,
  l.decision_reason_code, l.decision_reason_note, l.submission_round,
  d.model AS model, d.specs AS specs, coalesce(b.name, d.brand_name) AS brand_name,
  c.slug AS category_slug, c.name AS category_name, c.description AS category_description, c.icon AS category_icon,
  s.display_name AS seller_display_name, s.region AS seller_region,
  s.identity_reviewed_at AS seller_identity_reviewed_at, s.avatar_url AS seller_avatar_url,
  s.account_status AS seller_account_status, s.email AS seller_email, s.phone_visible AS seller_phone_visible,
  s.phone AS seller_phone, s.created_at AS seller_created_at, s.bio AS seller_bio, s.city AS seller_city,
  s.email_verified_at AS seller_email_verified_at,
  img.id AS primary_image_id, img.url AS primary_image_url, img.mime_type AS primary_image_mime,
  img.width AS primary_image_width, img.height AS primary_image_height,
  coalesce(img_count.total, 0) AS image_count
`;

export const LISTING_CARD_FROM = `
  FROM listings l
  JOIN devices d ON d.id = l.device_id
  JOIN categories c ON c.id = l.category_id
  LEFT JOIN brands b ON b.id = l.brand_id
  JOIN (
    SELECT u.id, u.email, u.account_status, u.identity_reviewed_at, u.email_verified_at, u.created_at,
           p.display_name, p.region, p.city, p.phone, p.phone_visible, p.bio,
           ma.url AS avatar_url
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      LEFT JOIN media_assets ma ON ma.id = p.avatar_media_id
  ) s ON s.id = l.seller_id
  LEFT JOIN LATERAL (
    SELECT li.media_asset_id FROM listing_images li WHERE li.listing_id = l.id ORDER BY li.position ASC LIMIT 1
  ) li0 ON true
  LEFT JOIN media_assets img ON img.id = li0.media_asset_id
  LEFT JOIN LATERAL (SELECT count(*)::int AS total FROM listing_images li2 WHERE li2.listing_id = l.id) img_count ON true
`;

/** Only approved, non-inactive, non-deleted listings may appear publicly. */
export const PUBLIC_LISTING_PREDICATE = `l.status = 'approved' AND l.availability <> 'inactive' AND l.deleted_at IS NULL`;
