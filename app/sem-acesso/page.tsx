import type { Metadata } from 'next';
import { ShieldAlert } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { UserMenu } from '@/components/user-menu';
import { requirePageUser } from '@/lib/auth-page';

export const metadata: Metadata = {
  title: 'Acesso não liberado · Retorno',
  description: 'Consulte o administrador da empresa para liberar um acesso.',
};

export default async function NoAccessPage() {
  const user = await requirePageUser();
  return (
    <main className="app-shell grid min-h-screen place-items-center px-4 py-10 text-foreground">
      <Card className="w-full max-w-lg border-0 bg-card p-6 text-center shadow-[var(--shadow-raised)] ring-border/80 sm:p-8">
        <div className="ml-auto flex justify-end"><UserMenu user={user} /></div>
        <span className="mx-auto mt-2 grid size-14 place-items-center rounded-2xl bg-amber-100 text-amber-800"><ShieldAlert className="size-7" /></span>
        <h1 className="display-title mt-5 text-2xl">Nenhum acesso foi liberado</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Sua conta está ativa, mas ainda não possui uma área disponível. Peça ao administrador de {user.organizationName} para marcar os acessos necessários.
        </p>
      </Card>
    </main>
  );
}
