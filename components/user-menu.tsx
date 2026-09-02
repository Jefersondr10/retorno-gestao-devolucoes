'use client';

import { useState } from 'react';
import { KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiFetch } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth';

export function UserMenu({ user }: { user: AuthUser }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';

  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    try {
      const response = await apiFetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || 'Não foi possível sair. Tente novamente.');
      }
      window.location.replace('/login');
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Não foi possível sair. Tente novamente.');
      setLoggingOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-h-11 items-center gap-2 rounded-xl px-1.5 pr-2 text-left outline-none transition hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Conta de ${user.displayName}`}>
        <Avatar size="lg"><AvatarFallback className="bg-primary/12 font-bold text-primary">{initials}</AvatarFallback></Avatar>
        <span className="hidden min-w-0 sm:block"><span className="block max-w-36 truncate text-xs font-semibold">{user.displayName}</span><span className="block max-w-36 truncate text-[10px] text-muted-foreground">{user.organizationName}</span></span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl p-2">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-2"><span className="block truncate text-sm font-semibold text-foreground">{user.displayName}</span><span className="mt-0.5 block truncate font-normal text-muted-foreground">{user.organizationName}</span><span className="mt-1 block truncate font-normal text-muted-foreground">@{user.username} · {user.role === 'ADMIN' ? 'Administrador' : 'Operação'}</span></DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {user.passwordLoginEnabled && <DropdownMenuItem className="min-h-10 rounded-lg px-2" onClick={() => window.location.assign('/alterar-senha')}><KeyRound /> Trocar minha senha</DropdownMenuItem>}
        {user.role === 'ADMIN' && <DropdownMenuItem className="min-h-10 rounded-lg px-2" onClick={() => window.location.assign('/configuracoes')}><ShieldCheck /> Administração</DropdownMenuItem>}
        <DropdownMenuSeparator />
        {logoutError && <p className="px-2 pb-2 text-xs leading-5 text-destructive" role="alert">{logoutError}</p>}
        <DropdownMenuItem variant="destructive" className="min-h-10 rounded-lg px-2" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? <Loader2 className="animate-spin" /> : <LogOut />} Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
