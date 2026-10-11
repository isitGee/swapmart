import { redirect } from 'next/navigation';
import { AppShell, type NavItem } from '@/components/layout/app-shell';
import { ButtonLink } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/server-api';

export const metadata = { title: 'Seller dashboard' };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/signin?next=/dashboard');

  const items: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: 'grid', exact: true, section: 'Selling' },
    { href: '/dashboard/listings', label: 'My listings', icon: 'list' },
    { href: '/dashboard/exchanges', label: 'Exchange requests', icon: 'arrow-swap' },
    { href: '/dashboard/transactions', label: 'Transactions', icon: 'handshake' },
    { href: '/dashboard/messages', label: 'Messages', icon: 'message', badge: user.unreadMessages, section: 'Communication' },
    { href: '/dashboard/notifications', label: 'Notifications', icon: 'bell', badge: user.unreadNotifications },
    { href: '/dashboard/saved', label: 'Saved listings', icon: 'bookmark', section: 'Buying' },
    { href: '/dashboard/reports', label: 'My reports', icon: 'flag', section: 'Trust & safety' },
    { href: '/dashboard/disputes', label: 'Disputes', icon: 'scale' },
    { href: '/dashboard/settings', label: 'Profile & security', icon: 'settings', section: 'Account' },
  ];

  if (user.role === 'admin') {
    items.push({ href: '/admin', label: 'Administrator console', icon: 'shield-check', section: 'Administration' });
  }

  return (
    <AppShell
      title="Seller dashboard"
      subtitle={user.profile.displayName}
      items={items}
      actions={
        <ButtonLink href="/dashboard/listings/new" variant="primary" icon="plus" size="sm">
          New listing
        </ButtonLink>
      }
    >
      {!user.emailVerified ? (
        <div className="rounded-card border border-warning-600/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Your email address is not verified, so you cannot submit a listing for review yet.{' '}
          <a href="/verify-email" className="font-medium underline">
            Verify it now
          </a>
          .
        </div>
      ) : null}
      {user.accountStatus === 'restricted' ? (
        <div className="rounded-card border border-warning-600/30 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Your account is restricted{user.restrictionReason ? `: ${user.restrictionReason}` : ''}. You can browse and message,
          but new listings and exchange proposals are blocked until an administrator lifts the restriction.
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
