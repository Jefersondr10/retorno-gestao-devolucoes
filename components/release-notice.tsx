'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Megaphone, Sparkles } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { apiFetch } from '@/lib/api-client';
import type { SystemRelease } from '@/lib/releases';

export const RELEASE_NOTES_EVENT = 'retorno:show-release-notes';

type ReleaseView = SystemRelease & { acknowledgedAt: string | null };

export function ReleaseNotice() {
  const pathname = usePathname();
  const publicEntryPage = pathname === '/login' || pathname === '/cadastro';
  const [items, setItems] = useState<ReleaseView[]>([]);
  const [pending, setPending] = useState<ReleaseView[]>([]);
  const [checkState, setCheckState] = useState<'checking' | 'ready' | 'error'>(
    publicEntryPage ? 'ready' : 'checking',
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const loadReleases = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setCheckState('checking');
    setError('');
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch('/api/releases', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (requestRef.current !== controller) return;
      if (response.status === 401) {
        setCheckState('ready');
        return;
      }
      const result = (await response.json().catch(() => ({}))) as {
        items?: ReleaseView[];
        pending?: ReleaseView[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || 'Não foi possível verificar as novidades.',
        );
      setItems(result.items || []);
      setPending(result.pending || []);
      setCheckState('ready');
    } catch (requestError) {
      if (requestRef.current !== controller) return;
      if (publicEntryPage) {
        setCheckState('ready');
        return;
      }
      setError(
        requestError instanceof Error && requestError.name !== 'AbortError'
          ? requestError.message
          : 'A verificação demorou mais do que o esperado.',
      );
      setCheckState('error');
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [publicEntryPage]);

  useEffect(() => {
    const showReleaseNotes = () => setManualOpen(true);
    window.addEventListener(RELEASE_NOTES_EVENT, showReleaseNotes);
    if (publicEntryPage) {
      return () =>
        window.removeEventListener(RELEASE_NOTES_EVENT, showReleaseNotes);
    }
    const initialLoad = window.setTimeout(() => void loadReleases(), 0);
    return () => {
      window.clearTimeout(initialLoad);
      requestRef.current?.abort();
      requestRef.current = null;
      window.removeEventListener(RELEASE_NOTES_EVENT, showReleaseNotes);
    };
  }, [loadReleases, publicEntryPage]);

  const mandatory = !publicEntryPage && pending.length > 0;
  const visibleItems = useMemo(
    () =>
      publicEntryPage
        ? []
        : mandatory
          ? pending
          : manualOpen
            ? items.slice(-1)
            : [],
    [items, mandatory, manualOpen, pending, publicEntryPage],
  );
  const checkingIsBlocking = !publicEntryPage && checkState !== 'ready';
  const open = checkingIsBlocking || visibleItems.length > 0;

  async function acknowledge() {
    if (!confirmed || !pending.length) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await apiFetch('/api/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseIds: pending.map((release) => release.id),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || 'Não foi possível salvar sua confirmação.',
        );
      setItems((current) =>
        current.map((release) =>
          pending.some((item) => item.id === release.id)
            ? { ...release, acknowledgedAt: new Date().toISOString() }
            : release,
        ),
      );
      setPending([]);
      setConfirmed(false);
      setManualOpen(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Não foi possível salvar sua confirmação.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && (checkingIsBlocking || mandatory)) {
          eventDetails.cancel();
          return;
        }
        if (!nextOpen) setManualOpen(false);
      }}
    >
      <AlertDialogContent className="grid max-h-[calc(100dvh-1.5rem)] max-w-[calc(100%-1.5rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl">
        <AlertDialogHeader className="grid-cols-[auto_1fr] grid-rows-[auto_auto] place-items-start gap-x-3 gap-y-1 p-5 text-left sm:p-6">
          <AlertDialogMedia className="row-span-2 m-0 size-11 rounded-xl bg-primary/10 text-primary">
            {checkState === 'checking' ? (
              <Loader2 className="size-5 animate-spin" />
            ) : checkState === 'error' ? (
              <AlertCircle className="size-5" />
            ) : (
              <Megaphone className="size-5" />
            )}
          </AlertDialogMedia>
          <AlertDialogTitle className="col-start-2 text-xl font-semibold tracking-[-0.02em]">
            {checkState === 'checking'
              ? 'Verificando novidades'
              : checkState === 'error'
                ? 'Não foi possível verificar'
                : 'Novidades do Retorno'}
          </AlertDialogTitle>
          <AlertDialogDescription className="col-start-2 text-left">
            {checkState === 'checking'
              ? 'Aguarde só um instante antes de continuar.'
              : checkState === 'error'
                ? 'A confirmação das atualizações é necessária para entrar.'
                : 'Leia o que mudou antes de continuar.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="overflow-y-auto border-y bg-muted/15 px-5 py-5 sm:px-6">
          {checkState === 'checking' ? (
            <output className="grid min-h-36 place-items-center text-center">
              <span>
                <Loader2 className="mx-auto size-7 animate-spin text-primary" />
                <span className="mt-3 block text-sm font-semibold">
                  Carregando as atualizações do sistema…
                </span>
              </span>
            </output>
          ) : checkState === 'error' ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertTitle>Verificação interrompida</AlertTitle>
              <AlertDescription>
                {error} Tente novamente para liberar o acesso.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-5">
              {visibleItems.map((release) => (
                <article
                  key={release.id}
                  className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-primary">
                      Versão {release.version}
                    </span>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={release.publishedAt}
                    >
                      {formatReleaseDate(release.publishedAt)}
                    </time>
                  </div>
                  <h2 className="mt-3 text-base font-semibold">
                    {release.title}
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {release.summary}
                  </p>
                  <ul className="mt-4 space-y-3">
                    {release.changes.map((change) => (
                      <li key={change.title} className="flex gap-3">
                        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-800">
                          <Check className="size-3.5" />
                        </span>
                        <span>
                          <strong className="block text-sm font-semibold">
                            {change.title}
                          </strong>
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                            {change.description}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
          {checkState === 'ready' && error && (
            <Alert variant="destructive" className="mt-4" role="alert">
              <Sparkles />
              <AlertTitle>Não foi possível confirmar</AlertTitle>
              <AlertDescription>
                {error} Tente novamente para continuar.
              </AlertDescription>
            </Alert>
          )}
        </div>
        <AlertDialogFooter className="mx-0 mb-0 gap-3 rounded-b-2xl border-0 bg-card p-4 sm:flex-col sm:items-stretch sm:p-5">
          {checkState === 'checking' ? (
            <p className="py-1 text-center text-xs text-muted-foreground">
              A tela será liberada assim que a verificação terminar.
            </p>
          ) : checkState === 'error' ? (
            <AlertDialogAction
              className="h-11 w-full"
              onClick={() => void loadReleases()}
            >
              <Loader2 /> Tentar novamente
            </AlertDialogAction>
          ) : mandatory ? (
            <>
              <label
                htmlFor="release-notes-confirmation"
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border bg-muted/20 p-3 text-sm font-medium leading-5"
              >
                <Checkbox
                  id="release-notes-confirmation"
                  checked={confirmed}
                  onCheckedChange={(value) => setConfirmed(Boolean(value))}
                  aria-label="Confirmar que li e entendi as novidades"
                />
                <span>Li e entendi todas as novidades apresentadas acima.</span>
              </label>
              <AlertDialogAction
                className="h-11 w-full"
                disabled={!confirmed || submitting}
                onClick={() => void acknowledge()}
              >
                {submitting ? <Loader2 className="animate-spin" /> : <Check />}{' '}
                {submitting
                  ? 'Salvando confirmação…'
                  : 'Confirmar que li e continuar'}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction
              className="h-11 w-full"
              onClick={() => setManualOpen(false)}
            >
              Fechar novidades
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function formatReleaseDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}
