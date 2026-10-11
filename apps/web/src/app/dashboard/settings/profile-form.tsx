'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TANZANIA_REGIONS, type CurrentUserDto } from '@swapmart/shared';
import { apiPatch, apiUpload, errorMessage, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Alert, Panel } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function ProfileForm({ user }: { user: CurrentUserDto }) {
  const [displayName, setDisplayName] = useState(user.profile.displayName);
  const [bio, setBio] = useState(user.profile.bio ?? '');
  const [phone, setPhone] = useState(user.profile.phone ?? '');
  const [region, setRegion] = useState(user.profile.region ?? '');
  const [city, setCity] = useState(user.profile.city ?? '');
  const [phoneVisible, setPhoneVisible] = useState(user.profile.phoneVisible);
  const [publicProfile, setPublicProfile] = useState(user.profile.publicProfile);
  const [avatarUrl, setAvatarUrl] = useState(user.profile.avatarUrl);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  async function uploadAvatar(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const asset = await apiUpload<{ id: string; url: string }>('/uploads/avatar', formData);
      setAvatarId(asset.id);
      setAvatarUrl(asset.url);
      toast.success('Photograph uploaded. Save the profile to apply it.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      await apiPatch('/auth/profile', {
        displayName: displayName.trim(),
        bio: bio.trim(),
        region: region || undefined,
        city: city.trim(),
        phoneVisible,
        publicProfile,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(avatarId ? { avatarMediaId: avatarId } : {}),
      });
      setSaved(true);
      toast.success('Profile updated.');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel title="Public profile" description="This is what buyers see on your listings and seller page.">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-lg font-semibold text-brand-700">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              displayName.slice(0, 2).toUpperCase()
            )}
          </span>
          <div>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="hidden"
              onChange={(event) => void uploadAvatar(event.target.files)}
            />
            <Button variant="secondary" size="sm" icon="camera" onClick={() => fileInput.current?.click()} loading={uploading}>
              Change photograph
            </Button>
            <p className="mt-1.5 text-xs text-ink-500">JPEG, PNG, WebP or AVIF up to 2MB.</p>
          </div>
        </div>

        <Field label="Display name" htmlFor="displayName" error={fieldErrors.displayName} required>
          <Input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} />
        </Field>

        <Field label="About you" htmlFor="bio" error={fieldErrors.bio} hint={`${bio.length}/600`}>
          <Textarea
            id="bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={600}
            rows={4}
            placeholder="Tell buyers what you sell and how you prefer to arrange viewings."
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Region" htmlFor="region" error={fieldErrors.region}>
            <Select id="region" value={region} onChange={(event) => setRegion(event.target.value)}>
              <option value="">Not stated</option>
              {TANZANIA_REGIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="City or district" htmlFor="city" error={fieldErrors.city}>
            <Input id="city" value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} />
          </Field>
        </div>

        <Field label="Phone number" htmlFor="phone" error={fieldErrors.phone} hint="Tanzanian format, e.g. +255 712 345 678">
          <Input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
        </Field>

        <div className="flex flex-col gap-2">
          <Checkbox
            id="phoneVisible"
            checked={phoneVisible}
            onChange={(event) => setPhoneVisible(event.target.checked)}
            label="Show my phone number on my public seller page"
            description="When unchecked, buyers can only reach you through SWAPMART messages."
          />
          <Checkbox
            id="publicProfile"
            checked={publicProfile}
            onChange={(event) => setPublicProfile(event.target.checked)}
            label="Allow my seller page to be discovered from my listings"
          />
        </div>

        {saved ? <Alert tone="success">Profile saved.</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex justify-end">
          <Button variant="primary" icon="check" onClick={save} loading={pending}>
            Save profile
          </Button>
        </div>
      </div>
    </Panel>
  );
}
