import { actorFrom, apiError, ensureSchema, getBindings, getReturnDetail } from '@/lib/data';
import { createReturnSchema } from '@/lib/returns';
import { runRetentionCleanup } from '@/lib/retention';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await ensureSchema();
    await runRetentionCleanup().catch((cleanupError) => console.error('Automatic retention cleanup failed', cleanupError));
    const { db } = getBindings();
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim().toLowerCase() || '';
    const status = url.searchParams.get('status')?.trim() || '';
    const includeFinalized = url.searchParams.get('includeFinalized') === 'true';

    const conditions: string[] = [];
    const values: unknown[] = [];
    if (status) {
      conditions.push('r.status = ?');
      values.push(status);
    } else if (!includeFinalized) {
      conditions.push("r.status != 'FINALIZED'");
    }
    if (query) {
      conditions.push(`(
        LOWER(r.protocol) LIKE ? OR
        LOWER(COALESCE(r.store, '')) LIKE ? OR
        LOWER(COALESCE(r.order_id, '')) LIKE ? OR
        LOWER(COALESCE(r.tracking_code, '')) LIKE ? OR
        LOWER(COALESCE(r.invoice_number, '')) LIKE ? OR
        EXISTS (
          SELECT 1 FROM return_items i
          WHERE i.return_id = r.id AND LOWER(i.product) LIKE ?
        )
      )`);
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const statement = db.prepare(
      `SELECT r.*, COALESCE(s.label, r.status) AS status_label,
        COALESCE(s.color, 'slate') AS status_color,
        COALESCE(store_option.color, '#64748b') AS store_color,
        (SELECT COUNT(*) FROM return_items i WHERE i.return_id = r.id) AS item_count,
        (SELECT COUNT(*) FROM return_photos p WHERE p.return_id = r.id) AS photo_count,
        (SELECT p.id FROM return_photos p WHERE p.return_id = r.id ORDER BY p.created_at LIMIT 1) AS first_photo_id
       FROM returns r
       LEFT JOIN status_definitions s ON s.code = r.status
       LEFT JOIN config_options store_option ON store_option.type = 'STORE' AND store_option.label = r.store
       ${where}
       ORDER BY CASE r.status
          WHEN 'PENDING_INFO' THEN 1
          WHEN 'IN_TRIAGE' THEN 2
          WHEN 'WAITING_TEST' THEN 3
          WHEN 'WAITING_ENTRY' THEN 4
          WHEN 'READY' THEN 5
          WHEN 'FINALIZED' THEN 9
          ELSE 6 END,
        r.received_at ASC
       LIMIT 250`,
    );
    const result = values.length ? await statement.bind(...values).all() : await statement.all();
    return Response.json({ items: result.results });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar as devoluções.', 500);
  }
}

export async function POST(request: Request) {
  const uploadedKeys: string[] = [];
  try {
    await ensureSchema();
    const { db, files } = getBindings();
    const actor = actorFrom(request);
    const formData = await request.formData();
    const getText = (name: string) => {
      const value = formData.get(name);
      return typeof value === 'string' ? value : '';
    };

    const parsed = createReturnSchema.safeParse({
      source: getText('source'),
      store: getText('store'),
      receivedLocation: getText('receivedLocation'),
      receivedAt: getText('receivedAt'),
      orderId: getText('orderId'),
      trackingCode: getText('trackingCode'),
      notes: getText('notes'),
      product: getText('product'),
      quantity: getText('quantity') || 1,
    });
    if (!parsed.success) return apiError('Confira os campos informados.', 422, parsed.error.issues);

    const data = parsed.data;
    const photos = formData.getAll('photos').filter((value): value is File => value instanceof File && value.size > 0);
    if (data.source === 'PHOTO' && photos.length === 0) {
      return apiError('Adicione pelo menos uma foto para registrar o recebimento.', 422);
    }
    if (data.source === 'MANUAL' && !data.product.trim()) {
      return apiError('Informe pelo menos um produto no cadastro completo.', 422);
    }
    if (data.source === 'MANUAL' && !data.orderId.trim() && !data.trackingCode.trim()) {
      return apiError('Informe o ID do pedido ou o código de rastreio.', 422);
    }
    if (photos.length > 8) return apiError('Envie no máximo 8 fotos por vez.', 422);
    for (const photo of photos) {
      if (!photo.type.startsWith('image/')) return apiError('Envie somente arquivos de imagem.', 422);
      if (photo.size > 2.5 * 1024 * 1024) return apiError('Cada foto deve ter no máximo 2,5 MB.', 422);
    }

    const duplicateParts: string[] = [];
    const duplicateValues: string[] = [];
    if (data.orderId) {
      duplicateParts.push('order_id = ?');
      duplicateValues.push(data.orderId);
    }
    if (data.trackingCode) {
      duplicateParts.push('tracking_code = ?');
      duplicateValues.push(data.trackingCode);
    }
    let duplicates: Array<{ id: string; protocol: string }> = [];
    if (duplicateParts.length) {
      const duplicateResult = await db
        .prepare(`SELECT id, protocol FROM returns WHERE ${duplicateParts.join(' OR ')} LIMIT 5`)
        .bind(...duplicateValues)
        .all<{ id: string; protocol: string }>();
      duplicates = duplicateResult.results;
    }

    const sequenceResult = await db.prepare('INSERT INTO return_sequences DEFAULT VALUES').run();
    const sequence = Number(sequenceResult.meta.last_row_id);
    const id = crypto.randomUUID();
    const protocol = `DEV-${String(sequence).padStart(6, '0')}`;
    const now = new Date().toISOString();
    const status = data.source === 'PHOTO' ? 'PENDING_INFO' : 'IN_TRIAGE';

    const photoRows: Array<{
      id: string;
      key: string;
      fileName: string;
      contentType: string;
      size: number;
    }> = [];

    for (const photo of photos) {
      const photoId = crypto.randomUUID();
      const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'foto.jpg';
      const key = `returns/${id}/${photoId}-${safeName}`;
      await files.put(key, photo.stream(), { httpMetadata: { contentType: photo.type } });
      uploadedKeys.push(key);
      photoRows.push({ id: photoId, key, fileName: photo.name, contentType: photo.type, size: photo.size });
    }

    const operations = [
      db
        .prepare(
          `INSERT INTO returns (
            id, protocol, store, received_location, received_at, order_id,
            tracking_code, status, notes, source, created_by, created_at,
            updated_by, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          protocol,
          data.store || null,
          data.receivedLocation,
          data.receivedAt,
          data.orderId || null,
          data.trackingCode || null,
          status,
          data.notes || null,
          data.source,
          actor,
          now,
          actor,
          now,
        ),
      db
        .prepare(
          `INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
           VALUES (?, ?, ?, 'CREATED', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          id,
          actor,
          JSON.stringify({ source: data.source, photos: photoRows.length, duplicateProtocols: duplicates.map((item) => item.protocol) }),
          now,
        ),
    ];

    if (data.product.trim()) {
      operations.push(
        db
          .prepare(
            `INSERT INTO return_items (id, return_id, product, quantity)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), id, data.product, data.quantity),
      );
    }
    for (const photo of photoRows) {
      operations.push(
        db
          .prepare(
            `INSERT INTO return_photos
             (id, return_id, object_key, file_name, content_type, size, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(photo.id, id, photo.key, photo.fileName, photo.contentType, photo.size, actor, now),
      );
    }

    await db.batch(operations);
    const created = await getReturnDetail(id);
    return Response.json({ item: created, duplicates }, { status: 201 });
  } catch (error) {
    console.error(error);
    try {
      const { files } = getBindings();
      await Promise.all(uploadedKeys.map((key) => files.delete(key)));
    } catch {
      // A cleanup failure must not hide the original error.
    }
    return apiError('Não foi possível registrar a devolução.', 500);
  }
}
