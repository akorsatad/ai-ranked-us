import React, { useState } from 'react';
import {
  useListRuns,
  getListRunsQueryKey,
  useTriggerRun,
  SurveyRun,
  useBrowseTable,
  useGetCatalog,
  getGetCatalogQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Play, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, ChevronDown, ChevronRight, Terminal, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

export default function Runs() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: runs, isLoading } = useListRuns({
    query: {
      queryKey: getListRunsQueryKey(),
      refetchInterval: (query) => {
        const activeRun = query.state.data?.some(r => r.status === 'running');
        return activeRun ? 3000 : false;
      }
    }
  });

  const isRunning = runs?.some(r => r.status === 'running');

  const triggerRun = useTriggerRun({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Survey Started",
          description: "A new AI engine survey is now running.",
        });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Failed to start survey",
          description: error.message || "An unknown error occurred",
        });
      }
    }
  });

  const handleTrigger = () => {
    triggerRun.mutate({});
  };

  return (
    <div className="p-6 md:p-10 max-w-[1200px] mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-4xl font-sans font-bold tracking-tight text-foreground">Survey Runs</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">
            History of AI engine polling operations
          </p>
        </div>
        <Button 
          onClick={handleTrigger} 
          disabled={isRunning || triggerRun.isPending}
          className="gap-2 font-mono"
          size="lg"
        >
          {isRunning ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Polling Engines...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Survey Now
            </>
          )}
        </Button>
      </div>

      <Card className="border-border">
        <CardHeader className="bg-muted/30 border-b border-border">
          <CardTitle>Execution History</CardTitle>
          <CardDescription>All manual and scheduled survey runs</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !runs || runs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
              <Clock className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium text-lg">No runs recorded</p>
              <p className="text-sm mt-1">Trigger a run to start collecting AI sentiment data.</p>
            </div>
          ) : (
            <div className="divide-y border-border">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunRow({ run }: { run: SurveyRun }) {
  const isRunning = run.status === 'running';
  const [expanded, setExpanded] = useState(false);
  
  let statusIcon;
  let statusColor;
  
  switch(run.status) {
    case 'completed':
      statusIcon = <CheckCircle2 className="w-5 h-5 text-accent" />;
      statusColor = 'bg-accent/10 text-accent border-accent/20';
      break;
    case 'running':
      statusIcon = <RefreshCw className="w-5 h-5 text-primary animate-spin" />;
      statusColor = 'bg-primary/10 text-primary border-primary/20';
      break;
    case 'failed':
      statusIcon = <XCircle className="w-5 h-5 text-destructive" />;
      statusColor = 'bg-destructive/10 text-destructive border-destructive/20';
      break;
    case 'partial':
      statusIcon = <AlertCircle className="w-5 h-5 text-orange-500" />;
      statusColor = 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      break;
  }

  const progress = run.totalQueries > 0 
    ? ((run.succeededQueries + run.failedQueries) / run.totalQueries) * 100 
    : 0;

  return (
    <div className="p-6 hover:bg-muted/10 transition-colors flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-6 md:items-center">
      <div className="flex items-start gap-4 flex-1">
        <div className="mt-1">{statusIcon}</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-lg">RUN-{run.id.toString().padStart(4, '0')}</span>
            <Badge variant="outline" className={`font-mono text-xs uppercase ${statusColor}`}>
              {run.status}
            </Badge>
            <Badge variant="outline" className="font-mono text-xs uppercase bg-secondary/30">
              {run.trigger}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground flex items-center gap-2 font-mono">
            <span>Started: {format(new Date(run.startedAt), 'MMM d, yyyy HH:mm:ss')}</span>
            {run.completedAt && (
              <>
                <span className="text-border">•</span>
                <span>Finished: {format(new Date(run.completedAt), 'HH:mm:ss')}</span>
              </>
            )}
          </div>
          {run.error && (
            <div className="text-sm text-destructive mt-2 bg-destructive/10 px-3 py-2 rounded-md font-mono">
              {run.error}
            </div>
          )}
          {run.keyWarnings && run.keyWarnings.length > 0 && (
            <div
              className="text-sm text-orange-600 mt-2 bg-orange-500/10 border border-orange-500/20 px-3 py-2 rounded-md font-mono space-y-1"
              data-testid={`text-key-warnings-${run.id}`}
            >
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
        </div>
      </div>

      <div className="w-full md:w-64 space-y-2">
        <div className="flex justify-between text-sm font-mono">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-bold">{run.succeededQueries + run.failedQueries} / {run.totalQueries}</span>
        </div>
        <Progress value={progress} className="h-2" />
        <div className="flex justify-between text-xs font-mono text-muted-foreground">
          <span className="text-accent">{run.succeededQueries} Success</span>
          {run.failedQueries > 0 && <span className="text-destructive">{run.failedQueries} Failed</span>}
        </div>
      </div>
      </div>

      {!isRunning && (run.succeededQueries + run.failedQueries) > 0 && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((e) => !e)}
            className="gap-2 font-mono text-xs"
            data-testid={`button-toggle-queries-${run.id}`}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {expanded ? 'Hide query log' : 'View query log'}
          </Button>
          {expanded && <RunQueryLog runId={run.id} />}
        </div>
      )}
    </div>
  );
}

interface ResponseRowData {
  id: number;
  engineId: number;
  engineName: string | null;
  industryId: number;
  industryName: string | null;
  metricKey: string;
  status: string;
  error: string | null;
  prompt: string | null;
  rawResponse: string | null;
}

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
