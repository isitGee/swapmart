'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { DEVICE_CONDITIONS, SORT_OPTIONS, type BrandDto, type CategoryDto } from '@swapmart/shared';
import { TANZANIA_REGIONS } from '@swapmart/shared';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { CONDITION_LABELS } from '@/lib/format';
import { cn } from '@/lib/cn';

const SORT_LABELS: Record<(typeof SORT_OPTIONS)[number], string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  relevance: 'Most relevant',
};

const AVAILABILITY_CHOICES = [
  { value: 'available', label: 'Available now' },
  { value: 'any', label: 'Include reserved and sold' },
] as const;

/**
 * Filter panel for the catalogue. Every control writes to the URL, so a
 * filtered view is shareable, bookmarkable and correctly paginated, and the
 * server does the filtering.
 */
export function ListingFilters({
  categories,
  brands,
  resultCount,
}: {
  categories: CategoryDto[];
  brands: BrandDto[];
  resultCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  const current = useMemo(
    () => ({
      q: params.get('q') ?? '',
      category: (params.get('category') ?? '').split(',').filter(Boolean),
      brand: (params.get('brand') ?? '').split(',').filter(Boolean),
      condition: (params.get('condition') ?? '').split(',').filter(Boolean),
      region: (params.get('region') ?? '').split(',').filter(Boolean),
      minPrice: params.get('minPrice') ?? '',
      maxPrice: params.get('maxPrice') ?? '',
      availability: params.get('availability') ?? 'available',
      sort: params.get('sort') ?? 'newest',
      exchangeAllowed: params.get('exchangeAllowed') === 'true',
    }),
    [params],
  );

  function push(next: URLSearchParams) {
    next.delete('page');
    const query = next.toString();
    router.push(query ? `/search?${query}` : '/search');
  }

  function toggleMulti(key: 'category' | 'brand' | 'condition' | 'region', value: string) {
    const set = new Set(current[key]);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    const next = new URLSearchParams(params.toString());
    if (set.size === 0) next.delete(key);
    else next.set(key, Array.from(set).join(','));
    push(next);
  }

  function setSingle(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete(key);
    else next.set(key, value);
    push(next);
  }

  const activeCount =
    current.category.length +
    current.brand.length +
    current.condition.length +
    current.region.length +
    (current.minPrice ? 1 : 0) +
    (current.maxPrice ? 1 : 0) +
    (current.availability !== 'available' ? 1 : 0) +
    (current.exchangeAllowed ? 1 : 0);

  const panel = (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Category</h3>
        <div className="mt-2 space-y-1.5">
          {categories.map((category) => (
            <Checkbox
              key={category.slug}
              id={`filter-category-${category.slug}`}
              checked={current.category.includes(category.slug)}
              onChange={() => toggleMulti('category', category.slug)}
              label={
                <span className="flex items-center justify-between gap-2">
                  <span>{category.name}</span>
                  {category.listingCount !== undefined ? (
                    <span className="text-xs text-ink-400">{category.listingCount}</span>
                  ) : null}
                </span>
              }
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Condition</h3>
        <div className="mt-2 space-y-1.5">
          {DEVICE_CONDITIONS.map((condition) => (
            <Checkbox
              key={condition}
              id={`filter-condition-${condition}`}
              checked={current.condition.includes(condition)}
              onChange={() => toggleMulti('condition', condition)}
              label={CONDITION_LABELS[condition]}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Price (TZS)</h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Input
            aria-label="Minimum price"
            inputMode="numeric"
            placeholder="Min"
            defaultValue={current.minPrice}
            onBlur={(event) => setSingle('minPrice', event.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setSingle('minPrice', (event.target as HTMLInputElement).value.replace(/[^\d]/g, ''));
            }}
          />
          <Input
            aria-label="Maximum price"
            inputMode="numeric"
            placeholder="Max"
            defaultValue={current.maxPrice}
            onBlur={(event) => setSingle('maxPrice', event.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setSingle('maxPrice', (event.target as HTMLInputElement).value.replace(/[^\d]/g, ''));
            }}
          />
        </div>
        <p className="mt-1.5 text-xs text-ink-500">Enter whole shillings, for example 850000.</p>
      </div>

      <Field label="Location" htmlFor="filter-region">
        <Select
          id="filter-region"
          value={current.region[0] ?? ''}
          onChange={(event) => setSingle('region', event.target.value)}
        >
          <option value="">All regions</option>
          {TANZANIA_REGIONS.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Availability</h3>
        <div className="mt-2 space-y-1.5">
          {AVAILABILITY_CHOICES.map((choice) => (
            <Checkbox
              key={choice.value}
              id={`filter-availability-${choice.value}`}
              checked={current.availability === choice.value}
              onChange={() => setSingle('availability', choice.value)}
              label={choice.label}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Options</h3>
        <div className="mt-2 space-y-1.5">
          <Checkbox
            id="filter-exchange"
            checked={current.exchangeAllowed}
            onChange={() => setSingle('exchangeAllowed', current.exchangeAllowed ? '' : 'true')}
            label="Accepts exchange offers"
          />
        </div>
      </div>

      {brands.length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Popular brands</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {brands.slice(0, 12).map((brand) => {
              const active = current.brand.includes(brand.slug);
              return (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => toggleMulti('brand', brand.slug)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-line-strong bg-surface text-ink-600 hover:bg-surface-muted',
                  )}
                >
                  {brand.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {activeCount > 0 ? (
        <Button variant="ghost" size="sm" icon="x" onClick={() => push(new URLSearchParams())}>
          Clear all filters
        </Button>
      ) : null}
    </div>
  );

  return (
    <>
      {/* Mobile: collapsed behind a disclosure so results stay above the fold. */}
      <div className="lg:hidden">
        <Button variant="secondary" size="sm" icon="filter" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </Button>
        {open ? <div className="sm-enter mt-3 rounded-card border border-line bg-surface p-4">{panel}</div> : null}
      </div>

      <aside className="hidden lg:block" aria-label="Filters">
        <div className="sm-card sticky top-20 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-900">Refine results</h2>
            <span className="text-xs text-ink-500">{resultCount} found</span>
          </div>
          <div className="mb-3 border-b border-line pb-3">
            <Field label="Sort by" htmlFor="filter-sort" compact>
              <Select id="filter-sort" value={current.sort} onChange={(event) => setSingle('sort', event.target.value)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {SORT_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {panel}
        </div>
      </aside>

      <div className="lg:hidden">
        <Field label="Sort by" htmlFor="filter-sort-mobile" className="mt-3">
          <Select id="filter-sort-mobile" value={current.sort} onChange={(event) => setSingle('sort', event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SORT_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-500">
          <Icon name="search" size={13} />
          {resultCount} listings match your search
        </p>
      </div>
    </>
  );
}
