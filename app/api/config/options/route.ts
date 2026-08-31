import { actorFrom, apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

const allowedTypes = ['LOCATION', 'STORE', 'CONDITION'] as const;
type OptionType = (typeof allowedTypes)[number];

export async function GET() {
  try {
    await ensureSchema();
    const { db } = getBindings();
    const result = await db
      .prepare(
        `SELECT code, type, label, color, is_system, sort_order, active, requires_invoice, requires_notes
         FROM config_options WHERE active = 1 ORDER BY type, sort_order, label`,
      )
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
      .prepare('SELECT code FROM config_options WHERE type = ? AND LOWER(label) = LOWER(?) LIMIT 1')
      .bind(type, label)
      .first();
    if (duplicate) return apiError('Já existe um cadastro com este nome.', 409);

    await db.batch([
      db
        .prepare(
          `INSERT INTO config_options
           (code, type, label, color, is_system, sort_order, active, requires_invoice, requires_notes, created_at)
           VALUES (?, ?, ?, ?, 0, 100, 1, ?, ?, ?)`,
        )
        .bind(code, type, label, color, requiresInvoice, requiresNotes, now),
      db
        .prepare(
          `INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
           VALUES (?, NULL, ?, 'CONFIG_OPTION_CREATED', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          actorFrom(request),
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
