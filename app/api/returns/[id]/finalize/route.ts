import { actorFrom, apiError, ensureSchema, getBindings, getReturnDetail } from '@/lib/data';
import { getBlockingReasons } from '@/lib/returns';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    await ensureSchema();
    const { id } = await context.params;
    const item = await getReturnDetail(id);
    if (!item) return apiError('Devolução não encontrada.', 404);
    if (item.status === 'FINALIZED') return Response.json({ item });

    const blockingReasons = getBlockingReasons(item);
    if (blockingReasons.length) {
      return apiError('A devolução ainda não pode ser finalizada.', 422, { blockingReasons });
    }

    const { db } = getBindings();
    const actor = actorFrom(request);
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `UPDATE returns SET status = 'FINALIZED', finalized_by = ?, finalized_at = ?,
           updated_by = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(actor, now, actor, now, id),
      db
        .prepare(
          `INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
           VALUES (?, ?, ?, 'FINALIZED', ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, actor, JSON.stringify({ invoiceNumber: item.invoice_number }), now),
    ]);
    return Response.json({ item: await getReturnDetail(id) });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível finalizar a devolução.', 500);
  }
}
