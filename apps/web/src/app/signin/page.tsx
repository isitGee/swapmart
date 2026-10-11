import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/feedback';
import { getCurrentUser } from '@/lib/server-api';
import { SignInForm } from './signin-form';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(params.next && params.next.startsWith('/') ? params.next : '/dashboard');

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Sign in to SWAPMART</h1>
      <p className="mt-1.5 text-sm text-ink-600">
        Manage your listings, continue conversations and track exchanges and transactions.
      </p>

      {params.reset === 'done' ? (
        <Alert tone="success" className="mt-6" title="Password changed">
          Sign in with your new password.
        </Alert>
      ) : null}

      <div className="sm-card mt-6 p-5">
        <SignInForm nextPath={params.next && params.next.startsWith('/') ? params.next : '/dashboard'} />
      </div>

      <p className="mt-5 text-sm text-ink-600">
        No account yet?{' '}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          Create one
        </Link>
        . Forgot your password?{' '}
        <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
          Reset it
        </Link>
        .
      </p>
    </div>
  );
}
