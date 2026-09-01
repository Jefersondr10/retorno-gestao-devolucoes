'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleIdentity = {
  initialize: (configuration: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce: string;
    auto_select: boolean;
    cancel_on_tap_outside: boolean;
    ux_mode: 'popup';
  }) => void;
  renderButton: (
    parent: HTMLElement,
    configuration: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: 'continue_with';
      shape: 'rectangular';
      logo_alignment: 'left';
      locale: 'pt-BR';
      width: number;
    },
  ) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

type ChallengeResponse = {
  clientId?: string;
  nonce?: string;
  error?: string;
};

type LoginResponse = {
  destination?: string;
  message?: string;
  error?: string;
};

const GOOGLE_SCRIPT_ID = 'google-identity-services';
let googleScriptPromise: Promise<void> | null = null;

export function GoogleLoginButton({ returnTo }: { returnTo: string }) {
  const buttonContainer = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'submitting' | 'pending' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const completeGoogleLogin = useCallback(async (credential: string) => {
    setState('submitting');
    setMessage('');
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ credential, returnTo }),
      });
      const result = (await response.json().catch(() => ({}))) as LoginResponse;

      if (response.status === 202) {
        setMessage(result.message || 'Seu acesso foi solicitado. Um administrador precisa aprová-lo antes do primeiro uso.');
        setState('pending');
        return;
      }
      if (!response.ok || !result.destination) throw new Error(result.error || 'Não foi possível entrar com o Google.');
      window.location.replace(result.destination);
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Não foi possível entrar com o Google.');
      setState('error');
    }
  }, [returnTo]);

  const prepareGoogleButton = useCallback(async () => {
    setState('loading');
    setMessage('');
    try {
      const [challengeResponse] = await Promise.all([
        fetch('/api/auth/google/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ returnTo }),
        }),
        loadGoogleIdentityScript(),
      ]);
      const challenge = (await challengeResponse.json().catch(() => ({}))) as ChallengeResponse;
      if (!challengeResponse.ok || !challenge.clientId || !challenge.nonce) {
        throw new Error(challenge.error || 'A entrada com Google ainda não está disponível.');
      }

      const identity = window.google?.accounts?.id;
      const container = buttonContainer.current;
      if (!identity || !container) throw new Error('Não foi possível carregar o botão do Google.');

      container.replaceChildren();
      identity.initialize({
        client_id: challenge.clientId,
        nonce: challenge.nonce,
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: 'popup',
        callback: (response) => {
          if (!response.credential) {
            setMessage('O Google não retornou os dados necessários. Tente novamente.');
            setState('error');
            return;
          }
          void completeGoogleLogin(response.credential);
        },
      });
      identity.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        locale: 'pt-BR',
        width: Math.max(240, Math.min(360, Math.round(container.getBoundingClientRect().width || 360))),
      });
      setState('ready');
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : 'Não foi possível preparar a entrada com Google.');
      setState('error');
    }
  }, [completeGoogleLogin, returnTo]);

  useEffect(() => {
    const timer = window.setTimeout(() => void prepareGoogleButton(), 0);
    return () => window.clearTimeout(timer);
  }, [prepareGoogleButton]);

  return (
    <div className="space-y-3">
      {state !== 'pending' && (
        <div className="relative grid min-h-11 place-items-center overflow-hidden rounded-xl">
          <div
            ref={buttonContainer}
            className={`flex min-h-11 w-full justify-center transition ${state === 'submitting' ? 'pointer-events-none opacity-45' : ''}`}
            aria-hidden={state === 'loading' || state === 'error'}
          />
          {state === 'loading' && <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl border bg-background text-sm font-medium text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Preparando Google…</div>}
          {state === 'submitting' && <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-xl border bg-background/90 text-sm font-medium"><Loader2 className="size-4 animate-spin text-primary" /> Validando acesso…</div>}
          {state === 'error' && <Button type="button" variant="outline" className="absolute inset-0 h-full w-full rounded-xl" onClick={() => void prepareGoogleButton()}><RefreshCw /> Tentar Google novamente</Button>}
        </div>
      )}

      {state === 'pending' && (
        <output className="block">
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <CheckCircle2 />
            <AlertTitle>Conta recebida para aprovação</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        </output>
      )}
      {state === 'error' && message && (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertTitle>Google indisponível</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <p className="text-center text-[11px] leading-5 text-muted-foreground">No primeiro acesso com Google, a conta fica aguardando aprovação de um administrador.</p>
    </div>
  );
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');
    const onLoad = () => resolve();
    const onError = () => {
      googleScriptPromise = null;
      reject(new Error('Não foi possível carregar a entrada segura do Google.'));
    };

    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.id = GOOGLE_SCRIPT_ID;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return googleScriptPromise;
}
