'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { AlertCircle, Building2, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, PackageCheck, UserPlus, UserRound } from 'lucide-react';
import Link from 'next/link';

import { GoogleLoginButton } from '@/components/google-login-button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type GoogleOnboarding = {
  email: string;
  displayName: string;
  expiresAt: string;
};

export function SignupForm({ returnTo, googleOnboarding }: { returnTo: string; googleOnboarding: boolean }) {
  const [displayName, setDisplayName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [googleIdentity, setGoogleIdentity] = useState<GoogleOnboarding | null>(null);
  const [checkingGoogle, setCheckingGoogle] = useState(googleOnboarding);

  useEffect(() => {
    if (!googleOnboarding) return;
    const controller = new AbortController();
    void fetch('/api/auth/google/onboarding', { credentials: 'same-origin', signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { item?: GoogleOnboarding; error?: string };
        if (!response.ok || !result.item) throw new Error(result.error || 'Esta criação de conta expirou.');
        setGoogleIdentity(result.item);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Não foi possível continuar com o Google.');
      })
      .finally(() => { if (!controller.signal.aborted) setCheckingGoogle(false); });
    return () => controller.abort();
  }, [googleOnboarding]);

  async function submitPasswordRegistration(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('As senhas não são iguais.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ displayName, organizationName, username, password, returnTo }),
      });
      const result = await response.json() as { destination?: string; error?: string };
      if (!response.ok || !result.destination) throw new Error(result.error || 'Não foi possível criar sua conta.');
      window.location.replace(result.destination);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível criar sua conta.');
      setLoading(false);
    }
  }

  async function completeGoogleRegistration(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/google/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ organizationName, returnTo }),
      });
      const result = await response.json() as { destination?: string; error?: string };
      if (!response.ok || !result.destination) throw new Error(result.error || 'Não foi possível criar o ambiente da empresa.');
      window.location.replace(result.destination);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível criar o ambiente da empresa.');
      setLoading(false);
    }
  }

  return (
    <main className="app-shell relative min-h-[100dvh] overflow-x-hidden px-4 py-8 sm:px-6" style={{ paddingTop: 'max(2rem, env(safe-area-inset-top))', paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 top-[-7rem] size-80 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-24 size-96 rounded-full bg-amber-300/10 blur-3xl" />
      <div className="relative mx-auto w-full max-w-[560px]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-emerald-700 text-primary-foreground shadow-[0_12px_30px_rgb(13_96_83/24%)]"><PackageCheck className="size-6" /></span>
          <div><p className="text-xl font-bold tracking-[-0.03em]">Retorno</p><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Gestão de devoluções</p></div>
        </div>
        <Card className="border-0 bg-card/95 p-5 shadow-[var(--shadow-floating)] ring-1 ring-border/80 backdrop-blur sm:p-8">
          {googleOnboarding ? (
            <>
              <div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Building2 className="size-5" /></span><h1 className="display-title mt-4 text-2xl">Só falta sua empresa</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Criaremos um ambiente separado e você entrará como administrador.</p></div>
              {checkingGoogle ? <div className="grid min-h-48 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : googleIdentity ? (
                <form className="mt-7 space-y-5" onSubmit={completeGoogleRegistration}>
                  <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950"><CheckCircle2 /><AlertTitle>Conta Google confirmada</AlertTitle><AlertDescription>{googleIdentity.displayName} · {googleIdentity.email}</AlertDescription></Alert>
                  <Field id="google-company" label="Nome da empresa"><div className="relative"><Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="google-company" className="h-12 rounded-xl pl-10" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Ex.: Núcleo de Operação" autoComplete="organization" maxLength={120} required /></div></Field>
                  {error && <ErrorAlert message={error} />}
                  <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base" disabled={loading || organizationName.trim().length < 2}>{loading ? <Loader2 className="animate-spin" /> : <UserPlus />} {loading ? 'Criando ambiente…' : 'Criar empresa e entrar'}</Button>
                </form>
              ) : <div className="mt-6 space-y-4">{error && <ErrorAlert message={error} />}<Link href="/cadastro" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 w-full rounded-xl')}>Começar novamente</Link></div>}
            </>
          ) : (
            <>
              <div className="text-center"><span className="mx-auto grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><UserPlus className="size-5" /></span><h1 className="display-title mt-4 text-2xl">Crie sua conta</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Crie um ambiente exclusivo para sua empresa e entre imediatamente.</p></div>
              <div className="mt-7"><GoogleLoginButton returnTo={returnTo} /></div>
              <div className="my-6 flex items-center gap-3" aria-hidden="true"><span className="h-px flex-1 bg-border" /><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">ou crie com usuário e senha</span><span className="h-px flex-1 bg-border" /></div>
              <form className="space-y-5" onSubmit={submitPasswordRegistration}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="signup-name" label="Seu nome"><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="signup-name" className="h-12 rounded-xl pl-10" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Ex.: Maria Silva" autoComplete="name" maxLength={100} required /></div></Field>
                  <Field id="signup-company" label="Empresa"><div className="relative"><Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="signup-company" className="h-12 rounded-xl pl-10" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Ex.: Minha Loja" autoComplete="organization" maxLength={120} required /></div></Field>
                </div>
                <Field id="signup-username" label="Nome de usuário"><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="signup-username" className="h-12 rounded-xl pl-10 lowercase" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} placeholder="Ex.: maria.silva" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={64} required /></div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Use letras minúsculas, números, ponto, hífen ou sublinhado.</p></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <PasswordField id="signup-password" label="Senha" value={password} onChange={setPassword} visible={showPassword} onToggle={() => setShowPassword((current) => !current)} />
                  <PasswordField id="signup-confirmation" label="Confirmar senha" value={confirmation} onChange={setConfirmation} visible={showPassword} />
                </div>
                <p className="text-[11px] leading-5 text-muted-foreground">A senha deve ter pelo menos 12 caracteres.</p>
                {error && <ErrorAlert message={error} />}
                <Button type="submit" size="lg" className="h-12 w-full rounded-xl text-base" disabled={loading || displayName.trim().length < 2 || organizationName.trim().length < 2 || username.trim().length < 3 || password.length < 12 || confirmation.length < 12}>{loading ? <Loader2 className="animate-spin" /> : <UserPlus />} {loading ? 'Criando conta…' : 'Criar conta e entrar'}</Button>
              </form>
            </>
          )}
          <p className="mt-6 text-center text-sm text-muted-foreground">{googleOnboarding ? 'Quer usar outro acesso?' : 'Já tem uma conta?'} <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">Entrar</Link></p>
        </Card>
        <p className="mt-5 text-center text-[11px] text-muted-foreground">Os dados de cada empresa ficam separados dos demais ambientes.</p>
      </div>
    </main>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function PasswordField({ id, label, value, onChange, visible, onToggle }: { id: string; label: string; value: string; onChange: (value: string) => void; visible: boolean; onToggle?: () => void }) {
  return <Field id={id} label={label}><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input id={id} type={visible ? 'text' : 'password'} className="h-12 rounded-xl px-10" value={value} onChange={(event) => onChange(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required />{onToggle && <button type="button" className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={onToggle} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}>{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>}</div></Field>;
}

function ErrorAlert({ message }: { message: string }) {
  return <Alert variant="destructive" role="alert"><AlertCircle /><AlertTitle>Não foi possível concluir</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>;
}
