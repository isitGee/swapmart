'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionDto } from '@swapmart/shared';
import { apiDelete, apiPost, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, Panel } from '@/components/ui/feedback';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatRelative } from '@/lib/format';

export function SecurityPanel({ sessions }: { sessions: SessionDto[] }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivatePassword, setDeactivatePassword] = useState('');
  const [deactivateReason, setDeactivateReason] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivatePending, setDeactivatePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    setPasswordPending(true);
    setPasswordError(null);
    try {
      await apiPost('/auth/password/change', { currentPassword, newPassword });
      toast.success('Password changed. Other sessions were signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      router.refresh();
    } catch (caught) {
      setPasswordError(caught instanceof ApiError && caught.fieldErrors.newPassword ? caught.fieldErrors.newPassword : errorMessage(caught));
    } finally {
      setPasswordPending(false);
    }
  }

  async function revoke(sessionId: string) {
    setError(null);
    try {
      await apiDelete(`/auth/sessions/${sessionId}`);
      toast.success('Session revoked.');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function deactivate() {
    setDeactivatePending(true);
    setError(null);
    try {
      await apiPost('/auth/account/deactivate', {
        password: deactivatePassword,
        ...(deactivateReason.trim() ? { reason: deactivateReason.trim() } : {}),
      });
      toast.success('Account deactivated. You have been signed out.');
      router.push('/');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeactivatePending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Change password" description="Changing your password signs out every other device.">
        <form onSubmit={changePassword} className="flex flex-col gap-3" noValidate>
          <Field label="Current password" htmlFor="currentPassword" required>
            <Input
              id="currentPassword"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password" htmlFor="newPassword" required>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label="Confirm new password"
            htmlFor="confirmPassword"
            error={confirmPassword && confirmPassword !== newPassword ? 'Passwords do not match' : null}
            required
          >
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {passwordError ? <Alert tone="danger">{passwordError}</Alert> : null}
          <Button type="submit" variant="primary" icon="lock" loading={passwordPending} className="self-start">
            Change password
          </Button>
        </form>
      </Panel>

      <Panel title="Active sessions" description="Every device signed in to your account.">
        <ul className="divide-y divide-line">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm text-ink-800">
                  {session.current ? 'This device' : (session.userAgent ?? 'Unknown device')}
                  {session.current ? <Badge tone="success" size="sm">Current</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Started {formatDateTime(session.createdAt)} · last active {formatRelative(session.lastSeenAt)} ·{' '}
                  {session.ipAddress ?? 'address unknown'}
                </p>
              </div>
              {!session.current ? (
                <Button variant="ghost" size="sm" icon="logout" onClick={() => void revoke(session.id)}>
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-500">
          Session tokens are stored as SHA-256 hashes. Revoking a session invalidates the token immediately.
        </p>
      </Panel>

      <Panel title="Deactivate account" description="This immediately signs you out everywhere.">
        {!deactivateOpen ? (
          <Button variant="secondary" size="sm" icon="lock" onClick={() => setDeactivateOpen(true)}>
            Deactivate my account
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Alert tone="warning">
              Deactivation does not delete your listings, transactions, reports or audit records — those are retained for
              other members and for the moderation history. Public listings are withdrawn.
            </Alert>
            <Field label="Confirm with your password" htmlFor="deactivatePassword" required>
              <Input
                id="deactivatePassword"
                type="password"
                value={deactivatePassword}
                onChange={(event) => setDeactivatePassword(event.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="Reason (optional)" htmlFor="deactivateReason">
              <Input
                id="deactivateReason"
                value={deactivateReason}
                onChange={(event) => setDeactivateReason(event.target.value)}
                maxLength={300}
              />
            </Field>
            <Checkbox
              id="confirm-deactivate"
              checked={confirmDeactivate}
              onChange={(event) => setConfirmDeactivate(event.target.checked)}
              label="I understand what deactivation does and does not do."
            />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDeactivateOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                icon="lock"
                onClick={deactivate}
                loading={deactivatePending}
                disabled={!confirmDeactivate || deactivatePassword.length === 0}
              >
                Deactivate account
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
