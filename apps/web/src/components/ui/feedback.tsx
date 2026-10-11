import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icon';

/* --------------------------------- Alerts -------------------------------- */

type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const ALERT_TONES: Record<AlertTone, { wrapper: string; icon: IconName }> = {
  info: { wrapper: 'bg-info-50 border-brand-200 text-brand-900', icon: 'info' },
  success: { wrapper: 'bg-success-50 border-success-600/25 text-success-700', icon: 'check-circle' },
  warning: { wrapper: 'bg-warning-50 border-warning-600/25 text-warning-700', icon: 'alert' },
  danger: { wrapper: 'bg-danger-50 border-danger-600/25 text-danger-700', icon: 'alert' },
  neutral: { wrapper: 'bg-surface-muted border-line text-ink-700', icon: 'info' },
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const config = ALERT_TONES[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-card border p-3.5 text-sm', config.wrapper, className)}>
      <Icon name={config.icon} size={17} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1', 'leading-relaxed')}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

/* ------------------------------- Containers ------------------------------ */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('sm-card overflow-hidden', className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-[0.9375rem] font-semibold text-ink-900">{title}</h2>
            {description ? <p className="mt-0.5 text-[0.8125rem] text-ink-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('px-4 py-4 sm:px-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-700">{eyebrow}</p>
        ) : null}
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink-900 sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm text-ink-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
  icon?: IconName;
}) {
  const accent =
    tone === 'warning'
      ? 'text-warning-700'
      : tone === 'danger'
        ? 'text-danger-600'
        : tone === 'success'
          ? 'text-success-600'
          : 'text-ink-900';

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        {icon ? <Icon name={icon} size={15} className="text-ink-400" /> : null}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', accent)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="sm-card block px-4 py-3.5 transition-colors hover:border-line-strong hover:bg-surface-muted"
      >
        {body}
      </Link>
    );
  }
  return <div className="sm-card px-4 py-3.5">{body}</div>;
}

/* ------------------------------ Empty states ----------------------------- */

export function EmptyState({
  icon = 'box',
  title,
  description,
  action,
  className,
}: {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunken text-ink-500">
        <Icon name={icon} size={20} />
      </span>
      <h3 className="mt-3.5 text-sm font-semibold text-ink-900">{title}</h3>
      {description ? <div className="mt-1.5 max-w-md text-sm text-ink-500">{description}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Unavailable-external-service state. Used wherever a capability genuinely is
 * not configured, so the interface never implies a check happened when it did
 * not.
 */
export function UnavailableState({
  title,
  description,
  setupHint,
  action,
}: {
  title: string;
  description: string;
  setupHint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface-muted p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink-500">
          <Icon name="shield" size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{title}</p>
          <p className="mt-1 text-sm text-ink-600">{description}</p>
          {setupHint ? <div className="mt-2 text-xs text-ink-500">{setupHint}</div> : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  retry,
}: {
  title?: string;
  message?: string;
  retry?: ReactNode;
}) {
  return (
    <div role="alert" className="sm-card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-50 text-danger-600">
        <Icon name="alert" size={20} />
      </span>
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      {message ? <p className="max-w-md text-sm text-ink-600">{message}</p> : null}
      {retry ? <div className="mt-2">{retry}</div> : null}
    </div>
  );
}

/* -------------------------------- Skeletons ------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('sm-skeleton h-4 w-full', className)} />;
}

export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="sm-card overflow-hidden">
          <div className="sm-skeleton aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-5 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-4 py-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton key={columnIndex} className={columnIndex === 0 ? 'w-4/5' : 'w-2/3'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- Tables -------------------------------- */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-500 whitespace-nowrap',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return (
    <td title={title} className={cn('border-b border-line px-3 py-2.5 align-middle text-ink-700', className)}>
      {children}
    </td>
  );
}

/* --------------------------------- Misc ---------------------------------- */

export function DataList({ items, className }: { items: { label: string; value: ReactNode; hint?: string }[]; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{item.label}</dt>
          <dd className="mt-0.5 text-sm text-ink-800">{item.value}</dd>
          {item.hint ? <p className="mt-0.5 text-xs text-ink-500">{item.hint}</p> : null}
        </div>
      ))}
    </dl>
  );
}

/** Small inline definition of the marketplace's verification limits. */
export function DisclaimerNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-xs leading-relaxed text-ink-500', className)}>
      <Icon name="info" size={13} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
