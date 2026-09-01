import { authenticateApi } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await authenticateApi(request, { allowPasswordChange: true, csrf: false });
  if ('response' in auth) return auth.response;
  return Response.json({ user: auth.user }, { headers: { 'Cache-Control': 'no-store' } });
}

