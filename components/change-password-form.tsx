'use client';

import { useState, type SyntheticEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, LogOut, PackageCheck, Save } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth';

export function ChangePasswordForm({ user }: { user: AuthUser }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError('A confirmação não é igual à nova senha.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await apiFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const result = (await response.json()) as { error?: string; destination?: string };
      if (!response.ok) throw new Error(result.error || 'Não foi possível trocar a senha.');
      window.location.replace(result.destination || '/');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível trocar a senha.');
      setLoading(false);
    }
  }

  async function logout() {
    setError('');
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || 'Não foi possível sair. Tente novamente.');
      }
      window.location.replace('/login');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível sair. Tente novamente.');
    }
  }

  return (
    <main className="app-shell grid min-h-[100dvh] place-items-center px-4 py-8 safe-bottom safe-top sm:px-6">
      <div className="w-full max-w-[480px]">
        <div className="mb-6 flex min-w-0 items-center justify-center gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground"><PackageCheck className="size-6" /></span><div className="min-w-0"><p className="text-xl font-bold tracking-[-0.03em]">Retorno</p><p className="max-w-72 truncate text-xs text-muted-foreground">Olá, {user.displayName}</p></div></div>
        <Card className="border-0 bg-card p-6 shadow-[var(--shadow-floating)] ring-1 ring-border/80 sm:p-8">
          <div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-amber-100 text-amber-800"><LockKeyhole className="size-5" /></span><h1 className="display-title mt-4 text-2xl">Crie sua nova senha</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{user.mustChangePassword ? 'A senha temporária precisa ser trocada antes de continuar.' : 'Digite a senha atual e escolha uma nova senha segura.'}</p></div>
          <form className="mt-7 space-y-4" onSubmit={submit}>
            <PasswordField id="current-password" label="Senha atual ou temporária" value={currentPassword} onChange={setCurrentPassword} visible={showPassword} autoComplete="current-password" />
            <PasswordField id="new-password" label="Nova senha" value={newPassword} onChange={setNewPassword} visible={showPassword} autoComplete="new-password" hint="Use pelo menos 12 caracteres." />
            <PasswordField id="confirm-password" label="Confirmar nova senha" value={confirmation} onChange={setConfirmation} visible={showPassword} autoComplete="new-password" />
            <button type="button" className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setShowPassword((current) => !current)} aria-pressed={showPassword}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{showPassword ? 'Ocultar senhas' : 'Mostrar senhas'}</button>
            {error && <Alert variant="destructive" role="alert"><AlertCircle /><AlertTitle>Confira os dados</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={loading || !currentPassword || !newPassword || !confirmation}>{loading ? <Loader2 className="animate-spin" /> : <Save />} {loading ? 'Salvando…' : 'Salvar nova senha'}</Button>
          </form>
          <Button type="button" variant="ghost" className="mt-3 h-11 w-full text-muted-foreground" onClick={() => void logout()}><LogOut /> Sair</Button>
        </Card>
      </div>
    </main>
  );
}

function PasswordField({ id, label, value, onChange, visible, autoComplete, hint }: { id: string; label: string; value: string; onChange: (value: string) => void; visible: boolean; autoComplete: string; hint?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} type={visible ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} className="h-12 rounded-xl" autoComplete={autoComplete} required />{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}
