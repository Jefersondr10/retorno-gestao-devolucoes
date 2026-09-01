'use client';

import { useState } from 'react';
import { AlertCircle, Loader2, Plus, Settings2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { apiFetch } from '@/lib/api-client';
import type { StatusDefinition } from '@/lib/returns';

const colorLabels = [
  ['slate', 'Cinza'],
  ['amber', 'Âmbar'],
  ['blue', 'Azul'],
  ['sky', 'Azul-claro'],
  ['orange', 'Laranja'],
  ['violet', 'Violeta'],
  ['emerald', 'Verde'],
  ['rose', 'Rosa'],
] as const;

const tone: Record<string, string> = {
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  orange: 'border-orange-200 bg-orange-50 text-orange-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function StatusSettingsDialog({ open, statuses, onOpenChange, onStatusCreated }: {
  open: boolean;
  statuses: StatusDefinition[];
  onOpenChange: (open: boolean) => void;
  onStatusCreated: (status: StatusDefinition) => void;
}) {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('slate');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const response = await apiFetch('/api/config/statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, color }),
      });
      const result = (await response.json()) as { item?: StatusDefinition; error?: string };
      if (!response.ok || !result.item) throw new Error(result.error || 'Não foi possível cadastrar o status.');
      onStatusCreated(result.item);
      setLabel('');
      setColor('slate');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Não foi possível cadastrar o status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold"><Settings2 className="size-5 text-primary" /> Status operacionais</DialogTitle>
            <DialogDescription>Crie etapas próprias sem alterar as regras de finalização do sistema.</DialogDescription>
          </DialogHeader>

          <div className="my-5 space-y-5">
            <div className="flex flex-wrap gap-2 rounded-2xl border bg-muted/30 p-3">
              {statuses.map((status) => <Badge key={status.code} variant="outline" className={tone[status.color] || tone.slate}>{status.label}{status.is_system ? '' : ' · personalizado'}</Badge>)}
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
              <div className="space-y-2"><Label htmlFor="status-name">Nome do novo status</Label><Input id="status-name" className="h-11" placeholder="Ex.: Aguardando assistência" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={60} /></div>
              <div className="space-y-2"><Label htmlFor="status-color">Cor</Label><NativeSelect id="status-color" className="w-full" value={color} onChange={(event) => setColor(event.target.value)}>{colorLabels.map(([value, name]) => <NativeSelectOption key={value} value={value}>{name}</NativeSelectOption>)}</NativeSelect></div>
            </div>
            {error && <Alert variant="destructive"><AlertCircle /><AlertTitle>Não foi possível salvar</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Fechar</Button>
            <Button type="submit" className="h-11" disabled={saving || !label.trim()}>{saving ? <Loader2 className="animate-spin" /> : <Plus />} Cadastrar status</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
