import { actorLabel, authenticateApi, consumeOrganizationActionRateLimit } from '@/lib/auth';
import { apiError, ensureSchema, getBindings, getReturnDetail } from '@/lib/data';
import { readBoundedFormData } from '@/lib/request-body';
import { createReturnSchema } from '@/lib/returns';
import { flushPendingStorageDeletions, runRetentionCleanup } from '@/lib/retention';
import { readVideoDurationMs } from '@/lib/video-metadata';

export const dynamic = 'force-dynamic';

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;
const MAX_VIDEO_DURATION_MS = 20_000;
const MAX_MULTIPART_BYTES = 64 * 1024 * 1024;
const MAX_ORGANIZATION_STORAGE_BYTES = 1024 * 1024 * 1024;
const MAX_ORGANIZATION_RETURNS = 25_000;
const MAX_RETURN_CREATIONS_PER_WINDOW = 150;
const QUOTA_RESERVATION_TTL_MS = 30 * 60 * 1000;

async function detectPhotoContentType(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG') return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return '';
}

async function detectVideoContentType(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isIsoMedia = bytes.length >= 8 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const declaredAsVideo = file.type.startsWith('video/') || ['mp4', 'm4v', 'mov', '3gp', '3gpp'].includes(extension || '');
  if (!declaredAsVideo) return '';
  if (isIsoMedia) {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    const imageOrAudioBrands = new Set(['avif', 'avis', 'heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'm4a ', 'm4b ', 'm4p ']);
    if (imageOrAudioBrands.has(brand)) return '';
    if (file.type === 'video/quicktime' || extension === 'mov') return 'video/quicktime';
    if (file.type === 'video/3gpp' || extension === '3gp' || extension === '3gpp') return 'video/3gpp';
    return 'video/mp4';
  }
  return '';
}

async function cleanupExpiredQuotaReservations(db: D1Database, files: R2Bucket, organizationId: string, nowIso: string) {
  const expired = await db
    .prepare(`SELECT id, return_id, object_keys_json
      FROM organization_quota_reservations
      WHERE organization_id = ? AND expires_at <= ?
      ORDER BY expires_at
      LIMIT 20`)
    .bind(organizationId, nowIso)
    .all<{ id: string; return_id: string; object_keys_json: string }>();

  for (const reservation of expired.results) {
    try {
      const committedReturn = await db
        .prepare('SELECT id FROM returns WHERE id = ? AND organization_id = ?')
        .bind(reservation.return_id, organizationId)
        .first();
      if (committedReturn) {
        await db.prepare('DELETE FROM organization_quota_reservations WHERE id = ? AND organization_id = ?')
          .bind(reservation.id, organizationId)
          .run();
        continue;
      }
      const parsedKeys = JSON.parse(reservation.object_keys_json) as unknown;
      const keys = Array.isArray(parsedKeys) ? parsedKeys.filter((key): key is string => typeof key === 'string') : [];
      const deletions = await Promise.allSettled(keys.map((key) => files.delete(key)));
      if (deletions.every((result) => result.status === 'fulfilled')) {
        await db.prepare('DELETE FROM organization_quota_reservations WHERE id = ? AND organization_id = ?')
          .bind(reservation.id, organizationId)
          .run();
      }
    } catch (cleanupError) {
      console.error('Expired quota reservation cleanup failed', cleanupError);
    }
  }
}

export async function GET(request: Request) {
  try {
    const auth = await authenticateApi(request, { permission: 'returns.view', csrf: false });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { db } = getBindings();
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim().toLowerCase() || '';
    const status = url.searchParams.get('status')?.trim() || '';
    const includeFinalized = url.searchParams.get('includeFinalized') === 'true';

    const conditions: string[] = ['r.organization_id = ?'];
    const values: unknown[] = [auth.user.organizationId];
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
      `SELECT r.*, COALESCE(s.label, 'Status não configurado') AS status_label,
        COALESCE(s.color, 'slate') AS status_color,
        COALESCE(store_option.color, '#64748b') AS store_color,
        (SELECT COUNT(*) FROM return_items i WHERE i.return_id = r.id) AS item_count,
        (SELECT COUNT(*) FROM return_photos p WHERE p.return_id = r.id) AS photo_count,
        (SELECT COUNT(*) FROM return_videos v WHERE v.return_id = r.id) AS video_count,
        (SELECT p.id FROM return_photos p WHERE p.return_id = r.id ORDER BY p.created_at LIMIT 1) AS first_photo_id
       FROM returns r
       LEFT JOIN tenant_status_definitions s ON s.organization_id = r.organization_id AND s.code = r.status
       LEFT JOIN tenant_config_options store_option ON store_option.organization_id = r.organization_id AND store_option.type = 'STORE' AND store_option.label = r.store
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
  let plannedObjectKeys: string[] = [];
  let quotaReservationId: string | null = null;
  let returnId: string | null = null;
  let databaseCommitted = false;
  try {
    const auth = await authenticateApi(request, { permission: 'returns.create' });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { db, files } = getBindings();
    const actionRateLimit = await consumeOrganizationActionRateLimit(
      auth.user.organizationId,
      'return-create',
      MAX_RETURN_CREATIONS_PER_WINDOW,
    );
    if (!actionRateLimit.allowed) {
      return apiError('Muitos cadastros foram enviados em pouco tempo. Aguarde alguns minutos e tente novamente.', 429);
    }
    const actor = actorLabel(auth.user);
    const contentType = request.headers.get('content-type') || '';
    const contentEncoding = (request.headers.get('content-encoding') || 'identity').toLowerCase();
    if (!contentType.toLowerCase().startsWith('multipart/form-data;') || contentEncoding !== 'identity') {
      return apiError('O formato do envio não é válido.', 400);
    }
    const boundedFormData = await readBoundedFormData(request, MAX_MULTIPART_BYTES);
    if (!boundedFormData.ok) {
      return boundedFormData.status === 413
        ? apiError('O envio ficou grande demais. Reduza o vídeo ou a quantidade de fotos.', 413)
        : apiError(boundedFormData.error, 400);
    }
    const formData = boundedFormData.value;
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
    const videos = formData.getAll('videos').filter((value): value is File => value instanceof File && value.size > 0);
    if (data.source === 'PHOTO' && photos.length === 0 && videos.length === 0) {
      return apiError('Adicione pelo menos uma foto ou um vídeo para registrar o recebimento.', 422);
    }
    if (data.source === 'MANUAL' && !data.product.trim()) {
      return apiError('Informe pelo menos um produto no cadastro completo.', 422);
    }
    if (data.source === 'MANUAL' && !data.orderId.trim() && !data.trackingCode.trim()) {
      return apiError('Informe o ID do pedido ou o código de rastreio.', 422);
    }
    if (photos.length > 8) return apiError('Envie no máximo 8 fotos por vez.', 422);
    if (videos.length > 1) return apiError('Envie no máximo 1 vídeo por devolução.', 422);
    const preparedPhotos: Array<{ file: File; contentType: string }> = [];
    for (const photo of photos) {
      if (photo.size > 2.5 * 1024 * 1024) return apiError('Cada foto deve ter no máximo 2,5 MB.', 422);
      const contentType = await detectPhotoContentType(photo);
      if (!contentType) return apiError('Use fotos JPEG, PNG ou WebP válidas.', 422);
      preparedPhotos.push({ file: photo, contentType });
    }
    const requestedVideoDurationMs = Number(getText('videoDurationMs'));
    if (videos.length && (!Number.isFinite(requestedVideoDurationMs) || requestedVideoDurationMs <= 0 || requestedVideoDurationMs > MAX_VIDEO_DURATION_MS + 500)) {
      return apiError('O vídeo deve ter no máximo 20 segundos.', 422);
    }
    const preparedVideos: Array<{ file: File; contentType: string; durationMs: number }> = [];
    for (const video of videos) {
      if (video.size > MAX_VIDEO_BYTES) return apiError('O vídeo deve ter no máximo 40 MB.', 422);
      const contentType = await detectVideoContentType(video);
      if (!contentType) return apiError('Use um vídeo MP4, MOV ou 3GP válido.', 422);
      const measuredDurationMs = await readVideoDurationMs(video);
      if (!measuredDurationMs) return apiError('Não foi possível confirmar a duração do vídeo. Grave novamente em MP4, MOV ou 3GP.', 422);
      if (measuredDurationMs > MAX_VIDEO_DURATION_MS + 500) return apiError('O vídeo deve ter no máximo 20 segundos.', 422);
      preparedVideos.push({ file: video, contentType, durationMs: measuredDurationMs });
    }

    const id = crypto.randomUUID();
    returnId = id;
    const photoRows = preparedPhotos.map(({ file: photo, contentType }) => {
      const photoId = crypto.randomUUID();
      const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || 'foto.jpg';
      return {
        id: photoId,
        key: `organizations/${auth.user.organizationId}/returns/${id}/photos/${photoId}-${safeName}`,
        fileName: photo.name,
        contentType,
        size: photo.size,
      };
    });
    const videoRows = preparedVideos.map((video) => {
      const videoId = crypto.randomUUID();
      const safeName = video.file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120)
        || (video.contentType === 'video/quicktime' ? 'video.mov' : 'video.mp4');
      return {
        id: videoId,
        key: `organizations/${auth.user.organizationId}/returns/${id}/videos/${videoId}-${safeName}`,
        fileName: video.file.name,
        contentType: video.contentType,
        size: video.file.size,
        durationMs: video.durationMs,
      };
    });
    plannedObjectKeys = [...photoRows.map((photo) => photo.key), ...videoRows.map((video) => video.key)];
    const incomingBytes = [...preparedPhotos, ...preparedVideos].reduce((total, item) => total + item.file.size, 0);
    await flushPendingStorageDeletions(auth.user.organizationId);
    const quotaNow = new Date();
    const quotaNowIso = quotaNow.toISOString();
    await cleanupExpiredQuotaReservations(db, files, auth.user.organizationId, quotaNowIso);
    quotaReservationId = crypto.randomUUID();
    const reservation = await db.prepare(
      `INSERT INTO organization_quota_reservations
        (id, organization_id, return_id, return_count, media_bytes, object_keys_json, expires_at, created_at)
       SELECT ?1, ?2, ?3, 1, ?4, ?5, ?6, ?7
       WHERE
         (SELECT COUNT(*) FROM returns WHERE organization_id = ?2)
           + (SELECT COALESCE(SUM(return_count), 0) FROM organization_quota_reservations
              WHERE organization_id = ?2) < ?8
         AND
         (SELECT COALESCE(SUM(p.size), 0) FROM return_photos p
            INNER JOIN returns r ON r.id = p.return_id WHERE r.organization_id = ?2)
           + (SELECT COALESCE(SUM(v.size), 0) FROM return_videos v
              INNER JOIN returns r ON r.id = v.return_id WHERE r.organization_id = ?2)
           + (SELECT COALESCE(SUM(media_bytes), 0) FROM organization_quota_reservations
              WHERE organization_id = ?2)
           + (SELECT COALESCE(SUM(
                CASE WHEN json_valid(deletion_event.details) THEN
                  CASE WHEN json_type(deletion_event.details, '$.bytes') IN ('integer', 'real')
                    THEN MAX(CAST(json_extract(deletion_event.details, '$.bytes') AS INTEGER), 0)
                    WHEN json_type(deletion_event.details, '$.objectKeys') = 'array'
                      AND json_array_length(deletion_event.details, '$.objectKeys') > 0 THEN 1073741824
                    ELSE 0 END
                ELSE 0 END
              ), 0)
              FROM audit_events deletion_event
              WHERE deletion_event.organization_id = ?2
                AND deletion_event.action IN ('VIDEOS_DELETION_PENDING', 'STORAGE_DELETION_PENDING'))
           + ?4 <= ?9
       RETURNING id`,
    )
      .bind(
        quotaReservationId,
        auth.user.organizationId,
        id,
        incomingBytes,
        JSON.stringify(plannedObjectKeys),
        new Date(quotaNow.getTime() + QUOTA_RESERVATION_TTL_MS).toISOString(),
        quotaNowIso,
        MAX_ORGANIZATION_RETURNS,
        MAX_ORGANIZATION_STORAGE_BYTES,
      )
      .first<{ id: string }>();
    if (!reservation) {
      quotaReservationId = null;
      const usage = await db.prepare(`SELECT
        (SELECT COUNT(*) FROM returns WHERE organization_id = ?1)
          + (SELECT COALESCE(SUM(return_count), 0) FROM organization_quota_reservations
             WHERE organization_id = ?1) AS return_count,
        (SELECT COALESCE(SUM(p.size), 0) FROM return_photos p INNER JOIN returns r ON r.id = p.return_id WHERE r.organization_id = ?1)
          + (SELECT COALESCE(SUM(v.size), 0) FROM return_videos v INNER JOIN returns r ON r.id = v.return_id WHERE r.organization_id = ?1)
          + (SELECT COALESCE(SUM(media_bytes), 0) FROM organization_quota_reservations
             WHERE organization_id = ?1) AS storage_bytes,
        (SELECT COALESCE(SUM(
              CASE WHEN json_valid(deletion_event.details) THEN
                CASE WHEN json_type(deletion_event.details, '$.bytes') IN ('integer', 'real')
                  THEN MAX(CAST(json_extract(deletion_event.details, '$.bytes') AS INTEGER), 0)
                  WHEN json_type(deletion_event.details, '$.objectKeys') = 'array'
                    AND json_array_length(deletion_event.details, '$.objectKeys') > 0 THEN 1073741824
                  ELSE 0 END
              ELSE 0 END
            ), 0)
            FROM audit_events deletion_event
            WHERE deletion_event.organization_id = ?1
              AND deletion_event.action IN ('VIDEOS_DELETION_PENDING', 'STORAGE_DELETION_PENDING')) AS pending_storage_bytes`)
        .bind(auth.user.organizationId)
        .first<{ return_count: number; storage_bytes: number; pending_storage_bytes: number }>();
      if (Number(usage?.return_count || 0) >= MAX_ORGANIZATION_RETURNS) {
        return apiError('Esta empresa atingiu o limite de devoluções armazenadas. Exclua registros antigos antes de continuar.', 409);
      }
      if (Number(usage?.storage_bytes || 0) + Number(usage?.pending_storage_bytes || 0) + incomingBytes > MAX_ORGANIZATION_STORAGE_BYTES) {
        return apiError('Esta empresa atingiu o limite de armazenamento. Aguarde a limpeza dos arquivos ou exclua mídias antigas.', 413);
      }
      return apiError('Não foi possível reservar espaço para este envio. Tente novamente em instantes.', 409);
    }
    const activeReservationId = reservation.id;

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
        .prepare(`SELECT id, protocol FROM returns WHERE organization_id = ? AND (${duplicateParts.join(' OR ')}) LIMIT 5`)
        .bind(auth.user.organizationId, ...duplicateValues)
        .all<{ id: string; protocol: string }>();
      duplicates = duplicateResult.results;
    }

    const sequenceResult = await db.prepare('INSERT INTO return_sequences DEFAULT VALUES').run();
    const sequence = Number(sequenceResult.meta.last_row_id);
    const protocol = `DEV-${String(sequence).padStart(6, '0')}`;
    const now = new Date().toISOString();
    const status = data.source === 'PHOTO' ? 'PENDING_INFO' : 'IN_TRIAGE';

    for (let index = 0; index < preparedPhotos.length; index += 1) {
      const preparedPhoto = preparedPhotos[index];
      const photo = photoRows[index];
      await files.put(photo.key, preparedPhoto.file.stream(), { httpMetadata: { contentType: preparedPhoto.contentType } });
    }
    for (let index = 0; index < preparedVideos.length; index += 1) {
      const preparedVideo = preparedVideos[index];
      const video = videoRows[index];
      await files.put(video.key, preparedVideo.file.stream(), { httpMetadata: { contentType: preparedVideo.contentType } });
    }

    const operations = [
      db
        .prepare(
          `INSERT INTO returns (
            id, organization_id, protocol, store, received_location, received_at, order_id,
            tracking_code, status, notes, source, created_by, created_at,
            updated_by, updated_at
          )
          SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
          WHERE EXISTS (
            SELECT 1 FROM organization_quota_reservations reservation
            WHERE reservation.id = ?16
              AND reservation.organization_id = ?2
              AND reservation.return_id = ?1
              AND reservation.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ) AND EXISTS (
            SELECT 1 FROM organization_memberships membership
            WHERE membership.organization_id = ?2
              AND membership.user_id = ?17
              AND membership.status = 'ACTIVE'
              AND (
                membership.role = 'ADMIN'
                OR EXISTS (
                  SELECT 1 FROM organization_membership_permissions permission
                  WHERE permission.organization_id = membership.organization_id
                    AND permission.user_id = membership.user_id
                    AND permission.permission = 'returns.create'
                )
              )
          )`,
        )
        .bind(
          id,
          auth.user.organizationId,
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
          activeReservationId,
          auth.user.id,
        ),
      db
        .prepare(
          `INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at)
           VALUES (?, ?, ?, ?, 'CREATED', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          auth.user.organizationId,
          id,
          actor,
          JSON.stringify({ source: data.source, photos: photos.length, videos: videos.length, duplicateProtocols: duplicates.map((item) => item.protocol) }),
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
    for (const video of videoRows) {
      operations.push(
        db
          .prepare(
            `INSERT INTO return_videos
             (id, return_id, object_key, file_name, content_type, size, duration_ms, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(video.id, id, video.key, video.fileName, video.contentType, video.size, video.durationMs, actor, now),
      );
    }
    operations.push(
      db.prepare('DELETE FROM organization_quota_reservations WHERE id = ? AND organization_id = ? AND return_id = ?')
        .bind(activeReservationId, auth.user.organizationId, id),
    );

    await db.batch(operations);
    const created = await getReturnDetail(id, auth.user.organizationId);
    if (!created) throw new Error('A reserva de capacidade expirou antes da conclusão do cadastro.');
    databaseCommitted = true;
    quotaReservationId = null;
    await runRetentionCleanup({ organizationId: auth.user.organizationId, actor: 'Sistema · limpeza automática' }).catch((cleanupError) => console.error('Automatic retention cleanup failed', cleanupError));
    return Response.json({ item: created, duplicates }, { status: 201 });
  } catch (error) {
    console.error(error);
    try {
      const { db, files } = getBindings();
      let uncommittedStateConfirmed = returnId === null;
      if (!databaseCommitted && returnId) {
        try {
          const committedReturn = await db.prepare('SELECT id FROM returns WHERE id = ?').bind(returnId).first();
          databaseCommitted = Boolean(committedReturn);
          uncommittedStateConfirmed = !committedReturn;
        } catch (confirmationError) {
          console.error('Return commit confirmation failed', confirmationError);
        }
      }
      if (!databaseCommitted && uncommittedStateConfirmed) {
        const deletions = await Promise.allSettled(plannedObjectKeys.map((key) => files.delete(key)));
        if (quotaReservationId && deletions.every((result) => result.status === 'fulfilled')) {
          await db.prepare('DELETE FROM organization_quota_reservations WHERE id = ?').bind(quotaReservationId).run();
        }
      }
    } catch {
      // A cleanup failure must not hide the original error.
    }
    return apiError('Não foi possível registrar a devolução.', 500);
  }
}
