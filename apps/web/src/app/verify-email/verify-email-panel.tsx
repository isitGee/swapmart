'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, Panel, UnavailableState } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

interface OutboxEntry {
  subject: string;
  bodyText: string;
  template: string;
  notice: string;
}

export function VerifyEmailPanel({
  initialEmail,
  token,
  devOutboxAvailable,
  emailTransport,
}: {
  initialEmail: string;
  token: string;
  devOutboxAvailable: boolean;
  emailTransport: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [manualToken, setManualToken] = useState(token);
  const [outbox, setOutbox] = useState<OutboxEntry | null>(null);
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const extractedToken = outbox ? extractToken(outbox.bodyText) : null;

  useEffect(() => {
    if (token) void confirm(token, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function requestLink() {
    if (!email.trim()) {
      setError('Enter the email address you registered with.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await apiPost<{ message: string }>('/auth/email/verify', { email: email.trim() });
      setMessage(result.message);
      if (devOutboxAvailable) await loadOutbox(email.trim());
      toast.success('Verification request recorded.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  async function loadOutbox(address: string) {
    setOutboxError(null);
    try {
      const entry = await apiGet<OutboxEntry>('/dev/email-outbox', { email: address, template: 'verify_email' });
      setOutbox(entry);
    } catch (caught) {
      setOutbox(null);
      setOutboxError(caught instanceof ApiError ? caught.message : errorMessage(caught));
    }
  }

  function extractToken(body: string): string | null {
    const match = body.match(/token=([A-Za-z0-9._~-]+)/);
    return match?.[1] ?? null;
  }

  async function confirm(value: string, automatic = false) {
    if (!value) {
      setError('Paste the verification token from your email.');
      return;
    }
    setConfirmPending(true);
    setError(null);
    try {
      await apiPost('/auth/email/confirm', { token: value.trim() });
      toast.success('Email address verified.');
      setMessage('Your email address is verified. You can now submit listings for review.');
      router.refresh();
    } catch (caught) {
      if (!automatic) setError(errorMessage(caught));
      else setError(`The link in your email could not be used: ${errorMessage(caught)}`);
    } finally {
      setConfirmPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Request a verification link">
        <div className="flex flex-col gap-3">
          <Field label="Email address" htmlFor="verify-email" required>
            <Input
              id="verify-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon="mail" onClick={requestLink} loading={pending}>
              Send verification link
            </Button>
            {devOutboxAvailable ? (
              <Button variant="secondary" icon="eye" onClick={() => loadOutbox(email.trim())} disabled={!email.trim()}>
                Show the recorded message
              </Button>
            ) : null}
          </div>
          {message ? <Alert tone="info">{message}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <p className="text-xs text-ink-500">
            The response is identical whether or not an account exists, so this page cannot be used to discover which
            addresses are registered.
          </p>
        </div>
      </Panel>

      <Panel title="Confirm with a token">
        <div className="flex flex-col gap-3">
          <Field label="Verification token" htmlFor="verify-token" hint="From the link in the email" required>
            <Input
              id="verify-token"
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              className="font-mono text-xs"
              placeholder="Paste the token value"
            />
          </Field>
          <div>
            <Button
              variant="primary"
              icon="check"
              onClick={() => confirm(manualToken)}
              loading={confirmPending}
              disabled={!manualToken}
            >
              Verify email address
            </Button>
          </div>
        </div>
      </Panel>

      {devOutboxAvailable ? (
        <Panel title="Development email outbox">
          {outbox ? (
            <div className="flex flex-col gap-3">
              <Alert tone="warning" title={outbox.notice}>
                The message below was recorded, not delivered. This endpoint is disabled when the environment is production.
              </Alert>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-control border border-line bg-surface-muted p-3 font-mono text-xs text-ink-700">
                {outbox.bodyText}
              </pre>
              {extractedToken ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon="check"
                  onClick={() => confirm(extractedToken)}
                  loading={confirmPending}
                  className="self-start"
                >
                  Use the recorded link now
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <UnavailableState
                title="No recorded message to show"
                description={
                  outboxError ??
                  'Request a verification link for an unverified address and the message this deployment recorded will appear here.'
                }
                setupHint={`Email transport: ${emailTransport}`}
              />
            </div>
          )}
        </Panel>
      ) : (
        <UnavailableState
          title="Outbox inspection is unavailable"
          description="This deployment delivers mail through a configured SMTP transport, so recorded messages are not exposed."
          setupHint={`Email transport: ${emailTransport}`}
        />
      )}
    </div>
  );
}
