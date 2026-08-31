import type { Metadata } from 'next';

import { ReturnWorkspace } from '@/components/return-workspace';

export const metadata: Metadata = {
  title: 'Gerenciar devolução · Retorno',
  description: 'Revise fotos, classifique os produtos e finalize a devolução.',
};

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnWorkspace returnId={id} />;
}
