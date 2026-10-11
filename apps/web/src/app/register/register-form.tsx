'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TANZANIA_REGIONS } from '@swapmart/shared';
import { apiPost, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

interface RegistrationResult {
  userId: string;
  email: string;
  verificationRequired: boolean;
  verificationEmailDelivered: boolean;
  notice: string | null;
}

const PASSWORD_RULES = [
  'At least 10 characters',
  'Contains an uppercase and a lowercase letter',
  'Contains a number',
];

export function RegisterForm() {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    region: '',
  });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const toast = useToast();

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const payload = {
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        acceptTerms: true,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.region ? { region: form.region } : {}),
      };
      const response = await apiPost<RegistrationResult>('/auth/register', payload);
      setResult(response);
      toast.success('Account created.');
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Account created">
          We sent a verification link to <span className="font-medium">{result.email}</span>.
          {!result.verificationEmailDelivered ? (
            <span className="mt-1 block text-warning-700">
              The email could not be delivered because no SMTP transport is configured on this deployment.
              {result.notice ? ` ${result.notice}` : ''}
            </span>
          ) : null}
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/verify-email?email=${encodeURIComponent(result.email)}`}
            className="inline-flex h-10 items-center rounded-control bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            Verify my email address
          </Link>
          <Link
            href="/signin"
            className="inline-flex h-10 items-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink-800 hover:bg-surface-muted"
          >
            Continue to sign in
          </Link>
        </div>

        <p className="text-xs text-ink-500">
          You can sign in before verifying, but you cannot submit a listing for review until your email address is verified.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Full name" htmlFor="fullName" error={fieldErrors.fullName} required>
        <Input
          id="fullName"
          value={form.fullName}
          onChange={(event) => update('fullName', event.target.value)}
          autoComplete="name"
          invalid={Boolean(fieldErrors.fullName)}
          required
        />
      </Field>

      <Field label="Email address" htmlFor="email" error={fieldErrors.email} required>
        <Input
          id="email"
          type="email"
          value={form.email}
          onChange={(event) => update('email', event.target.value)}
          autoComplete="username"
          invalid={Boolean(fieldErrors.email)}
          required
        />
      </Field>

      <Field label="Password" htmlFor="password" error={fieldErrors.password} required>
        <Input
          id="password"
          type="password"
          value={form.password}
          onChange={(event) => update('password', event.target.value)}
          autoComplete="new-password"
          invalid={Boolean(fieldErrors.password)}
          required
        />
      </Field>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        {PASSWORD_RULES.map((rule) => (
          <li key={rule} className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-ink-400" />
            {rule}
          </li>
        ))}
      </ul>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone number" htmlFor="phone" hint="Optional, Tanzanian format" error={fieldErrors.phone}>
          <Input
            id="phone"
            value={form.phone}
            onChange={(event) => update('phone', event.target.value)}
            placeholder="+255 7XX XXX XXX"
            autoComplete="tel"
          />
        </Field>
        <Field label="Region" htmlFor="region" hint="Optional" error={fieldErrors.region}>
          <Select id="region" value={form.region} onChange={(event) => update('region', event.target.value)}>
            <option value="">Select a region…</option>
            {TANZANIA_REGIONS.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Checkbox
        id="acceptTerms"
        checked={acceptTerms}
        onChange={(event) => setAcceptTerms(event.target.checked)}
        label={
          <>
            I accept the{' '}
            <Link href="/rules" className="font-medium text-brand-700 underline">
              marketplace rules
            </Link>{' '}
            and the{' '}
            <Link href="/privacy" className="font-medium text-brand-700 underline">
              data and privacy notice
            </Link>
            .
          </>
        }
        description="Registration requires this confirmation; it is recorded against your account."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Button type="submit" variant="primary" size="lg" block loading={pending} disabled={!acceptTerms}>
        Create account
      </Button>
    </form>
  );
}
