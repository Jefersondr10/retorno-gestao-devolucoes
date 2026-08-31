import { getBindings } from '@/lib/data';

const AUTO_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PENDING_DELETION_EVENT_LIMIT = 20;
const STORAGE_DELETE_BATCH_SIZE = 500;
const STORAGE_OUTBOX_KEY_CHUNK_SIZE = 250;
const SQL_BIND_CHUNK_SIZE = 90;

type PendingStorageDeletionAction = 'VIDEOS_DELETION_PENDING' | 'STORAGE_DELETION_PENDING';

export type PendingStorageDeletion = {
  id: string;
  action: PendingStorageDeletionAction;
  objectKeys: string[];
};

export type RetentionPolicy = {
  automaticEnabled: boolean;
  photoRetentionDays: number;
  returnRetentionDays: number;
  lastCleanupAt: string | null;
  lastCleanupPhotos: number;
  lastCleanupVideos: number;
  lastCleanupReturns: number;
};

export type RetentionOverview = RetentionPolicy & {
  eligiblePhotos: number;
  eligiblePhotoBytes: number;
  eligibleVideos: number;
  eligibleVideoBytes: number;
  eligibleReturns: number;
};

function numberSetting(settings: Map<string, string>, key: string, fallback: number) {
  const value = Number(settings.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function cutoffIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function queuedObjectKeys(details: string | null) {
  try {
    const parsed = JSON.parse(details || '{}') as { objectKeys?: unknown };
    return Array.isArray(parsed.objectKeys) ? parsed.objectKeys.filter((key): key is string => typeof key === 'string' && key.length > 0) : [];
  } catch {
    return [];
  }
}

function chunksOf<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size));
  return chunks;
}

function uniqueObjectKeys(objectKeys: string[]) {
  return [...new Set(objectKeys.filter((key) => key.length > 0))];
}

function deleteInBatches(db: D1Database, sqlPrefix: string, ids: string[]) {
  return chunksOf(ids, SQL_BIND_CHUNK_SIZE).map((chunk) =>
    db.prepare(`${sqlPrefix} (${chunk.map(() => '?').join(', ')})`).bind(...chunk),
  );
}

export function prepareStorageDeletionOutbox(
  db: D1Database,
  input: {
    objectKeys: string[];
    actor: string;
    now: string;
    reason: string;
    details?: Record<string, unknown>;
  },
) {
  const objectKeyChunks = chunksOf(uniqueObjectKeys(input.objectKeys), STORAGE_OUTBOX_KEY_CHUNK_SIZE);
  const events: PendingStorageDeletion[] = [];
  const operations: D1PreparedStatement[] = [];

  objectKeyChunks.forEach((objectKeys, index) => {
    const id = crypto.randomUUID();
    events.push({ id, action: 'STORAGE_DELETION_PENDING', objectKeys });
    operations.push(
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'STORAGE_DELETION_PENDING', ?, ?)")
        .bind(
          id,
          input.actor,
          JSON.stringify({
            ...input.details,
            reason: input.reason,
            chunk: index + 1,
            chunks: objectKeyChunks.length,
            objectKeys,
          }),
          input.now,
        ),
    );
  });

  return { events, operations };
}

export async function completeStorageDeletionEvents(events: PendingStorageDeletion[]) {
  if (!events.length) return 0;
  const { db, files } = getBindings();
  try {
    const objectKeys = uniqueObjectKeys(events.flatMap((event) => event.objectKeys));
    for (const chunk of chunksOf(objectKeys, STORAGE_DELETE_BATCH_SIZE)) await files.delete(chunk);

    const eventIds = events.map((event) => event.id);
    const completedAt = new Date().toISOString();
    await db.batch(
      chunksOf(eventIds, SQL_BIND_CHUNK_SIZE).map((chunk) =>
        db
          .prepare(
            `UPDATE audit_events
             SET action = CASE action
               WHEN 'VIDEOS_DELETION_PENDING' THEN 'VIDEOS_DELETED'
               WHEN 'STORAGE_DELETION_PENDING' THEN 'STORAGE_DELETED'
               ELSE action
             END,
             details = CASE
               WHEN json_valid(details) THEN json_set(details, '$.storageDeletedAt', ?)
               ELSE details
             END
             WHERE id IN (${chunk.map(() => '?').join(', ')})
               AND action IN ('VIDEOS_DELETION_PENDING', 'STORAGE_DELETION_PENDING')`,
          )
          .bind(completedAt, ...chunk),
      ),
    );
    return events.length;
  } catch (error) {
    console.error('Pending storage deletion failed', error);
    return 0;
  }
}

async function flushPendingStorageDeletions() {
  const { db } = getBindings();
  const pending = await db
    .prepare(
      `SELECT id, action, details
       FROM audit_events
       WHERE action IN ('VIDEOS_DELETION_PENDING', 'STORAGE_DELETION_PENDING')
         AND json_valid(details)
         AND json_type(details, '$.objectKeys') = 'array'
         AND json_array_length(details, '$.objectKeys') > 0
       ORDER BY created_at
       LIMIT ?`,
    )
    .bind(PENDING_DELETION_EVENT_LIMIT)
    .all<{ id: string; action: PendingStorageDeletionAction; details: string | null }>();
  return completeStorageDeletionEvents(
    pending.results.map((event) => ({ id: event.id, action: event.action, objectKeys: queuedObjectKeys(event.details) })),
  );
}

async function readPolicy(): Promise<RetentionPolicy> {
  const { db } = getBindings();
  const result = await db.prepare('SELECT key, value FROM system_settings').all<{ key: string; value: string }>();
  const settings = new Map(result.results.map((row) => [row.key, row.value]));
  return {
    automaticEnabled: settings.get('automatic_cleanup_enabled') === '1',
    photoRetentionDays: numberSetting(settings, 'photo_retention_days', 90),
    returnRetentionDays: numberSetting(settings, 'return_retention_days', 365),
    lastCleanupAt: settings.get('last_cleanup_at') || null,
    lastCleanupPhotos: numberSetting(settings, 'last_cleanup_photos', 0),
    lastCleanupVideos: numberSetting(settings, 'last_cleanup_videos', 0),
    lastCleanupReturns: numberSetting(settings, 'last_cleanup_returns', 0),
  };
}

async function previewFor(policy: RetentionPolicy) {
  const { db } = getBindings();
  const photoCutoff = cutoffIso(policy.photoRetentionDays);
  const returnCutoff = cutoffIso(policy.returnRetentionDays);
  const [photoResult, videoResult, returnResult] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(p.size), 0) AS bytes
         FROM return_photos p
         INNER JOIN returns r ON r.id = p.return_id
         WHERE r.status = 'FINALIZED' AND r.finalized_at IS NOT NULL AND r.finalized_at < ?`,
      )
      .bind(photoCutoff)
      .first<{ count: number; bytes: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(v.size), 0) AS bytes
         FROM return_videos v
         INNER JOIN returns r ON r.id = v.return_id
         WHERE r.status = 'FINALIZED' AND r.finalized_at IS NOT NULL AND r.finalized_at < ?`,
      )
      .bind(photoCutoff)
      .first<{ count: number; bytes: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM returns
         WHERE status = 'FINALIZED' AND finalized_at IS NOT NULL AND finalized_at < ?`,
      )
      .bind(returnCutoff)
      .first<{ count: number }>(),
  ]);
  return {
    eligiblePhotos: Number(photoResult?.count || 0),
    eligiblePhotoBytes: Number(photoResult?.bytes || 0),
    eligibleVideos: Number(videoResult?.count || 0),
    eligibleVideoBytes: Number(videoResult?.bytes || 0),
    eligibleReturns: Number(returnResult?.count || 0),
  };
}

export async function getRetentionOverview(): Promise<RetentionOverview> {
  const policy = await readPolicy();
  return { ...policy, ...(await previewFor(policy)) };
}

export async function saveRetentionPolicy(input: {
  automaticEnabled: boolean;
  photoRetentionDays: number;
  returnRetentionDays: number;
}) {
  const { db } = getBindings();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'automatic_cleanup_enabled'").bind(input.automaticEnabled ? '1' : '0', now),
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'photo_retention_days'").bind(String(input.photoRetentionDays), now),
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'return_retention_days'").bind(String(input.returnRetentionDays), now),
  ]);
  return getRetentionOverview();
}

export async function runRetentionCleanup({ force = false, actor = 'Limpeza automática' }: { force?: boolean; actor?: string } = {}) {
  const completedPendingStorageDeletions = await flushPendingStorageDeletions();
  const policy = await readPolicy();
  if (!force && !policy.automaticEnabled) return { executed: false, overview: { ...policy, ...(await previewFor(policy)) } };

  const lastRun = policy.lastCleanupAt ? new Date(policy.lastCleanupAt).getTime() : 0;
  if (!force && Number.isFinite(lastRun) && Date.now() - lastRun < AUTO_CLEANUP_INTERVAL_MS) {
    const currentPreview = await previewFor(policy);
    const hasBacklog = currentPreview.eligiblePhotos > 0 || currentPreview.eligibleVideos > 0 || currentPreview.eligibleReturns > 0;
    if (!hasBacklog) return { executed: false, overview: { ...policy, ...currentPreview } };
  }

  const { db } = getBindings();
  const returnCutoff = cutoffIso(policy.returnRetentionDays);
  const photoCutoff = cutoffIso(policy.photoRetentionDays);

  const expiredReturns = await db
    .prepare(
      `SELECT id, protocol FROM returns
       WHERE status = 'FINALIZED' AND finalized_at IS NOT NULL AND finalized_at < ?
       ORDER BY finalized_at ASC LIMIT 100`,
    )
    .bind(returnCutoff)
    .all<{ id: string; protocol: string }>();

  let deletedPhotos = 0;
  let deletedVideos = 0;
  let deletedPhotoBytes = 0;
  let deletedVideoBytes = 0;
  let deletedReturns = 0;
  const returnIds = expiredReturns.results.map((item) => item.id);
  if (returnIds.length) {
    const placeholders = returnIds.map(() => '?').join(', ');
    const [returnPhotos, returnVideos, pendingDeletionEvents] = await Promise.all([
      db.prepare(`SELECT id, object_key, size FROM return_photos WHERE return_id IN (${placeholders})`).bind(...returnIds).all<{ id: string; object_key: string; size: number }>(),
      db.prepare(`SELECT id, object_key, size FROM return_videos WHERE return_id IN (${placeholders})`).bind(...returnIds).all<{ id: string; object_key: string; size: number }>(),
      db.prepare(`SELECT details FROM audit_events WHERE return_id IN (${placeholders}) AND action = 'VIDEOS_DELETION_PENDING'`).bind(...returnIds).all<{ details: string | null }>(),
    ]);
    const objectKeys = [...new Set([
      ...returnPhotos.results.map((photo) => photo.object_key),
      ...returnVideos.results.map((video) => video.object_key),
      ...pendingDeletionEvents.results.flatMap((event) => queuedObjectKeys(event.details)),
    ])];
    const queuedAt = new Date().toISOString();
    const outbox = prepareStorageDeletionOutbox(db, {
      objectKeys,
      actor,
      now: queuedAt,
      reason: 'RETURN_RETENTION',
      details: {
        returnIds,
        protocols: expiredReturns.results.map((item) => item.protocol),
        photoCount: returnPhotos.results.length,
        videoCount: returnVideos.results.length,
      },
    });
    await db.batch([
      ...outbox.operations,
      ...deleteInBatches(db, 'DELETE FROM audit_events WHERE return_id IN', returnIds),
      ...deleteInBatches(db, 'DELETE FROM return_items WHERE return_id IN', returnIds),
      ...deleteInBatches(db, 'DELETE FROM return_photos WHERE return_id IN', returnIds),
      ...deleteInBatches(db, 'DELETE FROM return_videos WHERE return_id IN', returnIds),
      ...deleteInBatches(db, 'DELETE FROM returns WHERE id IN', returnIds),
    ]);
    await completeStorageDeletionEvents(outbox.events);
    deletedPhotos += returnPhotos.results.length;
    deletedVideos += returnVideos.results.length;
    deletedPhotoBytes += returnPhotos.results.reduce((total, photo) => total + Number(photo.size || 0), 0);
    deletedVideoBytes += returnVideos.results.reduce((total, video) => total + Number(video.size || 0), 0);
    deletedReturns += returnIds.length;
  }

  const [expiredPhotos, expiredVideos] = await Promise.all([
    db
      .prepare(
        `SELECT p.id, p.object_key, p.size
         FROM return_photos p
         INNER JOIN returns r ON r.id = p.return_id
         WHERE r.status = 'FINALIZED' AND r.finalized_at IS NOT NULL AND r.finalized_at < ?
         ORDER BY r.finalized_at ASC, p.created_at ASC LIMIT 500`,
      )
      .bind(photoCutoff)
      .all<{ id: string; object_key: string; size: number }>(),
    db
      .prepare(
        `SELECT v.id, v.object_key, v.size
         FROM return_videos v
         INNER JOIN returns r ON r.id = v.return_id
         WHERE r.status = 'FINALIZED' AND r.finalized_at IS NOT NULL AND r.finalized_at < ?
         ORDER BY r.finalized_at ASC, v.created_at ASC LIMIT 200`,
      )
      .bind(photoCutoff)
      .all<{ id: string; object_key: string; size: number }>(),
  ]);
  const expiredMediaKeys = [...expiredPhotos.results, ...expiredVideos.results].map((media) => media.object_key);
  if (expiredMediaKeys.length) {
    const queuedAt = new Date().toISOString();
    const outbox = prepareStorageDeletionOutbox(db, {
      objectKeys: expiredMediaKeys,
      actor,
      now: queuedAt,
      reason: 'MEDIA_RETENTION',
      details: {
        photoCount: expiredPhotos.results.length,
        videoCount: expiredVideos.results.length,
      },
    });
    await db.batch([
      ...outbox.operations,
      ...deleteInBatches(db, 'DELETE FROM return_photos WHERE id IN', expiredPhotos.results.map((photo) => photo.id)),
      ...deleteInBatches(db, 'DELETE FROM return_videos WHERE id IN', expiredVideos.results.map((video) => video.id)),
    ]);
    await completeStorageDeletionEvents(outbox.events);
    deletedPhotos += expiredPhotos.results.length;
    deletedVideos += expiredVideos.results.length;
    deletedPhotoBytes += expiredPhotos.results.reduce((total, photo) => total + Number(photo.size || 0), 0);
    deletedVideoBytes += expiredVideos.results.reduce((total, video) => total + Number(video.size || 0), 0);
  }

  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_cleanup_at'").bind(now, now),
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_cleanup_photos'").bind(String(deletedPhotos), now),
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_cleanup_videos'").bind(String(deletedVideos), now),
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_cleanup_returns'").bind(String(deletedReturns), now),
    db
      .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'RETENTION_CLEANUP', ?, ?)")
      .bind(crypto.randomUUID(), actor, JSON.stringify({ deletedPhotos, deletedPhotoBytes, deletedVideos, deletedVideoBytes, deletedReturns, completedPendingStorageDeletions, force }), now),
  ]);

  return { executed: true, overview: await getRetentionOverview() };
}
