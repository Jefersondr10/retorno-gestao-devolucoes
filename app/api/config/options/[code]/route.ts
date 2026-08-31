import { actorFrom, apiError, ensureSchema, getBindings } from '@/lib/data';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ code: string }> };

type OptionRecord = {
  code: string;
  type: 'LOCATION' | 'STORE' | 'CONDITION';
  label: string;
  color: string;
  is_system: number;
  sort_order: number;
  active: number;
  requires_invoice: number;
  requires_notes: number;
};

async function usageCount(option: OptionRecord) {
  const { db } = getBindings();
  if (option.type === 'STORE') return Number((await db.prepare('SELECT COUNT(*) AS count FROM returns WHERE store = ?').bind(option.label).first<{ count: number }>())?.count || 0);
  if (option.type === 'LOCATION') return Number((await db.prepare('SELECT COUNT(*) AS count FROM returns WHERE received_location = ?').bind(option.label).first<{ count: number }>())?.count || 0);
  return Number((await db.prepare('SELECT COUNT(*) AS count FROM return_items WHERE condition = ?').bind(option.code).first<{ count: number }>())?.count || 0);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    await ensureSchema();
    const { code } = await context.params;
    const { db } = getBindings();
    const current = await db.prepare('SELECT * FROM config_options WHERE code = ?').bind(code).first<OptionRecord>();
    if (!current) return apiError('Cadastro não encontrado.', 404);
    const body = (await request.json()) as { label?: string; active?: boolean };
    const label = body.label?.trim() || current.label;
    const active = body.active === undefined ? current.active : body.active ? 1 : 0;
    if (!label || label.length > 120) return apiError('Informe um nome com até 120 caracteres.', 422);
    const duplicate = await db
      .prepare('SELECT code FROM config_options WHERE type = ? AND LOWER(label) = LOWER(?) AND code != ? LIMIT 1')
      .bind(current.type, label, code)
      .first();
    if (duplicate) return apiError('Já existe um cadastro com este nome.', 409);

    const operations: D1PreparedStatement[] = [
      db.prepare('UPDATE config_options SET label = ?, active = ? WHERE code = ?').bind(label, active, code),
    ];
    if (label !== current.label && current.type === 'STORE') operations.push(db.prepare('UPDATE returns SET store = ? WHERE store = ?').bind(label, current.label));
    if (label !== current.label && current.type === 'LOCATION') operations.push(db.prepare('UPDATE returns SET received_location = ? WHERE received_location = ?').bind(label, current.label));
    const now = new Date().toISOString();
    operations.push(
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'CONFIG_OPTION_UPDATED', ?, ?)")
        .bind(crypto.randomUUID(), actorFrom(request), JSON.stringify({ code, previous: current, next: { label, active } }), now),
    );
    await db.batch(operations);
    return Response.json({ item: { ...current, label, active, usage_count: await usageCount({ ...current, label, active }) } });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível atualizar o cadastro.', 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    await ensureSchema();
    const { code } = await context.params;
    const { db } = getBindings();
    const current = await db.prepare('SELECT * FROM config_options WHERE code = ?').bind(code).first<OptionRecord>();
    if (!current) return apiError('Cadastro não encontrado.', 404);
    if (current.is_system) return apiError('Cadastro padrão do sistema não pode ser excluído. Você pode inativá-lo.', 409);
    const usage = await usageCount(current);
    if (usage > 0) return apiError(`Este cadastro está em uso em ${usage} devolução(ões). Inative-o em vez de excluir.`, 409);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('DELETE FROM config_options WHERE code = ?').bind(code),
      db
        .prepare("INSERT INTO audit_events (id, return_id, actor, action, details, created_at) VALUES (?, NULL, ?, 'CONFIG_OPTION_DELETED', ?, ?)")
        .bind(crypto.randomUUID(), actorFrom(request), JSON.stringify(current), now),
    ]);
    return Response.json({ deleted: true });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível excluir o cadastro.', 500);
  }
}
