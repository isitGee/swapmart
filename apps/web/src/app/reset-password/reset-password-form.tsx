'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function ResetPasswordForm({ initialToken }: { initialToken: string }) {
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const toast = useToast();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setError('The two passwords do not match.');
      return;
    }
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiPost('/auth/password/reset', { token: token.trim(), password });
      toast.success('Password changed.');
      router.push('/signin?reset=done');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Reset token" htmlFor="token" hint="From the email link" error={fieldErrors.token} required>
        <Input
          id="token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="font-mono text-xs"
          required
        />
      </Field>
      <Field label="New password" htmlFor="password" error={fieldErrors.password} required>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          invalid={Boolean(fieldErrors.password)}
          required
        />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmation" error={confirmation && password !== confirmation ? 'Passwords do not match' : null} required>
        <Input
          id="confirmation"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="new-password"
          invalid={Boolean(confirmation) && confirmation !== password}
          required
        />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        Set new password
      </Button>
    </form>
  );
}
