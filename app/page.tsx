import { Dashboard } from '@/components/dashboard';
import { requirePageUser } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requirePageUser();
  return <Dashboard currentUser={user} />;
}
