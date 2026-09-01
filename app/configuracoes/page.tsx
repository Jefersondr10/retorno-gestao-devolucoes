import type { Metadata } from 'next';

import { SettingsPage } from '@/components/settings-page';
import { requirePageUser } from '@/lib/auth-page';

export const metadata: Metadata = {
  title: 'Configurações · Retorno',
  description: 'Configure os status e consulte as regras de gestão de devoluções.',
};

export default async function ConfigurationPage() {
  const user = await requirePageUser({ roles: ['ADMIN'] });
  return <SettingsPage currentUser={user} />;
}
