import React, { useState } from 'react';
import {
  useListEngines,
  getListEnginesQueryKey,
  useCreateEngine,
  useUpdateEngine,
  useListEngineModels,
  getListEngineModelsQueryKey,
  useCreateEngineModel,
  useUpdateEngineModel,
  useDeleteEngineModel,
  AdminEngine,
  EngineModel,
  EngineInputProvider,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Cpu, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

const PROVIDERS: EngineInputProvider[] = ['openai', 'anthropic', 'gemini', 'openrouter'];

export default function AdminEngines() {
  const { data: engines, isLoading } = useListEngines();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListEnginesQueryKey() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ key: '', name: '', vendor: '', provider: 'openai' as EngineInputProvider, model: '' });

  const createEngine = useCreateEngine({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Engine added' });
        setOpen(false);
        setForm({ key: '', name: '', vendor: '', provider: 'openai', model: '' });
        invalidate();
      },
      onError: (e) => toast({ variant: 'destructive', title: 'Failed to add engine', description: e.message }),
    },
  });
  const updateEngine = useUpdateEngine({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e) => toast({ variant: 'destructive', title: 'Failed to update engine', description: e.message }),
    },
  });

  return (
    <div className="p-6 md:p-10 max-w-[1000px] space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-sans font-bold tracking-tight">Engines</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            Each engine queries its enabled models; per-model weights blend into the
            engine's score (normalized so weights sum to 100%).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" /> Add Engine</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Engine</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Key (unique)</Label>
                  <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="e.g. llama" className="font-mono" />
                </div>
                <div className="space-y-2">
                  <Label>Display name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Llama 4" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as EngineInputProvider })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Primary model</Label>
                  <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="e.g. gpt-5-mini" className="font-mono" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Vendor (optional)</Label>
                <Input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="e.g. Meta" />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createEngine.mutate({ data: { key: form.key.trim(), name: form.name.trim(), vendor: form.vendor.trim() || undefined, provider: form.provider, model: form.model.trim() } })}
                disabled={!form.key.trim() || !form.name.trim() || !form.model.trim() || createEngine.isPending}
              >
                Add Engine
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading || !engines ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="space-y-3">
          {engines.map((engine) => (
            <EngineRowCard
              key={engine.id}
              engine={engine}
              onToggle={(enabled) => updateEngine.mutate({ engineId: engine.id, data: { enabled } })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EngineRowCard({ engine, onToggle }: { engine: AdminEngine; onToggle: (enabled: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={`border-border ${engine.enabled ? '' : 'opacity-60'}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <button
            type="button"
            className="flex items-center gap-3 text-left"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{engine.name}</span>
                <Badge variant="outline" className="font-mono text-xs">{engine.key}</Badge>
                <Badge variant="outline" className="font-mono text-xs bg-secondary/30">{engine.provider}</Badge>
              </div>
              <div className="text-sm text-muted-foreground font-mono mt-0.5">
                {engine.vendor} · primary {engine.model}
              </div>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{engine.enabled ? 'Enabled' : 'Disabled'}</span>
            <Switch checked={engine.enabled} onCheckedChange={onToggle} />
          </div>
        </div>
        {open && <EngineModelsPanel engineId={engine.id} />}
      </CardContent>
    </Card>
  );
}

function EngineModelsPanel({ engineId }: { engineId: number }) {
  const { data: models, isLoading } = useListEngineModels(engineId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListEngineModelsQueryKey(engineId) });

  const [newModel, setNewModel] = useState('');

  const createModel = useCreateEngineModel({
    mutation: {
      onSuccess: () => { setNewModel(''); invalidate(); },
      onError: (e) => toast({ variant: 'destructive', title: 'Failed to add model', description: e.message }),
    },
  });
  const updateModel = useUpdateEngineModel({
    mutation: {
      onSuccess: invalidate,
      onError: (e) => toast({ variant: 'destructive', title: 'Failed to update model', description: e.message }),
    },
  });
  const deleteModel = useDeleteEngineModel({
    mutation: {
      onSuccess: invalidate,
      onError: (e) => toast({ variant: 'destructive', title: 'Failed to remove model', description: e.message }),
    },
  });

  const enabled = (models ?? []).filter((m) => m.enabled);
  const weightSum = enabled.reduce((s, m) => s + (m.weight || 0), 0) || 1;

  return (
    <div className="ml-7 border-l border-border pl-4 space-y-2">
      {isLoading || !models ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 items-center text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <span>Model</span><span>Weight</span><span>Effective</span><span>On</span>
          </div>
          {models.map((m) => (
            <ModelRow
              key={m.id}
              model={m}
              effective={m.enabled ? Math.round((m.weight / weightSum) * 100) : 0}
              onWeight={(weight) => updateModel.mutate({ modelId: m.id, data: { weight } })}
              onToggle={(en) => updateModel.mutate({ modelId: m.id, data: { enabled: en } })}
              onDelete={() => deleteModel.mutate({ modelId: m.id })}
            />
          ))}
          <div className="flex items-center gap-2 pt-2">
            <Input
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="add model id, e.g. gpt-5"
              className="font-mono h-8 text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1 shrink-0"
              disabled={!newModel.trim() || createModel.isPending}
              onClick={() => createModel.mutate({ engineId, data: { model: newModel.trim() } })}
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ModelRow({
  model, effective, onWeight, onToggle, onDelete,
}: {
  model: EngineModel;
  effective: number;
  onWeight: (weight: number) => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [weight, setWeight] = useState(String(model.weight));
  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 items-center ${model.enabled ? '' : 'opacity-50'}`}>
      <span className="font-mono text-sm truncate">{model.model}</span>
      <Input
        type="number"
        step="0.1"
        min="0"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        onBlur={() => {
          const w = Number(weight);
          if (Number.isFinite(w) && w >= 0 && w !== model.weight) onWeight(w);
        }}
        className="w-16 h-8 text-sm font-mono"
      />
      <span className="w-12 text-right font-mono text-xs text-muted-foreground">{effective}%</span>
      <Switch checked={model.enabled} onCheckedChange={onToggle} />
      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete}>
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );
}
