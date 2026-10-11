import { loadConfig } from '../config/env.ts';
import { logger } from '../config/logger.ts';
import { closePool, query, queryOne, withTransaction, type Tx } from './pool.ts';
import { encryptIdentifier, fingerprintIdentifier, hashPassword } from '../lib/crypto.ts';
import { storeUpload } from '../services/media-service.ts';
import { generatePng, syntheticImei, syntheticSerial } from './seed-support.ts';
import { runVerificationEngine } from '../services/verification/engine.ts';
import { notify } from '../services/notifications.ts';

/**
 * Development and demonstration seed data.
 *
 * Everything here is fictional: invented member names, invented devices and
 * synthetic identifiers (IMEIs with valid check digits that do not belong to any
 * real handset). No real identity documents, real people's data or real
 * stolen-device records are used anywhere in this project.
 *
 * Running the seed twice replaces the demonstration data; reference data
 * (categories, brands) comes from the migrations and is left alone.
 */
// Demonstration passwords. They deliberately satisfy the platform's own
// registration password policy (length, mixed case, digits, and not starting
// with the product name) so that the fixtures never contradict the rules the
// public registration form enforces.
// Development fixture passwords for the fictional demo members. They are read
// from the environment so a deployment never inherits them silently, and the
// seed summary states plainly whether the default is in use.
const DEMO_PASSWORD = process.env.DEMO_PASSWORD?.trim() || 'Mteja#Salama2026';
const DEFAULT_ADMIN_PASSWORD = 'Simamia#Salama2026';
// An empty ADMIN_PASSWORD in .env means "not configured" (dotenv yields ''), so treat
// blank as unset and fall back to the documented demonstration password.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD?.trim() || DEFAULT_ADMIN_PASSWORD;
const ADMIN_PASSWORD_IS_DEFAULT = ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD;

interface SeedUser {
  key: string;
  email: string;
  fullName: string;
  region: string;
  city: string;
  phone: string;
  bio: string;
  identityReviewed?: boolean;
  admin?: boolean;
  accountStatus?: 'active' | 'restricted' | 'suspended';
}

const USERS: SeedUser[] = [
  {
    key: 'admin',
    email: 'admin@swapmart.co.tz',
    fullName: 'Neema Mwakalinga',
    region: 'Dar es Salaam',
    city: 'Kinondoni',
    phone: '0755000100',
    bio: 'SWAPMART platform administrator (moderation and trust & safety).',
    identityReviewed: true,
    admin: true,
  },
  {
    key: 'baraka',
    email: 'baraka.juma@example.co.tz',
    fullName: 'Baraka Juma',
    region: 'Dar es Salaam',
    city: 'Mikocheni',
    phone: '0755000101',
    bio: 'I sell pre-owned smartphones I have used myself. Receipts and box kept for every device.',
    identityReviewed: true,
  },
  {
    key: 'zawadi',
    email: 'zawadi.mtei@example.co.tz',
    fullName: 'Zawadi Mtei',
    region: 'Arusha',
    city: 'Njiro',
    phone: '0755000102',
    bio: 'Laptop and tablet trader in Arusha. I upload photographs of every port and the battery report.',
    identityReviewed: true,
  },
  {
    key: 'jose',
    email: 'jose.mkumbo@example.co.tz',
    fullName: 'Jose Mkumbo',
    region: 'Mwanza',
    city: 'Nyamagana',
    phone: '0755000103',
    bio: 'Gaming consoles and accessories. I test every console with a game before listing it.',
  },
  {
    key: 'happyness',
    email: 'happyness.mwakyusa@example.co.tz',
    fullName: 'Happyness Mwakyusa',
    region: 'Mbeya',
    city: 'Uyole',
    phone: '0755000104',
    bio: 'Student selling my own devices when I upgrade. Serious buyers only.',
  },
  {
    key: 'shabani',
    email: 'shabani.mohamed@example.co.tz',
    fullName: 'Shabani Mohamed',
    region: 'Zanzibar Urban/West',
    city: 'Stone Town',
    phone: '0755000105',
    bio: 'Cameras and audio equipment. Meeting point is always a public place.',
    accountStatus: 'restricted',
  },
  {
    key: 'grace',
    email: 'grace.kimaro@example.co.tz',
    fullName: 'Grace Kimaro',
    region: 'Kilimanjaro',
    city: 'Moshi',
    phone: '0755000106',
    bio: 'Buying a laptop for my diploma course. Please share battery health in the description.',
  },
];

interface SeedListing {
  key: string;
  seller: string;
  category: string;
  brand: string;
  model: string;
  title: string;
  description: string;
  price: number;
  condition: string;
  specs: Record<string, unknown>;
  region: string;
  city: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'evidence_required' | 'suspended' | 'withdrawn' | 'flagged' | 'under_review';
  availability: 'available' | 'reserved' | 'sold' | 'inactive';
  identifierKind: 'imei' | 'serial' | 'model_number';
  identifierValue?: string;
  reviewNote?: string;
  reviewCode?: string;
  exchangeAllowed?: boolean;
}

function buildListingDefinitions(): SeedListing[] {
  return [
    {
      key: 's23-ultra',
      seller: 'baraka',
      category: 'smartphones',
      brand: 'Samsung',
      model: 'Galaxy S23 Ultra 256 GB',
      title: 'Samsung Galaxy S23 Ultra 256 GB — boxed with accessories',
      description:
        'Bought in Nairobi in March 2024 and used as my daily phone. Screen is flawless, the titanium frame has one small scuff on the bottom-left corner which I photographed. Comes with the original box, USB-C cable and a 45 W charger. Battery health is 94%. I have the purchase receipt and can show it at handover.',
      price: 1_850_000,
      condition: 'excellent',
      specs: { storageGb: '256', ramGb: '12', batteryHealth: '90-94', network: '5G', screenSizeIn: 6.8, colour: 'Phantom black', boxAndAccessories: true },
      region: 'Dar es Salaam',
      city: 'Mikocheni',
      status: 'approved',
      availability: 'available',
      identifierKind: 'imei',
    },
    {
      key: 'macbook-air',
      seller: 'zawadi',
      category: 'laptops',
      brand: 'Apple',
      model: 'MacBook Air M2 13" 256 GB',
      title: 'MacBook Air M2 (2023) 8 GB / 256 GB — 71 battery cycles',
      description:
        'Used for one academic year only, always kept in a sleeve. 71 battery cycles, battery condition "Normal". Charger, original box and a USB-C hub are included. No dents, keyboard and trackpad are perfect. I can share the battery report screenshot on request and I will demonstrate macOS at handover.',
      price: 2_300_000,
      condition: 'like_new',
      specs: { processor: 'Apple M2 8-core', ramGb: '8', storageGb: '256', storageType: 'SSD', screenSizeIn: 13.6, chargerIncluded: true },
      region: 'Arusha',
      city: 'Njiro',
      status: 'approved',
      availability: 'reserved',
      identifierKind: 'serial',
    },
    {
      key: 'ps5-slim',
      seller: 'jose',
      category: 'gaming-consoles',
      brand: 'Sony',
      model: 'PlayStation 5 Slim Disc Edition',
      title: 'PlayStation 5 Slim Disc Edition with two controllers',
      description:
        'Bought in December 2024 from a licensed shop in Mwanza, receipt available. Comes with two DualSense controllers, all cables and the original packaging. Runs quietly, no overheating, disc drive tested with two games. Selling because I moved to PC gaming.',
      price: 1_450_000,
      condition: 'like_new',
      specs: { storageGb: '1024', edition: 'PS5 Slim Disc Edition', controllersIncluded: 2, modded: false },
      region: 'Mwanza',
      city: 'Nyamagana',
      status: 'approved',
      availability: 'available',
      identifierKind: 'serial',
      exchangeAllowed: true,
    },
    {
      key: 'tecno-camon',
      seller: 'happyness',
      category: 'smartphones',
      brand: 'Tecno',
      model: 'Camon 20 Pro',
      title: 'Tecno Camon 20 Pro 256 GB — good condition, screen protector fitted',
      description:
        'My first smartphone, used for 14 months. Small scratch on the back panel (photographed), screen has always had a protector and a case fitted. Battery lasts a full day of moderate use. Charger included, no box. Price is negotiable for a serious student buyer.',
      price: 420_000,
      condition: 'good',
      specs: { storageGb: '256', ramGb: '8', batteryHealth: '85-89', network: '4G', screenSizeIn: 6.67, colour: 'Serenity blue', boxAndAccessories: false },
      region: 'Mbeya',
      city: 'Uyole',
      status: 'approved',
      availability: 'available',
      identifierKind: 'imei',
    },
    {
      key: 'canon-200d',
      seller: 'shabani',
      category: 'cameras',
      brand: 'Canon',
      model: 'EOS 200D II with 18-55 mm lens',
      title: 'Canon EOS 200D II + 18–55 mm STM lens, low shutter count',
      description:
        'Shutter count is about 9,800. Used for events around Stone Town. Body has minor wear on the edges, sensor was cleaned in June. Includes the kit lens, two batteries, charger and a 64 GB card. Tripod not included. Happy to demonstrate the shutter count in person.',
      price: 1_050_000,
      condition: 'good',
      specs: { cameraType: 'DSLR', megapixels: 24, shutterCount: 9800, lensesIncluded: '18-55 mm STM kit lens' },
      region: 'Zanzibar Urban/West',
      city: 'Stone Town',
      status: 'approved',
      availability: 'available',
      identifierKind: 'serial',
    },
    {
      key: 'hp-elitebook',
      seller: 'zawadi',
      category: 'laptops',
      brand: 'HP',
      model: 'EliteBook 840 G6',
      title: 'HP EliteBook 840 G6 i5 8th gen / 16 GB / 512 GB SSD',
      description:
        'Ex-corporate machine, well maintained. Keyboard replaced in March, battery holds about 4 hours of office work. Windows 11 Pro installed with a valid licence key printed on the base. Charger included. Ideal for accounting or programming students.',
      price: 950_000,
      condition: 'good',
      specs: { processor: 'Intel Core i5-8365U', ramGb: '16', storageGb: '512', storageType: 'SSD', screenSizeIn: 14, batteryHealth: '70-79', chargerIncluded: true },
      region: 'Arusha',
      city: 'Njiro',
      status: 'under_review' as never,
      availability: 'inactive',
      identifierKind: 'serial',
    },
    {
      key: 'apple-watch',
      seller: 'baraka',
      category: 'smartwatches',
      brand: 'Apple',
      model: 'Apple Watch SE (2nd gen) 44 mm',
      title: 'Apple Watch SE 2nd gen 44 mm GPS — two straps',
      description:
        'Bought last year, worn daily but no scratches on the screen. Battery health is 91%. Comes with the original silicone strap plus an extra nylon strap. Charging cable included. Not registered to any Apple account anymore.',
      price: 520_000,
      condition: 'excellent',
      specs: { caseSizeMm: 44, connectivity: 'Bluetooth + GPS', strapMaterial: 'Silicone 44 mm + nylon', batteryHealth: '90-94' },
      region: 'Dar es Salaam',
      city: 'Mikocheni',
      status: 'pending',
      availability: 'inactive',
      identifierKind: 'serial',
    },
    {
      key: 'jbl-speaker',
      seller: 'jose',
      category: 'audio',
      brand: 'JBL',
      model: 'JBL PartyBox 110',
      title: 'JBL PartyBox 110 portable speaker — loud, tested',
      description:
        'Very loud for its size, used for three family events. Wheels and handle work, Bluetooth pairing is instant. Small scuff on one corner. Charging cable included. Collection from Mwanza or I can arrange transport at the buyer’s cost.',
      price: 890_000,
      condition: 'good',
      specs: { audioType: 'Speaker', connectivity: 'Wired + Bluetooth', power: '160 W' },
      region: 'Mwanza',
      city: 'Nyamagana',
      status: 'pending',
      availability: 'inactive',
      identifierKind: 'model_number',
    },
    {
      key: 'fake-imei-phone',
      seller: 'happyness',
      category: 'smartphones',
      brand: 'Samsung',
      model: 'Galaxy A54',
      title: 'Samsung Galaxy A54 128 GB — quick sale',
      description:
        'Selling fast, price slightly below market. Screen replaced at a local shop but works fine. No receipt available anymore. Call me on 0769111222 to arrange viewing today.',
      price: 150_000,
      condition: 'fair',
      specs: { storageGb: '128', ramGb: '6', batteryHealth: 'below-70', network: '4G', colour: 'Awesome violet' },
      region: 'Mbeya',
      city: 'Uyole',
      status: 'flagged',
      availability: 'inactive',
      identifierKind: 'imei',
      identifierValue: '123456789012347',
    },
    {
      key: 'duplicate-imei',
      seller: 'shabani',
      category: 'smartphones',
      brand: 'Samsung',
      model: 'Galaxy S23 Ultra 256 GB',
      title: 'Samsung Galaxy S23 Ultra 256 GB available in Zanzibar',
      description:
        'Same model as another listing on the site but mine is in Stone Town. Screen and back are clean, battery health good. Comes with a charger only. I can share more photographs in the chat.',
      price: 1_650_000,
      condition: 'excellent',
      specs: { storageGb: '256', ramGb: '12', batteryHealth: '90-94', network: '5G', colour: 'Green', boxAndAccessories: false },
      region: 'Zanzibar Urban/West',
      city: 'Stone Town',
      status: 'flagged',
      availability: 'inactive',
      identifierKind: 'imei',
      identifierValue: 'duplicate-of-s23-ultra',
    },
    {
      key: 'evidence-needed-tablet',
      seller: 'grace',
      category: 'tablets',
      brand: 'Samsung',
      model: 'Galaxy Tab S6 Lite',
      title: 'Samsung Galaxy Tab S6 Lite with book cover',
      description:
        'Purchased second-hand in Moshi. S Pen included and working, screen has a small bright spot near the top edge. I do not have the original receipt, but I can photograph the serial number sticker on the back of the tablet and the box if the moderator needs it.',
      price: 480_000,
      condition: 'good',
      specs: { storageGb: '128', ramGb: '4', network: 'Wi-Fi only', screenSizeIn: 10.4, stylusIncluded: true },
      region: 'Kilimanjaro',
      city: 'Moshi',
      status: 'evidence_required',
      availability: 'inactive',
      identifierKind: 'serial',
      reviewNote: 'Please upload a photograph of the serial-number label and the back of the tablet so we can confirm the device matches the listing.',
      reviewCode: 'insufficient_evidence',
    },
    {
      key: 'suspended-console',
      seller: 'shabani',
      category: 'gaming-consoles',
      brand: 'Sony',
      model: 'PlayStation 4 Slim 1 TB',
      title: 'PlayStation 4 Slim 1 TB with three games',
      description:
        'Console works well, three disc games included. Controller has slight stick drift on the left stick which I mention honestly. Sold as seen, no returns. I have had this console for four years.',
      price: 620_000,
      condition: 'fair',
      specs: { storageGb: '1024', edition: 'PS4 Slim', controllersIncluded: 1, modded: true },
      region: 'Zanzibar Urban/West',
      city: 'Stone Town',
      status: 'suspended',
      availability: 'inactive',
      identifierKind: 'serial',
      reviewNote:
        'Listing suspended while a report about the device source is investigated. Please reply to the moderation message with your purchase history.',
      reviewCode: 'suspected_stolen_device',
    },
    {
      key: 'draft-laptop',
      seller: 'grace',
      category: 'laptops',
      brand: 'Lenovo',
      model: 'IdeaPad Slim 3',
      title: 'Lenovo IdeaPad Slim 3 — draft listing (not submitted yet)',
      description:
        'This is a draft saved by the seller. Drafts are never shown publicly and can be edited freely before the automated checks run. Once submitted, the listing enters moderation and the identifier is claimed.',
      price: 780_000,
      condition: 'good',
      specs: { processor: 'AMD Ryzen 5 7530U', ramGb: '8', storageGb: '512', storageType: 'SSD', screenSizeIn: 15.6, chargerIncluded: true },
      region: 'Kilimanjaro',
      city: 'Moshi',
      status: 'draft',
      availability: 'inactive',
      identifierKind: 'serial',
    },
  ];
}

async function ensureUser(tx: Tx, user: SeedUser, password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  const row = await tx.queryOne<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role, account_status, email_verified_at, identity_reviewed_at, status_reason)
     VALUES ($1, $2, $3, $4, $5, now(), $6, $7)
     ON CONFLICT (email_normalised) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = now()
     RETURNING id`,
    [
      user.email,
      passwordHash,
      user.fullName,
      user.admin ? 'admin' : 'user',
      user.accountStatus ?? 'active',
      user.identityReviewed ? new Date() : null,
      user.accountStatus === 'restricted' ? 'Restricted by moderation during a sample investigation (demonstration data)' : null,
    ],
  );
  if (!row) throw new Error(`Could not create seed user ${user.email}`);
  await tx.query(
    `INSERT INTO user_profiles (user_id, display_name, bio, region, city, phone, phone_visible, public_profile)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true)
     ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio,
       region = EXCLUDED.region, city = EXCLUDED.city, phone = EXCLUDED.phone, phone_visible = EXCLUDED.phone_visible`,
    [row.id, user.fullName, user.bio, user.region, user.city, user.phone, false],
  );
  return row.id;
}

/** Uploads one generated PNG through the real media pipeline. */
async function seedImage(ownerId: string, purpose: 'listing_image' | 'evidence' | 'avatar', seed: number): Promise<string> {
  const palettes: [number, number, number][][] = [
    [[37, 99, 235], [15, 23, 42]],
    [[13, 148, 136], [30, 64, 175]],
    [[124, 58, 237], [17, 24, 39]],
    [[234, 88, 12], [120, 53, 15]],
    [[22, 163, 74], [6, 78, 59]],
  ];
  const palette = palettes[seed % palettes.length] as [number, number, number][];
  const buffer = generatePng(640, 480, palette[0] as [number, number, number], palette[1] as [number, number, number]);
  const stored = await storeUpload({
    ownerId,
    purpose,
    buffer,
    mimeType: 'image/png',
    extension: 'png',
    width: 640,
    height: 480,
  });
  return stored.asset.id;
}

export interface SeedSummary {
  users: number;
  listings: number;
  approvedListings: number;
  conversations: number;
  messages: number;
  exchanges: number;
  transactions: number;
  reports: number;
  disputes: number;
}

export async function seedDatabase(): Promise<SeedSummary> {
  const config = loadConfig();
  if (config.isProduction && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error('Refusing to seed a production database. Set ALLOW_PRODUCTION_SEED=true to override deliberately.');
  }

  // Remove demonstration content only; reference data from migrations stays.
  await withTransaction(async (tx) => {
    await tx.query('TRUNCATE disputes, dispute_messages, report_notes, reports, transaction_status_history, transactions, exchange_requests, saved_listings, notifications, messages, conversation_participants, conversations, listing_comments, duplicate_alerts, identifier_conflicts, verification_events, evidence_requests, verification_evidence, device_verification_attempts, device_identifiers, listing_images, listings, devices, media_assets, moderation_notes, moderation_actions, audit_logs, email_outbox, sessions, auth_tokens, user_profiles, users RESTART IDENTITY CASCADE');
  });

  const userIds = new Map<string, string>();
  await withTransaction(async (tx) => {
    for (const user of USERS) {
      const id = await ensureUser(tx, user, user.admin ? ADMIN_PASSWORD : DEMO_PASSWORD);
      userIds.set(user.key, id);
    }
  });
  logger.info({ users: userIds.size }, 'seed: users created');

  const listingDefinitions = buildListingDefinitions();
  const listingIds = new Map<string, string>();
  const sellerImages = new Map<string, string[]>();

  for (const definition of listingDefinitions) {
    const sellerId = userIds.get(definition.seller) as string;
    const images = sellerImages.get(definition.seller) ?? [];
    if (images.length < 3) {
      for (let index = 0; index < 3; index += 1) {
        images.push(await seedImage(sellerId, 'listing_image', images.length + listingIds.size + index));
      }
      sellerImages.set(definition.seller, images);
    }

    const listingId = await withTransaction(async (tx) => {
      const category = await tx.queryOne<{ id: string; slug: string }>('SELECT id, slug FROM categories WHERE slug = $1', [definition.category]);
      const brand = await tx.queryOne<{ id: string }>('SELECT id FROM brands WHERE name = $1', [definition.brand]);
      if (!category) throw new Error(`Unknown category ${definition.category}`);

      const device = await tx.queryOne<{ id: string }>(
        `INSERT INTO devices (category_id, brand_id, brand_name, model, condition, specs, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [category.id, brand?.id ?? null, brand ? null : definition.brand, definition.model, definition.condition, JSON.stringify(definition.specs), sellerId],
      );
      if (!device) throw new Error('device insert failed');

      const status = definition.status === 'pending' ? 'under_review' : definition.status;
      const availability = definition.availability;
      const approved = status === 'approved';
      const slugBase = definition.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
      const listing = await tx.queryOne<{ id: string }>(
        `INSERT INTO listings (device_id, seller_id, category_id, brand_id, title, slug, description, asking_price_tzs,
                               negotiable, exchange_allowed, condition, region, city, status, availability, submitted_at,
                               published_at, decided_at, decision_reason_code, decision_reason_note, review_priority, submission_round)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         RETURNING id`,
        [
          device.id,
          sellerId,
          category.id,
          brand?.id ?? null,
          definition.title,
          `${slugBase}-${definition.key.slice(0, 6)}`,
          definition.description,
          definition.price,
          definition.exchangeAllowed ?? true,
          definition.condition,
          definition.region,
          definition.city,
          status,
          availability,
          status === 'draft' ? null : new Date(),
          approved ? new Date(Date.now() - 86_400_000 * 3) : null,
          ['approved', 'rejected', 'suspended'].includes(status) ? new Date() : null,
          definition.reviewCode ?? null,
          definition.reviewNote ?? null,
          status === 'flagged' ? 'urgent' : status === 'evidence_required' ? 'high' : 'normal',
          status === 'draft' ? 0 : 1,
        ],
      );
      if (!listing) throw new Error('listing insert failed');

      for (const [position, mediaId] of images.slice(0, 3).entries()) {
        await tx.query(
          `INSERT INTO listing_images (listing_id, media_asset_id, position, alt_text)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [listing.id, mediaId, position, `${definition.brand} ${definition.model} photograph ${position + 1}`],
        );
      }

      // Identifiers: submitted listings claim theirs (active), drafts do not.
      // The "duplicate identifier" demonstration listing reuses the fingerprint of
      // an already-approved listing so that duplicate detection has something real
      // to catch (the stored value stays a placeholder).
      const duplicateSource = definition.identifierValue === 'duplicate-of-s23-ultra' ? 's23-ultra' : null;
      let value = duplicateSource ? undefined : definition.identifierValue;
      if (!value && duplicateSource) {
        const source = listingIds.get(duplicateSource);
        if (source) {
          const existing = await tx.queryOne<{ fingerprint: string }>('SELECT fingerprint FROM device_identifiers WHERE listing_id = $1 LIMIT 1', [source]);
          value = existing?.fingerprint ?? undefined;
        }
      }
      if (!value) {
        value =
          definition.identifierKind === 'imei'
            ? syntheticImei('35', listingIds.size + 11)
            : definition.identifierKind === 'serial'
              ? syntheticSerial(definition.brand.slice(0, 3).toUpperCase(), listingIds.size + 11)
              : `MDL-${definition.key.slice(0, 6).toUpperCase()}`;
      }

      const precomputedFingerprint = duplicateSource ? value : null;
      if (precomputedFingerprint) {
        await tx.query(
          `INSERT INTO device_identifiers (device_id, listing_id, owner_id, kind, value_encrypted, fingerprint, last4, masked, is_primary, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, false)`,
          [
            device.id,
            listing.id,
            sellerId,
            definition.identifierKind,
            encryptIdentifier('UNKNOWN-DUPLICATE-ATTEMPT'),
            precomputedFingerprint,
            '••••',
            '•••• •••• •••• ••••',
          ],
        );
      } else {
        await tx.query(
          `INSERT INTO device_identifiers (device_id, listing_id, owner_id, kind, value_encrypted, fingerprint, last4, masked, is_primary, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)`,
          [
            device.id,
            listing.id,
            sellerId,
            definition.identifierKind,
            encryptIdentifier(value.replace(/[^0-9A-Z]/g, '')),
            fingerprintIdentifier(value.replace(/[^0-9A-Z]/g, '')),
            value.slice(-4),
            definition.identifierKind === 'imei' ? `•••• •••• •••• ${value.slice(-4)}` : `••••••${value.slice(-4)}`,
            ['approved', 'suspended', 'flagged'].includes(status),
          ],
        );
      }

      // Evidence for approved and evidence-requested listings.
      if (['approved', 'evidence_required', 'suspended'].includes(status)) {
        const evidenceId = await seedImage(sellerId, 'evidence', listingIds.size + 41);
        await tx.query(
          `INSERT INTO verification_evidence (listing_id, device_id, media_asset_id, uploaded_by, kind, note)
           VALUES ($1, $2, $3, $4, 'proof_of_purchase', $5) ON CONFLICT DO NOTHING`,
          [listing.id, device.id, evidenceId, sellerId, 'Demonstration evidence tile (fictional document, generated by the seed script)'],
        );
        await tx.query(
          `INSERT INTO verification_evidence (listing_id, device_id, media_asset_id, uploaded_by, kind, note)
           VALUES ($1, $2, $3, $4, 'device_front', $5) ON CONFLICT DO NOTHING`,
          [listing.id, device.id, images[0], sellerId, 'Front photograph of the device'],
        );
      }

      await tx.query(
        `INSERT INTO verification_events (listing_id, device_id, actor_id, actor_role, action, from_status, to_status, reason_code, reason_note, visible_to_seller)
         VALUES ($1, $2, $3, 'user', 'submitted', NULL, 'submitted', NULL, 'Listing submitted by the seller (seed data)', true)`,
        [listing.id, device.id, sellerId],
      );

      if (status !== 'draft') {
        const engine = await runVerificationEngine(
          {
            listingId: listing.id,
            deviceId: device.id,
            sellerId,
            sellerCreatedAt: new Date(Date.now() - 86_400_000 * 60),
            title: definition.title,
            description: definition.description,
            categorySlug: category.slug,
            brandName: definition.brand,
            model: definition.model,
            askingPriceTzs: definition.price,
            condition: definition.condition,
            specs: definition.specs,
            region: definition.region,
            submissionRound: 1,
            identifiers: [
              {
                id: 'seed',
                kind: definition.identifierKind,
                fingerprint: precomputedFingerprint ?? fingerprintIdentifier(value.replace(/[^0-9A-Z]/g, '')),
                isPrimary: true,
                formatValid: true,
              },
            ],
            evidenceCount: ['approved', 'evidence_required', 'suspended'].includes(status) ? 2 : 1,
            evidenceKinds: ['proof_of_purchase', 'device_front'],
            images: images.slice(0, 3).map((mediaId, index) => ({ mediaId, checksum: `seed-${index}-${mediaId}` })),
          },
          tx,
        );
        await tx.query(
          `INSERT INTO device_verification_attempts (device_id, listing_id, attempt_number, outcome, score, flags, checks,
                                                     external_check_status, external_provider, engine_version, duration_ms)
           VALUES ($1, $2, 1, $3, $4, $5, $6, $7, NULL, 'seed', $8)`,
          [
            device.id,
            listing.id,
            definition.status === 'flagged' ? 'flagged' : engine.outcome,
            definition.status === 'flagged' ? 35 : engine.score,
            JSON.stringify(definition.status === 'flagged' ? engine.flags : engine.flags),
            JSON.stringify(engine.checks),
            engine.externalCheck.status,
            engine.durationMs,
          ],
        );
        for (const alert of engine.duplicateAlerts) {
          await tx.query(
            `INSERT INTO duplicate_alerts (kind, severity, listing_id, related_listing_id, device_id, fingerprint, detail, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [alert.kind, alert.severity, listing.id, alert.relatedListingId, device.id, alert.fingerprint ?? null, alert.detail, JSON.stringify(alert.metadata ?? {})],
          );
        }

        if (['approved', 'rejected', 'suspended', 'evidence_required', 'under_review', 'flagged'].includes(status)) {
          const adminId = userIds.get('admin') as string;
          await tx.query(
            `INSERT INTO verification_events (listing_id, device_id, actor_id, actor_role, action, from_status, to_status, reason_code, reason_note, visible_to_seller)
             VALUES ($1, $2, $3, 'admin', $4, 'under_review', $5, $6, $7, true)`,
            [
              listing.id,
              device.id,
              status === 'under_review' || status === 'flagged' ? null : adminId,
              status === 'approved' ? 'moderator_approve' : status === 'evidence_required' ? 'moderator_request_evidence' : 'seed_state',
              status,
              definition.reviewCode ?? 'completeness_confirmed',
              definition.reviewNote ??
                (status === 'approved'
                  ? 'Photographs and the box label match the submitted identifier; price is consistent with the category. Approved.'
                  : 'Awaiting moderator review (demonstration state).'),
            ],
          );
          await tx.query(
            `INSERT INTO moderation_actions (actor_id, actor_role, action, entity_type, entity_id, from_status, to_status, reason_code, reason_note, metadata)
             VALUES ($1, 'admin', $2, 'listing', $3, 'under_review', $4, $5, $6, $7)`,
            [
              status === 'under_review' || status === 'flagged' ? null : adminId,
              status === 'approved' ? 'approved' : 'requested_evidence',
              listing.id,
              status,
              definition.reviewCode ?? 'completeness_confirmed',
              definition.reviewNote ?? 'Demonstration moderation action created by the seed script',
              JSON.stringify({ seed: true }),
            ],
          );
        }
      }

      return listing.id;
    });

    listingIds.set(definition.key, listingId);
  }
  logger.info({ listings: listingIds.size }, 'seed: listings created');

  /* --------------------------- Conversations & messages -------------------- */
  const conversationId = await withTransaction(async (tx) => {
    const buyerId = userIds.get('grace') as string;
    const listingId = listingIds.get('macbook-air') as string;
    const sellerId = userIds.get('zawadi') as string;
    const conversation = await tx.queryOne<{ id: string }>(
      `INSERT INTO conversations (kind, listing_id, initiator_id, subject, last_message_at, last_message_excerpt)
       VALUES ('listing_inquiry', $1, $2, 'MacBook Air M2 questions', now(), 'Yes, the charger and box are included.')
       RETURNING id`,
      [listingId, buyerId],
    );
    if (!conversation) throw new Error('conversation insert failed');
    await tx.query(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, last_read_at) VALUES
        ($1, $2, 'buyer', now() - interval '2 hours'), ($1, $3, 'seller', now())`,
      [conversation.id, buyerId, sellerId],
    );
    const messages: [string, string, string][] = [
      [buyerId, 'Hello Zawadi. Is the MacBook Air still available? Does it come with the original charger and box?', '3 hours'],
      [sellerId, 'Good evening Grace. Yes it is available. Yes, the charger and box are included, plus a USB-C hub.', '2 hours'],
      [buyerId, 'Thank you. Could you confirm the battery cycles and whether it has ever had a repair?', '90 minutes'],
      [sellerId, '71 cycles and it has never been repaired. I can show the battery report when we meet at a public place.', '40 minutes'],
    ];
    for (const [senderId, bodyText, interval] of messages) {
      await tx.query(
        `INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, now() - interval '${interval}')`,
        [conversation.id, senderId, bodyText],
      );
    }
    return conversation.id;
  });

  await withTransaction(async (tx) => {
    // A second conversation showing an unread badge for the seller.
    const buyerId = userIds.get('baraka') as string;
    const sellerId = userIds.get('jose') as string;
    const listingId = listingIds.get('ps5-slim') as string;
    const conversation = await tx.queryOne<{ id: string }>(
      `INSERT INTO conversations (kind, listing_id, initiator_id, subject, last_message_at, last_message_excerpt)
       VALUES ('listing_inquiry', $1, $2, 'PS5 Slim availability', now() - interval '5 minutes', 'Would you accept 1.35m cash today?')
       RETURNING id`,
      [listingId, buyerId],
    );
    if (conversation) {
      await tx.query(
        `INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, $2, 'buyer'), ($1, $3, 'seller')`,
        [conversation.id, buyerId, sellerId],
      );
      await tx.query(
        `INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, now() - interval '5 minutes')`,
        [conversation.id, buyerId, 'Hi Jose. Is the PS5 Slim still available? Would you accept 1.35m cash today?'],
      );
    }
  });

  /* ------------------------------ Listing question ------------------------- */
  await withTransaction(async (tx) => {
    const listingId = listingIds.get('s23-ultra') as string;
    const sellerId = userIds.get('baraka') as string;
    const askerId = userIds.get('grace') as string;
    const comment = await tx.queryOne<{ id: string }>(
      `INSERT INTO listing_comments (listing_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [listingId, askerId, 'Is the 45 W charger the original Samsung one? And would you accept 1.7m if I collect today?'],
    );
    if (comment) {
      await tx.query(
        `INSERT INTO listing_comments (listing_id, author_id, parent_id, body, is_seller_answer)
         VALUES ($1, $2, $3, $4, true)`,
        [
          listingId,
          sellerId,
          comment.id,
          'It is the original 45 W Samsung charger from the box. I can do 1.78m for a same-day collection in Mikocheni, but not 1.7m.',
        ],
      );
    }
  });

  /* -------------------------------- Exchanges ------------------------------ */
  const exchangeId = await withTransaction(async (tx) => {
    // Coherent proposal: Baraka (owner of the S23 Ultra) asks Zawadi to swap her
    // MacBook Air for his phone plus a top-up.
    const listingId = listingIds.get('macbook-air') as string;
    const offeredListingId = listingIds.get('s23-ultra') as string;
    const recipientId = userIds.get('zawadi') as string;
    const request = await tx.queryOne<{ id: string }>(
      `INSERT INTO exchange_requests (listing_id, offered_listing_id, requester_id, recipient_id, message,
                                      price_difference_tzs, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', now() + interval '12 days') RETURNING id`,
      [
        listingId,
        offeredListingId,
        userIds.get('baraka'),
        recipientId,
        'I would like to exchange my Galaxy S23 Ultra for your MacBook Air. I can add 450,000 TZS as a top-up so the values match.',
        450_000,
      ],
    );
    return request?.id ?? null;
  });

  const acceptedExchange = await withTransaction(async (tx) => {
    const request = await tx.queryOne<{ id: string }>(
      `INSERT INTO exchange_requests (listing_id, offered_listing_id, requester_id, recipient_id, message,
                                      price_difference_tzs, status, responded_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, 0, 'accepted', now(), now() + interval '10 days') RETURNING id`,
      [
        listingIds.get('ps5-slim'),
        listingIds.get('canon-200d'),
        userIds.get('shabani'),
        userIds.get('jose'),
        'Offer: my Canon EOS 200D II kit for your PS5 Slim, straight swap, both devices tested together before we agree.',
      ],
    );
    return request?.id ?? null;
  });

  /* ------------------------------ Transactions ----------------------------- */
  const transactionId = await withTransaction(async (tx) => {
    const reference = await tx.queryOne<{ reference: string }>(`SELECT next_reference('TXN') AS reference`);
    const created = await tx.queryOne<{ id: string }>(
      `INSERT INTO transactions (reference, type, status, listing_id, seller_id, buyer_id, exchange_request_id, agreed_amount_tzs,
                                 settlement_note, created_by)
       VALUES ($1, 'exchange', 'negotiating', $2, $3, $4, $5, 0, $6, $7) RETURNING id`,
      [
        reference?.reference ?? 'TXN-2026-000001',
        listingIds.get('ps5-slim'),
        userIds.get('jose'),
        userIds.get('shabani'),
        acceptedExchange,
        'Straight swap agreed in principle; both parties will meet in Mwanza to test the devices. SWAPMART does not handle payment.',
        userIds.get('jose'),
      ],
    );
    if (created) {
      await tx.query(
        `UPDATE exchange_requests SET transaction_id = $2 WHERE id = $1`,
        [acceptedExchange, created.id],
      );
      await tx.query(
        `INSERT INTO transaction_status_history (transaction_id, from_status, to_status, actor_id, actor_role, note)
         VALUES ($1, NULL, 'initiated', $2, 'user', 'Exchange accepted, transaction record created'), ($1, 'initiated', 'negotiating', $3, 'user', 'Parties agreed on a handover date in Mwanza')`,
        [created.id, userIds.get('shabani'), userIds.get('jose')],
      );
      return created.id;
    }
    return null;
  });

  /* -------------------------- Reports and disputes ------------------------- */
  await withTransaction(async (tx) => {
    const reference = await tx.queryOne<{ reference: string }>(`SELECT next_reference('RPT') AS reference`);
    const report = await tx.queryOne<{ id: string }>(
      `INSERT INTO reports (reference, reporter_id, category, description, listing_id, reported_user_id, status, priority)
       VALUES ($1, $2, 'misleading_description', $3, $4, $5, 'under_review', 'normal') RETURNING id`,
      [
        reference?.reference ?? 'RPT-2026-000001',
        userIds.get('grace'),
        'The description says the controller has no faults but the photos show a different controller than the one in the title. Please check whether the listing is accurate.',
        listingIds.get('suspended-console'),
        userIds.get('shabani'),
      ],
    );
    if (report) {
      await tx.query(
        `INSERT INTO report_notes (report_id, author_id, author_role, body, visibility)
         VALUES ($1, $2, 'admin', $3, 'moderator_note'),
                ($1, $2, 'admin', $4, 'reporter_visible')`,
        [
          report.id,
          userIds.get('admin'),
          'Internal note: the seller has a restricted account; keep the listing suspended until the purchase history is provided.',
          'Thank you for the report. The listing has been suspended while we ask the seller for evidence of purchase. We will update you here.',
        ],
      );
    }
  });

  if (transactionId) {
    await withTransaction(async (tx) => {
      const reference = await tx.queryOne<{ reference: string }>(`SELECT next_reference('DSP') AS reference`);
      const dispute = await tx.queryOne<{ id: string }>(
        `INSERT INTO disputes (reference, transaction_id, opened_by, counterparty_id, category, description, status)
         VALUES ($1, $2, $3, $4, 'item_not_as_described', $5, 'investigating') RETURNING id`,
        [
          reference?.reference ?? 'DSP-2026-000001',
          transactionId,
          userIds.get('shabani'),
          userIds.get('jose'),
          'The console arrived with a different controller model than the one advertised, and the disc drive makes a loud noise. We agreed to test the devices first but the seller arrived without the games listed.',
        ],
      );
      if (dispute) {
        await tx.query(
          `INSERT INTO dispute_messages (dispute_id, author_id, author_role, body, visibility)
           VALUES ($1, $2, 'user', $3, 'participants'),
                  ($1, $4, 'user', $5, 'participants'),
                  ($1, $6, 'admin', $7, 'admins_only')`,
          [
            dispute.id,
            userIds.get('shabani'),
            'I brought the console and both controllers exactly as listed. The buyer changed terms at the meeting point.',
            userIds.get('jose'),
            'The second controller is a third-party pad, not the DualSense in the listing. I am happy to resolve this without escalation.',
            userIds.get('admin'),
            'Internal: ask both parties for the meeting messages and photographs taken at handover. Transaction remains disputed.',
          ],
        );
      }
    });
  }

  /* ------------------------------ Saved listings --------------------------- */
  await query(
    `INSERT INTO saved_listings (user_id, listing_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
    [userIds.get('grace'), listingIds.get('s23-ultra'), listingIds.get('apple-watch')],
  );

  /* ------------------------------- Notifications --------------------------- */
  const adminId = userIds.get('admin') as string;
  for (const [key, title, body] of [
    ['grace', 'Listing approved', 'Your listing "Samsung Galaxy Tab S6 Lite" needs one more photograph before review.'],
    ['shabani', 'Listing suspended', 'Your listing "PlayStation 4 Slim 1 TB with three games" was suspended while a report is investigated.'],
    ['jose', 'New exchange proposal', 'Baraka Juma proposed an exchange involving your MacBook Air M2 listing.'],
    ['baraka', 'New question on your listing', 'Grace Kimaro asked about your Samsung Galaxy S23 Ultra.'],
  ] as const) {
    await notify({
      userId: userIds.get(key) as string,
      type: key === 'grace' ? 'evidence_requested' : key === 'shabani' ? 'listing_status_changed' : key === 'jose' ? 'exchange_proposed' : 'listing_question',
      title,
      body,
      linkUrl: '/dashboard',
    });
  }
  await notify({ userId: adminId, type: 'listing_status_changed', title: 'Moderation queue', body: 'Several submissions are awaiting review in the moderation queue.', linkUrl: '/admin' });

  const counts = await queryOne<{
    users: number;
    listings: number;
    approved: number;
    conversations: number;
    messages: number;
    exchanges: number;
    transactions: number;
    reports: number;
    disputes: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM listings) AS listings,
       (SELECT count(*)::int FROM listings WHERE status = 'approved') AS approved,
       (SELECT count(*)::int FROM conversations) AS conversations,
       (SELECT count(*)::int FROM messages) AS messages,
       (SELECT count(*)::int FROM exchange_requests) AS exchanges,
       (SELECT count(*)::int FROM transactions) AS transactions,
       (SELECT count(*)::int FROM reports) AS reports,
       (SELECT count(*)::int FROM disputes) AS disputes`,
  );
  void conversationId;
  void exchangeId;

  return {
    users: counts?.users ?? 0,
    listings: counts?.listings ?? 0,
    approvedListings: counts?.approved ?? 0,
    conversations: counts?.conversations ?? 0,
    messages: counts?.messages ?? 0,
    exchanges: counts?.exchanges ?? 0,
    transactions: counts?.transactions ?? 0,
    reports: counts?.reports ?? 0,
    disputes: counts?.disputes ?? 0,
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() as string)) {
  try {
    const summary = await seedDatabase();
    logger.info(
      {
        ...summary,
        demoPassword: DEMO_PASSWORD,
        adminPasswordIsDefault: ADMIN_PASSWORD_IS_DEFAULT,
      },
      'seed complete',
    );
  } catch (error) {
    logger.error({ err: error }, 'seed failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

export { DEMO_PASSWORD, ADMIN_PASSWORD };
