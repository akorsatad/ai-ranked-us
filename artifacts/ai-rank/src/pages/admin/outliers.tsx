import React, { useEffect, useState } from 'react';
import {
  useListOutliers,
  getListOutliersQueryKey,
  useGetOutlierSettings,
  getGetOutlierSettingsQueryKey,
  useUpdateOutlierSettings,
  useDetectOutliersNow,
  useAcknowledgeOutlier,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Siren, Loader2, RefreshCw, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function AdminOutliers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListOutliers({ query: { queryKey: getListOutliersQueryKey() } });
  const { data: settings } = useGetOutlierSettings({ query: { queryKey: getGetOutlierSettingsQueryKey() } });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListOutliersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetOutlierSettingsQueryKey() });
  };

  const detect = useDetectOutliersNow({
    mutation: {
      onSuccess: (r) => { toast({ title: 'Detection complete', description: r.message }); invalidate(); },
      onError: (e) => toast({ variant: 'destructive', title: 'Detection failed', description: e.message }),
    },
  });
  const ack = useAcknowledgeOutlier({
    mutation: { onSuccess: invalidate },
  });

  const outliers = data?.outliers ?? [];

  return (
    <div className="p-6 md:p-10 max-w-[1000px] space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-sans font-bold tracking-tight flex items-center gap-2">
            <Siren className="w-7 h-7 text-primary" /> Outliers
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            Statistical outliers (±Nσ) in each engine's brand-score trends, with the engine's own
            explanation of what supports the shift. Detected after every run.
          </p>
        </div>
        <Button className="gap-2" disabled={detect.isPending} onClick={() => detect.mutate()} data-testid="button-detect-outliers">
          {detect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Detect now
        </Button>
      </div>

      {settings && <SettingsPanel settings={settings} onSaved={invalidate} />}

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : outliers.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="p-8 text-center font-mono text-sm text-muted-foreground">
            No outliers detected yet. They appear once a brand's score moves beyond the σ threshold.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {outliers.map((o) => (
            <Card key={o.id} className={`border-l-4 ${o.direction === 'up' ? 'border-l-emerald-500' : 'border-l-destructive'} ${o.acknowledged ? 'opacity-60' : ''}`}>
              <CardContent className="p-5 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{o.brandName}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">{o.industryName}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">{o.metricLabel}</Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">{o.engineName}</Badge>
                    <span className={`font-mono text-xs font-bold ${o.direction === 'up' ? 'text-emerald-600' : 'text-destructive'}`}>
                      {o.direction === 'up' ? '▲' : '▼'} {Math.abs(o.sigma).toFixed(1)}σ
                    </span>
                  </div>
                  {!o.acknowledged && (
                    <Button variant="ghost" size="sm" className="gap-1 font-mono text-xs" onClick={() => ack.mutate({ id: o.id })}>
                      <Check className="w-3.5 h-3.5" /> Ack
                    </Button>
                  )}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  score {o.value} vs mean {o.mean} (σ {o.stddev}, n={o.sampleSize}) · {format(new Date(o.measuredAt), 'MMM d, yyyy')}
                </div>
                {o.explanation ? (
                  <p className="text-sm text-foreground leading-relaxed border-t border-border pt-2">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">{o.explanationModel} explains: </span>
                    {o.explanation}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Explanation pending.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ settings, onSaved }: { settings: { enabled: boolean; sigma: number; minPoints: number; maxExplanationsPerRun: number }; onSaved: () => void }) {
  const { toast } = useToast();
  const [sigma, setSigma] = useState(String(settings.sigma));
  const [minPoints, setMinPoints] = useState(String(settings.minPoints));
  const [maxExpl, setMaxExpl] = useState(String(settings.maxExplanationsPerRun));
  const [enabled, setEnabled] = useState(settings.enabled);
  useEffect(() => {
    setSigma(String(settings.sigma)); setMinPoints(String(settings.minPoints));
    setMaxExpl(String(settings.maxExplanationsPerRun)); setEnabled(settings.enabled);
  }, [settings]);

  const update = useUpdateOutlierSettings({
    mutation: {
      onSuccess: () => { toast({ title: 'Outlier settings saved' }); onSaved(); },
      onError: (e) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
    },
  });

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-5 flex flex-wrap items-end gap-4">
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">σ threshold</span>
          <Input value={sigma} onChange={(e) => setSigma(e.target.value)} inputMode="decimal" className="w-24 font-mono h-9" data-testid="input-sigma" />
        </label>
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">Min points</span>
          <Input value={minPoints} onChange={(e) => setMinPoints(e.target.value)} inputMode="numeric" className="w-24 font-mono h-9" />
        </label>
        <label className="space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground block">Max explains/run</span>
          <Input value={maxExpl} onChange={(e) => setMaxExpl(e.target.value)} inputMode="numeric" className="w-28 font-mono h-9" />
        </label>
        <label className="flex items-center gap-2 h-9">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span className="font-mono text-xs text-muted-foreground">Enabled</span>
        </label>
        <Button
          className="gap-2 font-mono ml-auto"
          disabled={update.isPending}
          onClick={() => update.mutate({ data: { enabled, sigma: Number(sigma), minPoints: Number(minPoints), maxExplanationsPerRun: Number(maxExpl) } })}
        >
          Save settings
        </Button>
      </CardContent>
    </Card>
  );
}
