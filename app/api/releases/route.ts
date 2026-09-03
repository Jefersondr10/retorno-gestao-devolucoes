import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';
import { isKnownReleaseId, SYSTEM_RELEASES } from '@/lib/releases';
import { readBoundedJsonObject } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApi(request, {
      allowPasswordChange: true,
      csrf: false,
    });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { db } = getBindings();
    const acknowledgements = await db
      .prepare(
        'SELECT release_id, acknowledged_at FROM user_release_acknowledgements WHERE user_id = ?',
      )
      .bind(auth.user.id)
      .all<{ release_id: string; acknowledged_at: string }>();
    const acknowledgedById = new Map(
      acknowledgements.results.map((item) => [
        item.release_id,
        item.acknowledged_at,
      ]),
    );
    const items = SYSTEM_RELEASES.map((release) => ({
      ...release,
      acknowledgedAt: acknowledgedById.get(release.id) || null,
    }));
    return Response.json(
      {
        items,
        pending: items.filter((release) => !release.acknowledgedAt),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar as novidades.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateApi(request, { allowPasswordChange: true });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const bodyResult = await readBoundedJsonObject(request, 8 * 1024);
    if (!bodyResult.ok) return apiError(bodyResult.error, bodyResult.status);
    const requestedIds = bodyResult.value.releaseIds;
    if (
      !Array.isArray(requestedIds) ||
      requestedIds.length === 0 ||
      requestedIds.length > SYSTEM_RELEASES.length
    ) {
      return apiError('As novidades confirmadas não são válidas.', 422);
    }
    const releaseIds = [...new Set(requestedIds)].filter(
      (releaseId): releaseId is string =>
        typeof releaseId === 'string' && isKnownReleaseId(releaseId),
    );
    if (releaseIds.length !== requestedIds.length) {
      return apiError('As novidades confirmadas não são válidas.', 422);
    }
    const { db } = getBindings();
    const now = new Date().toISOString();
    const operations: D1PreparedStatement[] = releaseIds.flatMap(
      (releaseId) => [
        db
          .prepare(
            `INSERT INTO user_release_acknowledgements (user_id, release_id, acknowledged_at)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, release_id) DO NOTHING`,
          )
          .bind(auth.user.id, releaseId, now),
        db
          .prepare(
            `INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at)
           VALUES (?, ?, NULL, ?, 'RELEASE_NOTES_ACKNOWLEDGED', ?, ?)
           ON CONFLICT(id) DO NOTHING`,
          )
          .bind(
            `release-ack:${auth.user.id}:${releaseId}`,
            auth.user.organizationId,
            actorLabel(auth.user),
            JSON.stringify({ userId: auth.user.id, releaseId }),
            now,
          ),
      ],
    );
    await db.batch(operations);
    return Response.json(
      { acknowledged: releaseIds, acknowledgedAt: now },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível confirmar a leitura das novidades.', 500);
  }
}
