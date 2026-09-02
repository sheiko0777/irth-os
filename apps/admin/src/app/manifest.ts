import type { MetadataRoute } from 'next';

// Drives the Android/Chrome "Add to Home Screen" icon + name — iOS reads
// apple-icon.png (app/apple-icon.png) and the appleWebApp metadata in
// [locale]/layout.tsx instead, Apple never consults this file.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'إرث | IRTH',
    short_name: 'إرث',
    description: 'نظام إدارة الأعمال لإرث',
    start_url: '/',
    display: 'standalone',
    background_color: '#060a10',
    theme_color: '#060a10',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
