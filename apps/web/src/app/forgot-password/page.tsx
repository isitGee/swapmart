import Link from 'next/link';
import { PageHeader } from '@/components/ui/feedback';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata = { title: 'Reset your password' };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <PageHeader
        title="Reset your password"
        description="Enter the email address on your account. If it belongs to a SWAPMART account, a single-use reset link is issued that expires shortly."
      />
      <div className="sm-card mt-6 p-5">
        <ForgotPasswordForm />
      </div>
      <p className="mt-5 text-sm text-ink-600">
        Remembered it?{' '}
        <Link href="/signin" className="font-medium text-brand-700 hover:underline">
          Return to sign in
        </Link>
        .
      </p>
    </div>
  );
}
