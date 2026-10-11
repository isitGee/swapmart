'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiPost, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const router = useRouter();
  const toast = useToast();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await apiPost<{ role: string }>('/auth/login', { email: email.trim(), password });
      toast.success('Signed in.');
      router.push(result.role === 'admin' && nextPath === '/dashboard' ? '/admin' : nextPath);
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
      <Field label="Email address" htmlFor="email" error={fieldErrors.email} required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          invalid={Boolean(fieldErrors.email)}
          required
        />
      </Field>
      <Field label="Password" htmlFor="password" error={fieldErrors.password} required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          invalid={Boolean(fieldErrors.password)}
          required
        />
      </Field>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Button type="submit" variant="primary" size="lg" block loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
