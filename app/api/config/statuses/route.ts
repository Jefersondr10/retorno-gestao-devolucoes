import { actorFrom, apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSchema();
    const { db } = getBindings();
    const result = await db
      .prepare('SELECT code, label, color, is_system, sort_order, active FROM status_definitions WHERE active = 1 ORDER BY sort_order, label')
      .all();
    return Response.json({ items: result.results });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível carregar os status.', 500);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { label?: string; color?: string };
    const label = body.label?.trim();
    if (!label || label.length > 60) return apiError('Informe um nome de status com até 60 caracteres.', 422);
    const allowedColors = ['slate', 'amber', 'blue', 'sky', 'orange', 'violet', 'emerald', 'rose'];
    const color = allowedColors.includes(body.color || '') ? body.color! : 'slate';
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
          `INSERT INTO status_definitions (code, label, color, is_system, sort_order, active)
           VALUES (?, ?, ?, 0, 100, 1)`,
        )
        .bind(code, label, color),
      db
        .prepare(
          `INSERT INTO audit_events (id, return_id, actor, action, details, created_at)
           VALUES (?, NULL, ?, 'STATUS_CREATED', ?, ?)`,
        )
        .bind(crypto.randomUUID(), actorFrom(request), JSON.stringify({ code, label, color }), new Date().toISOString()),
    ]);
    return Response.json({ item: { code, label, color, is_system: 0, sort_order: 100, active: 1 } }, { status: 201 });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível cadastrar o status.', 500);
  }
}
