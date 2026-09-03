import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { PwaProvider } from '@/components/pwa-provider';
import { ReleaseNotice } from '@/components/release-notice';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://devolucoes.nucleodeoperacao.com.br'),
  title: 'Retorno — Gestão de devoluções',
  description: 'Receba, classifique e finalize devoluções com segurança.',
  applicationName: 'Retorno',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Retorno',
    statusBarStyle: 'default',
  },
  openGraph: {
    title: 'Retorno — Gestão de devoluções',
    description: 'Receba, classifique e finalize devoluções com segurança.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Retorno — Gestão de devoluções' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Retorno — Gestão de devoluções',
    description: 'Receba, classifique e finalize devoluções com segurança.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0d6053',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <PwaProvider>
          {children}
          <ReleaseNotice />
        </PwaProvider>
      </body>
    </html>
  );
}
