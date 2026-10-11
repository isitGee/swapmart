'use client';

import { useState } from 'react';
import type { MediaAssetDto } from '@swapmart/shared';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/icon';

/**
 * Product image gallery. Thumbnails are keyboard reachable, and the selected
 * image is announced through `aria-current` rather than colour alone.
 */
export function ImageGallery({ images, title }: { images: MediaAssetDto[]; title: string }) {
  const [index, setIndex] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-card border border-line bg-surface-sunken text-ink-400">
        <div className="text-center">
          <Icon name="image" size={30} className="mx-auto" />
          <p className="mt-2 text-xs">No photographs were supplied for this listing</p>
        </div>
      </div>
    );
  }

  const active = images[Math.min(index, images.length - 1)];

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-card border border-line bg-surface-sunken">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active?.url}
          alt={`${title} — photograph ${Math.min(index, images.length - 1) + 1} of ${images.length}`}
          className="aspect-[4/3] w-full object-contain"
        />
        {images.length > 1 ? (
          <>
            <GalleryNav
              direction="previous"
              onClick={() => setIndex((value) => (value - 1 + images.length) % images.length)}
            />
            <GalleryNav direction="next" onClick={() => setIndex((value) => (value + 1) % images.length)} />
            <span className="absolute bottom-3 right-3 rounded-full bg-ink-900/70 px-2.5 py-1 text-xs font-medium text-white">
              {index + 1} / {images.length}
            </span>
          </>
        ) : null}
      </div>

      {images.length > 1 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, imageIndex) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setIndex(imageIndex)}
                aria-current={imageIndex === index ? 'true' : undefined}
                aria-label={`Show photograph ${imageIndex + 1}`}
                className={cn(
                  'h-16 w-20 overflow-hidden rounded-control border-2 transition-colors',
                  imageIndex === index ? 'border-brand-600' : 'border-transparent hover:border-line-strong',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function GalleryNav({ direction, onClick }: { direction: 'previous' | 'next'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 rounded-full border border-line bg-surface/95 p-2 text-ink-700 shadow-soft transition-colors hover:bg-surface',
        direction === 'previous' ? 'left-3' : 'right-3',
      )}
    >
      <Icon name={direction === 'previous' ? 'chevron-left' : 'chevron'} size={16} />
      <span className="sr-only">{direction === 'previous' ? 'Previous photograph' : 'Next photograph'}</span>
    </button>
  );
}
