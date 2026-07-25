import React, { useEffect, useState } from 'react';
import {
  useGetAdminPricing,
  getGetAdminPricingQueryKey,
  useUpdatePricingTier,
  useGetCostSummary,
  PricingTier,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { DollarSign, Save, Loader2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

// Target gross margin used for the "suggested rate" helper.
const TARGET_MARGIN = 0.5;

/** Blended API cost per token from measured usage (all priced responses). */
function useBlendedCostPerToken(): { costPerToken: number | null; tokens: number; costUsd: number } {
  const { data } = useGetCostSummary({ days: 30 });
  const t = data?.totals;
  const tokens = (t?.inputTokens ?? 0) + (t?.outputTokens ?? 0);
  const costUsd = t?.costUsd ?? 0;
  return { costPerToken: tokens > 0 ? costUsd / tokens : null, tokens, costUsd };
}

export default function AdminPricing() {
  const { data, isLoading } = useGetAdminPricing({
    query: { queryKey: getGetAdminPricingQueryKey() },
  });
  const cost = useBlendedCostPerToken();

  return (
    <div className="p-6 md:p-10 max-w-[900px] space-y-6">
      <div>
        <h1 className="text-3xl font-sans font-bold tracking-tight flex items-center gap-2">
          <DollarSign className="w-7 h-7 text-primary" />
          Pricing
        </h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          Billing is token-based. Set the per-token rate, monthly fee, and included tokens for each tier — these drive the public pricing page and how refills are charged.
        </p>
      </div>

      <MarginPanel cost={cost} />

      {isLoading || !data ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-52 w-full" />)}
        </div>
      ) : (
        data.tiers.map((tier) => (
          <TierEditor key={tier.key} tier={tier} costPerToken={cost.costPerToken} />
        ))
      )}
    </div>
  );
}

function MarginPanel({ cost }: { cost: { costPerToken: number | null; tokens: number; costUsd: number } }) {
  const per1m = cost.costPerToken != null ? cost.costPerToken * 1_000_000 : null;
  const suggested1m = per1m != null ? per1m / (1 - TARGET_MARGIN) : null;
  // Rough per-run sizing from measured average (~1,325 tokens/response, ~28
  // responses in a custom brand run across enabled engines/models).
  const tokensPerRun = 28 * 1325;
  const costPerRun = cost.costPerToken != null ? cost.costPerToken * tokensPerRun : null;
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <TrendingUp className="w-5 h-5 text-primary" /> Cost &amp; margin
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          Measured blended API cost from the last 30 days. Enabling pricier flagship
          models raises this — the target-margin suggestion tracks it live.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono">
        <Stat label="Blended cost" value={per1m != null ? `$${per1m.toFixed(2)}` : '—'} sub="/ 1M tokens" />
        <Stat label={`Rate for ${Math.round(TARGET_MARGIN * 100)}% margin`} value={suggested1m != null ? `$${suggested1m.toFixed(2)}` : '—'} sub="/ 1M tokens" />
        <Stat label="Est. cost / run" value={costPerRun != null ? `$${costPerRun.toFixed(3)}` : '—'} sub={`~${tokensPerRun.toLocaleString()} tok`} />
        <Stat label="Charge / run @ 50%" value={costPerRun != null ? `$${(costPerRun / (1 - TARGET_MARGIN)).toFixed(3)}` : '—'} sub="to hit target" />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tracking-tight text-foreground mt-1">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function TierEditor({ tier, costPerToken }: { tier: PricingTier; costPerToken: number | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [rate, setRate] = useState(String(tier.costPerTokenUsd));
  const [monthly, setMonthly] = useState(tier.monthlyPriceUsd != null ? String(tier.monthlyPriceUsd) : '');
  const [included, setIncluded] = useState(String(tier.includedTokens));

  useEffect(() => {
    setRate(String(tier.costPerTokenUsd));
    setMonthly(tier.monthlyPriceUsd != null ? String(tier.monthlyPriceUsd) : '');
    setIncluded(String(tier.includedTokens));
  }, [tier]);

  const update = useUpdatePricingTier({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAdminPricingQueryKey() });
        toast({ title: `${tier.name} pricing updated` });
      },
      onError: (e) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
    },
  });

  const rateNum = Number(rate);
  const monthlyNum = monthly.trim() === '' ? null : Number(monthly);
  const includedNum = Number(included);
  const invalid =
    !Number.isFinite(rateNum) || rateNum < 0 || rateNum > 1 ||
    (monthlyNum != null && (!Number.isFinite(monthlyNum) || monthlyNum < 0)) ||
    !Number.isInteger(includedNum) || includedNum < 0;

  const dirty =
    rateNum !== tier.costPerTokenUsd ||
    monthlyNum !== (tier.monthlyPriceUsd ?? null) ||
    includedNum !== tier.includedTokens;

  const per1k = Number.isFinite(rateNum) ? (rateNum * 1000).toFixed(4) : '—';

  // Margin at the current (edited) rate vs measured blended API cost.
  const marginPct =
    costPerToken != null && rateNum > 0
      ? Math.round(((rateNum - costPerToken) / rateNum) * 100)
      : null;
  const suggestedRate =
    costPerToken != null ? costPerToken / (1 - TARGET_MARGIN) : null;
  const marginColor =
    marginPct == null
      ? 'text-muted-foreground'
      : marginPct < 40
        ? 'text-destructive'
        : marginPct < 55
          ? 'text-emerald-600'
          : 'text-amber-600';

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            {tier.name}
            {tier.highlighted && <Badge variant="outline" className="font-mono text-[10px] uppercase">Featured</Badge>}
          </CardTitle>
          <span className="font-mono text-xs text-muted-foreground">{tier.key}</span>
        </div>
        <CardDescription className="font-mono text-xs">{tier.blurb}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1.5 block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Cost per token (USD)</span>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="font-mono" data-testid={`input-rate-${tier.key}`} />
            <span className="text-[11px] text-muted-foreground font-mono">≈ ${per1k} / 1K tokens</span>
            <div className="flex items-center gap-2 pt-0.5">
              <span className={`text-[11px] font-mono ${marginColor}`}>
                {marginPct != null ? `${marginPct}% margin` : 'margin n/a'}
              </span>
              {suggestedRate != null && (
                <button
                  type="button"
                  className="text-[11px] font-mono text-primary underline underline-offset-2"
                  onClick={() => setRate(suggestedRate.toPrecision(3))}
                  data-testid={`button-set-margin-${tier.key}`}
                >
                  set 50%
                </button>
              )}
            </div>
          </label>
          <label className="space-y-1.5 block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Monthly fee (USD)</span>
            <Input value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" placeholder="blank = custom" className="font-mono" data-testid={`input-monthly-${tier.key}`} />
            <span className="text-[11px] text-muted-foreground font-mono">blank → “Custom / contact sales”</span>
          </label>
          <label className="space-y-1.5 block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Included tokens / mo</span>
            <Input value={included} onChange={(e) => setIncluded(e.target.value)} inputMode="numeric" className="font-mono" data-testid={`input-included-${tier.key}`} />
            <span className="text-[11px] text-muted-foreground font-mono">before refills are needed</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button
            disabled={!dirty || invalid || update.isPending}
            onClick={() => update.mutate({ key: tier.key, data: { costPerTokenUsd: rateNum, monthlyPriceUsd: monthlyNum, includedTokens: includedNum } })}
            className="gap-2 font-mono"
            data-testid={`button-save-${tier.key}`}
          >
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save {tier.name}
          </Button>
          {invalid && <span className="text-xs text-destructive font-mono">Check the values</span>}
          {!invalid && dirty && <span className="text-xs text-muted-foreground font-mono">Unsaved changes</span>}
        </div>
      </CardContent>
    </Card>
  );
}
