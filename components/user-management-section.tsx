'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCheck,
  UserRound,
  UsersRound,
  UserX,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { apiFetch } from '@/lib/api-client';
import type { AuthUser, UserRole } from '@/lib/auth';
import {
  DEFAULT_OPERATOR_PERMISSIONS,
  effectiveUserPermissions,
  toggleUserPermission,
  USER_PERMISSION_DESCRIPTIONS,
  USER_PERMISSION_LABELS,
  USER_PERMISSIONS,
  type UserPermission,
} from '@/lib/permissions';
import { cn } from '@/lib/utils';

type ManagedUser = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  permissions: UserPermission[];
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  approval_status?: 'APPROVED' | 'PENDING' | 'REJECTED';
  provider?: 'GOOGLE' | 'PASSWORD';
  google_email?: string | null;
  password_login_enabled?: number | boolean;
};

type TeamActivity = {
  id: string;
  actor: string;
  action: 'USER_CREATED' | 'USER_UPDATED';
  details: string | null;
  created_at: string;
};

type UserChanges = {
  displayName?: string;
  role?: UserRole;
  permissions?: UserPermission[];
  active?: boolean;
  temporaryPassword?: string;
};

export function UserManagementSection({
  currentUser,
}: {
  currentUser: AuthUser;
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [activities, setActivities] = useState<TeamActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole>('OPERATOR');
  const [permissions, setPermissions] = useState<UserPermission[]>([
    ...DEFAULT_OPERATOR_PERMISSIONS,
  ]);
  const [temporaryPassword, setTemporaryPassword] = useState(() =>
    generateTemporaryPassword(),
  );
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetCredential, setResetCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [createdCredential, setCreatedCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);

  const grantablePermissions = useMemo(
    () =>
      USER_PERMISSIONS.filter(
        (permission) =>
          currentUser.role === 'ADMIN' ||
          (permission !== 'team.manage' &&
            currentUser.permissions.includes(permission)),
      ),
    [currentUser],
  );

  const loadUsers = useCallback(async () => {
    setError('');
    try {
      const response = await apiFetch('/api/admin/users');
      const result = (await response.json()) as {
        items?: ManagedUser[];
        activities?: TeamActivity[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || 'Não foi possível carregar os usuários.',
        );
      setUsers(result.items || []);
      setActivities(result.activities || []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível carregar os usuários.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timer);
  }, [loadUsers]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function createUser(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('CREATE');
    setError('');
    try {
      const selectedPermissions =
        role === 'ADMIN' ? [...USER_PERMISSIONS] : permissions;
      const response = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName,
          username,
          role,
          permissions: selectedPermissions,
          temporaryPassword,
        }),
      });
      const result = (await response.json()) as {
        item?: ManagedUser;
        error?: string;
      };
      if (!response.ok || !result.item)
        throw new Error(result.error || 'Não foi possível criar o usuário.');
      setNotice(
        `Usuário “${result.item.display_name}” criado com ${accessCountLabel(result.item.permissions.length)}.`,
      );
      setCreatedCredential({
        username: result.item.username,
        password: temporaryPassword,
      });
      setDisplayName('');
      setUsername('');
      setRole('OPERATOR');
      setPermissions([...DEFAULT_OPERATOR_PERMISSIONS]);
      setTemporaryPassword(generateTemporaryPassword());
      await loadUsers();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível criar o usuário.',
      );
    } finally {
      setSaving('');
    }
  }

  async function updateUser(user: ManagedUser, changes: UserChanges) {
    setSaving(user.id);
    setError('');
    try {
      const response = await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const result = (await response.json()) as {
        item?: ManagedUser;
        error?: string;
      };
      if (!response.ok || !result.item)
        throw new Error(
          result.error || 'Não foi possível atualizar o usuário.',
        );
      setNotice(
        changes.temporaryPassword
          ? `Senha temporária de “${user.display_name}” redefinida.`
          : `Acessos de “${result.item.display_name}” atualizados.`,
      );
      await loadUsers();
      return true;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível atualizar o usuário.',
      );
      return false;
    } finally {
      setSaving('');
    }
  }

  async function toggleUser(user: ManagedUser) {
    const nextActive = !user.active;
    if (
      !window.confirm(
        `${nextActive ? 'Reativar' : 'Inativar'} o acesso de “${user.display_name}”?${nextActive ? '' : ' As sessões abertas serão encerradas.'}`,
      )
    )
      return;
    await updateUser(user, { active: nextActive });
  }

  async function confirmReset(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetTarget) return;
    const target = resetTarget;
    const password = resetPassword;
    if (!(await updateUser(target, { temporaryPassword: password }))) return;
    setResetCredential({ username: target.username, password });
    setResetPassword('');
  }

  async function copyPassword(value = temporaryPassword) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(
        'Não foi possível copiar automaticamente. Selecione o acesso e copie manualmente.',
      );
    }
  }

  const activeUsers = users.filter((user) => Boolean(user.active)).length;
  const inactiveUsers = users.length - activeUsers;

  if (loading)
    return (
      <div className="grid min-h-40 place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={<UserCheck />}
          label="Usuários ativos"
          value={String(activeUsers)}
          tone="success"
        />
        <StatCard
          icon={<UserX />}
          label="Usuários inativos"
          value={String(inactiveUsers)}
        />
        <StatCard
          icon={<ShieldCheck />}
          label="Seus acessos"
          value={
            currentUser.role === 'ADMIN'
              ? 'Acesso total'
              : accessCountLabel(currentUser.permissions.length)
          }
          tone="primary"
        />
      </div>

      <form
        onSubmit={createUser}
        className="rounded-2xl border bg-muted/20 p-4 sm:p-5"
      >
        <div className="mb-5">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Plus className="size-4" />
            </span>
            <h3 className="text-base font-bold">Cadastrar usuário</h3>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Crie o login e marque exatamente o que essa pessoa poderá fazer no
            sistema.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field id="user-name" label="Nome da pessoa">
            <Input
              id="user-name"
              className="h-11"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Ex.: Maria Silva"
              maxLength={100}
              required
            />
          </Field>
          <Field id="user-username" label="Usuário">
            <Input
              id="user-username"
              className="h-11 lowercase"
              value={username}
              onChange={(event) =>
                setUsername(event.target.value.toLowerCase())
              }
              placeholder="Ex.: maria.silva"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={64}
              required
            />
          </Field>
          <Field id="user-role" label="Perfil">
            <NativeSelect
              id="user-role"
              className="h-11 w-full"
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
            >
              <NativeSelectOption value="OPERATOR">
                Acesso personalizado
              </NativeSelectOption>
              {currentUser.role === 'ADMIN' && (
                <NativeSelectOption value="ADMIN">
                  Administrador · acesso total
                </NativeSelectOption>
              )}
            </NativeSelect>
          </Field>
          <Field id="user-password" label="Senha temporária">
            <div className="flex gap-2">
              <Input
                id="user-password"
                className="h-11 min-w-0 font-mono text-xs"
                value={temporaryPassword}
                onChange={(event) => setTemporaryPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                onClick={() =>
                  setTemporaryPassword(generateTemporaryPassword())
                }
                aria-label="Gerar outra senha"
              >
                <RefreshCw />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                onClick={() => void copyPassword()}
                aria-label="Copiar senha"
              >
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
          </Field>
        </div>

        <div className="mt-5">
          <PermissionChecklist
            value={role === 'ADMIN' ? [...USER_PERMISSIONS] : permissions}
            onChange={setPermissions}
            available={grantablePermissions}
            disabled={role === 'ADMIN'}
            administrator={role === 'ADMIN'}
          />
        </div>

        <Button
          type="submit"
          className="mt-5 h-11 rounded-xl"
          disabled={
            saving === 'CREATE' ||
            !displayName.trim() ||
            !username.trim() ||
            temporaryPassword.length < 12 ||
            (role === 'OPERATOR' && permissions.length === 0)
          }
        >
          {saving === 'CREATE' ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Plus />
          )}{' '}
          Criar usuário com estes acessos
        </Button>
      </form>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertTitle>Não foi possível concluir</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
          <Check />
          <AlertTitle>Pronto</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {createdCredential && (
        <Alert className="border-primary/25 bg-primary/5">
          <KeyRound />
          <AlertTitle>Guarde este acesso temporário</AlertTitle>
          <AlertDescription>
            <p>
              Envie por um canal seguro. A senha será trocada no primeiro
              acesso.
            </p>
            <div className="mt-3 flex flex-col gap-2 rounded-xl border bg-card p-3 font-mono text-xs sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1 break-all">
                Usuário: {createdCredential.username}
                <br />
                Senha: {createdCredential.password}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 shrink-0"
                onClick={() =>
                  void copyPassword(
                    `Usuário: ${createdCredential.username}\nSenha: ${createdCredential.password}`,
                  )
                }
              >
                {copied ? <Check /> : <Copy />} Copiar acesso
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 shrink-0"
                onClick={() => setCreatedCredential(null)}
              >
                Ocultar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-bold">Equipe cadastrada</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Edite o nome, o perfil e as caixas de acesso de cada pessoa.
            </p>
          </div>
          <Badge variant="outline">
            {users.length} {users.length === 1 ? 'usuário' : 'usuários'}
          </Badge>
        </div>
        <div className="grid gap-4">
          {users.map((user) => (
            <ManagedUserCard
              key={`${user.id}-${user.updated_at}-${user.permissions.join('.')}`}
              user={user}
              currentUser={currentUser}
              grantablePermissions={grantablePermissions}
              saving={saving === user.id}
              onSave={(changes) => updateUser(user, changes)}
              onToggle={() => void toggleUser(user)}
              onResetPassword={() => {
                setResetTarget(user);
                setResetPassword(generateTemporaryPassword());
                setResetCredential(null);
              }}
            />
          ))}
          {users.length === 0 && (
            <div className="rounded-2xl border border-dashed bg-muted/15 px-5 py-10 text-center">
              <UsersRound className="mx-auto size-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">
                Nenhum usuário cadastrado
              </p>
            </div>
          )}
        </div>
      </section>

      {activities.length > 0 && (
        <section className="rounded-2xl border bg-muted/15 p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Activity className="size-5" />
            </span>
            <div>
              <h3 className="text-sm font-bold">
                Atividades recentes da equipe
              </h3>
              <p className="text-xs text-muted-foreground">
                Quem criou ou alterou os acessos.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {activities.slice(0, 8).map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        </section>
      )}

      <Dialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setResetTarget(null);
            setResetPassword('');
            setResetCredential(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          {resetCredential ? (
            <>
              <DialogHeader>
                <DialogTitle>Senha redefinida</DialogTitle>
                <DialogDescription>
                  Guarde e envie este acesso temporário por um canal seguro.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-xl border bg-primary/5 p-4 font-mono text-sm">
                <p className="break-all">Usuário: {resetCredential.username}</p>
                <p className="mt-2 break-all">
                  Senha: {resetCredential.password}
                </p>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                A pessoa será obrigada a criar outra senha no primeiro acesso.
              </p>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void copyPassword(
                      `Usuário: ${resetCredential.username}\nSenha: ${resetCredential.password}`,
                    )
                  }
                >
                  {copied ? <Check /> : <Copy />}{' '}
                  {copied ? 'Copiado' : 'Copiar acesso'}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setResetTarget(null);
                    setResetCredential(null);
                  }}
                >
                  Concluir
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Redefinir senha</DialogTitle>
                <DialogDescription>
                  {resetTarget
                    ? `Crie uma senha temporária para ${resetTarget.display_name}. Todas as sessões abertas serão encerradas.`
                    : ''}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={confirmReset} className="space-y-4">
                <Field id="reset-password" label="Nova senha temporária">
                  <div className="flex gap-2">
                    <Input
                      id="reset-password"
                      className="h-11 font-mono text-xs"
                      value={resetPassword}
                      onChange={(event) => setResetPassword(event.target.value)}
                      minLength={12}
                      maxLength={128}
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-11 shrink-0"
                      onClick={() =>
                        setResetPassword(generateTemporaryPassword())
                      }
                      aria-label="Gerar outra senha"
                    >
                      <RefreshCw />
                    </Button>
                  </div>
                </Field>
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <ShieldCheck />
                  <AlertTitle>Troca obrigatória</AlertTitle>
                  <AlertDescription>
                    A pessoa precisará criar outra senha no próximo acesso.
                  </AlertDescription>
                </Alert>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setResetTarget(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={!resetPassword || saving === resetTarget?.id}
                  >
                    {saving === resetTarget?.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <KeyRound />
                    )}{' '}
                    Redefinir
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ManagedUserCard({
  user,
  currentUser,
  grantablePermissions,
  saving,
  onSave,
  onToggle,
  onResetPassword,
}: {
  user: ManagedUser;
  currentUser: AuthUser;
  grantablePermissions: UserPermission[];
  saving: boolean;
  onSave: (changes: UserChanges) => Promise<boolean>;
  onToggle: () => void;
  onResetPassword: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [role, setRole] = useState<UserRole>(user.role);
  const [permissions, setPermissions] = useState<UserPermission[]>(
    effectiveUserPermissions(user),
  );
  const isCurrent = user.id === currentUser.id;
  const protectedFromManager =
    currentUser.role !== 'ADMIN' &&
    (user.role === 'ADMIN' ||
      user.permissions.includes('team.manage') ||
      user.permissions.some(
        (permission) => !currentUser.permissions.includes(permission),
      ));
  const editable = !isCurrent && !protectedFromManager;
  const effectivePermissions =
    role === 'ADMIN' ? [...USER_PERMISSIONS] : permissions;
  const dirty =
    displayName.trim() !== user.display_name ||
    role !== user.role ||
    effectivePermissions.join('|') !== effectiveUserPermissions(user).join('|');
  const googleAccount = provider(user) === 'GOOGLE';
  const passwordEnabled = passwordLoginEnabled(user);

  return (
    <article
      className={cn(
        'rounded-2xl border p-4 sm:p-5',
        user.active ? 'bg-card' : 'border-dashed bg-muted/35',
      )}
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-xl',
              googleAccount
                ? 'bg-blue-50 font-bold text-blue-700'
                : 'bg-primary/10 text-primary',
            )}
          >
            {googleAccount ? 'G' : <UserRound className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-bold">
                {user.display_name}
              </h3>
              {isCurrent && <Badge variant="outline">Você</Badge>}
              <Badge variant={user.role === 'ADMIN' ? 'default' : 'outline'}>
                {user.role === 'ADMIN' ? 'Administrador' : 'Personalizado'}
              </Badge>
              <Badge variant={user.active ? 'secondary' : 'outline'}>
                {user.active ? 'Ativo' : 'Inativo'}
              </Badge>
              <Badge variant="outline">
                {user.role === 'ADMIN'
                  ? 'Acesso total'
                  : accessCountLabel(user.permissions.length)}
              </Badge>
              {passwordEnabled && user.must_change_password ? (
                <Badge className="border-amber-200 bg-amber-50 text-amber-800">
                  Troca de senha pendente
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {googleAccount && user.google_email
                ? user.google_email
                : `@${user.username}`}{' '}
              · último acesso:{' '}
              {user.last_login_at
                ? formatDate(user.last_login_at)
                : 'ainda não acessou'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {passwordEnabled && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10"
              disabled={saving || !editable}
              onClick={onResetPassword}
            >
              <KeyRound /> Redefinir senha
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10"
            disabled={saving || !editable}
            title={
              isCurrent ? 'Você não pode inativar a própria conta' : undefined
            }
            onClick={onToggle}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Power />}{' '}
            {user.active ? 'Inativar' : 'Reativar'}
          </Button>
        </div>
      </div>

      {editable ? (
        <div className="mt-5 border-t pt-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`name-${user.id}`} label="Nome">
              <Input
                id={`name-${user.id}`}
                className="h-11"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={100}
              />
            </Field>
            <Field id={`role-${user.id}`} label="Perfil">
              <NativeSelect
                id={`role-${user.id}`}
                className="h-11 w-full"
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
              >
                <NativeSelectOption value="OPERATOR">
                  Acesso personalizado
                </NativeSelectOption>
                {currentUser.role === 'ADMIN' && (
                  <NativeSelectOption value="ADMIN">
                    Administrador · acesso total
                  </NativeSelectOption>
                )}
              </NativeSelect>
            </Field>
          </div>
          <div className="mt-4">
            <PermissionChecklist
              value={effectivePermissions}
              onChange={setPermissions}
              available={grantablePermissions}
              disabled={role === 'ADMIN'}
              administrator={role === 'ADMIN'}
              compact
            />
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {dirty
                ? 'Existem alterações ainda não salvas.'
                : 'Acessos atualizados.'}
            </p>
            <Button
              type="button"
              className="h-11"
              disabled={
                saving ||
                !dirty ||
                !displayName.trim() ||
                (role === 'OPERATOR' && permissions.length === 0)
              }
              onClick={() =>
                void onSave({
                  displayName: displayName.trim(),
                  role,
                  permissions: effectivePermissions,
                })
              }
            >
              {saving ? <Loader2 className="animate-spin" /> : <Save />} Salvar
              alterações
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
          {isCurrent
            ? 'Por segurança, outra pessoa com permissão de usuários deve alterar os seus próprios acessos.'
            : 'Este acesso é protegido e só pode ser alterado por um administrador.'}
        </div>
      )}
    </article>
  );
}

function PermissionChecklist({
  value,
  onChange,
  available,
  disabled = false,
  administrator = false,
  compact = false,
}: {
  value: UserPermission[];
  onChange: (value: UserPermission[]) => void;
  available: UserPermission[];
  disabled?: boolean;
  administrator?: boolean;
  compact?: boolean;
}) {
  const checklistId = useId();
  const visiblePermissions = administrator ? [...USER_PERMISSIONS] : available;
  const selectedAll =
    visiblePermissions.length > 0 &&
    visiblePermissions.every((permission) => value.includes(permission));

  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">Acessos permitidos</legend>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Acessos permitidos</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {administrator
              ? 'Administrador possui acesso total ao sistema.'
              : 'Marque as áreas e ações liberadas para esta pessoa.'}
          </p>
        </div>
        {!disabled && (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={selectedAll}
              onClick={() => onChange([...visiblePermissions])}
            >
              Selecionar tudo
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={value.length === 0}
              onClick={() => onChange([])}
            >
              Limpar tudo
            </Button>
          </div>
        )}
      </div>
      <div
        className={cn(
          'grid gap-2',
          compact ? 'md:grid-cols-2' : 'sm:grid-cols-2',
        )}
      >
        {visiblePermissions.map((permission) => {
          const checked = administrator || value.includes(permission);
          const controlId = `${checklistId}-${permission}`;
          return (
            <label
              key={permission}
              htmlFor={controlId}
              className={cn(
                'flex min-h-20 items-start gap-3 rounded-xl border p-3.5 transition',
                disabled
                  ? 'cursor-default'
                  : 'cursor-pointer hover:border-primary/30 hover:bg-primary/[0.03]',
                checked
                  ? 'border-primary/35 border-l-4 border-l-primary bg-primary/[0.07]'
                  : 'bg-card',
              )}
            >
              <Checkbox
                id={controlId}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(next) =>
                  onChange(
                    toggleUserPermission(value, permission, Boolean(next)),
                  )
                }
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {USER_PERMISSION_LABELS[permission]}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {USER_PERMISSION_DESCRIPTIONS[permission]}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'primary';
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-4">
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-xl [&>svg]:size-5',
          tone === 'success'
            ? 'bg-emerald-100 text-emerald-700'
            : tone === 'primary'
              ? 'bg-primary/10 text-primary'
              : 'bg-muted text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-lg font-bold">{value}</p>
      </div>
    </div>
  );
}

function ActivityRow({ activity }: { activity: TeamActivity }) {
  const details = parseActivityDetails(activity.details);
  const target = details.displayName || details.username || 'um usuário';
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card px-3 py-3">
      <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-semibold">{activity.actor}</span>{' '}
          {activity.action === 'USER_CREATED' ? 'criou' : 'alterou'}{' '}
          <span className="font-semibold">{target}</span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDate(activity.created_at)}
        </p>
      </div>
    </div>
  );
}

function parseActivityDetails(value: string | null) {
  if (!value) return {} as { displayName?: string; username?: string };
  try {
    return JSON.parse(value) as { displayName?: string; username?: string };
  } catch {
    return {};
  }
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `Rt-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
}

function provider(user: ManagedUser) {
  return user.provider === 'GOOGLE' ? 'GOOGLE' : 'PASSWORD';
}

function passwordLoginEnabled(user: ManagedUser) {
  if (typeof user.password_login_enabled === 'boolean')
    return user.password_login_enabled;
  if (typeof user.password_login_enabled === 'number')
    return user.password_login_enabled === 1;
  return provider(user) === 'PASSWORD';
}

function accessCountLabel(count: number) {
  return `${count} ${count === 1 ? 'acesso' : 'acessos'}`;
}
