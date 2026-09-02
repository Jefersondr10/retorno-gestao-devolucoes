import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SignupForm } from '@/components/signup-form';
import { safeReturnPath } from '@/lib/auth';
import { getPageUser } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Criar conta · Retorno',
  description: 'Crie o ambiente da sua empresa no sistema de gestão de devoluções.',
  robots: { index: false, follow: false },
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ returnTo?: string; google?: string }> }) {
  const parameters = await searchParams;
  const destination = safeReturnPath(parameters.returnTo);
  const user = await getPageUser();
  if (user) redirect(user.mustChangePassword ? '/alterar-senha' : destination);
  return <SignupForm returnTo={destination} googleOnboarding={parameters.google === '1'} />;
}
