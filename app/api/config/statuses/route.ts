import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await authenticateApi(request, { anyPermissions: ['returns.view', 'returns.create', 'settings.manage'], csrf: false });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { db } = getBindings();
    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === 'true';
    const result = await db
      .prepare(`SELECT s.code, s.label, s.color, s.is_system, s.sort_order, s.active,
        (SELECT COUNT(*) FROM returns r WHERE r.organization_id = s.organization_id AND r.status = s.code) AS usage_count
        FROM tenant_status_definitions s
        WHERE s.organization_id = ? ${includeInactive ? '' : 'AND s.active = 1'}
        ORDER BY s.active DESC, s.sort_order, s.label`)
      .bind(auth.user.organizationId)
      .all();
    return Response.json({ items: result.results });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar os status.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateApi(request, { permission: 'settings.manage' });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const body = (await request.json()) as { label?: string; color?: string };
    const label = body.label?.trim();
    if (!label || label.length > 60) return apiError('Informe um nome de status com até 60 caracteres.', 422);
    const namedColors = ['slate', 'amber', 'blue', 'sky', 'orange', 'violet', 'emerald', 'rose'];
    const requestedColor = body.color?.trim() || '';
    const color = /^#[0-9a-f]{6}$/i.test(requestedColor)
      ? requestedColor.toLowerCase()
      : namedColors.includes(requestedColor)
        ? requestedColor
        : '#64748b';
    const normalized = label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase()
      .slice(0, 30);
    const code = `CUSTOM_${normalized || 'STATUS'}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const { db } = getBindings();
    await db.batch([
      db
        .prepare(
          `INSERT INTO tenant_status_definitions (organization_id, code, label, color, is_system, sort_order, active)
           VALUES (?, ?, ?, ?, 0, 100, 1)`,
        )
        .bind(auth.user.organizationId, code, label, color),
      db
        .prepare(
          `INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at)
           VALUES (?, ?, NULL, ?, 'STATUS_CREATED', ?, ?)`,
        )
        .bind(crypto.randomUUID(), auth.user.organizationId, actorLabel(auth.user), JSON.stringify({ code, label, color }), new Date().toISOString()),
    ]);
    return Response.json({ item: { code, label, color, is_system: 0, sort_order: 100, active: 1 } }, { status: 201 });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível cadastrar o status.', 500);
  }
}
