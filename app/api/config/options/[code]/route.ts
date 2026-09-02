import { actorLabel, authenticateApi } from '@/lib/auth';
import { apiError, ensureSchema, getBindings } from '@/lib/data';

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

async function usageCount(option: OptionRecord, organizationId: string) {
  const { db } = getBindings();
  if (option.type === 'STORE') return Number((await db.prepare('SELECT COUNT(*) AS count FROM returns WHERE organization_id = ? AND store = ?').bind(organizationId, option.label).first<{ count: number }>())?.count || 0);
  if (option.type === 'LOCATION') return Number((await db.prepare('SELECT COUNT(*) AS count FROM returns WHERE organization_id = ? AND received_location = ?').bind(organizationId, option.label).first<{ count: number }>())?.count || 0);
  return Number((await db.prepare('SELECT COUNT(*) AS count FROM return_items i INNER JOIN returns r ON r.id = i.return_id WHERE r.organization_id = ? AND i.condition = ?').bind(organizationId, option.code).first<{ count: number }>())?.count || 0);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { code } = await context.params;
    const { db } = getBindings();
    const current = await db.prepare('SELECT * FROM tenant_config_options WHERE organization_id = ? AND code = ?').bind(auth.user.organizationId, code).first<OptionRecord>();
    if (!current) return apiError('Cadastro não encontrado.', 404);
    const body = (await request.json()) as { label?: string; color?: string; active?: boolean };
    const label = body.label?.trim() || current.label;
    const color = body.color === undefined
      ? current.color
      : /^#[0-9a-f]{6}$/i.test(body.color.trim())
        ? body.color.trim().toLowerCase()
        : '';
    const active = body.active === undefined ? current.active : body.active ? 1 : 0;
    if (!label || label.length > 120) return apiError('Informe um nome com até 120 caracteres.', 422);
    if (!color) return apiError('Selecione uma cor válida.', 422);
    const duplicate = await db
      .prepare('SELECT code FROM tenant_config_options WHERE organization_id = ? AND type = ? AND LOWER(label) = LOWER(?) AND code != ? LIMIT 1')
      .bind(auth.user.organizationId, current.type, label, code)
      .first();
    if (duplicate) return apiError('Já existe um cadastro com este nome.', 409);

    const operations: D1PreparedStatement[] = [
      db.prepare('UPDATE tenant_config_options SET label = ?, color = ?, active = ? WHERE organization_id = ? AND code = ?').bind(label, color, active, auth.user.organizationId, code),
    ];
    if (label !== current.label && current.type === 'STORE') operations.push(db.prepare('UPDATE returns SET store = ? WHERE organization_id = ? AND store = ?').bind(label, auth.user.organizationId, current.label));
    if (label !== current.label && current.type === 'LOCATION') operations.push(db.prepare('UPDATE returns SET received_location = ? WHERE organization_id = ? AND received_location = ?').bind(label, auth.user.organizationId, current.label));
    const now = new Date().toISOString();
    operations.push(
      db
        .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'CONFIG_OPTION_UPDATED', ?, ?)")
        .bind(crypto.randomUUID(), auth.user.organizationId, actorLabel(auth.user), JSON.stringify({ code, previous: current, next: { label, color, active } }), now),
    );
    await db.batch(operations);
    return Response.json({ item: { ...current, label, color, active, usage_count: await usageCount({ ...current, label, color, active }, auth.user.organizationId) } });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível atualizar o cadastro.', 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await authenticateApi(request, { roles: ['ADMIN'] });
    if ('response' in auth) return auth.response;
    await ensureSchema();
    const { code } = await context.params;
    const { db } = getBindings();
    const current = await db.prepare('SELECT * FROM tenant_config_options WHERE organization_id = ? AND code = ?').bind(auth.user.organizationId, code).first<OptionRecord>();
    if (!current) return apiError('Cadastro não encontrado.', 404);
    if (current.is_system) return apiError('Cadastro padrão do sistema não pode ser excluído. Você pode inativá-lo.', 409);
    const usage = await usageCount(current, auth.user.organizationId);
    if (usage > 0) return apiError(`Este cadastro está em uso em ${usage} devolução(ões). Inative-o em vez de excluir.`, 409);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('DELETE FROM tenant_config_options WHERE organization_id = ? AND code = ?').bind(auth.user.organizationId, code),
      db
        .prepare("INSERT INTO audit_events (id, organization_id, return_id, actor, action, details, created_at) VALUES (?, ?, NULL, ?, 'CONFIG_OPTION_DELETED', ?, ?)")
        .bind(crypto.randomUUID(), auth.user.organizationId, actorLabel(auth.user), JSON.stringify(current), now),
    ]);
    return Response.json({ deleted: true });
  } catch (error) {
    console.error(error);
    return apiError('Não foi possível excluir o cadastro.', 500);
  }
}
