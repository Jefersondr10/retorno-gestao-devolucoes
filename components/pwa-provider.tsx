'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Download,
  MonitorSmartphone,
  MoreVertical,
  Share2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform: string };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type PwaContextValue = {
  isInstalled: boolean;
  requestInstall: () => Promise<void>;
};

const unavailablePwaContext: PwaContextValue = {
  isInstalled: true,
  requestInstall: async () => undefined,
};

const PwaContext = createContext<PwaContextValue | null>(null);

function runningAsInstalledApp() {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
}

function currentDevice(): 'ios' | 'android' | 'desktop' {
  const userAgent = navigator.userAgent.toLowerCase();
  const navigatorWithPlatform = navigator as Navigator & { platform?: string };
  const isAppleTouchDevice =
    /iphone|ipad|ipod/.test(userAgent) ||
    (navigatorWithPlatform.platform === 'MacIntel' &&
      navigator.maxTouchPoints > 1);
  return isAppleTouchDevice
    ? 'ios'
    : /android/.test(userAgent)
      ? 'android'
      : 'desktop';
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(true);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [device, setDevice] = useState<'ios' | 'android' | 'desktop'>(
    'desktop',
  );

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const handleDisplayMode = () => setIsInstalled(runningAsInstalledApp());
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setInstructionsOpen(false);
      setIsInstalled(true);
    };

    const initializeTimer = window.setTimeout(handleDisplayMode, 0);
    displayMode.addEventListener('change', handleDisplayMode);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.clearTimeout(initializeTimer);
      displayMode.removeEventListener('change', handleDisplayMode);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      !('serviceWorker' in navigator)
    )
      return;
    const register = () => {
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  const requestInstall = useCallback(async () => {
    if (runningAsInstalledApp()) {
      setIsInstalled(true);
      return;
    }
    if (!installPrompt) {
      setDevice(currentDevice());
      setInstructionsOpen(true);
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === 'accepted') setIsInstalled(true);
    } catch {
      setDevice(currentDevice());
      setInstructionsOpen(true);
    }
  }, [installPrompt]);

  const value = useMemo(
    () => ({ isInstalled, requestInstall }),
    [isInstalled, requestInstall],
  );

  return (
    <PwaContext.Provider value={value}>
      {children}
      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <span className="mb-1 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <MonitorSmartphone className="size-5" />
            </span>
            <DialogTitle>Instalar o Retorno</DialogTitle>
            <DialogDescription>
              Tenha o sistema na tela inicial e abra em uma janela própria, como
              um aplicativo.
            </DialogDescription>
          </DialogHeader>
          {device === 'ios' ? (
            <ol className="space-y-3 rounded-xl border bg-muted/25 p-4 text-sm leading-6">
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  1
                </span>
                <span>
                  Abra este endereço no <strong>Safari</strong>.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  2
                </span>
                <span>
                  Toque em <strong>Compartilhar</strong>{' '}
                  <Share2 className="ml-1 inline size-4" />.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  3
                </span>
                <span>
                  Escolha <strong>Adicionar à Tela de Início</strong> e confirme
                  em <strong>Adicionar</strong>.
                </span>
              </li>
            </ol>
          ) : (
            <div className="rounded-xl border bg-muted/25 p-4 text-sm leading-6">
              <p className="font-semibold">
                Use o menu do navegador{' '}
                <MoreVertical className="ml-1 inline size-4" />.
              </p>
              <p className="mt-1 text-muted-foreground">
                Escolha <strong>Instalar aplicativo</strong>,{' '}
                <strong>Instalar Retorno</strong> ou{' '}
                <strong>Adicionar à tela inicial</strong>.
              </p>
            </div>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            O aplicativo usa o mesmo login e os mesmos dados do site. É
            necessário estar conectado à internet.
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setInstructionsOpen(false)}>
              <Download /> Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PwaContext.Provider>
  );
}

export function usePwaInstall() {
  return useContext(PwaContext) || unavailablePwaContext;
}
