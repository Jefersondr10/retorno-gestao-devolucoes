import { getBindings } from '@/lib/data';

const AUTO_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type RetentionPolicy = {
  automaticEnabled: boolean;
  photoRetentionDays: number;
  returnRetentionDays: number;
  lastCleanupAt: string | null;
  lastCleanupPhotos: number;
  lastCleanupReturns: number;
};

export type RetentionOverview = RetentionPolicy & {
  eligiblePhotos: number;
  eligiblePhotoBytes: number;
  eligibleReturns: number;
};

function numberSetting(settings: Map<string, string>, key: string, fallback: number) {
  const value = Number(settings.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function cutoffIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
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
    lastCleanupReturns: numberSetting(settings, 'last_cleanup_returns', 0),
  };
}

async function previewFor(policy: RetentionPolicy) {
  const { db } = getBindings();
  const photoCutoff = cutoffIso(policy.photoRetentionDays);
  const returnCutoff = cutoffIso(policy.returnRetentionDays);
  const [photoResult, returnResult] = await Promise.all([
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
  const policy = await readPolicy();
  if (!force && !policy.automaticEnabled) return { executed: false, overview: { ...policy, ...(await previewFor(policy)) } };

  const lastRun = policy.lastCleanupAt ? new Date(policy.lastCleanupAt).getTime() : 0;
  if (!force && Number.isFinite(lastRun) && Date.now() - lastRun < AUTO_CLEANUP_INTERVAL_MS) {
    return { executed: false, overview: { ...policy, ...(await previewFor(policy)) } };
  }

  const { db, files } = getBindings();
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
  let deletedReturns = 0;
  const returnIds = expiredReturns.results.map((item) => item.id);
  if (returnIds.length) {
    const placeholders = returnIds.map(() => '?').join(', ');
    const returnPhotos = await db
      .prepare(`SELECT id, object_key FROM return_photos WHERE return_id IN (${placeholders})`)
      .bind(...returnIds)
      .all<{ id: string; object_key: string }>();
    if (returnPhotos.results.length) await files.delete(returnPhotos.results.map((photo) => photo.object_key));
    const operations: D1PreparedStatement[] = [];
    returnIds.forEach((id) => {
      operations.push(
        db.prepare('DELETE FROM audit_events WHERE return_id = ?').bind(id),
        db.prepare('DELETE FROM return_items WHERE return_id = ?').bind(id),
        db.prepare('DELETE FROM return_photos WHERE return_id = ?').bind(id),
        db.prepare('DELETE FROM returns WHERE id = ?').bind(id),
      );
    });
    await db.batch(operations);
    deletedPhotos += returnPhotos.results.length;
    deletedReturns += returnIds.length;
  }

  const expiredPhotos = await db
    .prepare(
      `SELECT p.id, p.object_key
       FROM return_photos p
       INNER JOIN returns r ON r.id = p.return_id
       WHERE r.status = 'FINALIZED' AND r.finalized_at IS NOT NULL AND r.finalized_at < ?
       ORDER BY r.finalized_at ASC, p.created_at ASC LIMIT 500`,
    )
    .bind(photoCutoff)
    .all<{ id: string; object_key: string }>();
  if (expiredPhotos.results.length) {
    await files.delete(expiredPhotos.results.map((photo) => photo.object_key));
    await db.batch(expiredPhotos.results.map((photo) => db.prepare('DELETE FROM return_photos WHERE id = ?').bind(photo.id)));
    deletedPhotos += expiredPhotos.results.length;
  }

  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_cleanup_at'").bind(now, now),
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_cleanup_photos'").bind(String(deletedPhotos), now),
    db.prepare("UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_cleanup_returns'").bind(String(deletedReturns), now),
    db
      .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'RETENTION_CLEANUP', ?, ?)")
      .bind(crypto.randomUUID(), actor, JSON.stringify({ deletedPhotos, deletedReturns, force }), now),
  ]);

  return { executed: true, overview: await getRetentionOverview() };
}
