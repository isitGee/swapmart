import Link from 'next/link';
import { PageHeader } from '@/components/ui/feedback';
import { ResetPasswordForm } from './reset-password-form';

export const metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <PageHeader
        title="Choose a new password"
        description="Setting a new password revokes every existing session, including any session an attacker may hold."
      />
      <div className="sm-card mt-6 p-5">
        <ResetPasswordForm initialToken={params.token ?? ''} />
      </div>
      <p className="mt-5 text-sm text-ink-600">
        <Link href="/signin" className="font-medium text-brand-700 hover:underline">
          Return to sign in
        </Link>
      </p>
    </div>
  );
}
