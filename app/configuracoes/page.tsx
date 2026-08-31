import type { Metadata } from 'next';

import { SettingsPage } from '@/components/settings-page';

export const metadata: Metadata = {
  title: 'Configurações · Retorno',
  description: 'Configure os status e consulte as regras de gestão de devoluções.',
};

export default function ConfigurationPage() {
  return <SettingsPage />;
}
