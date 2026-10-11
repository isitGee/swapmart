import type { AutomatedCheckOutcome, FlagReason } from '@swapmart/shared';
import { PRICE_LIMITS, SPEC_FIELDS, validateSpecsForCategory } from '@swapmart/shared';
import { logger } from '../../config/logger.ts';
import type { Tx } from '../../db/pool.ts';
import { queryMany } from '../../db/pool.ts';
import { sha256Hex } from '../../lib/crypto.ts';
import { CATEGORIES_WITHOUT_IDENTIFIER_REQUIREMENT, describeRule } from '../../lib/identifiers.ts';
import { stolenCheckProvider } from './providers.ts';

/**
 * The preliminary verification engine.
 *
 * It performs only checks that can genuinely be performed locally: identifier
 * formatting and checksums, duplicate detection through keyed fingerprints,
 * listing-similarity and image-reuse heuristics, price plausibility against the
 * category distribution, evidence completeness, and submission patterns.
 *
 * It does NOT check any stolen-device register unless an authorised external
 * provider is configured. When no provider is configured the attempt records
 * `not_configured` and the submission is routed to human moderation — a green
 * "no match" is never invented.
 */
export const ENGINE_VERSION = '1.0.0';

export interface CheckResult {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  detail: string;
  durationMs?: number;
}

export interface EngineFlag {
  reason: FlagReason;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface EngineInput {
  listingId: string;
  deviceId: string;
  sellerId: string;
  sellerCreatedAt: Date;
  title: string;
  description: string;
  categorySlug: string;
  brandName: string | null;
  model: string;
  askingPriceTzs: number;
  condition: string;
  specs: Record<string, unknown>;
  region: string;
  submissionRound: number;
  identifiers: {
    id: string;
    kind: string;
    fingerprint: string;
    isPrimary: boolean;
    formatValid: boolean;
    plausibilityReason?: string;
  }[];
  evidenceCount: number;
  evidenceKinds: string[];
  images: { mediaId: string; checksum: string }[];
}

export interface EngineResult {
  outcome: AutomatedCheckOutcome;
  score: number;
  flags: EngineFlag[];
  checks: CheckResult[];
  /** Recommended moderation status for the state machine. */
  recommendedStatus: 'under_review' | 'flagged' | 'evidence_required';
  duplicateAlerts: {
    kind: 'identifier_conflict' | 'image_duplicate' | 'title_similarity' | 'rapid_resubmission';
    severity: 'info' | 'warning' | 'critical';
    detail: string;
    relatedListingId: string | null;
    fingerprint?: string;
    metadata?: Record<string, unknown>;
  }[];
  externalCheck: {
    status: string;
    provider: string | null;
    message: string;
    response?: Record<string, unknown>;
    performedAt: Date | null;
  };
  durationMs: number;
}

function normaliseTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !['the', 'and', 'with', 'for', 'new', 'used', 'box', 'good'].includes(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Contact details in a description indicate off-platform negotiation attempts. */
function detectOffPlatformContact(text: string): boolean {
  const phoneLike = /(?:\+?255|0)\s?[267]\d{2}[\s-]?\d{3}[\s-]?\d{3}/;
  const emailLike = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
  const socialLike = /(whatsapp|telegram|instagram|tiktok|facebook)\s*[:@]/i;
  return phoneLike.test(text) || emailLike.test(text) || socialLike.test(text);
}

export async function runVerificationEngine(input: EngineInput, tx?: Tx): Promise<EngineResult> {
  const started = performance.now();
  const checks: CheckResult[] = [];
  const flags: EngineFlag[] = [];
  const duplicateAlerts: EngineResult['duplicateAlerts'] = [];

  /** Runs inside the caller's transaction when one is provided. */
  const runQuery = async <T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => (tx ? tx.queryMany<T>(sql, params) : queryMany<T>(sql, params));

  const addCheck = (key: string, label: string, status: CheckResult['status'], detail: string, checkStarted: number) => {
    checks.push({ key, label, status, detail, durationMs: Math.round(performance.now() - checkStarted) });
  };

  /* 1. Required fields and specification completeness ---------------------- */
  let checkStarted = performance.now();
  const specValidation = validateSpecsForCategory(input.categorySlug, input.specs ?? {});
  const requiredSpecs = (SPEC_FIELDS[input.categorySlug] ?? []).filter((field) => field.required).map((field) => field.key);
  const missingSpecs = requiredSpecs.filter((key) => {
    const value = (input.specs ?? {})[key];
    return value === undefined || value === null || value === '';
  });
  if (!specValidation.ok) {
    flags.push({ reason: 'missing_required_fields', detail: specValidation.message, severity: 'warning' });
    addCheck('required_fields', 'Required information', 'fail', specValidation.message, checkStarted);
  } else if (missingSpecs.length > 0) {
    flags.push({
      reason: 'missing_required_fields',
      detail: `Missing required specifications: ${missingSpecs.join(', ')}`,
      severity: 'warning',
    });
    addCheck('required_fields', 'Required information', 'warn', `Missing: ${missingSpecs.join(', ')}`, checkStarted);
  } else {
    addCheck('required_fields', 'Required information', 'pass', 'All required fields and specifications are present', checkStarted);
  }

  /* 2. Identifier format and plausibility --------------------------------- */
  checkStarted = performance.now();
  const invalidIdentifiers = input.identifiers.filter((identifier) => !identifier.formatValid);
  const implausible = input.identifiers.filter(
    (identifier) => identifier.formatValid && identifier.plausibilityReason !== undefined,
  );
  const requiresIdentifier = !CATEGORIES_WITHOUT_IDENTIFIER_REQUIREMENT.has(input.categorySlug);
  if (input.identifiers.length === 0 && requiresIdentifier) {
    flags.push({
      reason: 'missing_required_fields',
      detail: `No device identifier was submitted. This category requires an identifier (${describeRule('serial')} or an IMEI where applicable).`,
      severity: 'warning',
    });
    addCheck('identifier_presence', 'Device identifier', 'warn', 'No identifier submitted', checkStarted);
  } else if (invalidIdentifiers.length > 0) {
    flags.push({
      reason: 'identifier_invalid_format',
      detail: `Identifier format failed validation for: ${invalidIdentifiers.map((identifier) => identifier.kind).join(', ')}`,
      severity: 'critical',
    });
    addCheck('identifier_format', 'Identifier format', 'fail', 'One or more identifiers failed format or checksum validation', checkStarted);
  } else {
    addCheck(
      'identifier_format',
      'Identifier format',
      implausible.length > 0 ? 'warn' : 'pass',
      implausible.length > 0
        ? `Plausibility concern: ${implausible.map((identifier) => identifier.plausibilityReason).join('; ')}`
        : 'Identifiers passed format and check-digit validation',
      checkStarted,
    );
    for (const identifier of implausible) {
      flags.push({
        reason: 'identifier_invalid_format',
        detail: `Identifier looks synthetic (${identifier.kind}): ${identifier.plausibilityReason}`,
        severity: 'critical',
      });
    }
  }

  /* 3. Duplicate identifiers across the platform -------------------------- */
  checkStarted = performance.now();
  const fingerprints = input.identifiers.map((identifier) => identifier.fingerprint);
  if (fingerprints.length > 0) {
    const conflicts = await runQuery<{
      fingerprint: string;
      listing_id: string;
      listing_title: string;
      listing_status: string;
      is_active: boolean;
      owner_id: string;
      kind: string;
    }>(
      `SELECT di.fingerprint, l.id AS listing_id, l.title AS listing_title, l.status AS listing_status,
              di.is_active, di.owner_id, di.kind
         FROM device_identifiers di
         JOIN listings l ON l.id = di.listing_id
        WHERE di.fingerprint = ANY($1::text[])
          AND di.listing_id <> $2
          AND l.deleted_at IS NULL
          AND l.status <> 'withdrawn'`,
      [fingerprints, input.listingId],
    );
    const activeConflict = conflicts.find((row) => row.is_active);
    const publishedConflict = conflicts.find((row) => row.listing_status === 'approved');
    if (activeConflict) {
      flags.push({
        reason: 'identifier_duplicate',
        detail:
          'This identifier is already claimed by an active listing on SWAPMART. A second active listing for the same device is not permitted.',
        severity: 'critical',
      });
      duplicateAlerts.push({
        kind: 'identifier_conflict',
        severity: 'critical',
        detail: `Identifier already actively claimed by listing ${activeConflict.listing_id}`,
        relatedListingId: activeConflict.listing_id,
        fingerprint: activeConflict.fingerprint,
        metadata: { kind: activeConflict.kind },
      });
    } else if (publishedConflict) {
      flags.push({
        reason: 'identifier_reuse_attempt',
        detail: 'This identifier appeared on a previously approved listing. Moderators must check whether the device was resold legitimately.',
        severity: 'warning',
      });
      duplicateAlerts.push({
        kind: 'identifier_conflict',
        severity: 'warning',
        detail: `Identifier previously appeared on approved listing ${publishedConflict.listing_id}`,
        relatedListingId: publishedConflict.listing_id,
        fingerprint: publishedConflict.fingerprint,
      });
      addCheck(
        'identifier_history',
        'Identifier history',
        'warn',
        'This identifier appeared in earlier submissions that were not published (recorded for moderator review)',
        checkStarted,
      );
    } else {
      addCheck('identifier_history', 'Identifier history', 'pass', 'No duplicate claim found in the platform database', checkStarted);
    }
  } else {
    addCheck('identifier_history', 'Identifier history', 'skipped', 'No identifiers submitted to compare', checkStarted);
  }

  /* 4. Image reuse --------------------------------------------------------- */
  checkStarted = performance.now();
  if (input.images.length > 0) {
    const checksums = input.images.map((image) => image.checksum);
    const reused = await runQuery<{ media_asset_id: string; listing_id: string }>(
      `SELECT li.media_asset_id, li.listing_id
         FROM listing_images li
         JOIN media_assets ma ON ma.id = li.media_asset_id
        WHERE ma.checksum_sha256 = ANY($1::text[])
          AND li.listing_id <> $2`,
      [checksums, input.listingId],
    );
    if (reused.length > 0) {
      flags.push({
        reason: 'duplicate_image_hash',
        detail: 'One or more photographs have been used on another listing. Confirm the seller physically holds the device.',
        severity: 'warning',
      });
      duplicateAlerts.push({
        kind: 'image_duplicate',
        severity: 'warning',
        detail: `${reused.length} photograph(s) already used on listing ${reused[0]?.listing_id}`,
        relatedListingId: reused[0]?.listing_id ?? null,
      });
      addCheck('image_reuse', 'Photograph reuse', 'warn', `Reused photographs detected (${reused.length})`, checkStarted);
    } else {
      addCheck('image_reuse', 'Photograph reuse', 'pass', 'No reused photographs found on other listings', checkStarted);
    }
  } else {
    addCheck('image_reuse', 'Photograph reuse', 'fail', 'At least one photograph of the device is required', checkStarted);
    flags.push({ reason: 'missing_required_fields', detail: 'No device photographs were uploaded', severity: 'critical' });
  }

  /* 5. Evidence completeness ---------------------------------------------- */
  checkStarted = performance.now();
  const requiredEvidenceKinds = ['device_front'];
  const missingEvidence = requiredEvidenceKinds.filter((kind) => !input.evidenceKinds.includes(kind));
  const hasIdentityOrPurchaseEvidence = ['proof_of_purchase', 'imei_screenshot', 'serial_label', 'box_label', 'warranty_document'].some((kind) =>
    input.evidenceKinds.includes(kind),
  );
  if (missingEvidence.length > 0) {
    flags.push({
      reason: 'incomplete_evidence',
      detail: `Required evidence is missing: ${missingEvidence.join(', ')}`,
      severity: 'warning',
    });
    addCheck('evidence_completeness', 'Evidence completeness', 'warn', 'Required evidence photographs are missing', checkStarted);
  } else if (!hasIdentityOrPurchaseEvidence) {
    flags.push({
      reason: 'incomplete_evidence',
      detail:
        'No ownership evidence was supplied. Add a proof of purchase, warranty card, box label or an IMEI screenshot matching the device.',
      severity: 'warning',
    });
    addCheck('evidence_completeness', 'Evidence completeness', 'warn', 'Ownership evidence not supplied', checkStarted);
  } else {
    addCheck('evidence_completeness', 'Evidence completeness', 'pass', `${input.evidenceCount} evidence file(s) supplied`, checkStarted);
  }

  /* 6. Price plausibility against the category distribution ---------------- */
  checkStarted = performance.now();
  const priceStats = await runQuery<{ median: number | null; p10: number | null; p90: number | null; sample: number }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY l.asking_price_tzs) AS median,
            percentile_cont(0.1) WITHIN GROUP (ORDER BY l.asking_price_tzs) AS p10,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY l.asking_price_tzs) AS p90,
            count(*)::int AS sample
       FROM listings l
       JOIN categories c ON c.id = l.category_id
      WHERE c.slug = $1 AND l.status = 'approved' AND l.deleted_at IS NULL`,
    [input.categorySlug],
  );
  const stats = priceStats[0];
  if (stats && stats.sample >= 5 && stats.median && stats.median > 0) {
    const median = Number(stats.median);
    const ratio = input.askingPriceTzs / median;
    if (ratio < PRICE_LIMITS.suspiciousLowRatio) {
      flags.push({
        reason: 'suspicious_price',
        detail: `Asking price is far below the category median (${Math.round(ratio * 100)}% of the median). Verify the device is genuine and functioning.`,
        severity: 'warning',
      });
      addCheck('price_plausibility', 'Price plausibility', 'warn', `Price is ${Math.round(ratio * 100)}% of the category median`, checkStarted);
    } else if (ratio > PRICE_LIMITS.suspiciousHighRatio) {
      flags.push({
        reason: 'suspicious_price',
        detail: `Asking price is unusually high for this category (${ratio.toFixed(1)}× the median).`,
        severity: 'info',
      });
      addCheck('price_plausibility', 'Price plausibility', 'warn', `Price is ${ratio.toFixed(1)}× the category median`, checkStarted);
    } else {
      addCheck('price_plausibility', 'Price plausibility', 'pass', 'Asking price is within the usual range for this category', checkStarted);
    }
  } else {
    addCheck(
      'price_plausibility',
      'Price plausibility',
      'skipped',
      'Not enough approved listings in this category yet to judge the price',
      checkStarted,
    );
  }

  /* 7. Duplicate / similar listing detection ------------------------------- */
  checkStarted = performance.now();
  const candidates = await runQuery<{ id: string; title: string; model: string; created_at: string }>(
    `SELECT l.id, l.title, d.model, l.created_at::text AS created_at
       FROM listings l
       JOIN devices d ON d.id = l.device_id
      WHERE l.category_id = (SELECT id FROM categories WHERE slug = $1)
        AND l.id <> $2 AND l.deleted_at IS NULL
        AND l.created_at > now() - interval '180 days'
      ORDER BY l.created_at DESC
      LIMIT 200`,
    [input.categorySlug, input.listingId],
  );
  const myTokens = normaliseTokens(`${input.title} ${input.brandName ?? ''} ${input.model}`);
  let mostSimilar: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = jaccard(myTokens, normaliseTokens(`${candidate.title} ${candidate.model}`));
    if (!mostSimilar || score > mostSimilar.score) mostSimilar = { id: candidate.id, score };
  }
  if (mostSimilar && mostSimilar.score >= 0.75) {
    flags.push({
      reason: 'duplicate_listing_similarity',
      detail: `This listing closely resembles an existing listing (similarity ${Math.round(mostSimilar.score * 100)}%). Check whether it is a duplicate submission.`,
      severity: 'warning',
    });
    duplicateAlerts.push({
      kind: 'title_similarity',
      severity: 'warning',
      detail: `Title/model similarity of ${Math.round(mostSimilar.score * 100)}% with listing ${mostSimilar.id}`,
      relatedListingId: mostSimilar.id,
      metadata: { score: mostSimilar.score },
    });
    addCheck('listing_similarity', 'Similar listing check', 'warn', `Similar existing listing found (${Math.round(mostSimilar.score * 100)}%)`, checkStarted);
  } else {
    addCheck('listing_similarity', 'Similar listing check', 'pass', 'No closely matching listing found', checkStarted);
  }

  /* 8. Submission behaviour patterns --------------------------------------- */
  checkStarted = performance.now();
  const recentSubmissions = await runQuery<{ total: number; duplicate_heavy: number }>(
    `SELECT
       (SELECT count(*)::int FROM listings WHERE seller_id = $1 AND submitted_at > now() - interval '24 hours') AS total,
       (SELECT count(*)::int FROM listings WHERE seller_id = $1 AND submitted_at > now() - interval '24 hours'
          AND status IN ('rejected', 'flagged', 'suspended')) AS duplicate_heavy`,
    [input.sellerId],
  );
  const behaviour = recentSubmissions[0];
  const accountAgeHours = (Date.now() - input.sellerCreatedAt.getTime()) / 3_600_000;
  if (behaviour && behaviour.total >= 8) {
    flags.push({
      reason: 'rapid_resubmission',
      detail: `${behaviour.total} submissions in the last 24 hours from this account. Check for bulk or automated submissions.`,
      severity: 'warning',
    });
    duplicateAlerts.push({
      kind: 'rapid_resubmission',
      severity: 'warning',
      detail: `${behaviour.total} submissions in 24 hours`,
      relatedListingId: input.listingId,
    });
    addCheck('submission_pattern', 'Submission pattern', 'warn', `${behaviour.total} submissions in 24h`, checkStarted);
  } else if (accountAgeHours < 24 && input.submissionRound > 1) {
    addCheck('submission_pattern', 'Submission pattern', 'warn', 'New account resubmitting after a previous decision', checkStarted);
  } else {
    addCheck('submission_pattern', 'Submission pattern', 'pass', 'No unusual submission pattern detected', checkStarted);
  }

  /* 9. Reporter history (open reports against the seller) ------------------ */
  checkStarted = performance.now();
  const reportHistory = await runQuery<{ open_reports: number; suspicion_reports: number }>(
    `SELECT count(*)::int AS open_reports,
            count(*) FILTER (WHERE category IN ('suspected_stolen_device', 'fraudulent_seller', 'counterfeit_device'))::int AS suspicion_reports
       FROM reports
      WHERE reported_user_id = $1 AND status IN ('open', 'under_review', 'escalated')`,
    [input.sellerId],
  );
  const history = reportHistory[0];
  if (history && history.open_reports > 0) {
    flags.push({
      reason: 'reporter_history',
      detail: `${history.open_reports} open report(s) about this account${history.suspicion_reports > 0 ? `, including ${history.suspicion_reports} theft/fraud-related report(s)` : ''}.`,
      severity: history.suspicion_reports > 0 ? 'critical' : 'warning',
    });
    addCheck('account_reports', 'Account reports', history.suspicion_reports > 0 ? 'fail' : 'warn', `${history.open_reports} open report(s) on file`, checkStarted);
  } else {
    addCheck('account_reports', 'Account reports', 'pass', 'No open reports against this account', checkStarted);
  }

  /* 10. Description quality ----------------------------------------------- */
  checkStarted = performance.now();
  const descriptionTokens = new Set(input.description.toLowerCase().split(/\s+/));
  const contactLeak = detectOffPlatformContact(input.description);
  if (input.description.trim().length < 120 || descriptionTokens.size < 20) {
    flags.push({
      reason: 'description_quality',
      detail: 'The description is very short. Ask the seller to describe condition, included accessories and known faults.',
      severity: 'info',
    });
    addCheck('description_quality', 'Description quality', 'warn', 'Description is thin', checkStarted);
  } else if (contactLeak) {
    flags.push({
      reason: 'description_quality',
      detail:
        'Contact details appear to be shared inside the description. SWAPMART keeps inquiries and payments coordination on-platform so that reports can be investigated.',
      severity: 'info',
    });
    addCheck('description_quality', 'Description quality', 'warn', 'Contact details detected in the description', checkStarted);
  } else {
    addCheck('description_quality', 'Description quality', 'pass', 'Description covers the device and its condition', checkStarted);
  }

  /* 11. External stolen-device provider ----------------------------------- */
  checkStarted = performance.now();
  const provider = stolenCheckProvider();
  const externalCheck: EngineResult['externalCheck'] = provider.configured
    ? await provider
        .check({
          listingId: input.listingId,
          identifiers: input.identifiers.map((identifier) => ({ kind: identifier.kind, value: identifier.fingerprint })),
        })
        .then((result) => ({
          status: result.status,
          provider: result.provider,
          message: result.message,
          response: result.response,
          performedAt: result.performedAt,
        }))
    : {
        status: 'not_configured',
        provider: null,
        message:
          'No authorised stolen-device verification provider is configured, so no automatic blacklist lookup was performed. This is not a statement that the device is clear — it has not been checked against any external register.',
        performedAt: null,
      };
  if (externalCheck.status === 'match') {
    flags.push({
      reason: 'identifier_duplicate',
      detail: `The verification provider reported a match: ${externalCheck.message}`,
      severity: 'critical',
    });
  }
  addCheck(
    'external_check',
    'External stolen-device check',
    externalCheck.status === 'not_configured' || externalCheck.status === 'not_performed'
      ? 'skipped'
      : externalCheck.status === 'clear'
        ? 'pass'
        : 'warn',
    externalCheck.message,
    checkStarted,
  );

  /* Outcome ---------------------------------------------------------------- */
  const criticalFlags = flags.filter((flag) => flag.severity === 'critical');
  const warningFlags = flags.filter((flag) => flag.severity === 'warning');
  const evidenceGap = flags.some((flag) => flag.reason === 'incomplete_evidence');

  const score = Math.max(
    0,
    100 -
      criticalFlags.length * 35 -
      warningFlags.length * 12 -
      flags.filter((flag) => flag.severity === 'info').length * 4,
  );

  let recommendedStatus: EngineResult['recommendedStatus'] = 'under_review';
  let outcome: AutomatedCheckOutcome = 'clean';
  if (criticalFlags.length > 0) {
    recommendedStatus = 'flagged';
    outcome = 'flagged';
  } else if (warningFlags.length > 0) {
    recommendedStatus = evidenceGap ? 'evidence_required' : 'flagged';
    outcome = evidenceGap ? 'needs_evidence' : 'flagged';
  }

  const durationMs = Math.round(performance.now() - started);
  logger.info(
    {
      listingId: input.listingId,
      engine: ENGINE_VERSION,
      outcome,
      recommendedStatus,
      flags: flags.map((flag) => flag.reason),
      durationMs,
    },
    'automated verification completed',
  );

  return { outcome, score, flags, checks, recommendedStatus, duplicateAlerts, externalCheck, durationMs };
}

/** Checksum helper shared with the media service (exact-duplicate detection). */
export function imageChecksum(buffer: Buffer): string {
  return sha256Hex(buffer);
}
