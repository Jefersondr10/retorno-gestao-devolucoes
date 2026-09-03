import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

const allowedTypes = ['LOCATION', 'STORE', 'CONDITION'] as const;
type OptionType = (typeof allowedTypes)[number];

export async function GET(request: Request) {
  try {
    const auth = await authenticateApi(request, { anyPermissions: ['returns.view', 'returns.create', 'settings.manage'], csrf: false });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { db } = getBindings();
    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === 'true';
    const result = await db
      .prepare(
        `SELECT o.code, o.type, o.label, o.color, o.is_system, o.sort_order, o.active, o.requires_invoice, o.requires_notes,
          CASE o.type
            WHEN 'STORE' THEN (SELECT COUNT(*) FROM returns r WHERE r.organization_id = o.organization_id AND r.store = o.label)
            WHEN 'LOCATION' THEN (SELECT COUNT(*) FROM returns r WHERE r.organization_id = o.organization_id AND r.received_location = o.label)
            WHEN 'CONDITION' THEN (SELECT COUNT(*) FROM return_items i INNER JOIN returns r ON r.id = i.return_id WHERE r.organization_id = o.organization_id AND i.condition = o.code)
            ELSE 0
          END AS usage_count
         FROM tenant_config_options o
         WHERE o.organization_id = ? ${includeInactive ? '' : 'AND o.active = 1'}
         ORDER BY o.type, o.active DESC, o.sort_order, o.label`,
      )
      .bind(auth.user.organizationId)
      .all<Record<string, unknown>>();
    const rows = result.results;
    return Response.json({
      locations: rows.filter((row) => row.type === 'LOCATION'),
      stores: rows.filter((row) => row.type === 'STORE'),
      conditions: rows.filter((row) => row.type === 'CONDITION'),
    });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar os cadastros.', 500);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticateApi(request, { permission: 'settings.manage' });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const body = (await request.json()) as {
      type?: string;
      label?: string;
      color?: string;
      requiresInvoice?: boolean;
      requiresNotes?: boolean;
    };
    const type = body.type as OptionType;
    const label = body.label?.trim();
    if (!allowedTypes.includes(type)) return apiError('Selecione um tipo de cadastro válido.', 422);
    if (!label || label.length > 120) return apiError('Informe um nome com até 120 caracteres.', 422);
    const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color!.toLowerCase() : '#64748b';
    const normalized = label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase()
      .slice(0, 32);
    const code = `${type}_${normalized || 'OPCAO'}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const requiresInvoice = type === 'CONDITION' ? (body.requiresInvoice === false ? 0 : 1) : 1;
    const requiresNotes = type === 'CONDITION' && body.requiresNotes ? 1 : 0;
    const now = new Date().toISOString();
    const { db } = getBindings();

    const duplicate = await db
      .prepare('SELECT code FROM tenant_config_options WHERE organization_id = ? AND type = ? AND LOWER(label) = LOWER(?) LIMIT 1')
      .bind(auth.user.organizationId, type, label)
      .first();
    if (duplicate) return apiError('Já existe um cadastro com este nome.', 409);

    await db.batch([
      db
        .prepare(
          `INSERT INTO tenant_config_options
           (organization_id, code, type, label, color, is_system, sort_order, active, requires_invoice, requires_notes, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 100, 1, ?, ?, ?)`,
        )
        .bind(auth.user.organizationId, code, type, label, color, requiresInvoice, requiresNotes, now),
      db
        .prepare(
          `INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at)
           VALUES (?, ?, NULL, ?, 'CONFIG_OPTION_CREATED', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          auth.user.organizationId,
          actorLabel(auth.user),
          JSON.stringify({ code, type, label, color, requiresInvoice, requiresNotes }),
          now,
        ),
    ]);
    return Response.json({
      item: {
        code,
        type,
        label,
        color,
        is_system: 0,
        sort_order: 100,
        active: 1,
        requires_invoice: requiresInvoice,
        requires_notes: requiresNotes,
      },
    }, { status: 201 });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível salvar o cadastro.', 500);
  }
}
