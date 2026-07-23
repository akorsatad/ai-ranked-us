import React, { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { 
  useGetOverview, 
  getGetOverviewQueryKey, 
  useListRuns, 
  getListRunsQueryKey,
  useTriggerRun,
  useGetCatalog,
  getGetCatalogQueryKey,
  useGetMovers,
  getGetMoversQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  BarChart3, 
  Building2, 
  Cpu, 
  MessageSquare, 
  Play, 
  AlertCircle,
  Trophy,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: runs } = useListRuns({
    query: {
      queryKey: getListRunsQueryKey(),
      refetchInterval: (query) => {
        const activeRun = query.state.data?.some(r => r.status === 'running');
        return activeRun ? 3000 : false;
      }
    }
  });

  const isRunning = runs?.some(r => r.status === 'running');

  const { data: overview, isLoading: isLoadingOverview } = useGetOverview({
    query: {
      queryKey: getGetOverviewQueryKey(),
      refetchInterval: isRunning ? 3000 : false,
    }
  });

  const { data: moversReport } = useGetMovers({
    query: {
      queryKey: getGetMoversQueryKey(),
      refetchInterval: isRunning ? 3000 : false,
    }
  });

  const { data: catalog } = useGetCatalog({
    query: {
      queryKey: getGetCatalogQueryKey(),
    }
  });

  const triggerRun = useTriggerRun({
    mutation: {
      onSuccess: () => {
        toast({
          title: "Survey Started",
          description: "A new AI engine survey is now running in the background.",
        });
        queryClient.invalidateQueries({ queryKey: getListRunsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
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

  const hasData = overview && overview.responsesCount > 0;

  if (isLoadingOverview) {
    return (
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-[1600px] mx-auto space-y-10">
      
      {/* Header section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-4xl font-sans font-bold tracking-tight text-foreground">Intelligence Overview</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">
            {overview?.lastRun?.completedAt 
              ? `Last updated ${formatDistanceToNow(new Date(overview.lastRun.completedAt), { addSuffix: true })}` 
              : "No completed runs yet"}
          </p>
        </div>
        <Button 
          onClick={handleTrigger} 
          disabled={isRunning || triggerRun.isPending}
          className="gap-2 font-mono"
          size="lg"
        >
          {isRunning ? (
            <span className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-foreground"></span>
              </span>
              Survey in progress...
            </span>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Run Survey Now
            </>
          )}
        </Button>
      </div>

      {!hasData && !isRunning && (
        <Alert className="bg-primary/5 border-primary/20 text-primary">
          <AlertCircle className="h-5 w-5 !text-primary" />
          <AlertTitle className="text-lg font-bold">Awaiting Intelligence</AlertTitle>
          <AlertDescription className="text-base mt-2 flex flex-col gap-4">
            <p>Your database is initialized but empty. Run a survey to query AI engines (GPT, Claude, Gemini, etc.) and gather baseline sentiment data across your catalog.</p>
            <div>
              <Button onClick={handleTrigger} variant="default" className="font-mono gap-2">
                <Play className="w-4 h-4" /> Start Initial Run
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Industries Tracked" value={overview?.industriesCount || 0} icon={Building2} />
        <StatCard title="Brands Surveyed" value={overview?.brandsCount || 0} icon={BarChart3} />
        <StatCard title="AI Engines" value={overview?.enginesCount || 0} icon={Cpu} />
        <StatCard title="Total Responses" value={overview?.responsesCount || 0} icon={MessageSquare} highlight />
      </div>

      {/* Biggest Movers since previous run */}
      {hasData && moversReport && moversReport.movers.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Biggest Movers</h2>
            <p className="text-sm text-muted-foreground font-mono">
              {moversReport.previousRunAt
                ? `vs. run ${formatDistanceToNow(new Date(moversReport.previousRunAt), { addSuffix: true })}`
                : 'vs. previous run'}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {moversReport.movers.slice(0, 6).map((mover, idx) => {
              const up = mover.rankDelta > 0 || (mover.rankDelta === 0 && mover.scoreDelta > 0);
              const flat = mover.rankDelta === 0;
              return (
                <Card
                  key={`${mover.industryId}-${mover.metric}-${mover.brandId}`}
                  className="border-border animate-in fade-in slide-in-from-bottom-2"
                  style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'both' }}
                >
                  <CardContent className="p-5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${
                        flat ? 'bg-muted text-muted-foreground'
                          : up ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-red-500/10 text-red-600 dark:text-red-400'
                      }`}>
                        {flat ? <Minus className="w-5 h-5" /> : up ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold truncate">{mover.brandName}</p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {mover.industryName} • {mover.metricLabel}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {mover.rankDelta !== 0 ? (
                        <p className={`font-mono font-bold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {mover.rankDelta > 0 ? '▲' : '▼'} {Math.abs(mover.rankDelta)} {Math.abs(mover.rankDelta) === 1 ? 'spot' : 'spots'}
                        </p>
                      ) : (
                        <p className={`font-mono font-bold ${mover.scoreDelta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {mover.scoreDelta > 0 ? '+' : ''}{mover.scoreDelta.toFixed(1)} pts
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground font-mono mt-1">
                        #{mover.previousRank} → #{mover.currentRank} • {mover.scoreDelta > 0 ? '+' : ''}{mover.scoreDelta.toFixed(1)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {hasData && moversReport && moversReport.previousRunId == null && (
        <p className="text-sm text-muted-foreground font-mono">
          Day-over-day movement will appear here once a second survey run completes.
        </p>
      )}

      {/* Main Content: Industry Leaders */}
      {hasData && catalog && overview && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Industry Leadership</h2>
            <p className="text-sm text-muted-foreground font-mono">Ranked by average AI sentiment score</p>
          </div>
          
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {catalog.industries.map((industry, iIdx) => {
              const leaders = overview.leaders.filter(l => l.industryId === industry.id);
              if (leaders.length === 0) return null;
              
              return (
                <Card 
                  key={industry.id} 
                  className="overflow-hidden hover:shadow-lg transition-shadow duration-300 border-border animate-in fade-in slide-in-from-bottom-4"
                  style={{ animationDelay: `${iIdx * 100}ms`, animationFillMode: 'both' }}
                >
                  <CardHeader className="bg-muted/30 border-b border-border pb-4 flex flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="text-xl flex items-center gap-2">
                        {industry.name}
                      </CardTitle>
                      <CardDescription className="font-mono text-xs mt-1 uppercase tracking-wider">{industry.country}</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" asChild className="font-mono text-xs">
                      <Link href={`/industry/${industry.id}`}>
                        Analyze <ArrowRight className="w-3 h-3 ml-2" />
                      </Link>
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y border-border">
                      {leaders.map((leader, idx) => (
                        <div 
                          key={leader.metric} 
                          className="flex items-center justify-between p-4 hover:bg-muted/20 transition-colors animate-in fade-in slide-in-from-bottom-2"
                          style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="bg-primary/10 text-primary p-2 rounded-lg">
                              <Trophy className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-medium text-sm text-muted-foreground">{leader.metricLabel}</p>
                              <p className="font-bold text-lg">{leader.brandName}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="inline-flex items-baseline px-3 py-1 rounded-full bg-accent/20 text-accent-foreground font-mono font-bold text-lg">
                              {leader.score.toFixed(1)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon: Icon, highlight = false }: { title: string, value: number, icon: any, highlight?: boolean }) {
  return (
    <Card className={`overflow-hidden border-border ${highlight ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-card-foreground'}`}>
      <CardContent className="p-6 flex items-center gap-4">
        <div className={`p-4 rounded-xl ${highlight ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary'}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className={`text-sm font-medium ${highlight ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{title}</p>
          <h3 className="text-3xl font-bold font-mono tracking-tight mt-1">
            {value.toLocaleString()}
          </h3>
        </div>
      </CardContent>
    </Card>
  );
}
