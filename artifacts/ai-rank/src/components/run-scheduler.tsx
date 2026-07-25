import React, { useState } from 'react';
import {
  useTriggerRun,
  getListRunsQueryKey,
  useListSchedules,
  getListSchedulesQueryKey,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
  useGetCatalog,
  getGetCatalogQueryKey,
  getGetRunsSummaryQueryKey,
  Schedule,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Play, CalendarClock, CalendarPlus, RefreshCw, Trash2, Pencil, Clock, Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

type Mode = 'now' | 'once' | 'recurring';
type Cadence = 'daily' | 'weekly' | 'monthly';

function useCatalog() {
  const { data } = useGetCatalog({ query: { queryKey: getGetCatalogQueryKey() } });
  return {
    industries: data?.industries ?? [],
    engines: data?.engines ?? [],
    industryName: (id: number | null | undefined) =>
      id == null ? 'All industries' : data?.industries.find((i) => i.id === id)?.name ?? `Industry ${id}`,
    engineName: (id: number | null | undefined) =>
      id == null ? null : data?.engines.find((e) => e.id === id)?.name ?? `Engine ${id}`,
  };
}

// ── Run wizard (opened by "Run now") ────────────────────────────────

export function RunWizard({ open, onClose, disabled }: { open: boolean; onClose: () => void; disabled?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { industries, engines } = useCatalog();

  const [mode, setMode] = useState<Mode>('now');
  const [industryId, setIndustryId] = useState('all');
  const [engineId, setEngineId] = useState('all');
  const [cadence, setCadence] = useState<Cadence>('daily');
  const [runAt, setRunAt] = useState('');

  const scope = () => ({
    ...(industryId !== 'all' ? { industryId: Number(industryId) } : {}),
    ...(engineId !== 'all' ? { engineId: Number(engineId) } : {}),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRunsSummaryQueryKey() });
  };

  const triggerRun = useTriggerRun({
    mutation: {
      onSuccess: () => { toast({ title: 'Run started' }); invalidate(); onClose(); },
      onError: (e) => toast({ variant: 'destructive', title: 'Failed to start run', description: e.message }),
    },
  });
  const createSchedule = useCreateSchedule({
    mutation: {
      onSuccess: () => { toast({ title: 'Schedule created' }); invalidate(); onClose(); },
      onError: (e) => toast({ variant: 'destructive', title: 'Failed to create schedule', description: e.message }),
    },
  });

  const busy = triggerRun.isPending || createSchedule.isPending;
  const needsRunAt = mode === 'once';
  const canSubmit = !busy && !(needsRunAt && !runAt);

  function submit() {
    if (mode === 'now') {
      triggerRun.mutate({ data: scope() });
    } else if (mode === 'once') {
      createSchedule.mutate({ data: { mode: 'once', runAt: new Date(runAt).toISOString(), ...scope() } });
    } else {
      createSchedule.mutate({
        data: { mode: 'recurring', cadence, ...(runAt ? { runAt: new Date(runAt).toISOString() } : {}), ...scope() },
      });
    }
  }

  const choices: { value: Mode; label: string; desc: string; icon: React.ReactNode }[] = [
    { value: 'now', label: 'Run now', desc: 'Start a survey immediately', icon: <Play className="w-4 h-4" /> },
    { value: 'once', label: 'Schedule one-time', desc: 'Run once at a chosen date & time', icon: <CalendarPlus className="w-4 h-4" /> },
    { value: 'recurring', label: 'Schedule recurring', desc: 'Repeat on a cadence', icon: <CalendarClock className="w-4 h-4" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">New survey run</DialogTitle>
          <DialogDescription>Run now, or set up a schedule the cron engine will fire.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2">
            {choices.map((c) => (
              <button
                key={c.value}
                onClick={() => setMode(c.value)}
                className={`flex items-center gap-3 p-3 border text-left transition-colors ${mode === c.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
                data-testid={`wizard-mode-${c.value}`}
              >
                <span className={mode === c.value ? 'text-primary' : 'text-muted-foreground'}>{c.icon}</span>
                <span>
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.desc}</span>
                </span>
              </button>
            ))}
          </div>

          {mode === 'recurring' && (
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Cadence</span>
              <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
                <SelectTrigger className="font-mono" data-testid="wizard-cadence"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}

          {(mode === 'once' || mode === 'recurring') && (
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {mode === 'once' ? 'Run at' : 'Start (optional)'}
              </span>
              <Input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} className="font-mono" data-testid="wizard-runat" />
              <span className="text-[11px] text-muted-foreground font-mono">Scheduled runs fire at the daily cron (06:00 UTC) on or after this time.</span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Industry</span>
              <Select value={industryId} onValueChange={setIndustryId}>
                <SelectTrigger className="font-mono" data-testid="wizard-industry"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All industries</SelectItem>
                  {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Engine</span>
              <Select value={engineId} onValueChange={setEngineId}>
                <SelectTrigger className="font-mono" data-testid="wizard-engine"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All engines</SelectItem>
                  {engines.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={canSubmit === false || disabled} onClick={submit} className="gap-2 font-mono" data-testid="wizard-submit">
            {mode === 'now' ? <Play className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
            {mode === 'now' ? 'Run now' : 'Create schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Schedules panel ─────────────────────────────────────────────────

export function SchedulesPanel() {
  const { data, isLoading } = useListSchedules({ query: { queryKey: getListSchedulesQueryKey() } });
  const schedules = data?.schedules ?? [];

  return (
    <Card className="border-border">
      <CardHeader className="bg-muted/30 border-b border-border">
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarClock className="w-4 h-4 text-primary" />
          Schedules
        </CardTitle>
        <CardDescription>
          Recurring and one-time survey definitions the cron engine fires. Editing a trigger switches one-off ↔ recurring.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : schedules.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground font-mono">No schedules — use “Run now → schedule”.</p>
        ) : (
          <div className="divide-y border-border">
            {schedules.map((s) => <ScheduleRow key={s.id} schedule={s} />)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleRow({ schedule: s }: { schedule: Schedule }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { industryName, engineName } = useCatalog();
  const [editing, setEditing] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListSchedulesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRunsSummaryQueryKey() });
  };
  const update = useUpdateSchedule({
    mutation: { onSuccess: refresh, onError: (e) => toast({ variant: 'destructive', title: 'Update failed', description: e.message }) },
  });
  const del = useDeleteSchedule({
    mutation: { onSuccess: () => { toast({ title: 'Schedule deleted' }); refresh(); }, onError: (e) => toast({ variant: 'destructive', title: 'Delete failed', description: e.message }) },
  });

  const scopeText = [industryName(s.industryId), s.engineId != null ? engineName(s.engineId) : null].filter(Boolean).join(' · ');
  const cadenceText = s.mode === 'recurring' ? (s.cadence ?? 'recurring') : 'one-time';

  return (
    <div className={`p-4 flex flex-wrap items-center justify-between gap-3 ${s.enabled ? '' : 'opacity-60'}`} data-testid={`schedule-row-${s.id}`}>
      <div className="flex items-center gap-3 min-w-0">
        <Badge variant="outline" className="font-mono text-[10px] uppercase capitalize">
          {s.mode === 'recurring' ? <RefreshCw className="w-3 h-3 mr-1" /> : <Clock className="w-3 h-3 mr-1" />}
          {cadenceText}
        </Badge>
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-1.5">
            {scopeText}
            {s.engineId != null && <Cpu className="w-3 h-3 text-primary" />}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            Next {format(new Date(s.nextRunAt), 'MMM d, HH:mm')} · {formatDistanceToNow(new Date(s.nextRunAt), { addSuffix: true })}
            {s.lastRunAt && ` · last ${formatDistanceToNow(new Date(s.lastRunAt), { addSuffix: true })}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={s.enabled} onCheckedChange={(v) => update.mutate({ id: s.id, data: { enabled: v } })} aria-label="Enabled" data-testid={`schedule-toggle-${s.id}`} />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(true)} data-testid={`schedule-edit-${s.id}`}><Pencil className="w-4 h-4" /></Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" data-testid={`schedule-delete-${s.id}`}><Trash2 className="w-4 h-4" /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this schedule?</AlertDialogTitle>
              <AlertDialogDescription>It will stop firing. Existing runs are not affected.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => del.mutate({ id: s.id })}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {editing && <ScheduleEditDialog schedule={s} onClose={() => setEditing(false)} onSaved={refresh} />}
    </div>
  );
}

function ScheduleEditDialog({ schedule: s, onClose, onSaved }: { schedule: Schedule; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { industries, engines } = useCatalog();
  const [mode, setMode] = useState<'once' | 'recurring'>(s.mode as 'once' | 'recurring');
  const [cadence, setCadence] = useState<Cadence>((s.cadence as Cadence) ?? 'daily');
  const [industryId, setIndustryId] = useState(s.industryId != null ? String(s.industryId) : 'all');
  const [engineId, setEngineId] = useState(s.engineId != null ? String(s.engineId) : 'all');

  const update = useUpdateSchedule({
    mutation: {
      onSuccess: () => { toast({ title: 'Schedule updated' }); onSaved(); onClose(); },
      onError: (e) => toast({ variant: 'destructive', title: 'Update failed', description: e.message }),
    },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono">Edit schedule</DialogTitle>
          <DialogDescription>Switch the trigger type, cadence, or scope.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Trigger</span>
            <Select value={mode} onValueChange={(v) => setMode(v as 'once' | 'recurring')}>
              <SelectTrigger className="font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recurring">Recurring</SelectItem>
                <SelectItem value="once">One-time</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {mode === 'recurring' && (
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Cadence</span>
              <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
                <SelectTrigger className="font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Industry</span>
              <Select value={industryId} onValueChange={setIndustryId}>
                <SelectTrigger className="font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All industries</SelectItem>
                  {industries.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Engine</span>
              <Select value={engineId} onValueChange={setEngineId}>
                <SelectTrigger className="font-mono"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All engines</SelectItem>
                  {engines.map((e) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={update.isPending}
            className="font-mono"
            onClick={() =>
              update.mutate({
                id: s.id,
                data: {
                  mode,
                  ...(mode === 'recurring' ? { cadence } : {}),
                  industryId: industryId === 'all' ? null : Number(industryId),
                  engineId: engineId === 'all' ? null : Number(engineId),
                },
              })
            }
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
