import React from 'react';
import { Link } from 'wouter';
import {
  useGetRankHistory,
  useGetMe,
  getGetMeQueryKey,
  getGetRankHistoryQueryKey,
} from '@workspace/api-client-react';
import {
  BarChart3,
  ArrowRight,
  Clock,
  CheckCircle,
  Loader2,
  XCircle,
  LogIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';

function statusIcon(status: string) {
  if (status === 'completed') return <CheckCircle className="w-4 h-4 text-green-500" />;
  if (status === 'failed') return <XCircle className="w-4 h-4 text-destructive" />;
  return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
}

function statusColor(status: string): string {
  if (status === 'completed') return 'bg-green-500/10 text-green-500 border-green-500/30';
  if (status === 'failed') return 'bg-destructive/10 text-destructive border-destructive/30';
  return 'bg-primary/10 text-primary border-primary/30';
}

export default function History() {
  const { data: user, isLoading: isLoadingUser } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  const { data: history, isLoading: isLoadingHistory } = useGetRankHistory({
    query: {
      queryKey: getGetRankHistoryQueryKey(),
      enabled: !!user,
      retry: false,
    },
  });

  if (isLoadingUser) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <div className="bg-primary/10 rounded-full p-4 w-16 h-16 flex items-center justify-center mx-auto mb-4">
          <LogIn className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">Sign in to see your history</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Your past custom rankings are saved to your account.
        </p>
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">My Rankings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Your custom brand ranking history, newest first.
        </p>
      </div>

      {isLoadingHistory && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => <Skeleton key={n} className="h-20 w-full" />)}
        </div>
      )}

      {history && history.length === 0 && (
        <div className="text-center py-16">
          <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No rankings yet.</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/">Rank your first brand</Link>
          </Button>
        </div>
      )}

      {history && history.length > 0 && (
        <div className="space-y-3">
          {history.map((item) => (
            <Card key={item.id} className="border-border hover:border-primary/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {statusIcon(item.status)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{item.brand}</span>
                        <Badge variant="outline" className="text-xs">{item.country}</Badge>
                        <Badge className={`text-xs border ${statusColor(item.status)}`}>
                          {item.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        vs. {item.competitors.join(', ')}
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>

                  {item.status === 'completed' && (
                    <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1">
                      <Link href={`/results/${item.id}`}>
                        View <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
