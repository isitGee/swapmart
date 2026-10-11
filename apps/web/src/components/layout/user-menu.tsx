'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { CurrentUserDto } from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/** Signed-in account menu: profile, dashboard links, administrator entry, sign out. */
export function UserMenu({ user }: { user: CurrentUserDto }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiPost('/auth/logout');
      toast.success('You have been signed out.');
      setOpen(false);
      router.push('/');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSigningOut(false);
    }
  }

  const initials = user.profile.displayName
    .split(' ')
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-control border border-line-strong bg-surface px-2 py-1.5 text-sm font-medium text-ink-800 transition-colors hover:bg-surface-muted"
      >
        <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-[0.6875rem] font-semibold text-brand-700">
          {user.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.profile.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials || 'SM'
          )}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{user.profile.displayName}</span>
        {user.unreadNotifications > 0 ? (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[0.625rem] font-semibold text-white">
            {user.unreadNotifications > 99 ? '99+' : user.unreadNotifications}
          </span>
        ) : null}
        <Icon name="chevron-down" size={14} className="text-ink-400" />
      </button>

      {open ? (
        <div
          role="menu"
          className="sm-enter absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-overlay"
        >
          <div className="border-b border-line px-3.5 py-3">
            <p className="truncate text-sm font-semibold text-ink-900">{user.profile.displayName}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {user.role === 'admin' ? (
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-white">
                  Administrator
                </span>
              ) : null}
              {user.emailVerified ? (
                <span className="text-[0.6875rem] text-success-600">Email verified</span>
              ) : (
                <Link href="/verify-email" className="text-[0.6875rem] font-medium text-warning-700 underline">
                  Email not verified
                </Link>
              )}
            </p>
          </div>
          <MenuLink href="/dashboard" icon="grid" label="Seller dashboard" />
          <MenuLink href="/dashboard/messages" icon="message" label="Messages" badge={user.unreadMessages} />
          <MenuLink href="/dashboard/notifications" icon="bell" label="Notifications" badge={user.unreadNotifications} />
          <MenuLink href="/dashboard/listings" icon="list" label="My listings" />
          <MenuLink href="/dashboard/transactions" icon="handshake" label="Transactions" />
          <MenuLink href="/dashboard/saved" icon="bookmark" label="Saved listings" />
          <MenuLink href="/dashboard/settings" icon="settings" label="Profile & security" />
          {user.role === 'admin' ? (
            <MenuLink href="/admin" icon="shield-check" label="Administrator console" />
          ) : null}
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-surface-sunken disabled:opacity-60"
            >
              {signingOut ? <Spinner size={14} /> : <Icon name="logout" size={15} className="text-ink-400" />}
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  label,
  badge,
}: {
  href: string;
  icon: 'grid' | 'message' | 'bell' | 'list' | 'handshake' | 'bookmark' | 'settings' | 'shield-check';
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-sunken"
    >
      <Icon name={icon} size={15} className="text-ink-400" />
      <span className="flex-1">{label}</span>
      {badge && badge > 0 ? (
        <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[0.625rem] font-semibold text-brand-700">{badge}</span>
      ) : null}
    </Link>
  );
}

/** Mobile navigation drawer shown below the `sm` breakpoint. */
export function MobileMenu({ user, categories }: { user: CurrentUserDto | null; categories: { slug: string; name: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Toggle navigation menu"
        className={cn('rounded-control border border-line-strong bg-surface p-2 text-ink-700 transition-colors hover:bg-surface-muted')}
      >
        <Icon name={open ? 'x' : 'list'} size={18} />
      </button>

      {open ? (
        <div className="sm-enter absolute inset-x-0 top-full z-40 border-b border-line bg-surface px-4 py-4 shadow-raised">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Categories</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {categories.map((category) => (
              <Link
                key={category.slug}
                href={`/categories/${category.slug}`}
                onClick={() => setOpen(false)}
                className="rounded-control px-2.5 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-sunken"
              >
                {category.name}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
            <Link href="/search" onClick={() => setOpen(false)} className="rounded-control px-2.5 py-2 text-sm text-ink-700 hover:bg-surface-sunken">
              Browse all listings
            </Link>
            {user ? (
              <>
                <Link href="/dashboard" onClick={() => setOpen(false)} className="rounded-control px-2.5 py-2 text-sm text-ink-700 hover:bg-surface-sunken">
                  Seller dashboard
                </Link>
                <Link
                  href="/dashboard/listings/new"
                  onClick={() => setOpen(false)}
                  className="rounded-control px-2.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
                >
                  Create a listing
                </Link>
              </>
            ) : (
              <>
                <Link href="/signin" onClick={() => setOpen(false)} className="rounded-control px-2.5 py-2 text-sm text-ink-700 hover:bg-surface-sunken">
                  Sign in
                </Link>
                <Link href="/register" onClick={() => setOpen(false)} className="rounded-control px-2.5 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
                  Create an account
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
