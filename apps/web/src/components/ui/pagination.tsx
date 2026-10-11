import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Icon } from './icon';

/**
 * Numbered pagination that preserves every existing query parameter, so paging
 * through a filtered search never drops the filters.
 */
export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  basePath,
  params,
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  basePath: string;
  params: Record<string, string | number | undefined>;
  className?: string;
}) {
  if (total === 0) return null;

  const linkFor = (targetPage: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue;
      search.set(key, String(value));
    }
    if (targetPage > 1) search.set('page', String(targetPage));
    else search.delete('page');
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const first = Math.max(1, Math.min(page - 2, totalPages - 4));
  const last = Math.min(totalPages, first + 4);
  const pages: number[] = [];
  for (let index = first; index <= last; index += 1) pages.push(index);

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  const base = 'inline-flex h-8 min-w-8 items-center justify-center rounded-control border px-2 text-sm transition-colors';

  return (
    <nav className={cn('flex flex-wrap items-center justify-between gap-3', className)} aria-label="Pagination">
      <p className="text-xs text-ink-500">
        Showing <span className="font-medium text-ink-700">{from}</span>–
        <span className="font-medium text-ink-700">{to}</span> of <span className="font-medium text-ink-700">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={linkFor(page - 1)} className={cn(base, 'border-line-strong text-ink-700 hover:bg-surface-muted')} rel="prev">
            <Icon name="chevron-left" size={15} />
            <span className="sr-only">Previous page</span>
          </Link>
        ) : (
          <span className={cn(base, 'border-line text-ink-400')} aria-disabled="true">
            <Icon name="chevron-left" size={15} />
          </span>
        )}
        {pages.map((entry) => (
          <Link
            key={entry}
            href={linkFor(entry)}
            aria-current={entry === page ? 'page' : undefined}
            className={cn(
              base,
              entry === page
                ? 'border-brand-600 bg-brand-600 font-semibold text-white'
                : 'border-line-strong text-ink-700 hover:bg-surface-muted',
            )}
          >
            {entry}
          </Link>
        ))}
        {page < totalPages ? (
          <Link href={linkFor(page + 1)} className={cn(base, 'border-line-strong text-ink-700 hover:bg-surface-muted')} rel="next">
            <Icon name="chevron" size={15} />
            <span className="sr-only">Next page</span>
          </Link>
        ) : (
          <span className={cn(base, 'border-line text-ink-400')} aria-disabled="true">
            <Icon name="chevron" size={15} />
          </span>
        )}
      </div>
    </nav>
  );
}
