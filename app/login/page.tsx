import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/login-form';
import { getPageUser } from '@/lib/auth-page';
import { safeReturnPath } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Entrar · Retorno',
  description: 'Acesso ao sistema de gestão de devoluções com usuário ou conta Google.',
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const parameters = await searchParams;
  const destination = safeReturnPath(parameters.returnTo);
  const user = await getPageUser();
  if (user) redirect(user.mustChangePassword ? '/alterar-senha' : destination);
  return <LoginForm returnTo={destination} />;
}
