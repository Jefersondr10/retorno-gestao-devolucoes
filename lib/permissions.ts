export const USER_PERMISSIONS = [
  'returns.view',
  'returns.create',
  'returns.edit',
  'returns.finalize',
  'returns.delete',
  'settings.manage',
  'retention.manage',
  'team.manage',
] as const;

export type UserPermission = (typeof USER_PERMISSIONS)[number];

export const USER_PERMISSION_LABELS: Record<UserPermission, string> = {
  'returns.view': 'Ver devoluções',
  'returns.create': 'Registrar devoluções',
  'returns.edit': 'Editar e classificar',
  'returns.finalize': 'Finalizar devoluções',
  'returns.delete': 'Excluir devoluções e arquivos',
  'settings.manage': 'Gerenciar cadastros',
  'retention.manage': 'Gerenciar arquivos e retenção',
  'team.manage': 'Gerenciar usuários e acessos',
};

export const USER_PERMISSION_DESCRIPTIONS: Record<UserPermission, string> = {
  'returns.view':
    'Consultar pendências, finalizadas, fotos, vídeos e histórico.',
  'returns.create':
    'Cadastrar pelo celular, pela câmera ou pelo formulário completo.',
  'returns.edit':
    'Preencher pedido, produtos, condições, status e nota de entrada.',
  'returns.finalize': 'Concluir devoluções que já atenderam a todas as regras.',
  'returns.delete':
    'Apagar devoluções finalizadas e remover vídeos permanentemente.',
  'settings.manage':
    'Cadastrar, editar e inativar status, locais, lojas e condições.',
  'retention.manage':
    'Definir a exclusão automática e executar a limpeza manual.',
  'team.manage':
    'Criar logins, redefinir senhas, suspender e escolher acessos.',
};

export const DEFAULT_OPERATOR_PERMISSIONS: readonly UserPermission[] = [
  'returns.view',
  'returns.create',
  'returns.edit',
  'returns.finalize',
];

export const SETTINGS_PERMISSIONS: readonly UserPermission[] = [
  'settings.manage',
  'retention.manage',
  'team.manage',
];

const USER_PERMISSION_DEPENDENCIES: Partial<
  Record<UserPermission, readonly UserPermission[]>
> = {
  'returns.edit': ['returns.view'],
  'returns.finalize': ['returns.view'],
  'returns.delete': ['returns.view'],
};

const USER_PERMISSION_SET = new Set<string>(USER_PERMISSIONS);

export function isUserPermission(value: unknown): value is UserPermission {
  return typeof value === 'string' && USER_PERMISSION_SET.has(value);
}

export function resolveUserPermissionDependencies(
  values: readonly UserPermission[],
) {
  const selected = new Set<UserPermission>(values.filter(isUserPermission));
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of selected) {
      for (const dependency of USER_PERMISSION_DEPENDENCIES[permission] || []) {
        if (!selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
    }
  }
  return USER_PERMISSIONS.filter((permission) => selected.has(permission));
}

function permissionDependsOn(
  permission: UserPermission,
  dependency: UserPermission,
  visited = new Set<UserPermission>(),
): boolean {
  if (visited.has(permission)) return false;
  visited.add(permission);
  return (USER_PERMISSION_DEPENDENCIES[permission] || []).some(
    (candidate) =>
      candidate === dependency ||
      permissionDependsOn(candidate, dependency, visited),
  );
}

export function toggleUserPermission(
  current: readonly UserPermission[],
  permission: UserPermission,
  checked: boolean,
) {
  if (checked)
    return resolveUserPermissionDependencies([...current, permission]);
  return USER_PERMISSIONS.filter(
    (candidate) =>
      current.includes(candidate) &&
      candidate !== permission &&
      !permissionDependsOn(candidate, permission),
  );
}

export function normalizeUserPermissions(
  value: unknown,
  fallback: readonly UserPermission[] = [],
) {
  if (!Array.isArray(value)) return resolveUserPermissionDependencies(fallback);
  return resolveUserPermissionDependencies(value.filter(isUserPermission));
}

export function parseStoredPermissions(value: unknown) {
  if (Array.isArray(value)) return normalizeUserPermissions(value);
  if (typeof value !== 'string' || !value) return [];
  try {
    return normalizeUserPermissions(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

type PermissionSubject = {
  role: string;
  permissions: readonly UserPermission[];
};

export function effectiveUserPermissions(subject: PermissionSubject) {
  return subject.role === 'ADMIN'
    ? [...USER_PERMISSIONS]
    : resolveUserPermissionDependencies(subject.permissions);
}

export function hasUserPermission(
  subject: PermissionSubject | null | undefined,
  permission: UserPermission,
) {
  return (
    subject?.role === 'ADMIN' ||
    Boolean(subject?.permissions.includes(permission))
  );
}

export function hasAnyUserPermission(
  subject: PermissionSubject | null | undefined,
  permissions: readonly UserPermission[],
) {
  return (
    subject?.role === 'ADMIN' ||
    permissions.some((permission) => subject?.permissions.includes(permission))
  );
}

export function getFirstAllowedRoute(subject: PermissionSubject) {
  if (hasUserPermission(subject, 'returns.view')) return '/';
  if (hasUserPermission(subject, 'returns.create')) return '/receber';
  if (hasAnyUserPermission(subject, SETTINGS_PERMISSIONS))
    return '/configuracoes';
  return '/sem-acesso';
}
