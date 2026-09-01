import type { Metadata } from 'next';

import { MobileReceiptPage } from '@/components/mobile-receipt-page';
import { requirePageUser } from '@/lib/auth-page';

export const metadata: Metadata = {
  title: 'Nova devolução por foto · Retorno',
  description: 'Registre uma devolução rapidamente usando a câmera do celular.',
};

export default async function ReceivePage() {
  const user = await requirePageUser({ roles: ['ADMIN', 'OPERATOR'] });
  return <MobileReceiptPage currentUser={user} />;
}
