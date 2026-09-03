import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings, getReturnDetail } from '@/lib/data';
import { completeStorageDeletionEvents, prepareStorageDeletionOutbox, queuedStorageObjects } from '@/lib/retention';
import { getBlockingReasons, updateReturnSchema } from '@/lib/returns';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function nextMutationTimestamp(previous: string) {
  const previousTime = Date.parse(previous);
  return new Date(Math.max(Date.now(), Number.isNaN(previousTime) ? 0 : previousTime + 1)).toISOString();
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { permission: 'returns.view', csrf: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const item = await getReturnDetail(id, auth.user.organizationId);
    if (!item) return apiError('Devolução não encontrada.', 404);
    return Response.json({ item });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar a devolução.', 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { permission: 'returns.edit' });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const current = await getReturnDetail(id, auth.user.organizationId);
    if (!current) return apiError('Devolução não encontrada.', 404);
    if (current.status === 'FINALIZED') {
      return apiError('Esta devolução já foi finalizada e está bloqueada para edição.', 409);
    }

    const requestBody = await request.json().catch(() => null) as unknown;
    const expectedUpdatedAt = requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
      ? (requestBody as { expectedUpdatedAt?: unknown }).expectedUpdatedAt
      : undefined;
    if (typeof expectedUpdatedAt !== 'string' || expectedUpdatedAt !== current.updated_at) {
      return apiError('Esta devolução foi alterada por outra pessoa. Atualize a tela antes de salvar.', 409);
    }
    const parsed = updateReturnSchema.safeParse(requestBody);
    if (!parsed.success) return apiError('Confira os campos informados.', 422, parsed.error.issues);
    const data = parsed.data;
    if (data.status === 'FINALIZED') {
      return apiError('Use a ação “Finalizar devolução” para concluir com segurança.', 422);
    }

    const { db } = getBindings();
    const statusDefinition = await db
      .prepare('SELECT code FROM tenant_status_definitions WHERE organization_id = ? AND code = ? AND (active = 1 OR code = ?)')
      .bind(auth.user.organizationId, data.status, current.status)
      .first();
    if (!statusDefinition) return apiError('Selecione um status válido.', 422);

    const conditionPolicies = await db
      .prepare("SELECT code, active, requires_invoice, requires_notes FROM tenant_config_options WHERE organization_id = ? AND type = 'CONDITION'")
      .bind(auth.user.organizationId)
      .all<{ code: string; active: number; requires_invoice: number; requires_notes: number }>();
    const conditionDefinitions = new Map(conditionPolicies.results.map((condition) => [condition.code, condition]));
    const currentConditionCodes = new Set(current.items.map((item) => item.condition).filter((code): code is string => Boolean(code)));
    for (const product of data.items) {
      if (!product.condition) continue;
      const definition = conditionDefinitions.get(product.condition);
      if (!definition || (!definition.active && !currentConditionCodes.has(product.condition))) {
        return apiError(`${product.product}: selecione uma condição válida.`, 422);
      }
    }

    let nextStatus = data.status;
    const preliminaryReasons = getBlockingReasons({
      store: data.store,
      received_location: data.receivedLocation,
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
        test_result: item.testResult,
      })),
    },
    conditionPolicies.results.filter((condition) => condition.requires_invoice === 0).map((condition) => condition.code),
    conditionPolicies.results.filter((condition) => condition.requires_notes === 1).map((condition) => condition.code));
    if (data.status === 'WAITING_ENTRY' && preliminaryReasons.length === 0) nextStatus = 'READY';

    const actor = actorLabel(auth.user);
    const now = nextMutationTimestamp(current.updated_at);
    const operations: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE returns SET
            store = ?, received_location = ?, received_at = ?, order_id = ?,
            tracking_code = ?, status = ?, notes = ?, invoice_number = ?,
            invoice_date = ?, updated_by = ?, updated_at = ?
           WHERE id = ? AND organization_id = ? AND status <> 'FINALIZED' AND updated_at = ?`,
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
          auth.user.organizationId,
          current.updated_at,
        ),
      db.prepare(`DELETE FROM return_items
        WHERE return_id = ? AND EXISTS (SELECT 1 FROM returns WHERE id = ? AND organization_id = ? AND updated_at = ?)`)
        .bind(id, id, auth.user.organizationId, now),
    ];

    for (const item of data.items) {
      operations.push(
        db
          .prepare(
            `INSERT INTO return_items (
              id, return_id, product, sku, quantity, condition,
              condition_notes, destination, test_result, notes
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM returns WHERE id = ? AND organization_id = ? AND updated_at = ?)`,
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
            id,
            auth.user.organizationId,
            now,
          ),
      );
    }

    operations.push(
      db
        .prepare(
          `INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at)
           SELECT ?, ?, ?, ?, 'UPDATED', ?, ?
           WHERE EXISTS (SELECT 1 FROM returns WHERE id = ? AND organization_id = ? AND updated_at = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          auth.user.organizationId,
          id,
          actor,
          JSON.stringify({ previousStatus: current.status, status: nextStatus, itemCount: data.items.length, invoiceNumber: data.invoiceNumber || null }),
          now,
          id,
          auth.user.organizationId,
          now,
        ),
    );

    const [updateResult] = await db.batch(operations);
    if (!Number(updateResult.meta.changes || 0)) {
      return apiError('Esta devolução foi alterada por outra pessoa. Atualize a tela antes de salvar.', 409);
    }
    return Response.json({ item: await getReturnDetail(id, auth.user.organizationId) });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível salvar as alterações.', 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { permission: 'returns.delete' });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const current = await getReturnDetail(id, auth.user.organizationId);
    if (!current) return apiError('Devolução não encontrada.', 404);
    if (current.status !== 'FINALIZED') {
      return apiError('Somente devoluções finalizadas podem ser excluídas.', 409);
    }
    const body = (await request.json().catch(() => ({}))) as { confirmProtocol?: string };
    if (body.confirmProtocol !== current.protocol) {
      return apiError('Confirme o protocolo para excluir esta devolução.', 422);
    }

    const { db } = getBindings();
    const [photos, videos, pendingVideoDeletions] = await Promise.all([
      db.prepare('SELECT object_key, size FROM return_photos WHERE return_id = ?').bind(id).all<{ object_key: string; size: number }>(),
      db.prepare('SELECT object_key, size FROM return_videos WHERE return_id = ?').bind(id).all<{ object_key: string; size: number }>(),
      db.prepare("SELECT details FROM audit_events WHERE return_id = ? AND action = 'VIDEOS_DELETION_PENDING'").bind(id).all<{ details: string | null }>(),
    ]);
    const objects = [
      ...photos.results.map((photo) => ({ objectKey: photo.object_key, size: Number(photo.size || 0) })),
      ...videos.results.map((video) => ({ objectKey: video.object_key, size: Number(video.size || 0) })),
      ...pendingVideoDeletions.results.flatMap((event) => queuedStorageObjects(event.details)),
    ];

    const now = new Date().toISOString();
    const actor = actorLabel(auth.user);
    const outbox = prepareStorageDeletionOutbox(db, {
      organizationId: auth.user.organizationId,
      objects,
      actor,
      now,
      reason: 'RETURN_DELETED',
      details: {
        returnId: id,
        protocol: current.protocol,
        photoCount: photos.results.length,
        videoCount: videos.results.length,
      },
    });
    await db.batch([
      db
        .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'RETURN_DELETED', ?, ?)")
        .bind(crypto.randomUUID(), auth.user.organizationId, actor, JSON.stringify({ protocol: current.protocol, photoCount: photos.results.length, videoCount: videos.results.length }), now),
      ...outbox.operations,
      db.prepare('DELETE FROM audit_events WHERE return_id = ?').bind(id),
      db.prepare('DELETE FROM return_items WHERE return_id = ?').bind(id),
      db.prepare('DELETE FROM return_photos WHERE return_id = ?').bind(id),
      db.prepare('DELETE FROM return_videos WHERE return_id = ?').bind(id),
      db.prepare('DELETE FROM returns WHERE id = ? AND organization_id = ?').bind(id, auth.user.organizationId),
    ]);
    const completedStorageEvents = await completeStorageDeletionEvents(outbox.events);
    const storagePending = completedStorageEvents < outbox.events.length;
    return Response.json({ deleted: true, protocol: current.protocol, storagePending }, { status: storagePending ? 202 : 200 });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível excluir a devolução.', 500);
  }
}
