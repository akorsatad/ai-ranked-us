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
  getGetIndustryHistoryQueryKey
} from '@workspace/api-client-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend
} from 'recharts';
import { 
  Building2, 
  TrendingUp, 
  History,
  Bot, 
  Info,
  ChevronRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus
} from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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

export default function Industry() {
  const [, params] = useRoute('/industry/:id');
  const industryId = parseInt(params?.id || '0', 10);

  const { data: catalog, isLoading: isLoadingCatalog } = useGetCatalog({
    query: { queryKey: getGetCatalogQueryKey() }
  });

  const [activeMetric, setActiveMetric] = useState<string>('');

  // Set default metric once catalog loads
  React.useEffect(() => {
    if (catalog?.metrics && catalog.metrics.length > 0 && !activeMetric) {
      setActiveMetric(catalog.metrics[0].key);
    }
  }, [catalog, activeMetric]);

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

  const industry = catalog?.industries.find(i => i.id === industryId);
  const metricInfo = catalog?.metrics.find(m => m.key === activeMetric);

  // Transform trends data for Recharts
  const chartData = useMemo(() => {
    if (!trends || trends.brands.length === 0) return [];
    
    // Assume all brands have same points length, we map by weekIndex
    const weeksCount = trends.brands[0].points.length;
    const data = [];
    
    for (let i = 0; i < weeksCount; i++) {
      const point: any = { 
        name: trends.brands[0].points[i].weekLabel,
        index: i
      };
      
      trends.brands.forEach((brand) => {
        point[brand.brandName] = brand.points[i].score;
      });
      data.push(point);
    }
    
    return data;
  }, [trends]);

  // Transform measured per-run history for Recharts (points keyed by runId)
  const historyChartData = useMemo(() => {
    if (!history || history.brands.length === 0) return [];

    const runMap = new Map<number, { name: string; runId: number; [brand: string]: any }>();
    for (const brand of history.brands) {
      for (const point of brand.points) {
        let row = runMap.get(point.runId);
        if (!row) {
          row = {
            runId: point.runId,
            name: new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          };
          runMap.set(point.runId, row);
        }
        row[brand.brandName] = point.score;
      }
    }
    return [...runMap.values()].sort((a, b) => a.runId - b.runId);
  }, [history]);

  if (isLoadingCatalog || !industry) {
    return (
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

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
        
        {/* Left Column: Chart */}
        <div className="xl:col-span-2 space-y-8">
          <Card className="border-border">
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    13-Week Trend
                  </CardTitle>
                  <CardDescription>
                    AI consensus sentiment over time
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {isLoadingTrends ? (
                <Skeleton className="h-[400px] w-full" />
              ) : chartData.length > 0 ? (
                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          borderColor: 'hsl(var(--border))',
                          borderRadius: '0.5rem',
                          fontFamily: 'var(--app-font-mono)',
                          fontSize: '12px',
                          color: 'hsl(var(--foreground))'
                        }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Legend 
                        wrapperStyle={{ paddingTop: '20px', fontFamily: 'var(--app-font-sans)', fontSize: '14px' }}
                      />
                      {trends?.brands.map((brand, i) => (
                        <Line 
                          key={brand.brandId}
                          type="monotone" 
                          dataKey={brand.brandName} 
                          stroke={CHART_COLORS[i % CHART_COLORS.length]} 
                          strokeWidth={2}
                          dot={{ r: 4, strokeWidth: 2 }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[400px] flex items-center justify-center text-muted-foreground font-mono">
                  No trend data available.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Measured per-run history */}
          <Card className="border-border">
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <History className="w-5 h-5 text-primary" />
                    Measured History
                  </CardTitle>
                  <CardDescription>
                    Real day-over-day scores from stored survey runs (averaged across engines)
                  </CardDescription>
                </div>
                {history && (
                  <span className="text-xs font-mono bg-primary/10 px-2 py-1 rounded-md text-primary shrink-0">
                    {history.runsCount} {history.runsCount === 1 ? 'RUN' : 'RUNS'}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {isLoadingHistory ? (
                <Skeleton className="h-[300px] w-full" />
              ) : historyChartData.length > 1 ? (
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          borderColor: 'hsl(var(--border))',
                          borderRadius: '0.5rem',
                          fontFamily: 'var(--app-font-mono)',
                          fontSize: '12px',
                          color: 'hsl(var(--foreground))'
                        }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
                      <Legend 
                        wrapperStyle={{ paddingTop: '20px', fontFamily: 'var(--app-font-sans)', fontSize: '14px' }}
                      />
                      {history?.brands.map((brand, i) => (
                        <Line 
                          key={brand.brandId}
                          type="monotone" 
                          dataKey={brand.brandName} 
                          stroke={CHART_COLORS[i % CHART_COLORS.length]} 
                          strokeWidth={2}
                          dot={{ r: 4, strokeWidth: 2 }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[120px] flex items-center justify-center text-center text-muted-foreground font-mono text-sm px-6">
                  {historyChartData.length === 1
                    ? 'One run recorded — measured history appears once a second survey run completes.'
                    : 'No measured history yet. Run surveys to start building real day-over-day data.'}
                </div>
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
