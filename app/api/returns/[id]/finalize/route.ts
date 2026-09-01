import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings, getReturnDetail } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function nextMutationTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isNaN(previousTime) ? 0 : previousTime + 1)).toISOString();
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN', 'OPERATOR'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const item = await getReturnDetail(id);
    if (!item) return apiError('Devolução não encontrada.', 404);
    if (item.status === 'FINALIZED') return Response.json({ item });

    const requestBody = await request.json().catch(() => null) as unknown;
    const expectedUpdatedAt = requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
      ? (requestBody as { expectedUpdatedAt?: unknown }).expectedUpdatedAt
      : undefined;
    if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt !== item.updated_at) {
      return apiError('Esta devolução foi alterada por outra pessoa. Atualize a tela antes de finalizar.', 409);
    }

    const blockingReasons = item.blockingReasons;
    if (blockingReasons.length) {
      return apiError('A devolução ainda não pode ser finalizada.', 422, { blockingReasons });
    }

    const { db } = getBindings();
    const actor = actorLabel(auth.user);
    const now = nextMutationTimestamp(item.updated_at);
    const [updateResult] = await db.batch([
      db
        .prepare(
          `UPDATE returns SET status = 'FINALIZED', finalized_by = ?, finalized_at = ?,
           updated_by = ?, updated_at = ?
           WHERE id = ? AND status <> 'FINALIZED' AND updated_at = ?`,
        )
        .bind(actor, now, actor, now, id, item.updated_at),
      db
        .prepare(
          `INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
           SELECT ?, ?, ?, 'FINALIZED', ?, ?
           WHERE EXISTS (SELECT 1 FROM returns WHERE id = ? AND status = 'FINALIZED' AND updated_at = ?)`,
        )
        .bind(crypto.randomUUID(), id, actor, JSON.stringify({ invoiceNumber: item.invoice_number }), now, id, now),
    ]);
    if (!Number(updateResult.meta.changes || 0)) {
      return apiError('Esta devolução foi alterada por outra pessoa. Atualize a tela antes de finalizar.', 409);
    }
    return Response.json({ item: await getReturnDetail(id) });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível finalizar a devolução.', 500);
  }
}
