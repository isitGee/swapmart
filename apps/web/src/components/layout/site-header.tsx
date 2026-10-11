import Link from 'next/link';
import type { CategoryDto, CurrentUserDto } from '@swapmart/shared';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MobileMenu, UserMenu } from './user-menu';

/** Top-level navigation shared by every marketplace page. */
export function SiteHeader({ user, categories }: { user: CurrentUserDto | null; categories: CategoryDto[] }) {
  const topCategories = categories.slice(0, 6);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="SWAPMART home">
          <span className="flex h-7 w-7 items-center justify-center rounded-[0.5rem] bg-brand-600 text-white">
            <Icon name="arrow-swap" size={16} strokeWidth={2.25} />
          </span>
          <span className="text-[0.9375rem] font-semibold tracking-tight text-ink-900">
            SWAP<span className="text-brand-600">MART</span>
          </span>
        </Link>

        <form action="/search" method="get" role="search" className="hidden min-w-0 flex-1 md:block">
          <label htmlFor="header-search" className="sr-only">
            Search listings
          </label>
          <div className="relative">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              id="header-search"
              name="q"
              type="search"
              placeholder="Search phones, laptops, consoles…"
              className="sm-input h-9 pl-9"
              autoComplete="off"
            />
          </div>
        </form>

        <nav aria-label="Categories" className="hidden items-center gap-0.5 lg:flex">
          {topCategories.map((category) => (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className="rounded-control px-2.5 py-1.5 text-[0.8125rem] font-medium text-ink-600 transition-colors hover:bg-surface-sunken hover:text-ink-900"
            >
              {category.name}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <ButtonLink href="/dashboard/listings/new" variant="primary" size="sm" icon="plus" className="hidden sm:inline-flex">
                Sell a device
              </ButtonLink>
              <Link
                href="/dashboard/messages"
                className="relative hidden rounded-control border border-line-strong bg-surface p-2 text-ink-700 transition-colors hover:bg-surface-muted sm:inline-flex"
                aria-label={`Messages${user.unreadMessages > 0 ? `, ${user.unreadMessages} unread` : ''}`}
              >
                <Icon name="message" size={16} />
                {user.unreadMessages > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[0.625rem] font-semibold text-white">
                    {user.unreadMessages > 9 ? '9+' : user.unreadMessages}
                  </span>
                ) : null}
              </Link>
              <UserMenu user={user} />
            </>
          ) : (
            <div className="hidden items-center gap-2 sm:flex">
              <ButtonLink href="/signin" variant="ghost" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/register" variant="primary" size="sm">
                Create account
              </ButtonLink>
            </div>
          )}
          <MobileMenu user={user} categories={categories.map((category) => ({ slug: category.slug, name: category.name }))} />
        </div>
      </div>
    </header>
  );
}
