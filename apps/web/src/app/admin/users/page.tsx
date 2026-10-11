import Link from 'next/link';
import type { AdminUserDto } from '@swapmart/shared';
import { AccountStatusBadge, Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Panel, Table, Td, Th } from '@/components/ui/feedback';
import { serverFetchPage } from '@/lib/server-api';
import { formatNumber, formatRelative } from '@/lib/format';
import { UserActions } from './user-actions';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; role?: string; sort?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  let result;
  try {
    result = await serverFetchPage<AdminUserDto>('/admin/users', {
      params: {
        page,
        perPage: 25,
        q: params.q,
        status: params.status,
        role: params.role,
        sort: params.sort ?? 'newest',
      },
    });
  } catch (error) {
    return (
      <ErrorState
        title="Members could not be loaded"
        message={error instanceof Error ? error.message : undefined}
        retry={<ButtonLink href="/admin/users" variant="secondary">Retry</ButtonLink>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Membership"
        title="Members"
        description="Account status changes take effect immediately: suspending an account revokes its sessions and blocks sign-in. Every change records a reason and is audited."
      />

      <form action="/admin/users" method="get" className="flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={params.q ?? ''}
          placeholder="Search name, email or phone"
          className="sm-input max-w-md"
          aria-label="Search members"
        />
        <select name="status" defaultValue={params.status ?? ''} className="sm-input max-w-40" aria-label="Account status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="restricted">Restricted</option>
          <option value="suspended">Suspended</option>
          <option value="deactivated">Deactivated</option>
        </select>
        <select name="role" defaultValue={params.role ?? ''} className="sm-input max-w-36" aria-label="Role">
          <option value="">Any role</option>
          <option value="user">Member</option>
          <option value="admin">Administrator</option>
        </select>
        <select name="sort" defaultValue={params.sort ?? 'newest'} className="sm-input max-w-44" aria-label="Sort">
          <option value="newest">Newest members</option>
          <option value="oldest">Oldest members</option>
          <option value="reports">Most reported</option>
        </select>
        <button type="submit" className="inline-flex h-10 items-center rounded-control bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
          Apply
        </button>
      </form>

      {result.data.length === 0 ? (
        <div className="sm-card">
          <EmptyState icon="users" title="No members match" description="Adjust the search or filters." />
        </div>
      ) : (
        <Panel bodyClassName="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Status</Th>
                <Th className="text-right">Listings</Th>
                <Th className="text-right">Reports</Th>
                <Th className="text-right">Transactions</Th>
                <Th>Last sign-in</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {result.data.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-surface-muted">
                  <Td>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                        {user.fullName}
                        {user.role === 'admin' ? <Badge size="sm" tone="brand">Administrator</Badge> : null}
                        {user.identityReviewedAt ? <Badge size="sm" tone="success">Identity reviewed</Badge> : null}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {user.email}
                        {user.region ? ` · ${user.region}` : ''}
                        {user.emailVerified ? '' : ' · email unverified'}
                      </p>
                      {user.restrictionReason ? (
                        <p className="mt-0.5 text-xs text-warning-700">Restricted: {user.restrictionReason}</p>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <AccountStatusBadge status={user.accountStatus} />
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(user.listingCount)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(user.reportCountAgainst)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(user.transactionCount)}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Never'}
                  </Td>
                  <Td>
                    <UserActions user={user} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-500">
            <span>{formatNumber(result.meta.total)} members</span>
            <span className="flex gap-2">
              {result.meta.hasPreviousPage ? (
                <Link href={`/admin/users?page=${page - 1}`} className="font-medium text-brand-700 hover:underline">
                  Previous
                </Link>
              ) : null}
              {result.meta.hasNextPage ? (
                <Link href={`/admin/users?page=${page + 1}`} className="font-medium text-brand-700 hover:underline">
                  Next
                </Link>
              ) : null}
            </span>
          </div>
        </Panel>
      )}
    </div>
  );
}
