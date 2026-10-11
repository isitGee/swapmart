'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminUserDto } from '@swapmart/shared';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

const ACTIONS = [
  { value: 'restrict', label: 'Restrict — block new listings and messages' },
  { value: 'unrestrict', label: 'Lift restriction' },
  { value: 'suspend', label: 'Suspend — revoke sessions and block sign-in' },
  { value: 'reactivate', label: 'Reactivate account' },
  { value: 'verify_identity', label: 'Mark identity as reviewed' },
  { value: 'revoke_identity', label: 'Revoke identity review' },
];

export function UserActions({ user }: { user: AdminUserDto }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('restrict');
  const [reason, setReason] = useState('');
  const [notifyUser, setNotifyUser] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function apply() {
    if (reason.trim().length < 5) {
      setError('Record a reason of at least 5 characters — it is stored in the audit log and shown to the member when you choose to notify them.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost(`/admin/users/${user.id}/status`, { action, reason: reason.trim(), notifyUser });
      toast.success('Account status updated.');
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" icon="settings" onClick={() => setOpen(true)}>
        Manage
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Manage ${user.fullName}`}
        description="This changes what the member can do on SWAPMART immediately. The reason is recorded permanently."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant={action === 'suspend' ? 'danger' : 'primary'} icon="check" onClick={apply} loading={pending}>
              Apply change
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {user.role === 'admin' ? (
            <Alert tone="warning">
              This account is an administrator. Suspend it only if you are certain — an operator will need database access to
              restore it.
            </Alert>
          ) : null}

          <Field label="Action" htmlFor={`action-${user.id}`} required>
            <Select id={`action-${user.id}`} value={action} onChange={(event) => setAction(event.target.value)}>
              {ACTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Reason (recorded in the audit log)" htmlFor={`reason-${user.id}`} required>
            <Textarea
              id={`reason-${user.id}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="e.g. Repeatedly listed a device whose identifier an administrator had already rejected."
            />
          </Field>

          <Checkbox
            id={`notify-${user.id}`}
            checked={notifyUser}
            onChange={(event) => setNotifyUser(event.target.checked)}
            label="Notify the member and show them this reason"
          />

          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}
