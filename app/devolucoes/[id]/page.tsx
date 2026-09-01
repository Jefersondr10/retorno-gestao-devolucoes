import type { Metadata } from 'next';

import { ReturnWorkspace } from '@/components/return-workspace';
import { requirePageUser } from '@/lib/auth-page';

export const metadata: Metadata = {
  title: 'Gerenciar devolução · Retorno',
  description: 'Revise fotos, classifique os produtos e finalize a devolução.',
};

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  return <ReturnWorkspace returnId={id} currentUser={user} />;
}
