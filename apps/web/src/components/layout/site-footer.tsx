import Link from 'next/link';
import { Icon } from '@/components/ui/icon';

export function SiteFooter({ configuration }: { configuration?: { media: string; stolenCheck: string } }) {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[0.5rem] bg-brand-600 text-white">
              <Icon name="arrow-swap" size={16} strokeWidth={2.25} />
            </span>
            <span className="text-[0.9375rem] font-semibold tracking-tight text-ink-900">
              SWAP<span className="text-brand-600">MART</span>
            </span>
          </div>
          <p className="mt-3 text-sm text-ink-600">
            A peer-to-peer recommerce marketplace for second-hand consumer electronics in Tanzania, with structured
            device verification and administrator review.
          </p>
        </div>
        <FooterColumn
          title="Marketplace"
          links={[
            { href: '/search', label: 'Browse listings' },
            { href: '/categories/smartphones', label: 'Smartphones' },
            { href: '/categories/laptops', label: 'Laptops' },
            { href: '/categories/gaming-consoles', label: 'Gaming consoles' },
          ]}
        />
        <FooterColumn
          title="Trust & safety"
          links={[
            { href: '/how-verification-works', label: 'How verification works' },
            { href: '/rules', label: 'Marketplace rules' },
            { href: '/privacy', label: 'Data & privacy notice' },
            { href: '/report', label: 'Report a listing' },
          ]}
        />
        <FooterColumn
          title="Account"
          links={[
            { href: '/register', label: 'Create an account' },
            { href: '/signin', label: 'Sign in' },
            { href: '/dashboard', label: 'Seller dashboard' },
          ]}
        />
      </div>
      <div className="border-t border-line px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs text-ink-500">
          <p>
            &copy; {new Date().getFullYear()} SWAPMART (final-year project demonstration). Prices are shown in Tanzanian
            shillings. SWAPMART does not process payments and does not take custody of devices.
          </p>
          <p className="flex flex-wrap items-center gap-3">
            <span>Media storage: {configuration?.media ?? 'local disk'}</span>
            <span>Stolen-device check: {configuration?.stolenCheck ?? 'not configured'}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h3>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-sm text-ink-700 transition-colors hover:text-brand-700">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
