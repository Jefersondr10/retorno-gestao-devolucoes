import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Retorno — Gestão de devoluções',
    short_name: 'Retorno',
    description: 'Receba, classifique e finalize devoluções com segurança.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f3faf7',
    theme_color: '#0d6053',
    lang: 'pt-BR',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Devoluções',
        short_name: 'Devoluções',
        description: 'Abrir as devoluções da empresa',
        url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        ],
      },
      {
        name: 'Nova devolução',
        short_name: 'Receber',
        description: 'Registrar uma devolução com fotos ou vídeo',
        url: '/receber',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        ],
      },
    ],
  };
}
