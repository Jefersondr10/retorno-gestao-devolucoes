'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { AlertCircle, Check, Copy, KeyRound, Loader2, Plus, Power, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { apiFetch } from '@/lib/api-client';
import type { AuthUser, UserRole } from '@/lib/auth';

type ManagedUser = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export function UserManagementSection({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole>('OPERATOR');
  const [temporaryPassword, setTemporaryPassword] = useState(() => generateTemporaryPassword());
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetCredential, setResetCredential] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [createdCredential, setCreatedCredential] = useState<{ username: string; password: string } | null>(null);

  const loadUsers = useCallback(async () => {
    setError('');
    try {
      const response = await apiFetch('/api/admin/users');
      const result = (await response.json()) as { items?: ManagedUser[]; error?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os usuários.');
      setUsers(result.items || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível carregar os usuários.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadUsers(), 0); return () => window.clearTimeout(timer); }, [loadUsers]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4500); return () => window.clearTimeout(timer); }, [notice]);

  async function createUser(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('CREATE');
    setError('');
    try {
      const response = await apiFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, username, role, temporaryPassword }),
      });
      const result = (await response.json()) as { item?: ManagedUser; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível criar o usuário.');
      setNotice(`Usuário “${result.item.display_name}” criado.`);
      setCreatedCredential({ username: result.item.username, password: temporaryPassword });
      setDisplayName('');
      setUsername('');
      setRole('OPERATOR');
      setTemporaryPassword(generateTemporaryPassword());
      await loadUsers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível criar o usuário.');
    } finally {
      setSaving('');
    }
  }

  async function updateUser(user: ManagedUser, changes: { role?: UserRole; active?: boolean; temporaryPassword?: string }) {
    setSaving(user.id);
    setError('');
    try {
      const response = await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const result = (await response.json()) as { item?: ManagedUser; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível atualizar o usuário.');
      setNotice(changes.temporaryPassword ? `Senha temporária de “${user.display_name}” redefinida.` : `Acesso de “${user.display_name}” atualizado.`);
      await loadUsers();
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível atualizar o usuário.');
      return false;
    } finally {
      setSaving('');
    }
  }

  async function toggleUser(user: ManagedUser) {
    const nextActive = !user.active;
    if (!window.confirm(`${nextActive ? 'Reativar' : 'Inativar'} o acesso de “${user.display_name}”?${nextActive ? '' : ' As sessões abertas serão encerradas.'}`)) return;
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
      setError('Não foi possível copiar automaticamente. Selecione o acesso e copie manualmente.');
    }
  }

  if (loading) return <div className="grid min-h-40 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;

  return (
    <div>
      <form onSubmit={createUser} className="rounded-2xl border bg-muted/20 p-4 sm:p-5">
        <div className="mb-4"><h3 className="text-sm font-bold">Criar novo acesso</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">O usuário entrará com a senha temporária e será obrigado a trocá-la.</p></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field id="user-name" label="Nome da pessoa"><Input id="user-name" className="h-11" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ex.: Maria Silva" maxLength={100} required /></Field>
          <Field id="user-username" label="Usuário"><Input id="user-username" className="h-11 lowercase" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="Ex.: maria.silva" autoCapitalize="none" spellCheck={false} maxLength={64} required /></Field>
          <Field id="user-role" label="Perfil"><NativeSelect id="user-role" className="h-11 w-full" value={role} onChange={(event) => setRole(event.target.value as UserRole)}><NativeSelectOption value="OPERATOR">Operação</NativeSelectOption><NativeSelectOption value="ADMIN">Administrador</NativeSelectOption></NativeSelect></Field>
          <Field id="user-password" label="Senha temporária"><div className="flex gap-2"><Input id="user-password" className="h-11 min-w-0 font-mono text-xs" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} minLength={12} maxLength={128} required /><Button type="button" variant="outline" size="icon" className="size-11 shrink-0" onClick={() => setTemporaryPassword(generateTemporaryPassword())} aria-label="Gerar outra senha"><RefreshCw /></Button><Button type="button" variant="outline" size="icon" className="size-11 shrink-0" onClick={() => void copyPassword()} aria-label="Copiar senha">{copied ? <Check /> : <Copy />}</Button></div></Field>
        </div>
        <Button type="submit" className="mt-4 h-11 rounded-xl" disabled={saving === 'CREATE' || !displayName.trim() || !username.trim() || temporaryPassword.length < 12}>{saving === 'CREATE' ? <Loader2 className="animate-spin" /> : <Plus />} Criar usuário</Button>
      </form>

      {error && <Alert variant="destructive" className="mt-4" role="alert"><AlertCircle /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {notice && <Alert className="mt-4 border-emerald-200 bg-emerald-50 text-emerald-900"><Check /><AlertTitle>Pronto</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert>}
      {createdCredential && <Alert className="mt-4 border-primary/25 bg-primary/5"><KeyRound /><AlertTitle>Guarde este acesso temporário</AlertTitle><AlertDescription><p>Envie por um canal seguro. A senha será trocada no primeiro acesso.</p><div className="mt-3 flex flex-col gap-2 rounded-xl border bg-card p-3 font-mono text-xs sm:flex-row sm:items-center"><span className="min-w-0 flex-1 break-all">Usuário: {createdCredential.username}<br />Senha: {createdCredential.password}</span><Button type="button" variant="outline" size="sm" className="h-10 shrink-0" onClick={() => void copyPassword(`Usuário: ${createdCredential.username}\nSenha: ${createdCredential.password}`)}>{copied ? <Check /> : <Copy />} Copiar acesso</Button><Button type="button" variant="ghost" size="sm" className="h-10 shrink-0" onClick={() => setCreatedCredential(null)}>Ocultar</Button></div></AlertDescription></Alert>}

      <div className="mt-5 grid gap-3">
        {users.map((user) => {
          const isCurrent = user.id === currentUser.id;
          return (
            <article key={user.id} className={`flex flex-col gap-4 rounded-2xl border p-4 lg:flex-row lg:items-center ${user.active ? 'bg-card' : 'border-dashed bg-muted/35'}`}>
              <div className="flex min-w-0 flex-1 items-start gap-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound className="size-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-bold">{user.display_name}</h3>{isCurrent && <Badge variant="outline">Você</Badge>}<Badge variant={user.active ? 'secondary' : 'outline'}>{user.active ? 'Ativo' : 'Inativo'}</Badge>{user.must_change_password ? <Badge className="border-amber-200 bg-amber-50 text-amber-800">Troca de senha pendente</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">@{user.username} · último acesso: {user.last_login_at ? formatDate(user.last_login_at) : 'ainda não acessou'}</p></div></div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-40"><Label htmlFor={`role-${user.id}`} className="sr-only">Perfil de {user.display_name}</Label><NativeSelect id={`role-${user.id}`} className="w-full" value={user.role} disabled={saving === user.id || isCurrent} onChange={(event) => void updateUser(user, { role: event.target.value as UserRole })}><NativeSelectOption value="OPERATOR">Operação</NativeSelectOption><NativeSelectOption value="ADMIN">Administrador</NativeSelectOption></NativeSelect></div>
                <Button type="button" size="sm" variant="outline" className="h-11" disabled={saving === user.id || isCurrent} onClick={() => { setResetTarget(user); setResetPassword(generateTemporaryPassword()); setResetCredential(null); }}><KeyRound /> Redefinir senha</Button>
                <Button type="button" size="sm" variant="outline" className="h-11" disabled={saving === user.id || isCurrent} title={isCurrent ? 'Você não pode inativar a própria conta' : undefined} onClick={() => void toggleUser(user)}>{saving === user.id ? <Loader2 className="animate-spin" /> : <Power />} {user.active ? 'Inativar' : 'Reativar'}</Button>
                {isCurrent && <p className="basis-full text-xs leading-5 text-muted-foreground">Para sua conta, use “Trocar minha senha” no menu superior. Outro administrador controla seu perfil.</p>}
              </div>
            </article>
          );
        })}
      </div>

      <Dialog open={Boolean(resetTarget)} onOpenChange={(open) => { if (!open) { setResetTarget(null); setResetPassword(''); setResetCredential(null); } }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          {resetCredential ? <>
            <DialogHeader><DialogTitle>Senha redefinida</DialogTitle><DialogDescription>Guarde e envie este acesso temporário por um canal seguro.</DialogDescription></DialogHeader>
            <div className="rounded-xl border bg-primary/5 p-4 font-mono text-sm"><p className="break-all">Usuário: {resetCredential.username}</p><p className="mt-2 break-all">Senha: {resetCredential.password}</p></div>
            <p className="text-xs leading-5 text-muted-foreground">A pessoa será obrigada a criar outra senha no primeiro acesso.</p>
            <DialogFooter><Button type="button" variant="outline" onClick={() => void copyPassword(`Usuário: ${resetCredential.username}\nSenha: ${resetCredential.password}`)}>{copied ? <Check /> : <Copy />} {copied ? 'Copiado' : 'Copiar acesso'}</Button><Button type="button" onClick={() => { setResetTarget(null); setResetCredential(null); }}>Concluir</Button></DialogFooter>
          </> : <>
            <DialogHeader><DialogTitle>Redefinir senha</DialogTitle><DialogDescription>{resetTarget ? `Crie uma senha temporária para ${resetTarget.display_name}. Todas as sessões abertas serão encerradas.` : ''}</DialogDescription></DialogHeader>
            <form onSubmit={confirmReset} className="space-y-4"><Field id="reset-password" label="Nova senha temporária"><div className="flex gap-2"><Input id="reset-password" className="h-11 font-mono text-xs" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} minLength={12} maxLength={128} required /><Button type="button" variant="outline" size="icon" className="size-11 shrink-0" onClick={() => setResetPassword(generateTemporaryPassword())} aria-label="Gerar outra senha"><RefreshCw /></Button></div></Field><Alert className="border-amber-200 bg-amber-50 text-amber-900"><ShieldCheck /><AlertTitle>Troca obrigatória</AlertTitle><AlertDescription>A pessoa precisará criar outra senha no próximo acesso.</AlertDescription></Alert><DialogFooter><Button type="button" variant="outline" onClick={() => setResetTarget(null)}>Cancelar</Button><Button type="submit" disabled={!resetPassword || saving === resetTarget?.id}>{saving === resetTarget?.id ? <Loader2 className="animate-spin" /> : <KeyRound />} Redefinir</Button></DialogFooter></form>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `Rt-${[...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
