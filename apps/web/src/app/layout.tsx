import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { getCurrentUser, serverFetchSafe } from '@/lib/server-api';
import type { CategoryDto, SystemConfigDto } from '@swapmart/shared';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'SWAPMART — Verified second-hand electronics marketplace in Tanzania',
    template: '%s · SWAPMART',
  },
  description:
    'Buy and sell second-hand smartphones, laptops, tablets, consoles and smartwatches in Tanzania. Listings carry a structured device verification record reviewed by administrators.',
  applicationName: 'SWAPMART',
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, categories, configuration] = await Promise.all([
    getCurrentUser(),
    serverFetchSafe<CategoryDto[]>('/categories', []),
    serverFetchSafe<SystemConfigDto | null>('/system/status', null),
  ]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <ToastProvider>
          <a
            href="#main"
            className="sr-only-focusable absolute left-4 top-3 z-50 rounded-control bg-brand-600 px-3 py-2 text-sm font-medium text-white"
          >
            Skip to main content
          </a>
          <SiteHeader user={user} categories={categories} />
          <main id="main" className="flex-1">
            <Suspense fallback={null}>{children}</Suspense>
          </main>
          <SiteFooter
            configuration={
              configuration
                ? { media: configuration.media.driver, stolenCheck: configuration.stolenCheck.provider }
                : undefined
            }
          />
        </ToastProvider>
      </body>
    </html>
  );
}
