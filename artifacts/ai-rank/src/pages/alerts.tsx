import React, { useState } from 'react';
import {
  useListAlerts,
  getListAlertsQueryKey,
  useMarkAlertsRead,
  useGetAlertSettings,
  getGetAlertSettingsQueryKey,
  useUpdateAlertSettings,
  useSendTestAlertEmail,
  BrandAlert,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { BellOff, TrendingDown, ArrowDownWideNarrow, CheckCheck, Settings2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

export default function Alerts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useListAlerts(undefined, {
    query: { queryKey: getListAlertsQueryKey() },
  });

  const markRead = useMarkAlertsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
      },
    },
  });

  const alerts = data?.alerts ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="p-6 md:p-10 max-w-[1200px] mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-4xl font-sans font-bold tracking-tight text-foreground">Alerts</h1>
          <p className="text-muted-foreground mt-2 font-mono text-sm">
            Sharp score drops and ranking falls detected after each survey run
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2 font-mono"
          disabled={unreadCount === 0 || markRead.isPending}
          onClick={() => markRead.mutate({ data: {} })}
          data-testid="button-mark-all-read"
        >
          <CheckCheck className="w-4 h-4" />
          Mark all read {unreadCount > 0 ? `(${unreadCount})` : ''}
        </Button>
      </div>

      <ThresholdSettings />

      <Card className="border-border">
        <CardHeader className="bg-muted/30 border-b border-border">
          <CardTitle>Alert Feed</CardTitle>
          <CardDescription>Newest first — generated automatically when a run completes</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
              <BellOff className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-medium text-lg">No alerts yet</p>
              <p className="text-sm mt-1">
                When a brand's score or rank deteriorates sharply between runs, it will show up here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {alerts.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onMarkRead={() => markRead.mutate({ data: { ids: [alert.id] } })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AlertRow({ alert, onMarkRead }: { alert: BrandAlert; onMarkRead: () => void }) {
  const isScore = alert.kind === 'score_drop';
  return (
    <div
      className={`flex items-start gap-4 p-4 ${alert.read ? 'opacity-60' : 'bg-destructive/5'}`}
      data-testid={`alert-row-${alert.id}`}
    >
      <div className="mt-1 p-2 rounded-md bg-destructive/10 text-destructive shrink-0">
        {isScore ? <TrendingDown className="w-4 h-4" /> : <ArrowDownWideNarrow className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{alert.brandName}</span>
          <Badge variant="outline" className="font-mono text-xs">{alert.industryName}</Badge>
          <Badge variant="secondary" className="font-mono text-xs">{alert.metricLabel}</Badge>
          {!alert.read && <Badge className="text-xs">New</Badge>}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {isScore ? (
            <>
              Score worsened by <span className="text-destructive font-semibold">{alert.delta.toFixed(1)} pts</span>{' '}
              ({alert.previousValue.toFixed(1)} → {alert.currentValue.toFixed(1)}) — threshold {alert.threshold}
            </>
          ) : (
            <>
              Fell <span className="text-destructive font-semibold">{alert.delta} position{alert.delta === 1 ? '' : 's'}</span>{' '}
              (rank #{alert.previousValue} → #{alert.currentValue}) — threshold {alert.threshold}
            </>
          )}
        </p>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          {format(new Date(alert.createdAt), 'MMM d, yyyy HH:mm')} · Run #{alert.runId}
        </p>
      </div>
      {!alert.read && (
        <Button variant="ghost" size="sm" onClick={onMarkRead} data-testid={`button-read-${alert.id}`}>
          Mark read
        </Button>
      )}
    </div>
  );
}

function ThresholdSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings } = useGetAlertSettings({
    query: { queryKey: getGetAlertSettingsQueryKey() },
  });
  const [scoreDrop, setScoreDrop] = useState<string | null>(null);
  const [rankDrop, setRankDrop] = useState<string | null>(null);
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  const [emailRecipient, setEmailRecipient] = useState<string | null>(null);

  const update = useUpdateAlertSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Thresholds updated', description: 'New thresholds apply to the next survey run.' });
        queryClient.invalidateQueries({ queryKey: getGetAlertSettingsQueryKey() });
        setScoreDrop(null);
        setRankDrop(null);
        setEmailEnabled(null);
        setEmailRecipient(null);
      },
      onError: (error) => {
        toast({ variant: 'destructive', title: 'Failed to update', description: error.message });
      },
    },
  });

  const sendTest = useSendTestAlertEmail({
    mutation: {
      onSuccess: (result: { message?: string }) => {
        toast({
          title: 'Test email sent',
          description: result.message ?? 'Check the recipient inbox to confirm delivery.',
        });
      },
      onError: (error: { message?: string }) => {
        toast({
          variant: 'destructive',
          title: 'Test email failed',
          description: error.message,
        });
      },
    },
  });

  const scoreValue = scoreDrop ?? (settings ? String(settings.scoreDropThreshold) : '');
  const rankValue = rankDrop ?? (settings ? String(settings.rankDropThreshold) : '');
  const emailOn = emailEnabled ?? settings?.emailEnabled ?? false;
  const recipientValue = emailRecipient ?? settings?.emailRecipient ?? '';
  const dirty =
    scoreDrop !== null || rankDrop !== null || emailEnabled !== null || emailRecipient !== null;

  const save = () => {
    const scoreDropThreshold = Number(scoreValue);
    const rankDropThreshold = Number(rankValue);
    if (!Number.isFinite(scoreDropThreshold) || scoreDropThreshold < 1 || scoreDropThreshold > 100) {
      toast({ variant: 'destructive', title: 'Invalid score threshold', description: 'Must be between 1 and 100 points.' });
      return;
    }
    if (!Number.isFinite(rankDropThreshold) || rankDropThreshold < 1 || rankDropThreshold > 50) {
      toast({ variant: 'destructive', title: 'Invalid rank threshold', description: 'Must be between 1 and 50 positions.' });
      return;
    }
    const recipient = recipientValue.trim();
    if (emailOn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      toast({
        variant: 'destructive',
        title: 'Invalid email address',
        description: 'Enter a valid recipient email to enable alert emails.',
      });
      return;
    }
    update.mutate({
      data: {
        scoreDropThreshold,
        rankDropThreshold,
        emailEnabled: emailOn,
        emailRecipient: recipient,
      },
    });
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings2 className="w-4 h-4" />
          Thresholds
        </CardTitle>
        <CardDescription>
          An alert fires when a brand deteriorates by at least this much between consecutive runs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="score-threshold">Score drop (points, 0–100 scale)</Label>
          <Input
            id="score-threshold"
            type="number"
            min={1}
            max={100}
            className="w-48 font-mono"
            value={scoreValue}
            onChange={(e) => setScoreDrop(e.target.value)}
            data-testid="input-score-threshold"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rank-threshold">Rank fall (positions)</Label>
          <Input
            id="rank-threshold"
            type="number"
            min={1}
            max={50}
            className="w-48 font-mono"
            value={rankValue}
            onChange={(e) => setRankDrop(e.target.value)}
            data-testid="input-rank-threshold"
          />
        </div>
        <div className="w-full border-t border-border pt-4 mt-2 flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="email-enabled">Email digest</Label>
            <div className="flex items-center gap-2 h-9">
              <Switch
                id="email-enabled"
                checked={emailOn}
                onCheckedChange={(checked) => setEmailEnabled(checked)}
                data-testid="switch-email-enabled"
              />
              <span className="text-sm text-muted-foreground font-mono">
                {emailOn ? 'On' : 'Off'}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email-recipient">Recipient email</Label>
            <Input
              id="email-recipient"
              type="email"
              placeholder="you@example.com"
              className="w-72 font-mono"
              value={recipientValue}
              onChange={(e) => setEmailRecipient(e.target.value)}
              disabled={!emailOn}
              data-testid="input-email-recipient"
            />
          </div>
          <Button
            variant="outline"
            className="gap-2"
            disabled={!emailOn || dirty || sendTest.isPending || !(settings?.emailRecipient ?? '').trim()}
            onClick={() => sendTest.mutate()}
            data-testid="button-send-test-email"
          >
            <Send className="w-4 h-4" />
            {sendTest.isPending ? 'Sending…' : 'Send test email'}
          </Button>
          <p className="text-xs text-muted-foreground basis-full">
            When on, an email summarizing new alerts is sent after each survey run that detects any.
          </p>
        </div>
        <Button onClick={save} disabled={!dirty || update.isPending} data-testid="button-save-thresholds">
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
