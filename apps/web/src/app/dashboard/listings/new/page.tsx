import type { BrandDto, CategoryDto } from '@swapmart/shared';
import { Alert, PageHeader } from '@/components/ui/feedback';
import { serverFetchSafe } from '@/lib/server-api';
import { getCurrentUser } from '@/lib/server-api';
import { ListingForm } from './listing-form';

export const metadata = { title: 'Create a listing' };

export default async function NewListingPage() {
  const [user, categories, brands] = await Promise.all([
    getCurrentUser(),
    serverFetchSafe<CategoryDto[]>('/categories', []),
    serverFetchSafe<BrandDto[]>('/brands', []),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="New listing"
        title="Sell a device"
        description="Photographs and evidence are uploaded first, then the submission is checked automatically and reviewed by an administrator. Nothing is published until it is approved."
      />

      {!user?.capabilities.canCreateListing ? (
        <Alert tone="warning" title="You cannot create listings at the moment">
          Either your email address is not verified, or your account is {user?.accountStatus ?? 'restricted'}. Resolve that
          first and this form will start working.
        </Alert>
      ) : null}

      <ListingForm categories={categories} brands={brands} />
    </div>
  );
}
