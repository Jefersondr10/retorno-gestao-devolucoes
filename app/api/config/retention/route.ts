import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';
import { getRetentionOverview, runRetentionCleanup, saveRetentionPolicy } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'], csrf: false });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    return Response.json({ item: await getRetentionOverview(auth.user.organizationId) });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar a política de retenção.', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const body = (await request.json()) as {
      automaticEnabled?: boolean;
      photoRetentionDays?: number;
      returnRetentionDays?: number;
    };
    const photoRetentionDays = Number(body.photoRetentionDays);
    const returnRetentionDays = Number(body.returnRetentionDays);
    if (!Number.isInteger(photoRetentionDays) || photoRetentionDays < 7 || photoRetentionDays > 3650) {
      return apiError('O prazo dos arquivos deve ficar entre 7 e 3650 dias.', 422);
    }
    if (!Number.isInteger(returnRetentionDays) || returnRetentionDays < 30 || returnRetentionDays > 3650) {
      return apiError('O prazo dos registros deve ficar entre 30 e 3650 dias.', 422);
    }
    if (returnRetentionDays < photoRetentionDays) {
      return apiError('O registro completo não pode ser excluído antes das fotos e vídeos.', 422);
    }
    const item = await saveRetentionPolicy(auth.user.organizationId, {
      automaticEnabled: body.automaticEnabled === true,
      photoRetentionDays,
      returnRetentionDays,
    });
    const { db } = getBindings();
    const now = new Date().toISOString();
    await db
      .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'RETENTION_UPDATED', ?, ?)")
      .bind(crypto.randomUUID(), auth.user.organizationId, actorLabel(auth.user), JSON.stringify(item), now)
      .run();
    return Response.json({ item });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível salvar a política de retenção.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const result = await runRetentionCleanup({ organizationId: auth.user.organizationId, force: true, actor: actorLabel(auth.user) });
    return Response.json(result);
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível executar a limpeza agora.', 500);
  }
}
