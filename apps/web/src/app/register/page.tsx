import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/server-api';
import { RegisterForm } from './register-form';

export const metadata = { title: 'Create an account' };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Create your SWAPMART account</h1>
      <p className="mt-1.5 text-sm text-ink-600">
        One account buys and sells. Registering grants no special privileges — administrator access is provisioned separately
        by an operator and can never be requested through registration.
      </p>

      <div className="sm-card mt-6 p-5">
        <RegisterForm />
      </div>

      <p className="mt-5 text-sm text-ink-600">
        Already registered?{' '}
        <Link href="/signin" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
        .
      </p>
    </div>
  );
}
