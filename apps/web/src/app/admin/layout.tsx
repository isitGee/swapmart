import { redirect } from 'next/navigation';
import { AppShell, type NavItem } from '@/components/layout/app-shell';
import { ButtonLink } from '@/components/ui/button';
import { getCurrentUser } from '@/lib/server-api';

export const metadata = { title: 'Administrator console' };

/**
 * The administrator console.
 *
 * Access is decided twice: here (so a signed-in member never sees the console
 * chrome) and, decisively, by `requireAdmin` on every administrator API route.
 * Rendering rules in this layout are a convenience, never the enforcement point.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/signin?next=/admin');
  if (user.role !== 'admin') redirect('/dashboard');

  const items: NavItem[] = [
    { href: '/admin', label: 'Overview', icon: 'gauge', exact: true, section: 'Monitoring' },
    { href: '/admin/listings', label: 'Review queue', icon: 'shield', section: 'Moderation' },
    { href: '/admin/duplicates', label: 'Duplicate alerts', icon: 'layers' },
    { href: '/admin/reports', label: 'Reports', icon: 'flag', section: 'Trust & safety' },
    { href: '/admin/disputes', label: 'Disputes', icon: 'scale' },
    { href: '/admin/transactions', label: 'Transactions', icon: 'handshake', section: 'Marketplace' },
    { href: '/admin/users', label: 'Members', icon: 'users' },
    { href: '/admin/audit', label: 'Audit log', icon: 'list', section: 'Accountability' },
    { href: '/admin/system', label: 'System status', icon: 'settings' },
  ];

  return (
    <AppShell
      title="Administrator console"
      subtitle={user.profile.displayName}
      accent="admin"
      items={items}
      actions={
        <ButtonLink href="/dashboard" variant="secondary" size="sm" icon="arrow-left">
          Seller dashboard
        </ButtonLink>
      }
    >
      {children}
    </AppShell>
  );
}
