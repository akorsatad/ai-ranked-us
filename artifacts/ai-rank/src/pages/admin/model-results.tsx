import React, { useState, useEffect } from 'react';
import {
  useGetCatalog,
  getGetCatalogQueryKey,
  useGetModelResults,
  getGetModelResultsQueryKey,
  GetModelResultsParams,
  ModelRankingEntry,
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import { Microscope, Coins } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatUsd(v: number): string {
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export default function AdminModelResults() {
  const { data: catalog } = useGetCatalog({
    query: { queryKey: getGetCatalogQueryKey() },
  });

  const [industryId, setIndustryId] = useState<string>('');
  const [metric, setMetric] = useState<string>('');

  // Default to the first industry/metric once the catalog loads.
  useEffect(() => {
    if (!industryId && catalog?.industries?.[0]) {
      setIndustryId(String(catalog.industries[0].id));
    }
    if (!metric && catalog?.metrics?.[0]) {
      setMetric(catalog.metrics[0].key);
    }
  }, [catalog, industryId, metric]);

  const ready = Boolean(industryId && metric);
  const params: GetModelResultsParams = {
    industryId: Number(industryId),
    metric,
  };

  const { data, isLoading } = useGetModelResults(params, {
    query: {
      queryKey: getGetModelResultsQueryKey(params),
      enabled: ready,
    },
  });

  return (
    <>
      <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <h1 className="text-3xl font-sans font-bold tracking-tight text-foreground">Model Results</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">
              How each individual model ranked brands, next to the aggregated result
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Industry</Label>
              <Select value={industryId} onValueChange={setIndustryId}>
                <SelectTrigger className="w-56 font-mono" data-testid="select-industry">
                  <SelectValue placeholder="Industry" />
                </SelectTrigger>
                <SelectContent>
                  {catalog?.industries?.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>{i.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-mono uppercase text-muted-foreground">Metric</Label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="w-56 font-mono" data-testid="select-metric">
                  <SelectValue placeholder="Metric" />
                </SelectTrigger>
                <SelectContent>
                  {catalog?.metrics?.map((m) => (
                    <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {!ready || isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !data || data.byModel.length === 0 ? (
          <Card className="border-border">
            <CardContent className="p-12 text-center text-muted-foreground flex flex-col items-center">
              <Microscope className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium text-lg">No survey results yet</p>
              <p className="text-sm mt-1">Run a survey to see per-model rankings here.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-border border-primary/30">
              <CardHeader className="bg-primary/5 border-b border-border">
                <CardTitle>Aggregated Ranking</CardTitle>
                <CardDescription>
                  {data.metricLabel} — averaged across {data.byModel.length} model{data.byModel.length === 1 ? '' : 's'}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <EntriesTable entries={data.aggregated} testId="table-aggregated" />
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              {data.byModel.map((m) => (
                <Card key={m.engineId} className="border-border" data-testid={`card-model-${m.engineKey}`}>
                  <CardHeader className="bg-muted/30 border-b border-border">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <CardTitle className="text-lg">{m.engineName}</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-xs uppercase">{m.provider}</Badge>
                        {m.costUsd != null && (
                          <Badge variant="outline" className="font-mono text-xs gap-1">
                            <Coins className="w-3 h-3" />
                            {formatUsd(m.costUsd)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <CardDescription className="font-mono text-xs space-x-2">
                      <span>{m.resolvedModel ?? m.model}</span>
                      <span>·</span>
                      <span>{format(new Date(m.surveyedAt), 'MMM d, yyyy HH:mm')}</span>
                      <span>·</span>
                      <span>RUN-{String(m.runId).padStart(4, '0')}</span>
                      {m.inputTokens != null && m.outputTokens != null ? (
                        <>
                          <span>·</span>
                          <span>{m.inputTokens} in / {m.outputTokens} out tokens</span>
                        </>
                      ) : (
                        <>
                          <span>·</span>
                          <span className="text-muted-foreground/70">usage not tracked</span>
                        </>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <EntriesTable entries={m.entries} testId={`table-model-${m.engineKey}`} showRationale />
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function EntriesTable({
  entries,
  testId,
  showRationale = true,
}: {
  entries: ModelRankingEntry[];
  testId: string;
  showRationale?: boolean;
}) {
  return (
    <Table data-testid={testId}>
      <TableHeader>
        <TableRow>
          <TableHead className="font-mono w-16">Rank</TableHead>
          <TableHead className="font-mono">Brand</TableHead>
          <TableHead className="font-mono text-right w-20">Score</TableHead>
          {showRationale && <TableHead className="font-mono">Rationale</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => (
          <TableRow key={e.brandId}>
            <TableCell className="font-mono font-bold">#{e.rank}</TableCell>
            <TableCell className="font-medium">{e.brandName}</TableCell>
            <TableCell className="font-mono text-right">{e.score}</TableCell>
            {showRationale && (
              <TableCell className="text-sm text-muted-foreground max-w-md">{e.rationale ?? '—'}</TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
