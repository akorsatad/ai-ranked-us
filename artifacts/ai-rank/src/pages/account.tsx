import React from 'react';
import { Link } from 'wouter';
import {
  useGetMe,
  getGetMeQueryKey,
  useGetPricing,
  getGetPricingQueryKey,
  useCreateBillingPortal,
} from '@workspace/api-client-react';
import { DI, Eyebrow, BrandButton } from '../components/brand';
import { useToast } from '@/hooks/use-toast';

const MAX_W = '52rem';

export default function Account() {
  const { toast } = useToast();
  const { data: me, isLoading, isError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });
  const { data: pricing } = useGetPricing({ query: { queryKey: getGetPricingQueryKey() } });

  const portal = useCreateBillingPortal({
    mutation: {
      onSuccess: (r) => { window.location.href = r.url; },
      onError: (e) => toast({ variant: 'destructive', title: 'Billing portal', description: e.message }),
    },
  });

  const checkoutSuccess = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('checkout') === 'success';

  if (isLoading) return <Shell><p style={muted}>Loading your account…</p></Shell>;

  if (isError || !me) {
    return (
      <Shell>
        <p style={{ fontSize: 15, color: DI.body, margin: '0 0 20px' }}>
          You're not signed in. Sign in to view your plan, token balance, and manage billing.
        </p>
        <Link href="/sign-in"><BrandButton>Sign in</BrandButton></Link>
      </Shell>
    );
  }

  const tier = pricing?.tiers.find((t) => t.key === me.tier) ?? null;
  const planName = me.tier === 'free' || !tier ? 'Free' : tier.name;
  const status = me.subscriptionStatus;
  const active = status === 'active' || status === 'trialing';

  return (
    <Shell>
      {checkoutSuccess && (
        <div style={{ border: `1px solid ${DI.teal}`, background: 'rgba(14,168,142,0.06)', padding: '12px 16px', marginBottom: 24 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DI.teal, fontWeight: 700 }}>✓ Subscription started.</span>
          <span style={{ fontSize: 13, color: DI.body, marginLeft: 8 }}>Your plan and token balance update within a moment.</span>
        </div>
      )}

      <div style={{ fontSize: 13, color: DI.body, marginBottom: 28 }}>
        Signed in as <span style={{ fontWeight: 600, color: DI.ink }}>{me.email}</span>
      </div>

      {/* Plan card */}
      <div style={{ border: `1px solid ${DI.line}`, background: '#fff', padding: 24 }}>
        <div className="flex items-start justify-between" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Eyebrow color="faint" size={10}>Current plan</Eyebrow>
            <div className="flex items-baseline" style={{ gap: 10, marginTop: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30, color: DI.ink }}>{planName}</span>
              {status && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '3px 8px', border: `1px solid ${active ? DI.teal : DI.warn}`, color: active ? DI.teal : DI.warn }}>
                  {status}
                </span>
              )}
            </div>
            {tier?.monthlyPriceUsd != null && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DI.steel, marginTop: 6 }}>
                ${tier.monthlyPriceUsd.toFixed(0)} / month
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <Eyebrow color="faint" size={10}>Token balance</Eyebrow>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30, color: DI.ink, marginTop: 8 }}>
              {me.tokenBalance.toLocaleString()}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.faint }}>tokens remaining</div>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${DI.line}`, marginTop: 20, paddingTop: 18 }} className="flex flex-wrap" >
          <div className="flex flex-wrap" style={{ gap: 10 }}>
            {me.hasStripeCustomer ? (
              <BrandButton onClick={() => portal.mutate()}>
                {portal.isPending ? 'Opening…' : 'Manage billing'}
              </BrandButton>
            ) : (
              <a href="/#pricing"><BrandButton>Choose a plan</BrandButton></a>
            )}
            <Link href="/history"><BrandButton variant="ghost">Your rankings</BrandButton></Link>
          </div>
        </div>
      </div>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: DI.faint, marginTop: 20 }}>
        Billing is handled securely by Stripe · Cancel anytime from the billing portal
      </p>
    </Shell>
  );
}

const muted: React.CSSProperties = { fontSize: 15, color: DI.faint };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: DI.paper, minHeight: '70vh' }}>
      <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '48px 24px 80px' }}>
        <Eyebrow color="faint" size={11}>Account</Eyebrow>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em', color: DI.ink, margin: '8px 0 28px' }}>
          Your account
        </h1>
        {children}
      </div>
    </div>
  );
}
