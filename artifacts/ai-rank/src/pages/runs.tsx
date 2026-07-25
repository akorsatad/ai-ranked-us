import React, { useMemo, useState } from 'react';
import {
  useListRuns,
  getListRunsQueryKey,
  useTriggerRun,
  usePauseRun,
  useResumeRun,
  useCancelRun,
  useReportRunIssue,
  useDeleteRun,
  useClearFailedRuns,
  useReconcileRuns,
  useGetRunsSummary,
  getGetRunsSummaryQueryKey,
  SurveyRun,
  ListRunsParams,
  useBrowseTable,
  getBrowseTableQueryKey,
  useGetCatalog,
  getGetCatalogQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Play, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, ChevronDown,
  ChevronRight, ChevronLeft, Terminal, KeyRound, Pause, Ban, BellPlus, Users,
  Trash2, Regex as RegexIcon, Cpu, RotateCw, CheckSquare, Square,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { RunWizard, SchedulesPanel } from '@/components/run-scheduler';

const ACTIVE_STATUSES = ['running', 'pausing', 'cancelling'];

type StatusFilter = 'all' | NonNullable<ListRunsParams['status']>;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Per-status color coding: row accent, badge, icon. */
const STATUS_META: Record<
  string,
  { row: string; badge: string; icon: React.ReactNode }
> = {
  completed: {
    row: 'border-l-emerald-500 bg-emerald-500/[0.04]',
    badge: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  },
  running: {
    row: 'border-l-primary bg-primary/[0.04]',
    badge: 'bg-primary/10 text-primary border-primary/20',
    icon: <RefreshCw className="w-4 h-4 text-primary animate-spin" />,
  },
  pausing: {
    row: 'border-l-muted-foreground',
    badge: 'bg-muted text-muted-foreground border-border',
    icon: <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />,
  },
  cancelling: {
    row: 'border-l-muted-foreground',
    badge: 'bg-muted text-muted-foreground border-border',
    icon: <RefreshCw className="w-4 h-4 text-muted-foreground animate-spin" />,
  },
  paused: {
    row: 'border-l-amber-500 bg-amber-500/[0.04]',
    badge: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    icon: <Pause className="w-4 h-4 text-amber-500" />,
  },
  cancelled: {
    row: 'border-l-border',
    badge: 'bg-muted text-muted-foreground border-border',
    icon: <Ban className="w-4 h-4 text-muted-foreground" />,
  },
  failed: {
    row: 'border-l-destructive bg-destructive/[0.04]',
    badge: 'bg-destructive/10 text-destructive border-destructive/20',
    icon: <XCircle className="w-4 h-4 text-destructive" />,
  },
  partial: {
    row: 'border-l-orange-500 bg-orange-500/[0.04]',
    badge: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    icon: <AlertCircle className="w-4 h-4 text-orange-500" />,
  },
};

function runHasIssues(run: SurveyRun): boolean {
  return (
    run.failedQueries > 0 ||
    run.status === 'failed' ||
    !!run.error ||
    (run.keyWarnings?.length ?? 0) > 0
  );
}

function fmtDur(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function runDuration(run: SurveyRun): string {
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  return fmtDur(end - new Date(run.startedAt).getTime());
}

// A run's heartbeat is considered stale (loop likely wedged/dead) after this.
const STALE_HEARTBEAT_MS = 120_000;

/** Derived live telemetry for a run: throughput, ETA, and heartbeat health. */
function runTelemetry(run: SurveyRun) {
  const processed = run.succeededQueries + run.failedQueries;
  const remaining = Math.max(0, run.totalQueries - processed);
  const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
  const elapsedMs = Math.max(0, end - new Date(run.startedAt).getTime());
  const perMin = elapsedMs > 0 ? processed / (elapsedMs / 60_000) : 0;
  const etaMs = perMin > 0 && remaining > 0 ? (remaining / perMin) * 60_000 : null;
  const active = ACTIVE_STATUSES.includes(run.status);
  const heartbeatMs = run.heartbeatAt
    ? Date.now() - new Date(run.heartbeatAt).getTime()
    : null;
  const stale = active && heartbeatMs != null && heartbeatMs > STALE_HEARTBEAT_MS;
  return { processed, remaining, perMin, etaMs, active, heartbeatMs, stale };
}

export default function Runs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<'all' | 'scheduled' | 'manual' | 'auto'>('all');
  const [engineFilter, setEngineFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [regexInput, setRegexInput] = useState('');
  const [pageSize, setPageSize] = useState<25 | 50>(25);
  const [page, setPage] = useState(1);
  const [detailRunId, setDetailRunId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [wizardOpen, setWizardOpen] = useState(false);

  const params: ListRunsParams = {
    limit: 200,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(triggerFilter !== 'all' ? { trigger: triggerFilter } : {}),
    ...(engineFilter !== 'all' ? { engineId: Number(engineFilter) } : {}),
    ...(dateFrom ? { from: dateFrom } : {}),
    ...(dateTo ? { to: dateTo } : {}),
  };

  const { data: runs, isLoading } = useListRuns(params, {
    query: {
      queryKey: getListRunsQueryKey(params),
      refetchInterval: (query) => {
        const activeRun = query.state.data?.some(r => ACTIVE_STATUSES.includes(r.status));
        return activeRun ? 3000 : false;
      }
    }
  });

  const { data: catalog } = useGetCatalog({
    query: { queryKey: getGetCatalogQueryKey() },
  });

  const { data: summary } = useGetRunsSummary({
    query: {
      queryKey: getGetRunsSummaryQueryKey(),
      refetchInterval: (query) => (query.state.data?.activeRuns ? 3000 : 30000),
    },
  });

  const engines = catalog?.engines ?? [];
  const industryName = (id: number | null | undefined): string | null =>
    id == null
      ? null
      : catalog?.industries.find((i) => i.id === id)?.name ?? `Industry ${id}`;
  const engineName = (id: number | null | undefined): string | null =>
    id == null ? null : engines.find((e) => e.id === id)?.name ?? `Engine ${id}`;
  const scopeLabel = (run: SurveyRun): string => {
    const parts: string[] = [];
    parts.push(industryName(run.industryId) ?? 'All industries');
    if (run.engineId != null) parts.push(engineName(run.engineId) ?? `Engine ${run.engineId}`);
    return parts.join(' · ');
  };

  // Custom regex filter (client-side, case-insensitive) over a per-run
  // haystack: id, status, trigger, scope, error text, and start date.
  const { regex, regexError } = useMemo(() => {
    if (!regexInput.trim()) return { regex: null, regexError: false };
    try {
      return { regex: new RegExp(regexInput.trim(), 'i'), regexError: false };
    } catch {
      return { regex: null, regexError: true };
    }
  }, [regexInput]);

  const filtered = useMemo(() => {
    if (!runs) return [];
    if (!regex) return runs;
    return runs.filter((run) => {
      const haystack = [
        `RUN-${run.id.toString().padStart(4, '0')}`,
        `#${run.id}`,
        run.status,
        run.trigger,
        scopeLabel(run),
        run.error ?? '',
        format(new Date(run.startedAt), 'yyyy-MM-dd HH:mm'),
      ].join(' ');
      return regex.test(haystack);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, regex, catalog]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const isRunning = runs?.some(r => ACTIVE_STATUSES.includes(r.status));
  const detailRun = detailRunId != null ? runs?.find((r) => r.id === detailRunId) ?? null : null;
  const failedCount = runs?.filter((r) => r.status === 'failed').length ?? 0;
  const stalledCount = runs?.filter((r) => runTelemetry(r).stale).length ?? 0;

  const reconcile = useReconcileRuns({
    mutation: {
      onSuccess: (r) => {
        toast({ title: 'Reconcile complete', description: r.message });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Reconcile failed', description: e.message }),
    },
  });

  const clearFailed = useClearFailedRuns({
    mutation: {
      onSuccess: (r) => {
        toast({ title: 'Failed runs cleared', description: r.message });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Clear failed', description: e.message }),
    },
  });

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  // ── Bulk actions ──────────────────────────────────────────────────
  const deleteRun = useDeleteRun();
  const cancelRunM = useCancelRun();
  const reportIssueM = useReportRunIssue();
  const [bulkBusy, setBulkBusy] = useState(false);

  const selectedRuns = filtered.filter((r) => selected.has(r.id));
  const toggleSel = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  const clearSel = () => setSelected(new Set());

  async function runBulk(
    label: string,
    fn: (id: number) => Promise<unknown>,
    filterFn?: (r: SurveyRun) => boolean,
  ) {
    const targets = selectedRuns.filter((r) => (filterFn ? filterFn(r) : true));
    if (targets.length === 0) {
      toast({ title: `No eligible runs for ${label}` });
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    for (const r of targets) {
      try { await fn(r.id); ok++; } catch { /* keep going */ }
    }
    setBulkBusy(false);
    clearSel();
    queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRunsSummaryQueryKey() });
    toast({ title: `${label}: ${ok}/${targets.length} done` });
  }

  const bulkDelete = () =>
    runBulk('Deleted', (id) => deleteRun.mutateAsync({ runId: id }), (r) => !ACTIVE_STATUSES.includes(r.status));
  const bulkCancel = () =>
    runBulk('Cancelled', (id) => cancelRunM.mutateAsync({ runId: id }), (r) => ['running', 'pausing', 'paused'].includes(r.status));
  const bulkPushAlerts = () =>
    runBulk('Pushed to alerts', (id) => reportIssueM.mutateAsync({ runId: id }), (r) => runHasIssues(r) && !ACTIVE_STATUSES.includes(r.status));

  return (
    <div className="p-6 md:p-10 max-w-[1400px] mx-auto space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-4xl font-sans font-bold tracking-tight text-foreground">Survey Runs</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">
            Run engine: execute, monitor, and escalate AI polling operations
          </p>
        </div>
        <Button
          onClick={() => setWizardOpen(true)}
          disabled={isRunning}
          size="lg"
          className="gap-2 font-mono"
          data-testid="button-trigger-run"
        >
          {isRunning ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Polling…</>
          ) : (
            <><Play className="w-4 h-4" /> Run now</>
          )}
        </Button>
      </div>

      <RunWizard open={wizardOpen} onClose={() => setWizardOpen(false)} disabled={isRunning} />

      {/* Schedules */}
      <SchedulesPanel />

      {/* Ops summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Total runs" value={summary ? String(summary.totalRuns) : '—'} sub={summary?.activeRuns ? `${summary.activeRuns} active now` : 'idle'} />
        <SummaryTile
          label="First run"
          value={summary?.firstRun ? format(new Date(summary.firstRun.startedAt), 'MMM d') : '—'}
          sub={summary?.firstRun ? format(new Date(summary.firstRun.startedAt), 'yyyy · HH:mm') : 'no runs yet'}
        />
        <SummaryTile
          label="Last run"
          value={summary?.lastRun ? formatDistanceToNow(new Date(summary.lastRun.startedAt), { addSuffix: true }) : '—'}
          sub={summary?.lastRun ? summary.lastRun.status : 'no runs yet'}
          subColor={summary?.lastRun ? STATUS_META[summary.lastRun.status]?.badge : undefined}
        />
        <SummaryTile
          label="Next scheduled"
          value={summary ? format(new Date(summary.nextScheduledRun), 'MMM d, HH:mm') : '—'}
          sub={summary ? `${formatDistanceToNow(new Date(summary.nextScheduledRun), { addSuffix: true })} · 06:00 UTC daily` : ''}
          accent
        />
      </div>

      {/* Filter bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={statusFilter === f.value ? 'default' : 'outline'}
              size="sm"
              className="font-mono text-xs"
              onClick={() => resetPage(setStatusFilter)(f.value)}
              data-testid={`filter-status-${f.value}`}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">Trigger</span>
          {(['all', 'scheduled', 'manual', 'auto'] as const).map((t) => (
            <Button
              key={t}
              variant={triggerFilter === t ? 'default' : 'outline'}
              size="sm"
              className="font-mono text-xs capitalize"
              onClick={() => resetPage(setTriggerFilter)(t)}
              data-testid={`filter-trigger-${t}`}
            >
              {t}
            </Button>
          ))}
          <span className="text-xs font-mono text-muted-foreground ml-2 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" /> Engine
          </span>
          <Select value={engineFilter} onValueChange={(v) => resetPage(setEngineFilter)(v)}>
            <SelectTrigger className="w-[150px] font-mono text-xs h-9" data-testid="filter-engine">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All engines</SelectItem>
              {engines.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-mono text-muted-foreground">From</span>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => resetPage(setDateFrom)(e.target.value)}
              className="w-[150px] font-mono text-xs h-9"
              aria-label="From date"
              data-testid="input-date-from"
            />
            <span className="text-xs font-mono text-muted-foreground">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => resetPage(setDateTo)(e.target.value)}
              className="w-[150px] font-mono text-xs h-9"
              aria-label="To date"
              data-testid="input-date-to"
            />
          </div>
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <RegexIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={regexInput}
              onChange={(e) => resetPage(setRegexInput)(e.target.value)}
              placeholder="Custom filter — plain text or regex (e.g. failed|partial, ^RUN-00, Banking)"
              className={`pl-8 font-mono text-xs h-9 ${regexError ? 'border-destructive' : ''}`}
              aria-label="Regex filter"
              data-testid="input-regex-filter"
            />
            {regexError && (
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-destructive font-mono">
                invalid regex
              </span>
            )}
          </div>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => resetPage(setPageSize)(Number(v) as 25 | 50)}
          >
            <SelectTrigger className="w-[110px] font-mono text-xs h-9" data-testid="select-page-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25 / page</SelectItem>
              <SelectItem value="50">50 / page</SelectItem>
            </SelectContent>
          </Select>
          {(dateFrom || dateTo || regexInput || statusFilter !== 'all' || triggerFilter !== 'all' || engineFilter !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              className="font-mono text-xs"
              onClick={() => {
                setStatusFilter('all');
                setTriggerFilter('all');
                setEngineFilter('all');
                setDateFrom('');
                setDateTo('');
                setRegexInput('');
                setPage(1);
              }}
              data-testid="button-clear-filters"
            >
              Clear filters
            </Button>
          )}
          {stalledCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="font-mono text-xs text-destructive hover:text-destructive gap-1.5 ml-auto"
              disabled={reconcile.isPending}
              onClick={() => reconcile.mutate()}
              data-testid="button-reconcile-runs"
              title="Finalize runs whose heartbeat has gone stale"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Finalize {stalledCount} stalled
            </Button>
          )}
          {failedCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`font-mono text-xs text-destructive hover:text-destructive gap-1.5 ${stalledCount > 0 ? '' : 'ml-auto'}`}
                  disabled={clearFailed.isPending}
                  data-testid="button-clear-failed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear {failedCount} failed
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all failed runs?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Permanently deletes {failedCount} failed run
                    {failedCount === 1 ? '' : 's'} and all of their rows. Runs
                    with data are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => clearFailed.mutate()}>
                    Delete failed runs
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border border-primary/30 bg-primary/5 px-3 py-2" data-testid="bulk-bar">
          <span className="font-mono text-xs text-primary font-bold">{selected.size} selected</span>
          <Button size="sm" variant="outline" className="font-mono text-xs gap-1.5" disabled={bulkBusy} onClick={bulkCancel} data-testid="bulk-cancel">
            <Ban className="w-3.5 h-3.5" /> Cancel
          </Button>
          <Button size="sm" variant="outline" className="font-mono text-xs gap-1.5 text-orange-600 hover:text-orange-600" disabled={bulkBusy} onClick={bulkPushAlerts} data-testid="bulk-push-alerts">
            <BellPlus className="w-3.5 h-3.5" /> Push to alerts
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="font-mono text-xs gap-1.5 text-destructive hover:text-destructive" disabled={bulkBusy} data-testid="bulk-delete">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selected.size} selected run{selected.size === 1 ? '' : 's'}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Permanently deletes the selected runs (active runs are skipped) and all of their rows. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={bulkDelete}>Delete selected</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" variant="ghost" className="font-mono text-xs ml-auto" onClick={clearSel}>Clear selection</Button>
        </div>
      )}

      {/* Jobs table */}
      <Card className="border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : pageRows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
              <Clock className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium text-lg">No matching runs</p>
              <p className="text-sm mt-1">
                {runs && runs.length > 0
                  ? 'Adjust the filters above.'
                  : 'Trigger a run to start collecting AI sentiment data.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36px]">
                    <button onClick={toggleAllOnPage} aria-label="Select all on page" className="flex items-center" data-testid="select-all">
                      {allOnPageSelected ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 text-muted-foreground" />}
                    </button>
                  </TableHead>
                  <TableHead className="w-[110px]">Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-right">OK</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((run) => {
                  const meta = STATUS_META[run.status] ?? STATUS_META.cancelled!;
                  return (
                    <TableRow
                      key={run.id}
                      onClick={() => setDetailRunId(run.id)}
                      className={`cursor-pointer border-l-2 ${meta.row} ${selected.has(run.id) ? 'bg-primary/5' : ''}`}
                      data-testid={`row-run-${run.id}`}
                    >
                      <TableCell onClick={(e) => { e.stopPropagation(); toggleSel(run.id); }}>
                        <Checkbox checked={selected.has(run.id)} aria-label={`Select run ${run.id}`} data-testid={`select-run-${run.id}`} />
                      </TableCell>
                      <TableCell className="font-mono font-bold text-xs">
                        RUN-{run.id.toString().padStart(4, '0')}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          {meta.icon}
                          <Badge variant="outline" className={`font-mono text-[10px] uppercase ${meta.badge}`}>
                            {run.status}
                          </Badge>
                          {runHasIssues(run) && !ACTIVE_STATUSES.includes(run.status) && (
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px] uppercase bg-orange-500/10 text-orange-600 border-orange-500/20"
                            >
                              issues
                            </Badge>
                          )}
                          {runTelemetry(run).stale && (
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px] uppercase bg-destructive/10 text-destructive border-destructive/20"
                              title="No heartbeat — the run loop appears wedged"
                            >
                              stalled
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {industryName(run.industryId) ?? 'All industries'}
                        {run.engineId != null && (
                          <span className="ml-1.5 inline-flex items-center gap-1 font-mono text-[10px] uppercase text-primary">
                            <Cpu className="w-3 h-3" />{engineName(run.engineId)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px] uppercase bg-secondary/30">
                          {run.trigger}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-600">
                        {run.succeededQueries}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${run.failedQueries > 0 ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                        {run.failedQueries}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{run.totalQueries}</TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {format(new Date(run.startedAt), 'MMM d HH:mm')}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{runDuration(run)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-mono">
          {filtered.length} job{filtered.length === 1 ? '' : 's'}
          {runs && filtered.length !== runs.length ? ` (filtered from ${runs.length})` : ''}
          {' · '}page {safePage} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {detailRun && (
        <RunDetailDialog
          run={detailRun}
          industryName={industryName(detailRun.industryId)}
          engineLabel={engineName(detailRun.engineId)}
          onClose={() => setDetailRunId(null)}
        />
      )}

      <UserQueryMonitor />
    </div>
  );
}

function SummaryTile({ label, value, sub, subColor, accent }: { label: string; value: string; sub?: string; subColor?: string; accent?: boolean }) {
  return (
    <div className={`border p-4 ${accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-sans font-bold text-lg tracking-tight text-foreground mt-1.5 truncate">{value}</div>
      {sub && (
        subColor
          ? <Badge variant="outline" className={`font-mono text-[10px] uppercase mt-1 ${subColor}`}>{sub}</Badge>
          : <div className="font-mono text-[11px] text-muted-foreground mt-1 truncate">{sub}</div>
      )}
    </div>
  );
}

function RunDetailDialog({
  run,
  industryName,
  engineLabel,
  onClose,
}: {
  run: SurveyRun;
  industryName: string | null;
  engineLabel: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isRunning = ACTIVE_STATUSES.includes(run.status);
  const meta = STATUS_META[run.status] ?? STATUS_META.cancelled!;

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
  const reRun = useTriggerRun({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Re-run started', description: 'A new run with the same scope is running.' });
        refresh();
        onClose();
      },
      onError: (e) => toast({ variant: 'destructive', title: 'Re-run failed', description: e.message }),
    },
  });
  const deleteRun = useDeleteRun({
    mutation: {
      onSuccess: () => {
        toast({ title: `Run #${run.id} deleted` });
        refresh();
        onClose();
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Delete failed', description: e.message }),
    },
  });
  const onError = (error: { message?: string }) => {
    toast({
      variant: "destructive",
      title: "Run control failed",
      description: error.message || "An unknown error occurred",
    });
    refresh();
  };

  const pauseRun = usePauseRun({ mutation: { onSuccess: refresh, onError } });
  const resumeRun = useResumeRun({ mutation: { onSuccess: refresh, onError } });
  const cancelRun = useCancelRun({ mutation: { onSuccess: refresh, onError } });
  const reportIssue = useReportRunIssue({
    mutation: {
      onSuccess: () =>
        toast({
          title: 'Pushed to alert queue',
          description: `Run #${run.id} is now flagged in Alerts.`,
        }),
      onError: (error) =>
        toast({
          variant: 'destructive',
          title: 'Could not report run',
          description: error.message || 'An unknown error occurred',
        }),
    },
  });
  const controlPending = pauseRun.isPending || resumeRun.isPending || cancelRun.isPending;

  const canPause = run.status === 'running';
  const canResume = run.status === 'paused';
  const canCancel = ['running', 'pausing', 'paused'].includes(run.status);
  const hasIssues = runHasIssues(run);

  const progress = run.totalQueries > 0
    ? ((run.succeededQueries + run.failedQueries) / run.totalQueries) * 100
    : 0;
  const tel = runTelemetry(run);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono">
            {meta.icon}
            RUN-{run.id.toString().padStart(4, '0')}
            <Badge variant="outline" className={`font-mono text-xs uppercase ${meta.badge}`}>
              {run.status}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs uppercase bg-secondary/30">
              {run.trigger}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs">
              {industryName ?? 'All industries'}
            </Badge>
            {engineLabel && (
              <Badge variant="outline" className="font-mono text-xs gap-1 text-primary">
                <Cpu className="w-3 h-3" />{engineLabel}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground font-mono flex flex-wrap gap-x-3 gap-y-1">
            <span>Started {format(new Date(run.startedAt), 'MMM d, yyyy HH:mm:ss')}</span>
            {run.completedAt && <span>· Finished {format(new Date(run.completedAt), 'HH:mm:ss')}</span>}
            <span>· Duration {runDuration(run)}</span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm font-mono">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-bold">
                {tel.processed} / {run.totalQueries}
                <span className="text-muted-foreground font-normal"> ({Math.round(progress)}%)</span>
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs font-mono text-muted-foreground">
              <span className="text-emerald-600">{run.succeededQueries} succeeded</span>
              {run.failedQueries > 0 && <span className="text-destructive">{run.failedQueries} failed</span>}
              {tel.active && <span>{tel.remaining} remaining</span>}
              {tel.active && tel.perMin > 0 && (
                <span>{tel.perMin.toFixed(1)}/min</span>
              )}
              {tel.active && tel.etaMs != null && (
                <span>ETA ~{fmtDur(tel.etaMs)}</span>
              )}
            </div>
            {tel.active && (
              <div
                className={`flex items-center gap-1.5 text-xs font-mono ${tel.stale ? 'text-destructive' : 'text-muted-foreground'}`}
                data-testid={`run-heartbeat-${run.id}`}
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    tel.stale ? 'bg-destructive' : 'bg-emerald-500 animate-pulse'
                  }`}
                />
                {tel.heartbeatMs == null
                  ? 'No heartbeat recorded yet'
                  : tel.stale
                    ? `Stalled — no heartbeat for ${fmtDur(tel.heartbeatMs)}. The watchdog will finalize it, or cancel it now.`
                    : `Live · last heartbeat ${fmtDur(tel.heartbeatMs)} ago`}
              </div>
            )}
          </div>

          {run.error && (
            <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md font-mono">
              {run.error}
            </div>
          )}
          {run.keyWarnings && run.keyWarnings.length > 0 && (
            <div className="text-sm text-orange-600 bg-orange-500/10 border border-orange-500/20 px-3 py-2 rounded-md font-mono space-y-1">
              <div className="flex items-center gap-2 font-bold uppercase text-xs">
                <KeyRound className="w-3.5 h-3.5" /> Provider key check failed before this run
              </div>
              {run.keyWarnings.map((w) => (
                <div key={w.provider} className="break-all">
                  <span className="uppercase font-bold">{w.provider}</span>
                  {' — '}
                  {w.source === 'none' ? 'no API key configured' : w.error}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!isRunning && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 font-mono"
                disabled={reRun.isPending}
                onClick={() =>
                  reRun.mutate({
                    data: {
                      ...(run.industryId != null ? { industryId: run.industryId } : {}),
                      ...(run.engineId != null ? { engineId: run.engineId } : {}),
                    },
                  })
                }
                data-testid={`button-rerun-${run.id}`}
              >
                <RotateCw className="w-3.5 h-3.5" />
                Re-run
              </Button>
            )}
            {hasIssues && !isRunning && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 font-mono text-orange-600 hover:text-orange-600"
                disabled={reportIssue.isPending}
                onClick={() => reportIssue.mutate({ runId: run.id })}
                data-testid={`button-report-issue-${run.id}`}
              >
                <BellPlus className="w-3.5 h-3.5" />
                Push to alerts
              </Button>
            )}
            {canPause && (
              <Button variant="outline" size="sm" className="gap-1.5 font-mono" disabled={controlPending}
                onClick={() => pauseRun.mutate({ runId: run.id })} data-testid={`button-pause-run-${run.id}`}>
                <Pause className="w-3.5 h-3.5" /> Pause
              </Button>
            )}
            {canResume && (
              <Button variant="outline" size="sm" className="gap-1.5 font-mono" disabled={controlPending}
                onClick={() => resumeRun.mutate({ runId: run.id })} data-testid={`button-resume-run-${run.id}`}>
                <Play className="w-3.5 h-3.5" /> Resume
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" size="sm" className="gap-1.5 font-mono text-destructive hover:text-destructive" disabled={controlPending}
                onClick={() => cancelRun.mutate({ runId: run.id })} data-testid={`button-cancel-run-${run.id}`}>
                <Ban className="w-3.5 h-3.5" /> Cancel
              </Button>
            )}
            {!isRunning && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1.5 font-mono text-destructive hover:text-destructive ml-auto"
                    disabled={deleteRun.isPending} data-testid={`button-delete-run-${run.id}`}>
                    <Trash2 className="w-3.5 h-3.5" /> Delete run
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete RUN-{run.id.toString().padStart(4, '0')}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Permanently removes this run and all of its query
                      responses, trend snapshots, and measurements. This cannot
                      be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteRun.mutate({ runId: run.id })}>
                      Delete run
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {(run.succeededQueries + run.failedQueries) > 0 && (
            <div>
              <p className="text-xs font-mono uppercase text-muted-foreground mb-2">Query log</p>
              <RunQueryLog runId={run.id} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Live monitor of public "Rank your brand" submissions — every user query
 * is visible here with its status, so abuse or failures are caught fast.
 */
function UserQueryMonitor() {
  const [status, setStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const params: Record<string, unknown> = { page, pageSize: 25 };
  if (status !== 'all') params.status = status;

  const { data, isLoading } = useBrowseTable('ad_hoc_requests', params, {
    query: {
      queryKey: getBrowseTableQueryKey('ad_hoc_requests', params),
      refetchInterval: 10000,
    },
  });

  const rows = (data?.rows ?? []) as unknown as {
    id: number;
    userId: number | null;
    userEmail: string | null;
    brand: string;
    competitors: string[];
    country: string;
    status: string;
    error: string | null;
    createdAt: string;
  }[];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1;

  return (
    <Card className="border-border">
      <CardHeader className="bg-muted/30 border-b border-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              User Query Monitor
            </CardTitle>
            <CardDescription>
              Public "Rank your brand" submissions — refreshed every 10s. Inputs
              are sanitized and length-capped server-side.
            </CardDescription>
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[160px] font-mono" data-testid="select-query-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground font-mono">
            No user queries{status !== 'all' ? ` with status ${status}` : ' yet'}.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Competitors</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} data-testid={`row-user-query-${r.id}`}>
                  <TableCell className="font-mono text-xs">{r.id}</TableCell>
                  <TableCell className="font-medium">{r.brand}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[260px] truncate">
                    {Array.isArray(r.competitors) ? r.competitors.join(', ') : ''}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.userEmail ?? 'anonymous'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.country}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] uppercase ${
                        r.status === 'completed'
                          ? 'text-accent border-accent/30'
                          : r.status === 'failed'
                            ? 'text-destructive border-destructive/30'
                            : 'text-primary border-primary/30'
                      }`}
                    >
                      {r.status}
                    </Badge>
                    {r.error && (
                      <p className="text-[10px] text-destructive mt-1 max-w-[200px] truncate">{r.error}</p>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data && data.total > 25 && (
          <div className="flex items-center justify-between p-3 border-t border-border">
            <p className="text-xs text-muted-foreground font-mono">
              Page {page} of {totalPages} · {data.total} queries
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ResponseRowData {
  id: number;
  engineId: number;
  engineName: string | null;
  industryId: number;
  industryName: string | null;
  metricKey: string;
  queryType?: string;
  status: string;
  error: string | null;
  prompt: string | null;
  rawResponse: string | null;
}

const QUERY_TYPE_LABEL: Record<string, string> = {
  current: 'daily',
  trend: '13-week',
  combined: 'combined',
};

function RunQueryLog({ runId }: { runId: number }) {
  const { data, isLoading } = useBrowseTable('survey_responses', { runId, page: 1, pageSize: 100 });
  const { data: catalog } = useGetCatalog({
    query: { queryKey: getGetCatalogQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="mt-3 space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  const rows = (data?.rows ?? []) as unknown as ResponseRowData[];
  if (rows.length === 0) {
    return <p className="mt-3 text-sm font-mono text-muted-foreground">No logged queries for this run.</p>;
  }

  const metricLabel = (key: string) => catalog?.metrics.find((m) => m.key === key)?.label ?? key;

  return (
    <div className="mt-3 border border-border rounded-md divide-y divide-border bg-muted/10">
      {rows.map((row) => (
        <QueryLogRow
          key={row.id}
          row={row}
          engine={row.engineName ?? `Engine ${row.engineId}`}
          industry={row.industryName ?? `Industry ${row.industryId}`}
          metric={metricLabel(row.metricKey)}
        />
      ))}
    </div>
  );
}

function QueryLogRow({
  row,
  engine,
  industry,
  metric,
}: {
  row: ResponseRowData;
  engine: string;
  industry: string;
  metric: string;
}) {
  const [open, setOpen] = useState(false);
  const ok = row.status === 'ok';

  return (
    <div data-testid={`row-query-${row.id}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
        data-testid={`button-expand-query-${row.id}`}
      >
        {open ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
        {ok ? (
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-accent" />
        ) : (
          <XCircle className="w-4 h-4 flex-shrink-0 text-destructive" />
        )}
        <span className="font-mono text-xs flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline" className="font-mono text-[10px] uppercase">{engine}</Badge>
          {row.queryType && (
            <Badge
              variant="outline"
              className={`font-mono text-[10px] uppercase ${
                row.queryType === 'trend'
                  ? 'text-violet-600 border-violet-500/30'
                  : row.queryType === 'current'
                    ? 'text-sky-600 border-sky-500/30'
                    : 'text-muted-foreground'
              }`}
            >
              {QUERY_TYPE_LABEL[row.queryType] ?? row.queryType}
            </Badge>
          )}
          <span className="text-foreground">{industry}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{metric}</span>
        </span>
        <Badge
          variant="outline"
          className={`font-mono text-[10px] uppercase ${ok ? 'text-accent border-accent/30' : 'text-destructive border-destructive/30'}`}
        >
          {row.status}
        </Badge>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {row.error && (
            <div className="text-xs font-mono text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2" data-testid={`text-query-error-${row.id}`}>
              {row.error}
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 mb-1.5 text-xs font-mono uppercase text-muted-foreground">
              <Terminal className="w-3.5 h-3.5" /> Prompt sent
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/40 border border-border rounded-md p-3 max-h-72 overflow-y-auto" data-testid={`text-query-prompt-${row.id}`}>
              {row.prompt ?? 'Not recorded (logged before prompt logging was added)'}
            </pre>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5 text-xs font-mono uppercase text-muted-foreground">
              <Terminal className="w-3.5 h-3.5" /> Raw response
            </div>
            <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/40 border border-border rounded-md p-3 max-h-72 overflow-y-auto" data-testid={`text-query-response-${row.id}`}>
              {row.rawResponse ?? (row.status === 'ok' ? 'Not recorded (logged before response logging was added)' : 'No response received (request failed before a response arrived)')}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
