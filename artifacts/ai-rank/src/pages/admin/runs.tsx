import React from 'react';
import { useListRuns, getListRunsQueryKey, useTriggerRun, SurveyRun } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Play, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, Zap, TrendingUp, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminLayout } from './layout';

export default function AdminRuns() {
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
          title: "Survey Initiated",
          description: "New survey run queued and executing.",
        });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Trigger Failed",
          description: error.message || "Could not start survey run",
        });
      }
    }
  });

  const handleTrigger = () => {
    triggerRun.mutate();
  };

  const finishedRuns = runs?.filter(r => r.status !== 'running' && r.totalQueries > 0) || [];
  const failedRuns = runs?.filter(r => r.status === 'failed' || r.status === 'partial') || [];
  const avgSuccessRate = finishedRuns.length > 0
    ? finishedRuns.reduce((acc, r) => acc + (r.succeededQueries / r.totalQueries), 0) / finishedRuns.length
    : 0;

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-8">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">Survey Execution Control</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              Trigger runs, monitor progress, inspect failures
            </p>
          </div>
          <Button 
            onClick={handleTrigger} 
            disabled={isRunning || triggerRun.isPending}
            className="gap-2 font-mono"
            size="lg"
            data-testid="button-trigger-run"
          >
            {isRunning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Trigger Now
              </>
            )}
          </Button>
        </div>

        {runs && runs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-border">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-primary/10 text-primary">
                  <Zap className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Runs</p>
                  <h3 className="text-3xl font-bold font-mono tracking-tight mt-1">
                    {runs.length}
                  </h3>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-accent/10 text-accent-foreground">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Avg Success Rate</p>
                  <h3 className="text-3xl font-bold font-mono tracking-tight mt-1">
                    {(avgSuccessRate * 100).toFixed(1)}%
                  </h3>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive">
                  <Activity className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Failed/Partial</p>
                  <h3 className="text-3xl font-bold font-mono tracking-tight mt-1">
                    {failedRuns.length}
                  </h3>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="border-border">
          <CardHeader className="bg-muted/30 border-b border-border">
            <CardTitle>Execution History</CardTitle>
            <CardDescription>Chronological record of all survey runs</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
              </div>
            ) : !runs || runs.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                <Clock className="w-12 h-12 mb-4 opacity-20" />
                <p className="font-medium text-lg">No execution history</p>
                <p className="text-sm mt-1">Trigger your first run to begin collecting data.</p>
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
    </AdminLayout>
  );
}

function RunRow({ run }: { run: SurveyRun }) {
  const isRunning = run.status === 'running';
  
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

  const duration = run.completedAt && run.startedAt 
    ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : null;

  return (
    <div className="p-6 hover:bg-muted/10 transition-colors flex flex-col gap-4" data-testid={`row-run-${run.id}`}>
      <div className="flex flex-col md:flex-row gap-6 md:items-start">
        <div className="flex items-start gap-4 flex-1">
          <div className="mt-1">{statusIcon}</div>
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-lg" data-testid={`text-run-id-${run.id}`}>RUN-{run.id.toString().padStart(4, '0')}</span>
              <Badge variant="outline" className={`font-mono text-xs uppercase ${statusColor}`} data-testid={`badge-status-${run.id}`}>
                {run.status}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs uppercase bg-secondary/30" data-testid={`badge-trigger-${run.id}`}>
                {run.trigger}
              </Badge>
              {duration !== null && (
                <span className="text-xs font-mono text-muted-foreground">
                  {duration}s
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground font-mono space-y-1">
              <div>Started: {format(new Date(run.startedAt), 'MMM d, yyyy HH:mm:ss')}</div>
              {run.completedAt && (
                <div>Finished: {format(new Date(run.completedAt), 'MMM d, yyyy HH:mm:ss')}</div>
              )}
            </div>
            {run.error && (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md font-mono border border-destructive/20" data-testid={`text-error-${run.id}`}>
                {run.error}
              </div>
            )}
          </div>
        </div>

        <div className="w-full md:w-72 space-y-2">
          <div className="flex justify-between text-sm font-mono">
            <span className="text-muted-foreground">Query Progress</span>
            <span className="font-bold" data-testid={`text-progress-${run.id}`}>{run.succeededQueries + run.failedQueries} / {run.totalQueries}</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between text-xs font-mono">
            <span className="text-accent" data-testid={`text-succeeded-${run.id}`}>{run.succeededQueries} Success</span>
            {run.failedQueries > 0 && <span className="text-destructive" data-testid={`text-failed-${run.id}`}>{run.failedQueries} Failed</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
