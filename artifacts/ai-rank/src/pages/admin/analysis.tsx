import React from 'react';
import {
  useListAnalysisReports,
  getListAnalysisReportsQueryKey,
  useGenerateAnalysis,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function AdminAnalysis() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListAnalysisReports({
    query: { queryKey: getListAnalysisReportsQueryKey() },
  });

  const generate = useGenerateAnalysis({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Analysis generated' });
        queryClient.invalidateQueries({ queryKey: getListAnalysisReportsQueryKey() });
      },
      onError: (e) =>
        toast({ variant: 'destructive', title: 'Generation failed', description: e.message }),
    },
  });

  const reports = data?.reports ?? [];

  return (
    <div className="p-6 md:p-10 max-w-[900px] space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-sans font-bold tracking-tight flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary" /> Analysis
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            Weekly Claude Fable analysis of engine overlap on the 13-week lookback. Auto-generated
            weekly; each report is a downloadable PDF.
          </p>
        </div>
        <Button
          className="gap-2"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
          data-testid="button-generate-analysis"
        >
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Generate now
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>
      ) : reports.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="p-8 text-center font-mono text-sm text-muted-foreground">
            No reports yet. One is generated automatically each week after the 13-week lookback runs,
            or click <span className="text-foreground">Generate now</span>.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id} className="border-border">
              <CardContent className="p-5 space-y-2">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{r.title}</span>
                      {r.model && (
                        <Badge variant="outline" className="font-mono text-[10px] uppercase">{r.model}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      {format(new Date(r.createdAt), 'MMM d, yyyy · HH:mm')}
                    </div>
                  </div>
                  <a
                    href={`${basePath}/api/admin/analysis/${r.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0"
                  >
                    <Button variant="outline" size="sm" className="gap-1.5 font-mono">
                      <Download className="w-3.5 h-3.5" /> PDF
                    </Button>
                  </a>
                </div>
                {r.summary && (
                  <p className="text-sm text-muted-foreground leading-relaxed">{r.summary}…</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
