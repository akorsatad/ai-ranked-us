import React, { useEffect, useState } from 'react';
import {
  useGetAdminPricing,
  getGetAdminPricingQueryKey,
  useUpdatePricingTier,
  PricingTier,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { DollarSign, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

export default function AdminPricing() {
  const { data, isLoading } = useGetAdminPricing({
    query: { queryKey: getGetAdminPricingQueryKey() },
  });

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

      {isLoading || !data ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-52 w-full" />)}
        </div>
      ) : (
        data.tiers.map((tier) => <TierEditor key={tier.key} tier={tier} />)
      )}
    </div>
  );
}

function TierEditor({ tier }: { tier: PricingTier }) {
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
