import { redirect } from 'next/navigation';

import { Dashboard } from '@/components/dashboard';
import { requirePageUser } from '@/lib/auth-page';
import { getFirstAllowedRoute, hasUserPermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requirePageUser();
  if (!hasUserPermission(user, 'returns.view')) redirect(getFirstAllowedRoute(user));
  return <Dashboard currentUser={user} />;
}
