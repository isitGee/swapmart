'use client';

import { useState } from 'react';
import { apiPost, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, UnavailableState } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

interface ForgotResult {
  requested: boolean;
  emailDelivered: boolean;
  message: string;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ForgotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<ForgotResult>('/auth/password/forgot', { email: email.trim() });
      setResult(response);
      toast.success('Reset request recorded.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" title="Request received">
          {result.message}
        </Alert>
        {!result.emailDelivered ? (
          <UnavailableState
            title="Email delivery is not configured on this deployment"
            description="The reset link exists in the database and an operator can retrieve it from the recorded outbox, but SWAPMART did not pretend to send mail."
            setupHint="Configure SMTP_HOST, SMTP_USER and SMTP_PASSWORD to enable real delivery."
          />
        ) : null}
        <a
          href="/reset-password"
          className="inline-flex h-10 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink-800 hover:bg-surface-muted"
        >
          I have a reset token
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Email address" htmlFor="email" required>
        <Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        Send reset link
      </Button>
    </form>
  );
}
