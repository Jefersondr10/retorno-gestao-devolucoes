import type { Metadata } from 'next';

import { ChangePasswordForm } from '@/components/change-password-form';
import { requirePageUser } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Trocar senha · Retorno',
  description: 'Atualize sua senha de acesso.',
  robots: { index: false, follow: false },
};

export default async function ChangePasswordPage() {
  const user = await requirePageUser({ allowPasswordChange: true });
  return <ChangePasswordForm user={user} />;
}

