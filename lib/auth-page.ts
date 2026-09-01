import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSessionUserFromCookie, type AuthUser, type UserRole } from '@/lib/auth';

export async function getPageUser() {
  const cookieStore = await cookies();
  return getSessionUserFromCookie(cookieStore.toString());
}

export async function requirePageUser(options: { roles?: UserRole[]; allowPasswordChange?: boolean } = {}): Promise<AuthUser> {
  const user = await getPageUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword && !options.allowPasswordChange) redirect('/alterar-senha');
  if (options.roles && !options.roles.includes(user.role)) redirect('/');
  return user;
}

