import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/montserrat';
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import './globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: '2x1 Burger Co | Centro operativo',
  description: 'Inventario, punto de venta, caja y cierre diario para operación de restaurante.',
  applicationName: '2X1 Burger Co',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '2X1 Meseros',
  },
};

export const viewport: Viewport = {
  themeColor: '#E09F3E',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-surface font-sans text-ink antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
