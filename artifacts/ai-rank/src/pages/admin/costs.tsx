import React, { useState } from 'react';
import {
  useGetCostSummary,
  getGetCostSummaryQueryKey,
  GetCostSummaryParams,
  CostBucket,
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import { DollarSign, Cpu, Layers, History, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const RANGES = [
  { label: 'Last run', value: 'last-run' },
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: 'All time', value: 'all' },
] as const;

type RangeValue = typeof RANGES[number]['value'];

function formatUsd(v: number): string {
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

export default function AdminCosts() {
  const [range, setRange] = useState<RangeValue>('30');

  const params: GetCostSummaryParams =
    range === 'all' || range === 'last-run' ? {} : { days: Number(range) };

  const { data, isLoading } = useGetCostSummary(params, {
    query: { queryKey: getGetCostSummaryQueryKey(params) },
  });

  // "Last run" = the most recent run bucket in the unfiltered summary.
  const lastRun = data?.byRun?.[0];
  const showLastRunOnly = range === 'last-run';

  const totals = showLastRunOnly && lastRun
    ? {
        costUsd: lastRun.costUsd,
        inputTokens: lastRun.inputTokens,
        outputTokens: lastRun.outputTokens,
        responses: lastRun.responses,
        responsesWithUsage: lastRun.responsesWithUsage,
      }
    : data?.totals;

  const untracked = data
    ? data.totals.responses - data.totals.responsesWithUsage
    : 0;

  return (
    <>
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">API Spend</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              Estimated cost and token usage across providers and models
            </p>
          </div>
          <div className="flex gap-1 border border-border rounded-lg p-1 bg-muted/30">
            {RANGES.map((r) => (
              <Button
                key={r.value}
                variant={range === r.value ? 'default' : 'ghost'}
                size="sm"
                className="font-mono text-xs"
                onClick={() => setRange(r.value)}
                data-testid={`button-range-${r.value}`}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="border-border">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <DollarSign className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {showLastRunOnly ? 'Last Run Spend' : 'Estimated Spend'}
                    </p>
                    <h3 className="text-3xl font-bold font-mono tracking-tight mt-1" data-testid="text-total-cost">
                      {formatUsd(totals?.costUsd ?? 0)}
                    </h3>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-accent/10 text-accent-foreground">
                    <Layers className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Input Tokens</p>
                    <h3 className="text-3xl font-bold font-mono tracking-tight mt-1" data-testid="text-input-tokens">
                      {formatTokens(totals?.inputTokens ?? 0)}
                    </h3>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-border">
                <CardContent className="p-6 flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-secondary/30 text-secondary-foreground">
                    <Cpu className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Output Tokens</p>
                    <h3 className="text-3xl font-bold font-mono tracking-tight mt-1" data-testid="text-output-tokens">
                      {formatTokens(totals?.outputTokens ?? 0)}
                    </h3>
                  </div>
                </CardContent>
              </Card>
            </div>

            {untracked > 0 && !showLastRunOnly && (
              <div className="flex items-start gap-3 text-sm bg-muted/40 border border-border rounded-lg px-4 py-3 font-mono text-muted-foreground" data-testid="text-untracked-notice">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {untracked} historical response{untracked === 1 ? '' : 's'} predate{untracked === 1 ? 's' : ''} usage
                  tracking and {untracked === 1 ? 'is' : 'are'} not included in token or cost totals.
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BucketTable
                title="By Provider"
                description="Spend grouped by API provider"
                buckets={showLastRunOnly ? [] : data.byProvider}
                emptyText={showLastRunOnly ? 'Switch to a time range to see provider breakdown.' : 'No usage recorded yet.'}
                testId="table-by-provider"
              />
              <BucketTable
                title="By Model"
                description="Spend grouped by resolved model"
                buckets={showLastRunOnly ? [] : data.byModel}
                emptyText={showLastRunOnly ? 'Switch to a time range to see model breakdown.' : 'No usage recorded yet.'}
                testId="table-by-model"
              />
            </div>

            <Card className="border-border">
              <CardHeader className="bg-muted/30 border-b border-border">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-muted-foreground" />
                  <CardTitle>Cost per Run</CardTitle>
                </div>
                <CardDescription>Most recent runs first</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {data.byRun.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground font-mono text-sm">No runs in this range.</div>
                ) : (
                  <Table data-testid="table-by-run">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-mono">Run</TableHead>
                        <TableHead className="font-mono">Started</TableHead>
                        <TableHead className="font-mono">Status</TableHead>
                        <TableHead className="font-mono text-right">Responses</TableHead>
                        <TableHead className="font-mono text-right">In Tokens</TableHead>
                        <TableHead className="font-mono text-right">Out Tokens</TableHead>
                        <TableHead className="font-mono text-right">Est. Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byRun.map((run) => (
                        <TableRow key={run.runId} data-testid={`row-run-cost-${run.runId}`}>
                          <TableCell className="font-mono font-bold">RUN-{String(run.runId).padStart(4, '0')}</TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {run.startedAt ? format(new Date(run.startedAt), 'MMM d, yyyy HH:mm') : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs uppercase">{run.status}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-right">{run.responses}</TableCell>
                          <TableCell className="font-mono text-right">{formatTokens(run.inputTokens)}</TableCell>
                          <TableCell className="font-mono text-right">{formatTokens(run.outputTokens)}</TableCell>
                          <TableCell className="font-mono text-right font-bold">
                            {run.responsesWithUsage === 0 ? (
                              <span className="text-muted-foreground font-normal">not tracked</span>
                            ) : (
                              formatUsd(run.costUsd)
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function BucketTable({
  title,
  description,
  buckets,
  emptyText,
  testId,
}: {
  title: string;
  description: string;
  buckets: CostBucket[];
  emptyText: string;
  testId: string;
}) {
  return (
    <Card className="border-border">
      <CardHeader className="bg-muted/30 border-b border-border">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {buckets.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-mono text-sm">{emptyText}</div>
        ) : (
          <Table data-testid={testId}>
            <TableHeader>
              <TableRow>
                <TableHead className="font-mono">Name</TableHead>
                <TableHead className="font-mono text-right">Responses</TableHead>
                <TableHead className="font-mono text-right">In</TableHead>
                <TableHead className="font-mono text-right">Out</TableHead>
                <TableHead className="font-mono text-right">Est. Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b) => (
                <TableRow key={b.key} data-testid={`row-bucket-${b.key}`}>
                  <TableCell className="font-mono font-medium">
                    {b.label}
                    {b.unknownCostResponses > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">({b.unknownCostResponses} unpriced)</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-right">{b.responses}</TableCell>
                  <TableCell className="font-mono text-right">{formatTokens(b.inputTokens)}</TableCell>
                  <TableCell className="font-mono text-right">{formatTokens(b.outputTokens)}</TableCell>
                  <TableCell className="font-mono text-right font-bold">{formatUsd(b.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
