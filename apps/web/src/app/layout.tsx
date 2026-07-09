import type { Metadata, Viewport } from 'next';
import { Montserrat, Poppins } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';

const headingFont = Poppins({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-heading',
});

const bodyFont = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
});

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
      <body className={`${headingFont.variable} ${bodyFont.variable} bg-surface font-sans text-ink antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-2xl focus:bg-brand-500 focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-soft focus:outline-none"
        >
          Saltar al contenido principal
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
