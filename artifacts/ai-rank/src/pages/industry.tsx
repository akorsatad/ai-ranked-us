import React, { useState, useMemo } from 'react';
import { useRoute } from 'wouter';
import { 
  useGetCatalog, 
  getGetCatalogQueryKey,
  useGetIndustryRankings,
  getGetIndustryRankingsQueryKey,
  useGetIndustryTrends,
  getGetIndustryTrendsQueryKey,
  useGetIndustryHistory,
  getGetIndustryHistoryQueryKey,
  useListTrendSnapshots,
  getListTrendSnapshotsQueryKey,
  useGetTrendSnapshot,
  getGetTrendSnapshotQueryKey
} from '@workspace/api-client-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend
} from 'recharts';
import { 
  Building2, 
  TrendingUp, 
  GitCompareArrows,
  Bot, 
  Info,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus
} from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';

// Generate colors based on index for the chart
const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--primary))',
];

function RankChange({ rank, previousRank }: { rank: number; previousRank?: number | null }) {
  if (previousRank == null) return null;
  const delta = previousRank - rank; // positive = moved up
  if (delta > 0) {
    return (
      <span data-testid="rank-change-up" className="inline-flex items-center gap-0.5 text-xs font-mono font-bold text-emerald-500">
        <ArrowUp className="w-3 h-3" />{delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span data-testid="rank-change-down" className="inline-flex items-center gap-0.5 text-xs font-mono font-bold text-red-500">
        <ArrowDown className="w-3 h-3" />{Math.abs(delta)}
      </span>
    );
  }
  return (
    <span data-testid="rank-change-flat" className="inline-flex items-center text-xs font-mono text-muted-foreground">
      <Minus className="w-3 h-3" />
    </span>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortDate(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  borderColor: 'hsl(var(--border))',
  borderRadius: '0.5rem',
  fontFamily: 'var(--app-font-mono)',
  fontSize: '12px',
  color: 'hsl(var(--foreground))',
} as const;

export default function Industry() {
  const [, params] = useRoute('/industry/:id');
  const industryId = parseInt(params?.id || '0', 10);

  const { data: catalog, isLoading: isLoadingCatalog } = useGetCatalog({
    query: { queryKey: getGetCatalogQueryKey() }
  });

  const [activeMetric, setActiveMetric] = useState<string>('');
  const [showMeasured, setShowMeasured] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [snapshotA, setSnapshotA] = useState<string>('');
  const [snapshotB, setSnapshotB] = useState<string>('');

  // Set default metric once catalog loads
  React.useEffect(() => {
    if (catalog?.metrics && catalog.metrics.length > 0 && !activeMetric) {
      setActiveMetric(catalog.metrics[0].key);
    }
  }, [catalog, activeMetric]);

  // Reset snapshot picks when the metric changes
  React.useEffect(() => {
    setSnapshotA('');
    setSnapshotB('');
  }, [activeMetric]);

  const { data: rankings, isLoading: isLoadingRankings } = useGetIndustryRankings(
    industryId, 
    { metric: activeMetric }, 
    { 
      query: { 
        enabled: !!industryId && !!activeMetric,
        queryKey: getGetIndustryRankingsQueryKey(industryId, { metric: activeMetric })
      } 
    }
  );

  const { data: trends, isLoading: isLoadingTrends } = useGetIndustryTrends(
    industryId,
    { metric: activeMetric },
    {
      query: {
        enabled: !!industryId && !!activeMetric,
        queryKey: getGetIndustryTrendsQueryKey(industryId, { metric: activeMetric })
      }
    }
  );

  const { data: history, isLoading: isLoadingHistory } = useGetIndustryHistory(
    industryId,
    { metric: activeMetric },
    {
      query: {
        enabled: !!industryId && !!activeMetric,
        queryKey: getGetIndustryHistoryQueryKey(industryId, { metric: activeMetric })
      }
    }
  );

  const { data: snapshotList } = useListTrendSnapshots(
    industryId,
    { metric: activeMetric },
    {
      query: {
        enabled: !!industryId && !!activeMetric,
        queryKey: getListTrendSnapshotsQueryKey(industryId, { metric: activeMetric })
      }
    }
  );

  const snapshotDates = snapshotList?.snapshots.map(s => s.date) ?? [];

  // Default the perception-shift picks: A = oldest, B = newest.
  React.useEffect(() => {
    if (snapshotDates.length >= 2) {
      if (!snapshotA || !snapshotDates.includes(snapshotA)) {
        setSnapshotA(snapshotDates[snapshotDates.length - 1]);
      }
      if (!snapshotB || !snapshotDates.includes(snapshotB)) {
        setSnapshotB(snapshotDates[0]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotList]);

  const { data: snapA } = useGetTrendSnapshot(
    industryId, snapshotA, { metric: activeMetric },
    {
      query: {
        enabled: !!industryId && !!activeMetric && !!snapshotA,
        queryKey: getGetTrendSnapshotQueryKey(industryId, snapshotA, { metric: activeMetric })
      }
    }
  );
  const { data: snapB } = useGetTrendSnapshot(
    industryId, snapshotB, { metric: activeMetric },
    {
      query: {
        enabled: !!industryId && !!activeMetric && !!snapshotB,
        queryKey: getGetTrendSnapshotQueryKey(industryId, snapshotB, { metric: activeMetric })
      }
    }
  );

  const industry = catalog?.industries.find(i => i.id === industryId);
  const metricInfo = catalog?.metrics.find(m => m.key === activeMetric);

  // Merge measured daily history and the latest 13-week estimated trend onto
  // one date-keyed axis. Trend weeks are anchored to the latest snapshot date.
  const combinedChart = useMemo(() => {
    const rows = new Map<string, Record<string, unknown>>();
    const getRow = (key: string) => {
      let row = rows.get(key);
      if (!row) {
        row = { dateKey: key, name: shortDate(key) };
        rows.set(key, row);
      }
      return row;
    };

    const measuredKeys: string[] = [];
    if (history) {
      for (const brand of history.brands) {
        const seriesKey = `${brand.brandName} · measured`;
        measuredKeys.push(seriesKey);
        for (const point of brand.points) {
          getRow(dateKey(new Date(point.date)))[seriesKey] = point.score;
        }
      }
    }

    const trendKeys: string[] = [];
    if (trends && trends.brands.length > 0) {
      const anchorKey = snapshotDates[0] ?? dateKey(new Date());
      const anchor = new Date(`${anchorKey}T00:00:00Z`).getTime();
      for (const brand of trends.brands) {
        const seriesKey = `${brand.brandName} · 13w est.`;
        trendKeys.push(seriesKey);
        for (const point of brand.points) {
          const d = new Date(anchor - (12 - point.weekIndex) * 7 * DAY_MS);
          getRow(dateKey(d))[seriesKey] = point.score;
        }
      }
    }

    const data = [...rows.values()].sort((a, b) =>
      String(a.dateKey) < String(b.dateKey) ? -1 : 1,
    );
    return { data, measuredKeys, trendKeys };
  }, [history, trends, snapshotDates]);

  // Perception shift: overlay two snapshots on the weekIndex axis.
  const shiftChart = useMemo(() => {
    if (!snapA || !snapB) return { data: [], brands: [] as string[] };
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 13; i++) {
      rows.push({ weekIndex: i, name: snapB.brands[0]?.points.find(p => p.weekIndex === i)?.weekLabel ?? `W${i}` });
    }
    const brandNames = new Set<string>();
    for (const [snap, tag] of [[snapA, 'A'], [snapB, 'B']] as const) {
      for (const brand of snap.brands) {
        brandNames.add(brand.brandName);
        for (const point of brand.points) {
          if (point.weekIndex >= 0 && point.weekIndex <= 12) {
            rows[point.weekIndex][`${brand.brandName} · ${tag}`] = point.score;
          }
        }
      }
    }
    return { data: rows, brands: [...brandNames] };
  }, [snapA, snapB]);

  if (isLoadingCatalog || !industry) {
    return (
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const isLoadingCombined = isLoadingTrends || isLoadingHistory;
  const hasCombinedData = combinedChart.data.length > 0 &&
    ((showMeasured && combinedChart.measuredKeys.length > 0) ||
     (showTrend && combinedChart.trendKeys.length > 0));

  return (
    <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-8">
      
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" asChild className="w-fit -ml-2 text-muted-foreground hover:text-foreground">
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Overview
          </Link>
        </Button>
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 text-primary p-3 rounded-xl border border-primary/20">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-4xl font-sans font-bold tracking-tight text-foreground">{industry.name}</h1>
            <p className="text-muted-foreground mt-1 font-mono uppercase tracking-widest text-sm">
              {industry.country} • Industry Sector
            </p>
          </div>
        </div>
      </div>

      {catalog && catalog.metrics && (
        <Tabs value={activeMetric} onValueChange={setActiveMetric} className="w-full">
          <div className="overflow-x-auto pb-2 scrollbar-hide">
            <TabsList className="bg-muted/50 p-1 border border-border">
              {catalog.metrics.map(metric => (
                <TabsTrigger 
                  key={metric.key} 
                  value={metric.key}
                  className="data-[state=active]:bg-card data-[state=active]:text-card-foreground data-[state=active]:shadow-sm font-mono text-sm px-4"
                >
                  {metric.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </Tabs>
      )}

      {metricInfo && (
        <div className="flex items-center gap-2 text-muted-foreground bg-muted/30 p-4 rounded-lg border border-border">
          <Info className="w-5 h-5 text-primary" />
          <p className="font-medium">{metricInfo.description}</p>
        </div>
      )}

      {/* Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Left Column: Charts */}
        <div className="xl:col-span-2 space-y-8">
          {/* Combined dual-series chart */}
          <Card className="border-border">
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Score History
                  </CardTitle>
                  <CardDescription>
                    Real measured daily scores (solid) vs the AI-estimated 13-week lookback (dashed)
                  </CardDescription>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch id="toggle-measured" checked={showMeasured} onCheckedChange={setShowMeasured} />
                    <Label htmlFor="toggle-measured" className="font-mono text-xs cursor-pointer">MEASURED</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="toggle-trend" checked={showTrend} onCheckedChange={setShowTrend} />
                    <Label htmlFor="toggle-trend" className="font-mono text-xs cursor-pointer">13W ESTIMATE</Label>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {isLoadingCombined ? (
                <Skeleton className="h-[400px] w-full" />
              ) : hasCombinedData ? (
                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={combinedChart.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12} 
                        fontFamily="var(--app-font-mono)"
                        tickMargin={10}
                      />
                      <YAxis 
                        domain={[0, 100]} 
                        stroke="hsl(var(--muted-foreground))" 
                        fontSize={12}
                        fontFamily="var(--app-font-mono)"
                        tickMargin={10}
                      />
                      <RechartsTooltip contentStyle={tooltipStyle} itemStyle={{ color: 'hsl(var(--foreground))' }} />
                      <Legend 
                        wrapperStyle={{ paddingTop: '20px', fontFamily: 'var(--app-font-sans)', fontSize: '13px' }}
                      />
                      {showTrend && trends?.brands.map((brand, i) => (
                        <Line 
                          key={`t-${brand.brandId}`}
                          isAnimationActive={false}
                          type="monotone" 
                          dataKey={`${brand.brandName} · 13w est.`}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]} 
                          strokeWidth={1.5}
                          strokeDasharray="6 4"
                          strokeOpacity={0.65}
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0 }}
                          connectNulls
                        />
                      ))}
                      {showMeasured && history?.brands.map((brand, i) => (
                        <Line 
                          key={`m-${brand.brandId}`}
                          isAnimationActive={false}
                          type="monotone" 
                          dataKey={`${brand.brandName} · measured`}
                          stroke={CHART_COLORS[i % CHART_COLORS.length]} 
                          strokeWidth={2.5}
                          dot={{ r: 4, strokeWidth: 2 }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[400px] flex items-center justify-center text-muted-foreground font-mono text-sm text-center px-6">
                  {!showMeasured && !showTrend
                    ? 'Both series hidden — toggle one back on above.'
                    : 'No data yet. Run surveys to start building history.'}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Perception shift */}
          <Card className="border-border">
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GitCompareArrows className="w-5 h-5 text-primary" />
                    Perception Shift
                  </CardTitle>
                  <CardDescription>
                    Compare 13-week estimates from two survey days to see how engines revise the past
                  </CardDescription>
                </div>
                {snapshotDates.length >= 2 && (
                  <div className="flex items-center gap-2">
                    <Select value={snapshotA} onValueChange={setSnapshotA}>
                      <SelectTrigger className="w-[130px] font-mono text-xs" aria-label="Snapshot A date">
                        <SelectValue placeholder="Date A" />
                      </SelectTrigger>
                      <SelectContent>
                        {snapshotDates.map(d => (
                          <SelectItem key={d} value={d} className="font-mono text-xs">{shortDate(d)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-muted-foreground font-mono text-xs">vs</span>
                    <Select value={snapshotB} onValueChange={setSnapshotB}>
                      <SelectTrigger className="w-[130px] font-mono text-xs" aria-label="Snapshot B date">
                        <SelectValue placeholder="Date B" />
                      </SelectTrigger>
                      <SelectContent>
                        {snapshotDates.map(d => (
                          <SelectItem key={d} value={d} className="font-mono text-xs">{shortDate(d)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {snapshotDates.length < 2 ? (
                <div className="h-[120px] flex items-center justify-center text-center text-muted-foreground font-mono text-sm px-6">
                  Snapshots from at least two different days are needed — each daily run stores its own 13-week estimate.
                </div>
              ) : shiftChart.data.length > 0 ? (
                <>
                  <div className="h-[340px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={shiftChart.data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis 
                          dataKey="name" 
                          stroke="hsl(var(--muted-foreground))" 
                          fontSize={12} 
                          fontFamily="var(--app-font-mono)"
                          tickMargin={10}
                        />
                        <YAxis 
                          domain={[0, 100]} 
                          stroke="hsl(var(--muted-foreground))" 
                          fontSize={12}
                          fontFamily="var(--app-font-mono)"
                          tickMargin={10}
                        />
                        <RechartsTooltip contentStyle={tooltipStyle} itemStyle={{ color: 'hsl(var(--foreground))' }} />
                        <Legend 
                          wrapperStyle={{ paddingTop: '20px', fontFamily: 'var(--app-font-sans)', fontSize: '13px' }}
                        />
                        {shiftChart.brands.map((brandName, i) => (
                          <Line 
                            key={`a-${brandName}`}
                            isAnimationActive={false}
                          type="monotone" 
                            dataKey={`${brandName} · A`}
                            stroke={CHART_COLORS[i % CHART_COLORS.length]} 
                            strokeWidth={1.5}
                            strokeDasharray="5 5"
                            strokeOpacity={0.5}
                            dot={false}
                            connectNulls
                          />
                        ))}
                        {shiftChart.brands.map((brandName, i) => (
                          <Line 
                            key={`b-${brandName}`}
                            isAnimationActive={false}
                          type="monotone" 
                            dataKey={`${brandName} · B`}
                            stroke={CHART_COLORS[i % CHART_COLORS.length]} 
                            strokeWidth={2.5}
                            dot={false}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono mt-2 text-center">
                    A ({snapshotA && shortDate(snapshotA)}, dashed) vs B ({snapshotB && shortDate(snapshotB)}, solid)
                  </p>
                </>
              ) : (
                <Skeleton className="h-[340px] w-full" />
              )}
            </CardContent>
          </Card>

          {/* Engine Breakdowns */}
          {rankings && rankings.byEngine.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" /> Breakdowns by Engine
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {rankings.byEngine.map(engine => (
                  <Card key={engine.engineKey} className="border-border">
                    <CardHeader className="p-4 bg-muted/20 border-b border-border">
                      <CardTitle className="text-lg">{engine.engineName}</CardTitle>
                      {engine.surveyedAt && (
                        <CardDescription className="font-mono text-xs">
                          {new Date(engine.surveyedAt).toLocaleDateString()}
                        </CardDescription>
                      )}
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y border-border">
                        {engine.entries.slice(0, 5).map((entry, idx) => (
                          <div 
                            key={entry.brandId} 
                            className="p-3 flex items-center justify-between text-sm animate-in fade-in slide-in-from-left-2"
                            style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-muted-foreground w-4">{entry.rank}</span>
                              <span className="font-medium">{entry.brandName}</span>
                              <RankChange rank={entry.rank} previousRank={entry.previousRank} />
                            </div>
                            <span className="font-mono font-bold">{entry.score.toFixed(1)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Current Rankings (Averaged) */}
        <div className="space-y-6">
          <Card className="border-primary/20 shadow-lg border-2">
            <CardHeader className="bg-primary/5 border-b border-primary/20">
              <CardTitle className="text-primary flex items-center justify-between">
                Consensus Ranking
                <span className="text-xs font-mono bg-primary/10 px-2 py-1 rounded-md text-primary">AVERAGE</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingRankings ? (
                <div className="p-4 space-y-4">
                  {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : rankings && rankings.average.length > 0 ? (
                <div className="divide-y border-border">
                  {rankings.average.map((entry, idx) => (
                    <div 
                      key={entry.brandId} 
                      className="p-4 hover:bg-muted/30 transition-colors group animate-in fade-in slide-in-from-bottom-4"
                      style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 flex items-center justify-center rounded-full font-mono text-xs font-bold ${
                            entry.rank === 1 ? 'bg-accent text-accent-foreground' : 
                            entry.rank <= 3 ? 'bg-secondary text-secondary-foreground' : 
                            'bg-muted text-muted-foreground'
                          }`}>
                            {entry.rank}
                          </div>
                          <span className="font-bold text-lg">{entry.brandName}</span>
                          <RankChange rank={entry.rank} previousRank={entry.previousRank} />
                        </div>
                        <div className="font-mono text-xl font-bold text-primary">
                          {entry.score.toFixed(1)}
                        </div>
                      </div>
                      
                      {entry.rationale && (
                        <div className="pl-9 pr-2">
                          <p className="text-sm text-muted-foreground italic leading-snug border-l-2 border-primary/20 pl-3 py-1">
                            "{entry.rationale}"
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground font-mono">
                  No ranking data available.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
