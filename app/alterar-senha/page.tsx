import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

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
  if (!user.passwordLoginEnabled) redirect('/');
  return <ChangePasswordForm user={user} />;
}
