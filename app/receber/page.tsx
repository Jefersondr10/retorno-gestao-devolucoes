import type { Metadata } from 'next';

import { MobileReceiptPage } from '@/components/mobile-receipt-page';

export const metadata: Metadata = {
  title: 'Nova devolução por foto · Retorno',
  description: 'Registre uma devolução rapidamente usando a câmera do celular.',
};

export default function ReceivePage() {
  return <MobileReceiptPage />;
}
