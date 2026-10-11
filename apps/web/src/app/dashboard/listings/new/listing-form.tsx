'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DEVICE_CONDITIONS,
  IDENTIFIER_KINDS,
  SPEC_FIELDS,
  TANZANIA_REGIONS,
  UPLOAD_LIMITS,
  type BrandDto,
  type CategoryDto,
  type MediaAssetDto,
} from '@swapmart/shared';
import { apiPost, apiUpload, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, Panel } from '@/components/ui/feedback';
import { Checkbox, Field, Input, RadioGroup, Select, Textarea } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { CONDITION_LABELS, formatTzs } from '@/lib/format';
import { cn } from '@/lib/cn';

interface IdentifierDraft {
  kind: string;
  value: string;
}

interface EvidenceDraft {
  mediaId: string;
  kind: string;
  note: string;
  fileName: string;
  mimeType: string;
  checking?: boolean;
}

interface CheckResult {
  valid: boolean;
  available: boolean;
  message: string;
  formatHint?: string;
}

const EVIDENCE_KINDS = [
  { value: 'proof_of_purchase', label: 'Proof of purchase' },
  { value: 'imei_screenshot', label: 'Identifier screenshot' },
  { value: 'serial_label', label: 'Serial number label' },
  { value: 'box_label', label: 'Box or packaging label' },
  { value: 'device_front', label: 'Device photograph (front)' },
  { value: 'device_back', label: 'Device photograph (back)' },
  { value: 'warranty_document', label: 'Warranty document' },
  { value: 'other', label: 'Other supporting document' },
];

export function ListingForm({ categories, brands }: { categories: CategoryDto[]; brands: BrandDto[] }) {
  const router = useRouter();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [categorySlug, setCategorySlug] = useState(categories[0]?.slug ?? '');
  const [brandId, setBrandId] = useState('');
  const [brandName, setBrandName] = useState('');
  const [model, setModel] = useState('');
  const [condition, setCondition] = useState<string>('good');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [negotiable, setNegotiable] = useState(true);
  const [exchangeAllowed, setExchangeAllowed] = useState(true);
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [specs, setSpecs] = useState<Record<string, string>>({});

  const [images, setImages] = useState<MediaAssetDto[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const [identifiers, setIdentifiers] = useState<IdentifierDraft[]>([{ kind: 'imei', value: '' }]);
  const [checks, setChecks] = useState<Record<number, CheckResult>>({});
  const [checkingIndex, setCheckingIndex] = useState<number | null>(null);

  const [evidence, setEvidence] = useState<EvidenceDraft[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const evidenceInput = useRef<HTMLInputElement>(null);
  const [evidenceKind, setEvidenceKind] = useState('proof_of_purchase');

  const [confirmAccuracy, setConfirmAccuracy] = useState(false);
  const [confirmLawful, setConfirmLawful] = useState(false);
  const [pending, setPending] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const specFields = useMemo(() => SPEC_FIELDS[categorySlug] ?? [], [categorySlug]);
  const usedBrands = useMemo(() => new Set(brands.map((brand) => brand.id)), [brands]);

  const priceNumber = Number.parseInt(price.replace(/[^\d]/g, ''), 10);
  const priceValid = Number.isFinite(priceNumber) && priceNumber >= 1000;

  async function handleImageUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = UPLOAD_LIMITS.maxImagesPerListing - images.length;
    if (remaining <= 0) {
      setImageError(`A listing can hold at most ${UPLOAD_LIMITS.maxImagesPerListing} photographs.`);
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    setUploadingImages(true);
    setImageError(null);
    try {
      const formData = new FormData();
      for (const file of selected) formData.append('files', file);
      const stored = await apiUpload<MediaAssetDto[]>('/uploads/listing-images', formData);
      setImages((current) => [...current, ...stored]);
      toast.success(`${stored.length} photograph${stored.length === 1 ? '' : 's'} uploaded.`);
    } catch (caught) {
      setImageError(errorMessage(caught));
    } finally {
      setUploadingImages(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  }

  async function handleEvidenceUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = UPLOAD_LIMITS.maxEvidenceFiles - evidence.length;
    if (remaining <= 0) {
      setEvidenceError(`At most ${UPLOAD_LIMITS.maxEvidenceFiles} evidence files can be attached.`);
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    setUploadingEvidence(true);
    setEvidenceError(null);
    try {
      const formData = new FormData();
      for (const file of selected) formData.append('files', file);
      const stored = await apiUpload<{ id: string; mimeType: string }[]>('/uploads/evidence', formData);
      setEvidence((current) => [
        ...current,
        ...stored.map((asset, index) => ({
          mediaId: asset.id,
          kind: evidenceKind,
          note: '',
          fileName: selected[index]?.name ?? 'evidence file',
          mimeType: asset.mimeType,
        })),
      ]);
      toast.success('Evidence stored privately.');
    } catch (caught) {
      setEvidenceError(errorMessage(caught));
    } finally {
      setUploadingEvidence(false);
      if (evidenceInput.current) evidenceInput.current.value = '';
    }
  }

  async function checkIdentifier(index: number) {
    const identifier = identifiers[index];
    if (!identifier || identifier.value.trim().length < 4) return;
    setCheckingIndex(index);
    try {
      const result = await apiPost<CheckResult>('/identifiers/check', {
        kind: identifier.kind,
        value: identifier.value.trim(),
      });
      setChecks((current) => ({ ...current, [index]: result }));
    } catch (caught) {
      setChecks((current) => ({
        ...current,
        [index]: { valid: false, available: false, message: errorMessage(caught) },
      }));
    } finally {
      setCheckingIndex(null);
    }
  }

  function moveImage(index: number, direction: -1 | 1) {
    setImages((current) => {
      const next = [...current];
      const target = index + direction;
      const item = next[index];
      const swap = next[target];
      if (!item || !swap) return current;
      next[index] = swap;
      next[target] = item;
      return next;
    });
  }

  async function save(mode: 'draft' | 'submit') {
    setError(null);
    setFieldErrors({});
    const localErrors: Record<string, string> = {};
    if (title.trim().length < 8) localErrors.title = 'Give the listing a descriptive title of at least 8 characters.';
    if (!categorySlug) localErrors.categorySlug = 'Choose a category.';
    if (!model.trim()) localErrors.model = 'State the model.';
    if (description.trim().length < 40) localErrors.description = 'Describe the device in at least 40 characters.';
    if (!priceValid) localErrors.askingPriceTzs = 'Enter a whole amount in TZS of at least 1,000.';
    if (!region) localErrors.region = 'Choose the region where the device can be inspected.';
    const filledIdentifiers = identifiers.filter((identifier) => identifier.value.trim().length > 0);
    if (mode === 'submit' && images.length === 0) localErrors.images = 'Upload at least one photograph before submitting.';
    if (mode === 'submit' && filledIdentifiers.length === 0 && evidence.length === 0) {
      localErrors.identifiers = 'For submission, supply a device identifier or at least one evidence file.';
    }
    if (mode === 'submit' && (!confirmAccuracy || !confirmLawful)) {
      localErrors.confirmations = 'Confirm both statements before submitting for review.';
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setError('Please correct the highlighted fields before continuing.');
      return;
    }

    setPending(mode);
    try {
      const payload = {
        title: title.trim(),
        categorySlug,
        ...(brandId && usedBrands.has(brandId) ? { brandId } : {}),
        ...(brandName.trim() ? { brandName: brandName.trim() } : {}),
        model: model.trim(),
        condition,
        description: description.trim(),
        askingPriceTzs: priceNumber,
        negotiable,
        exchangeAllowed,
        region,
        ...(city.trim() ? { city: city.trim() } : {}),
        specs: Object.fromEntries(
          Object.entries(specs).filter(([, value]) => value !== '' && value !== undefined),
        ),
        identifiers: filledIdentifiers.map((identifier) => ({
          kind: identifier.kind,
          value: identifier.value.trim(),
        })),
        imageMediaIds: images.map((image) => image.id),
        evidence: evidence.map((item) => ({
          mediaId: item.mediaId,
          kind: item.kind,
          ...(item.note.trim() ? { note: item.note.trim() } : {}),
        })),
      };

      const created = await apiPost<{ id: string }>('/me/listings', payload);

      if (mode === 'submit') {
        await apiPost(`/me/listings/${created.id}/submit`, { confirmAccuracy: true, confirmLawful: true });
        toast.success('Listing submitted for verification.');
      } else {
        toast.success('Draft saved. You can finish and submit it later.');
      }

      router.push(`/dashboard/listings/${created.id}`);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors);
        setError(caught.message);
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert tone="danger" title="The listing was not saved">{error}</Alert> : null}

      <Panel title="1. What are you selling?" description="Accurate titles and descriptions are what buyers search.">
        <div className="grid gap-4">
          <Field label="Listing title" htmlFor="title" error={fieldErrors.title} hint={`${title.length}/120`} required>
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="e.g. iPhone 13 128GB — excellent condition, boxed"
              invalid={Boolean(fieldErrors.title)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="category" error={fieldErrors.categorySlug} required>
              <Select
                id="category"
                value={categorySlug}
                onChange={(event) => {
                  setCategorySlug(event.target.value);
                  setSpecs({});
                }}
              >
                {categories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Condition" htmlFor="condition" required>
              <Select id="condition" value={condition} onChange={(event) => setCondition(event.target.value)}>
                {DEVICE_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {CONDITION_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Brand" htmlFor="brand" hint="Choose a listed brand, or type one below">
              <Select id="brand" value={brandId} onChange={(event) => setBrandId(event.target.value)}>
                <option value="">Not listed / other</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand name (if not listed)" htmlFor="brandName">
              <Input
                id="brandName"
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
                maxLength={60}
                placeholder="e.g. Tecno"
                disabled={Boolean(brandId)}
              />
            </Field>
          </div>

          <Field label="Model" htmlFor="model" error={fieldErrors.model} required>
            <Input
              id="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              maxLength={80}
              placeholder="e.g. A2633 (iPhone 13)"
              invalid={Boolean(fieldErrors.model)}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="description"
            error={fieldErrors.description}
            hint={`${description.length}/4000 · minimum 40 characters`}
            required
          >
            <Textarea
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={4000}
              rows={6}
              placeholder="Describe the condition honestly: battery health, scratches, repairs, accessories included, and how long you have owned it."
              invalid={Boolean(fieldErrors.description)}
            />
          </Field>
        </div>
      </Panel>

      {specFields.length > 0 ? (
        <Panel title="2. Specifications" description="Structured fields make it possible to compare devices and to sanity-check prices.">
          <div className="grid gap-4 sm:grid-cols-2">
            {specFields.map((field) => (
              <Field
                key={field.key}
                label={field.label + (field.required ? '' : ' (optional)')}
                htmlFor={`spec-${field.key}`}
                hint={field.unit}
              >
                {field.type === 'boolean' ? (
                  <Select
                    id={`spec-${field.key}`}
                    value={specs[field.key] ?? ''}
                    onChange={(event) => setSpecs((current) => ({ ...current, [field.key]: event.target.value }))}
                  >
                    <option value="">Not stated</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </Select>
                ) : field.type === 'select' ? (
                  <Select
                    id={`spec-${field.key}`}
                    value={specs[field.key] ?? ''}
                    onChange={(event) => setSpecs((current) => ({ ...current, [field.key]: event.target.value }))}
                  >
                    <option value="">Not stated</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={`spec-${field.key}`}
                    inputMode={field.type === 'number' ? 'numeric' : 'text'}
                    value={specs[field.key] ?? ''}
                    onChange={(event) => setSpecs((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="3. Photographs"
        description={`Up to ${UPLOAD_LIMITS.maxImagesPerListing} images, ${Math.round(UPLOAD_LIMITS.maxImageBytes / 1024 / 1024)}MB each. Use photographs of the actual device.`}
      >
        <div className="flex flex-col gap-3">
          <input
            ref={imageInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            className="hidden"
            onChange={(event) => void handleImageUpload(event.target.files)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon="upload"
              onClick={() => imageInput.current?.click()}
              loading={uploadingImages}
              disabled={images.length >= UPLOAD_LIMITS.maxImagesPerListing}
            >
              Upload photographs
            </Button>
            <span className="self-center text-xs text-ink-500">
              {images.length}/{UPLOAD_LIMITS.maxImagesPerListing} uploaded
            </span>
          </div>
          {imageError ? <Alert tone="danger">{imageError}</Alert> : null}
          {fieldErrors.images ? <Alert tone="warning">{fieldErrors.images}</Alert> : null}

          {images.length > 0 ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {images.map((image, index) => (
                <li key={image.id} className="overflow-hidden rounded-card border border-line">
                  <div className="relative aspect-[4/3] bg-surface-sunken">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt={`Photograph ${index + 1}`} className="h-full w-full object-cover" />
                    {index === 0 ? (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-brand-600 px-2 py-0.5 text-[0.625rem] font-semibold text-white">
                        Cover
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveImage(index, -1)}
                        disabled={index === 0}
                        className="rounded p-1 text-ink-500 transition-colors hover:bg-surface-sunken disabled:opacity-30"
                        aria-label="Move photograph earlier"
                      >
                        <Icon name="chevron-left" size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(index, 1)}
                        disabled={index === images.length - 1}
                        className="rounded p-1 text-ink-500 transition-colors hover:bg-surface-sunken disabled:opacity-30"
                        aria-label="Move photograph later"
                      >
                        <Icon name="chevron" size={14} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                      className="rounded p-1 text-danger-600 transition-colors hover:bg-danger-50"
                      aria-label={`Remove photograph ${index + 1}`}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-control border border-dashed border-line-strong bg-surface-muted px-3 py-6 text-center text-sm text-ink-500">
              No photographs yet. Listings without photographs are not accepted for review.
            </p>
          )}
        </div>
      </Panel>

      <Panel
        title="4. Device identifier"
        description="An IMEI, MEID, serial number or MAC address. It is encrypted at rest, checked for duplicates, and never shown publicly."
      >
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {identifiers.map((identifier, index) => (
              <li key={index} className="rounded-card border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
                  <Field label="Type" htmlFor={`identifier-kind-${index}`} compact>
                    <Select
                      id={`identifier-kind-${index}`}
                      value={identifier.kind}
                      onChange={(event) =>
                        setIdentifiers((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, kind: event.target.value } : item,
                          ),
                        )
                      }
                    >
                      {IDENTIFIER_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind.replace(/_/g, ' ').toUpperCase()}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Value" htmlFor={`identifier-value-${index}`} compact>
                    <Input
                      id={`identifier-value-${index}`}
                      value={identifier.value}
                      onChange={(event) =>
                        setIdentifiers((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                      className="font-mono"
                      placeholder={identifier.kind === 'imei' ? '15 digits, e.g. 356938035643809' : 'Identifier value'}
                      autoComplete="off"
                    />
                  </Field>
                  <div className="flex items-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void checkIdentifier(index)}
                      loading={checkingIndex === index}
                      disabled={identifier.value.trim().length < 4}
                    >
                      Check
                    </Button>
                    {identifiers.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        onClick={() => setIdentifiers((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label="Remove identifier"
                      />
                    ) : null}
                  </div>
                </div>

                {checks[index] ? (
                  <div className="mt-2">
                    <Alert tone={checks[index]?.available && checks[index]?.valid ? 'success' : 'warning'}>
                      <p className="font-medium">{checks[index]?.message}</p>
                      {checks[index]?.formatHint ? (
                        <p className="mt-0.5 font-mono text-xs">{checks[index]?.formatHint}</p>
                      ) : null}
                    </Alert>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {identifiers.length < 4 ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="self-start"
              onClick={() => setIdentifiers((current) => [...current, { kind: 'serial', value: '' }])}
            >
              Add another identifier
            </Button>
          ) : null}

          {fieldErrors.identifiers ? <Alert tone="warning">{fieldErrors.identifiers}</Alert> : null}

          <Alert tone="info" title="What happens when you submit">
            The identifier becomes an active claim and is compared against every other listing. If another active listing
            already holds it, submission is refused and the conflict is recorded for administrators. You will be told the
            identifier is unavailable — never who holds it.
          </Alert>
        </div>
      </Panel>

      <Panel
        title="5. Supporting evidence"
        description="Proof of purchase, an identifier screenshot, the box label or a warranty document. Evidence is private to you and to moderators."
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[16rem_1fr] sm:items-end">
            <Field label="Evidence type" htmlFor="evidence-kind">
              <Select id="evidence-kind" value={evidenceKind} onChange={(event) => setEvidenceKind(event.target.value)}>
                {EVIDENCE_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <input
                ref={evidenceInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
                multiple
                className="hidden"
                onChange={(event) => void handleEvidenceUpload(event.target.files)}
              />
              <Button
                variant="secondary"
                icon="upload"
                onClick={() => evidenceInput.current?.click()}
                loading={uploadingEvidence}
                disabled={evidence.length >= UPLOAD_LIMITS.maxEvidenceFiles}
              >
                Upload evidence
              </Button>
              <span className="self-center text-xs text-ink-500">
                {evidence.length}/{UPLOAD_LIMITS.maxEvidenceFiles} attached
              </span>
            </div>
          </div>

          {evidenceError ? <Alert tone="danger">{evidenceError}</Alert> : null}

          {evidence.length > 0 ? (
            <ul className="divide-y divide-line rounded-card border border-line">
              {evidence.map((item, index) => (
                <li key={item.mediaId} className="flex flex-wrap items-center gap-3 p-3">
                  <Icon name="file" size={16} className="text-ink-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink-800">{item.fileName}</span>
                    <span className="text-xs text-ink-500">{item.mimeType}</span>
                  </span>
                  <input
                    aria-label={`Note for ${item.fileName}`}
                    className="sm-input max-w-64"
                    placeholder="Note for the reviewer (optional)"
                    value={item.note}
                    maxLength={300}
                    onChange={(event) =>
                      setEvidence((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, note: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <Select
                    aria-label={`Evidence type for ${item.fileName}`}
                    className="max-w-48"
                    value={item.kind}
                    onChange={(event) =>
                      setEvidence((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, kind: event.target.value } : entry,
                        ),
                      )
                    }
                  >
                    {EVIDENCE_KINDS.map((kind) => (
                      <option key={kind.value} value={kind.value}>
                        {kind.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    aria-label={`Remove ${item.fileName}`}
                    onClick={() => setEvidence((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-control border border-dashed border-line-strong bg-surface-muted px-3 py-5 text-center text-sm text-ink-500">
              No evidence attached yet. A receipt or identifier photograph significantly speeds up review.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="6. Price and location">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Asking price (TZS)"
              htmlFor="price"
              error={fieldErrors.askingPriceTzs}
              hint={priceValid ? formatTzs(priceNumber) : 'Whole shillings only — no decimals'}
              required
            >
              <Input
                id="price"
                inputMode="numeric"
                value={price}
                onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ''))}
                placeholder="850000"
                invalid={Boolean(fieldErrors.askingPriceTzs)}
              />
            </Field>
            <Field label="Region" htmlFor="region" error={fieldErrors.region} required>
              <Select
                id="region"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                invalid={Boolean(fieldErrors.region)}
              >
                <option value="">Select a region…</option>
                {TANZANIA_REGIONS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="City or district" htmlFor="city" hint="Optional — helps buyers judge travel distance">
            <Input id="city" value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} placeholder="e.g. Kinondoni" />
          </Field>

          <div className="flex flex-col gap-2">
            <Checkbox
              id="negotiable"
              checked={negotiable}
              onChange={(event) => setNegotiable(event.target.checked)}
              label="Price is negotiable"
            />
            <Checkbox
              id="exchangeAllowed"
              checked={exchangeAllowed}
              onChange={(event) => setExchangeAllowed(event.target.checked)}
              label="Open to exchange proposals"
              description="Buyers may offer one of their own devices plus or minus a price difference."
            />
          </div>
        </div>
      </Panel>

      <Panel title="7. Submit for verification">
        <div className="flex flex-col gap-3">
          <RadioGroup
            name="submission-mode"
            legend="How would you like to proceed?"
            value="explain"
            options={[
              {
                value: 'explain',
                label: 'Automated checks run on submission',
                description:
                  'Identifier format and duplicates, evidence completeness, price sanity and image reuse are checked immediately, then an administrator reviews the result.',
              },
              {
                value: 'reminder',
                label: 'Approval is not a legal guarantee',
                description:
                  'An administrator confirms that the evidence is plausible and the identifier is not already claimed. Ownership and theft history are not certified.',
              },
            ]}
          />

          <Checkbox
            id="confirm-accuracy"
            checked={confirmAccuracy}
            onChange={(event) => setConfirmAccuracy(event.target.checked)}
            label="I confirm the information in this listing is accurate to the best of my knowledge."
          />
          <Checkbox
            id="confirm-lawful"
            checked={confirmLawful}
            onChange={(event) => setConfirmLawful(event.target.checked)}
            label="I confirm that I own this device or am authorised to sell it, and that it is not reported stolen."
          />
          {fieldErrors.confirmations ? <Alert tone="warning">{fieldErrors.confirmations}</Alert> : null}

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button
              variant="secondary"
              icon="file"
              onClick={() => void save('draft')}
              loading={pending === 'draft'}
              disabled={pending !== null}
            >
              Save as draft
            </Button>
            <Button
              variant="primary"
              icon="upload"
              onClick={() => void save('submit')}
              loading={pending === 'submit'}
              disabled={pending !== null}
            >
              Save and submit for review
            </Button>
            <Link
              href="/dashboard/listings"
              className="inline-flex h-10 items-center rounded-control px-3 text-sm font-medium text-ink-600 hover:bg-surface-sunken"
            >
              Cancel
            </Link>
          </div>
          <p className={cn('text-xs text-ink-500')}>
            Submitting places the listing in the review queue. You can still withdraw it while it is under review.
          </p>
        </div>
      </Panel>
    </div>
  );
}
