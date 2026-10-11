'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiDelete, apiPost, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/** Saves or unsaves a listing. Unsigned visitors are sent to the sign-in page. */
export function SaveListingButton({
  listingId,
  saved,
  signedIn,
  size = 'md',
}: {
  listingId: string;
  saved: boolean;
  signedIn: boolean;
  size?: 'sm' | 'md';
}) {
  const [optimistic, setOptimistic] = useState(saved);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function toggle() {
    if (!signedIn) {
      router.push(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setPending(true);
    const next = !optimistic;
    setOptimistic(next);
    try {
      if (next) await apiPost('/listings/' + listingId + '/save', { listingId });
      else await apiDelete(`/listings/${listingId}/save`);
      toast.success(next ? 'Listing saved to your dashboard.' : 'Listing removed from your saved list.');
      router.refresh();
    } catch (error) {
      setOptimistic(!next);
      if (error instanceof ApiError && error.isAuthError) {
        router.push(`/signin?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant={optimistic ? 'primary' : 'secondary'}
      size={size}
      icon="bookmark"
      onClick={toggle}
      loading={pending}
      aria-pressed={optimistic}
    >
      {optimistic ? 'Saved' : 'Save'}
    </Button>
  );
}
