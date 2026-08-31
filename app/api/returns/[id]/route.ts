import { actorFrom, apiError, ensureSchema, getBindings, getReturnDetail } from '@/lib/data';
import { getBlockingReasons, updateReturnSchema } from '@/lib/returns';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const item = await getReturnDetail(id);
    if (!item) return apiError('Devolução não encontrada.', 404);
    return Response.json({ item });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar a devolução.', 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await ensureSchema();
    const { id } = await context.params;
    const current = await getReturnDetail(id);
    if (!current) return apiError('Devolução não encontrada.', 404);
    if (current.status === 'FINALIZED') {
      return apiError('Esta devolução já foi finalizada e está bloqueada para edição.', 409);
    }

    const parsed = updateReturnSchema.safeParse(await request.json());
    if (!parsed.success) return apiError('Confira os campos informados.', 422, parsed.error.issues);
    const data = parsed.data;
    if (data.status === 'FINALIZED') {
      return apiError('Use a ação “Finalizar devolução” para concluir com segurança.', 422);
    }

    const { db } = getBindings();
    const statusDefinition = await db
      .prepare('SELECT code FROM status_definitions WHERE code = ? AND (active = 1 OR code = ?)')
      .bind(data.status, current.status)
      .first();
    if (!statusDefinition) return apiError('Selecione um status válido.', 422);

    const conditionPolicies = await db
      .prepare("SELECT code, requires_invoice, requires_notes FROM config_options WHERE type = 'CONDITION' AND active = 1")
      .all<{ code: string; requires_invoice: number; requires_notes: number }>();

    let nextStatus = data.status;
    const preliminaryReasons = getBlockingReasons({
      store: data.store,
      received_at: data.receivedAt,
      order_id: data.orderId,
      tracking_code: data.trackingCode,
      invoice_number: data.invoiceNumber,
      status: data.status,
      items: data.items.map((item) => ({
        product: item.product,
        quantity: item.quantity,
        condition: item.condition,
        condition_notes: item.conditionNotes,
        destination: item.destination,
      })),
    },
    conditionPolicies.results.filter((condition) => condition.requires_invoice === 0).map((condition) => condition.code),
    conditionPolicies.results.filter((condition) => condition.requires_notes === 1).map((condition) => condition.code));
    if (data.status === 'WAITING_ENTRY' && preliminaryReasons.length === 0) nextStatus = 'READY';

    const actor = actorFrom(request);
    const now = new Date().toISOString();
    const operations: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE returns SET
            store = ?, received_location = ?, received_at = ?, order_id = ?,
            tracking_code = ?, status = ?, notes = ?, invoice_number = ?,
            invoice_date = ?, updated_by = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          data.store,
          data.receivedLocation,
          data.receivedAt,
          data.orderId || null,
          data.trackingCode || null,
          nextStatus,
          data.notes || null,
          data.invoiceNumber || null,
          data.invoiceDate || null,
          actor,
          now,
          id,
        ),
      db.prepare('DELETE FROM return_items WHERE return_id = ?').bind(id),
    ];

    for (const item of data.items) {
      operations.push(
        db
          .prepare(
            `INSERT INTO return_items (
              id, return_id, product, sku, quantity, condition,
              condition_notes, destination, test_result, notes
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            item.id || crypto.randomUUID(),
            id,
            item.product,
            item.sku || null,
            item.quantity,
            item.condition || null,
            item.conditionNotes || null,
            item.destination || null,
            item.testResult || null,
            item.notes || null,
          ),
      );
    }

    operations.push(
      db
        .prepare(
          `INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
           VALUES (?, ?, ?, 'UPDATED', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          actor,
          JSON.stringify({ previousStatus: current.status, status: nextStatus, itemCount: data.items.length, invoiceNumber: data.invoiceNumber || null }),
          now,
        ),
    );

    await db.batch(operations);
    return Response.json({ item: await getReturnDetail(id) });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível salvar as alterações.', 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await ensureSchema();
    const { id } = await context.params;
    const current = await getReturnDetail(id);
    if (!current) return apiError('Devolução não encontrada.', 404);
    if (current.status !== 'FINALIZED') {
      return apiError('Somente devoluções finalizadas podem ser excluídas.', 409);
    }
    const body = (await request.json().catch(() => ({}))) as { confirmProtocol?: string };
    if (body.confirmProtocol !== current.protocol) {
      return apiError('Confirme o protocolo para excluir esta devolução.', 422);
    }

    const { db, files } = getBindings();
    const photos = await db
      .prepare('SELECT object_key FROM return_photos WHERE return_id = ?')
      .bind(id)
      .all<{ object_key: string }>();
    if (photos.results.length) await files.delete(photos.results.map((photo) => photo.object_key));

    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'RETURN_DELETED', ?, ?)")
        .bind(crypto.randomUUID(), actorFrom(request), JSON.stringify({ protocol: current.protocol, photoCount: photos.results.length }), now),
      db.prepare('DELETE FROM audit_events WHERE return_id = ?').bind(id),
      db.prepare('DELETE FROM return_items WHERE return_id = ?').bind(id),
      db.prepare('DELETE FROM return_photos WHERE return_id = ?').bind(id),
      db.prepare('DELETE FROM returns WHERE id = ?').bind(id),
    ]);
    return Response.json({ deleted: true, protocol: current.protocol });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível excluir a devolução.', 500);
  }
}
