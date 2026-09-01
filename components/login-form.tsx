'use client';

import { useState, type SyntheticEvent } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, LogIn, PackageCheck, UserRound } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GoogleLoginButton } from '@/components/google-login-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password, returnTo }),
      });
      const result = (await response.json()) as { error?: string; destination?: string };
      if (!response.ok || !result.destination) throw new Error(result.error || 'Não foi possível entrar.');
      window.location.replace(result.destination);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível entrar.');
      setLoading(false);
    }
  }

  return (
    <main className="app-shell relative grid min-h-screen place-items-center overflow-hidden px-4 py-8 safe-bottom safe-top sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 top-[-7rem] size-80 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-24 size-96 rounded-full bg-amber-300/10 blur-3xl" />
      <div className="relative w-full max-w-[430px]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-[0_12px_30px_rgb(13_96_83/24%)]"><PackageCheck className="size-6" /></span>
          <div><p className="text-xl font-bold tracking-[-0.03em]">Retorno</p><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Gestão de devoluções</p></div>
        </div>
        <Card className="border-0 bg-card/95 p-6 shadow-[var(--shadow-floating)] ring-1 ring-border/80 backdrop-blur sm:p-8">
          <div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><LockKeyhole className="size-5" /></span><h1 className="display-title mt-4 text-2xl">Entrar no sistema</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Use seu acesso da equipe ou continue com uma conta Google.</p></div>
          <form className="mt-7 space-y-5" onSubmit={submit}>
            <div className="space-y-2"><Label htmlFor="username">Usuário</Label><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} className="h-12 rounded-xl pl-10" placeholder="Digite seu usuário" autoComplete="username" autoCapitalize="none" spellCheck={false} required /></div></div>
            <div className="space-y-2"><Label htmlFor="password">Senha</Label><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 rounded-xl px-10" placeholder="Digite sua senha" autoComplete="current-password" required /><button type="button" className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></div>
            {error && <Alert variant="destructive" role="alert"><AlertCircle /><AlertTitle>Não foi possível entrar</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base shadow-[0_10px_24px_rgb(13_96_83/20%)]" disabled={loading || !username.trim() || !password}>{loading ? <Loader2 className="animate-spin" /> : <LogIn />} {loading ? 'Entrando…' : 'Entrar'}</Button>
          </form>
          <div className="my-6 flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-border" /><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">ou</span><span className="h-px flex-1 bg-border" /></div>
          <GoogleLoginButton returnTo={returnTo} />
          <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">Não consegue entrar com usuário e senha? Peça a um administrador para redefinir seu acesso.</p>
        </Card>
        <p className="mt-5 text-center text-[11px] text-muted-foreground">Acesso restrito à equipe autorizada.</p>
      </div>
    </main>
  );
}
