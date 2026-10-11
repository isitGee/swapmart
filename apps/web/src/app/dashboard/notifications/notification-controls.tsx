'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api';
import { Button, IconButton } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

export function NotificationControls({ unreadIds, compact = false }: { unreadIds: string[]; compact?: boolean }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function markRead(body: { ids?: string[]; all?: boolean }) {
    setPending(true);
    try {
      await apiPost('/notifications/read', body);
      toast.success('Marked as read.');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (unreadIds.length === 0) return null;

  if (compact) {
    return (
      <IconButton
        icon="check"
        label="Mark this notification as read"
        onClick={() => void markRead({ ids: unreadIds })}
        loading={pending}
      />
    );
  }

  return (
    <Button variant="secondary" size="sm" icon="check" onClick={() => void markRead({ all: true })} loading={pending}>
      Mark all as read
    </Button>
  );
}
