import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '2X1 Burger Co · Meseros',
    short_name: '2X1 Meseros',
    description: 'Toma de pedidos móvil para mesas y comandas en 2X1 Burger Co.',
    start_url: '/waiter/login',
    scope: '/waiter',
    display: 'standalone',
    background_color: '#F8F8F8',
    theme_color: '#E09F3E',
    lang: 'es-CO',
    orientation: 'portrait',
    categories: ['food', 'business', 'productivity'],
    icons: [
      {
        src: '/pwa/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/pwa/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
