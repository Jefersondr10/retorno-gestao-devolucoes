import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSessionUserFromCookie, type AuthUser, type UserRole } from '@/lib/auth';
import { getFirstAllowedRoute, hasAnyUserPermission, hasUserPermission, type UserPermission } from '@/lib/permissions';

export async function getPageUser() {
  const cookieStore = await cookies();
  return getSessionUserFromCookie(cookieStore.toString());
}

export async function requirePageUser(options: { roles?: UserRole[]; permission?: UserPermission; anyPermissions?: readonly UserPermission[]; allowPasswordChange?: boolean } = {}): Promise<AuthUser> {
  const user = await getPageUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword && !options.allowPasswordChange) redirect('/alterar-senha');
  if (options.roles && !options.roles.includes(user.role)) redirect(getFirstAllowedRoute(user));
  if (options.permission && !hasUserPermission(user, options.permission)) redirect(getFirstAllowedRoute(user));
  if (options.anyPermissions && !hasAnyUserPermission(user, options.anyPermissions)) redirect(getFirstAllowedRoute(user));
  return user;
}
