import type { NextConfig } from 'next';

/**
 * Everything the browser talks to stays same-origin: `/api/v1/*` and `/media/*`
 * are rewritten to the Express API. That keeps session cookies first-party,
 * avoids CORS in the browser, and means the API never has to be publicly
 * addressable from the client. Only the Next server needs to reach it.
 */
const apiBaseUrl = (process.env.API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Device photographs are served by the API/Cloudinary as already-optimised
  // files; bypassing the image optimiser keeps the deployment free of a native
  // sharp dependency and of remote-pattern allowlists.
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiBaseUrl}/api/v1/:path*` },
      { source: '/media/:path*', destination: `${apiBaseUrl}/media/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default nextConfig;
