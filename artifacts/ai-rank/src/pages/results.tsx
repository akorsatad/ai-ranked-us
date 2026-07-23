import React, { useEffect } from 'react';
import { Link, useParams } from 'wouter';
import {
  useGetAdHocRequest,
  getGetAdHocRequestQueryKey,
} from '@workspace/api-client-react';
import type { AdHocMetricResult, AdHocEngineResult, AdHocRankingEntry } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Trophy,
  ArrowLeft,
  AlertCircle,
  BarChart3,
  ChevronRight,
  Medal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

const COUNTRY_LABELS: Record<string, string> = {
  US: 'United States',
  UK: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  JP: 'Japan',
  IN: 'India',
  BR: 'Brazil',
  MX: 'Mexico',
};

function rankColor(rank: number): string {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return 'text-slate-400';
  if (rank === 3) return 'text-amber-600';
  return 'text-muted-foreground';
}

function RankBadge({ rank }: { rank: number }) {
  const colors: Record<number, string> = {
    1: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
    2: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
    3: 'bg-amber-600/15 text-amber-600 border-amber-600/30',
  };
  const cls = colors[rank] ?? 'bg-muted text-muted-foreground border-border';
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full border text-xs font-bold ${cls}`}>
      {rank}
    </span>
  );
}

function MetricCard({ metric, focusBrand }: { metric: AdHocMetricResult; focusBrand: string }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold">{metric.metricLabel}</CardTitle>
          <Badge variant="outline" className="text-xs shrink-0">
            {metric.higherIsBetter ? 'Higher = better' : 'Lower = better'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {metric.entries.map((entry) => {
          const isTarget = entry.brandName.toLowerCase() === focusBrand.toLowerCase();
          const pct = `${entry.score}%`;
          return (
            <div
              key={entry.brandName}
              className={`rounded-lg p-3 border transition-colors ${
                isTarget ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/30'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <RankBadge rank={entry.rank} />
                <span
                  className={`text-sm font-semibold flex-1 ${
                    isTarget ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {entry.brandName}
                  {isTarget && (
                    <span className="ml-2 text-xs font-normal text-primary/70">your brand</span>
                  )}
                </span>
                <span className={`text-sm font-bold tabular-nums ${rankColor(entry.rank)}`}>
                  {entry.score}/100
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isTarget ? 'bg-primary' : 'bg-muted-foreground/40'
                  }`}
                  style={{ width: pct }}
                />
              </div>
              {entry.rationale && (
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  {entry.rationale}
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function Results() {
  const params = useParams<{ id: string }>();
  const requestId = parseInt(params.id ?? '', 10);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useGetAdHocRequest(requestId, {
    query: {
      queryKey: getGetAdHocRequestQueryKey(requestId),
      enabled: !isNaN(requestId),
      refetchInterval: (query: { state: { data: unknown } }) => {
        const status = (query.state.data as { status?: string })?.status;
        return status === 'pending' || status === 'running' ? 2000 : false;
      },
    },
  });

  if (isNaN(requestId)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">Invalid results ID.</p>
        <Button asChild variant="outline"><Link href="/">← Back</Link></Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">Results not found.</p>
        <Button asChild variant="outline"><Link href="/">← Back</Link></Button>
      </div>
    );
  }

  const isPending = data.status === 'pending' || data.status === 'running';
  const isFailed = data.status === 'failed';
  const countryLabel = COUNTRY_LABELS[data.country] ?? data.country;
  const allBrands = [data.brand, ...data.competitors];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>

        <div className="flex items-start gap-4">
          <div className="bg-primary/10 rounded-xl p-3 mt-0.5 shrink-0">
            <BarChart3 className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{data.brand}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              vs. {data.competitors.join(', ')} · {countryLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Status banner */}
      {isPending && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
          <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Surveying AI engines…</p>
            <p className="text-xs text-muted-foreground">This takes about 30–60 seconds. Results will appear automatically.</p>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="flex items-center gap-3 bg-destructive/5 border border-destructive/20 rounded-xl px-4 py-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Survey failed</p>
            <p className="text-xs text-muted-foreground">{data.error ?? 'Unknown error occurred.'}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {data.results && (
        <>
          {/* Quick summary */}
          <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="w-4 h-4 text-primary" />
                Quick Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.results.averaged.map((metric: AdHocMetricResult) => {
                  const brandEntry = metric.entries.find(
                    (e: AdHocRankingEntry) => e.brandName.toLowerCase() === data.brand.toLowerCase(),
                  );
                  const topEntry = metric.entries[0];
                  if (!brandEntry || !topEntry) return null;
                  return (
                    <div key={metric.metricKey} className="bg-background/50 rounded-lg p-3 border border-border">
                      <p className="text-xs text-muted-foreground mb-1">{metric.metricLabel}</p>
                      <div className="flex items-baseline justify-between">
                        <div className="flex items-center gap-1.5">
                          <Medal className={`w-3.5 h-3.5 ${rankColor(brandEntry.rank)}`} />
                          <span className="text-sm font-bold text-foreground">
                            #{brandEntry.rank} of {metric.entries.length}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {brandEntry.score}/100
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Per-metric breakdowns */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Detailed Rankings
              <span className="text-sm font-normal text-muted-foreground">(averaged across AI engines)</span>
            </h2>
            {data.results.averaged.map((metric: AdHocMetricResult) => (
              <MetricCard key={metric.metricKey} metric={metric} focusBrand={data.brand} />
            ))}
          </div>

          {/* Engine breakdown */}
          {data.results.byEngine.length > 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-foreground">By Engine</h2>
              {data.results.byEngine.map((engine: AdHocEngineResult) => (
                <details key={engine.engineKey} className="group">
                  <summary className="flex items-center gap-2 cursor-pointer list-none py-3 px-4 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors">
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-open:rotate-90 transition-transform" />
                    <span className="text-sm font-medium text-foreground">{engine.engineName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{engine.metrics.length} metrics</span>
                  </summary>
                  <div className="mt-2 space-y-3 pl-4">
                      {engine.metrics.map((metric: AdHocMetricResult) => (
                      <MetricCard key={metric.metricKey} metric={metric} focusBrand={data.brand} />
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}

      {/* CTA */}
      <div className="border-t border-border pt-6 flex flex-col sm:flex-row gap-3">
        <Button asChild variant="outline" className="flex-1">
          <Link href="/">← Rank another brand</Link>
        </Button>
        <Button asChild className="flex-1">
          <Link href="/explore">Explore all industry rankings <ChevronRight className="w-4 h-4 ml-1" /></Link>
        </Button>
      </div>
    </div>
  );
}
