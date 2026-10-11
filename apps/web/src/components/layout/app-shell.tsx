'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  exact?: boolean;
  section?: string;
}

/**
 * Sidebar shell used by the seller dashboard and the administrator console.
 * The active item is derived from the current path so a user always knows where
 * they are, and the whole navigation collapses into a disclosure on small
 * screens.
 */
export function AppShell({
  title,
  subtitle,
  items,
  children,
  actions,
  accent = 'brand',
}: {
  title: string;
  subtitle?: string;
  items: NavItem[];
  children: ReactNode;
  actions?: ReactNode;
  accent?: 'brand' | 'admin';
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const sections = items.reduce<Record<string, NavItem[]>>((accumulator, item) => {
    const key = item.section ?? '';
    accumulator[key] = accumulator[key] ?? [];
    accumulator[key].push(item);
    return accumulator;
  }, {});

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const navigation = (
    <nav aria-label={`${title} navigation`} className="flex flex-col gap-4">
      {Object.entries(sections).map(([section, sectionItems]) => (
        <div key={section}>
          {section ? (
            <p className="px-3 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-400">{section}</p>
          ) : null}
          <ul className="space-y-0.5">
            {sectionItems.map((item) => {
              const active = isActive(item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors',
                      active
                        ? accent === 'admin'
                          ? 'bg-ink-900 font-medium text-white'
                          : 'bg-brand-50 font-medium text-brand-700'
                        : 'text-ink-600 hover:bg-surface-sunken hover:text-ink-900',
                    )}
                  >
                    <Icon name={item.icon} size={16} className={active ? undefined : 'text-ink-400'} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && item.badge > 0 ? (
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[0.625rem] font-semibold',
                          active ? 'bg-white/25 text-white' : 'bg-surface-sunken text-ink-600',
                        )}
                      >
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-6 px-4 py-6 sm:px-6">
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="sticky top-20">
          <div className="pb-3">
            <p className="text-[0.9375rem] font-semibold text-ink-900">{title}</p>
            {subtitle ? <p className="text-xs text-ink-500">{subtitle}</p> : null}
          </div>
          {navigation}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-ink-800"
          >
            <Icon name={open ? 'x' : 'list'} size={16} />
            {title}
          </button>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </div>

        {open ? (
          <div className="sm-enter mb-4 rounded-card border border-line bg-surface p-3 shadow-soft lg:hidden">{navigation}</div>
        ) : null}

        <div className="flex flex-col gap-6">
          <div className="hidden items-start justify-end gap-2 lg:flex">{actions}</div>
          {children}
        </div>
      </div>
    </div>
  );
}
