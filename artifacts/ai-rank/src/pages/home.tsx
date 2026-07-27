import React, { useState, useCallback } from 'react';
import { useLocation, Link } from 'wouter';
import {
  useSuggestCompetitors,
  useRunAdHocRank,
  useGetMovers,
  getGetMoversQueryKey,
  useGetOverview,
  getGetOverviewQueryKey,
  useGetPricing,
  getGetPricingQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useGetStripeConfig,
  getGetStripeConfigQueryKey,
  useCreateCheckout,
  PricingTier,
} from '@workspace/api-client-react';
import { Plus, X, Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { AuthModal } from '@/components/auth-modal';
import {
  DI,
  Eyebrow,
  SectionHeading,
  BrandButton,
  FieldLabel,
  CornerCard,
} from '@/components/brand';
import { Ticker, SideRail, LiveIndexBoard } from '@/components/home-board';

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'UK', label: 'United Kingdom' },
  { code: 'AU', label: 'Australia' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'JP', label: 'Japan' },
  { code: 'IN', label: 'India' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 42,
  padding: '0 12px',
  background: '#fff',
  border: `1px solid ${DI.line}`,
  borderRadius: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  color: DI.ink,
  outline: 'none',
};

const MAX_W = '72rem';
/** Query stashed while the visitor sets up their account; run after verify. */
export const PENDING_RANK_KEY = 'airank_pending_rank';

export default function Home() {
  const [, setLocation] = useLocation();

  const [brand, setBrand] = useState('');
  const [country, setCountry] = useState('US');
  const [competitors, setCompetitors] = useState<string[]>(['', '']);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMsg, setAuthModalMsg] = useState('Sign in to continue');
  const [formError, setFormError] = useState<string | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);

  const { data: moversData } = useGetMovers({
    query: { queryKey: getGetMoversQueryKey() },
  });
  const { data: overview } = useGetOverview({
    query: { queryKey: getGetOverviewQueryKey() },
  });
  const { data: pricing } = useGetPricing({
    query: { queryKey: getGetPricingQueryKey() },
  });
  const { data: me } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false, retryOnMount: false },
  });

  const { mutate: suggest, isPending: isSuggesting } = useSuggestCompetitors({
    mutation: {
      onSuccess: (data: { competitors: string[] }) => {
        const filled = data.competitors.map((c) => c);
        setCompetitors(filled.length ? filled : ['', '']);
        setFormError(null);
      },
      onError: (err: unknown) => {
        setFormError((err as { data?: { message?: string } }).data?.message ?? 'Could not suggest competitors.');
      },
    },
  });

  const { mutate: runRank, isPending: isRunning } = useRunAdHocRank({
    mutation: {
      onSuccess: (data: { id: number }) => setLocation(`/results/${data.id}`),
      onError: (err: unknown) => {
        const apiErr = err as { status: number; data?: { message?: string; requiresAuth?: boolean; retryAt?: string } };
        const body = apiErr.data;
        if (apiErr.status === 401 && body?.requiresAuth) {
          try {
            localStorage.setItem(PENDING_RANK_KEY, JSON.stringify({ brand: brand.trim(), competitors: validCompetitors, country }));
          } catch { /* ignore */ }
          setAuthModalMsg('Create your account to run this ranking');
          setShowAuthModal(true);
          return;
        }
        if (apiErr.status === 429) {
          const retryTime = body?.retryAt
            ? new Date(body.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : 'tomorrow';
          setRateLimitMsg(`You've used today's free ranking. Come back at ${retryTime}.`);
          return;
        }
        setFormError(body?.message ?? 'Something went wrong. Please try again.');
      },
    },
  });

  const validCompetitors = competitors.filter((c) => c.trim().length > 0);

  const handleSuggest = useCallback(() => {
    if (!brand.trim()) {
      setFormError('Enter your brand name first.');
      return;
    }
    setFormError(null);
    suggest({ data: { brand: brand.trim(), country } });
  }, [brand, country, suggest]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setRateLimitMsg(null);
    if (!brand.trim()) return setFormError('Brand name is required.');
    if (validCompetitors.length === 0) return setFormError('Add at least one competitor.');

    const payload = { brand: brand.trim(), competitors: validCompetitors, country };
    if (!me) {
      // No account yet: stash the query, then collect email + confirm. The
      // ranking kicks off automatically once the magic link is verified.
      try {
        localStorage.setItem(PENDING_RANK_KEY, JSON.stringify(payload));
      } catch {
        /* storage unavailable — the user can resubmit after signing in */
      }
      setAuthModalMsg('Create your account to run this ranking');
      setShowAuthModal(true);
      return;
    }
    runRank({ data: payload });
  }

  const scrollToRank = () =>
    document.getElementById('rank-form')?.scrollIntoView({ behavior: 'smooth' });

  // Stripe billing: config + checkout.
  const { data: stripeConfig } = useGetStripeConfig({
    query: { queryKey: getGetStripeConfigQueryKey() },
  });
  const stripeReady = !!stripeConfig?.configured;
  const checkout = useCreateCheckout({
    mutation: {
      onSuccess: (r) => { window.location.href = r.url; },
      onError: (e) => {
        // Not signed in → prompt account creation; else surface the message.
        setAuthModalMsg(
          e?.message?.toLowerCase().includes('sign in')
            ? 'Create your account to subscribe'
            : (e?.message || 'Could not start checkout'),
        );
        setShowAuthModal(true);
      },
    },
  });
  const onSubscribe = (tierKey: string) => {
    if (!stripeReady) { scrollToRank(); return; }
    checkout.mutate({ data: { tier: tierKey } });
  };

  // Real data: top movers (up to 4) and one leader card per industry.
  const movers = (moversData?.movers ?? []).slice(0, 4);
  const leadersByIndustry = new Map<number, { name: string; leader: string; score: number }>();
  for (const l of overview?.leaders ?? []) {
    if (!leadersByIndustry.has(l.industryId)) {
      leadersByIndustry.set(l.industryId, { name: l.industryName, leader: l.brandName, score: l.score });
    }
  }
  const industryCards = [...leadersByIndustry.entries()].slice(0, 8).map(([id, v]) => ({ id, ...v }));

  return (
    <div style={{ background: DI.paper }}>
      <Ticker movers={moversData} />
      <SideRail />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <header className="mx-auto" style={{ maxWidth: MAX_W, padding: '48px 24px 40px' }}>
        <div className="di-hero-grid grid items-end" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 56 }}>
          <div>
            <Eyebrow>The AI consensus index</Eyebrow>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(2.75rem,6vw,4.5rem)', lineHeight: 1.02, letterSpacing: '-0.025em', color: DI.ink, margin: '20px 0 0', textWrap: 'pretty' }}>
              Every week, AI picks winners. <span style={{ color: DI.teal }}>We keep score.</span>
            </h1>
            <p style={{ fontSize: 17, lineHeight: 1.625, color: DI.body, maxWidth: '40rem', margin: '24px 0 0' }}>
              AI Ranked US asks ChatGPT, Claude, Gemini, and Grok the questions consumers ask — then publishes who they recommend, how it changes over time, and why.
            </p>
            <div className="flex flex-wrap items-center" style={{ gap: 16, marginTop: 32 }}>
              <BrandButton onClick={scrollToRank}>Rank my brand — free</BrandButton>
              <Link href="/explore"><BrandButton variant="ghost">Explore the rankings</BrandButton></Link>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint, marginTop: 28 }}>
              4 AI engines &middot; 12 industries &middot; 92 brands &middot; free to cite
            </div>
          </div>

          <CornerCard style={{ padding: 24 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint, marginBottom: 6 }}>
              Biggest movers
            </div>
            {movers.length === 0 ? (
              <div style={{ padding: '18px 0', fontSize: 13, color: DI.faint }}>
                Movers appear once two survey runs have completed.
              </div>
            ) : (
              movers.map((mv, i) => {
                const up = mv.rankDelta > 0 || (mv.rankDelta === 0 && mv.scoreDelta > 0);
                const dTxt = mv.rankDelta !== 0 ? `${up ? '▲' : '▼'} ${Math.abs(mv.rankDelta)}` : `${mv.scoreDelta > 0 ? '+' : ''}${mv.scoreDelta}`;
                return (
                  <div key={i} className="flex items-baseline justify-between" style={{ gap: 12, padding: '10px 0', borderBottom: `1px solid ${DI.line}` }}>
                    <span className="flex flex-col" style={{ gap: 2 }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: DI.ink }}>{mv.brandName}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>{mv.industryName}</span>
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: up ? DI.teal : DI.danger }}>{dTxt}</span>
                  </div>
                );
              })
            )}
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint, marginTop: 12 }}>
              Largest moves &middot; all industries
            </div>
          </CornerCard>
        </div>
      </header>

      {/* ── Live index board ─────────────────────────────────── */}
      <div id="board" className="mx-auto" style={{ maxWidth: MAX_W, padding: '0 24px 64px' }}>
        <LiveIndexBoard onOpenIndustry={(id) => setLocation(`/industry/${id}`)} />
      </div>

      {/* ── Industry leaders ─────────────────────────────────── */}
      <section id="industries" style={{ background: DI.surface, borderTop: `1px solid ${DI.line}`, borderBottom: `1px solid ${DI.line}`, padding: '96px 0' }}>
        <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '0 24px' }}>
          <SectionHeading number="01" title="12 industries. One leader each." />
          {industryCards.length === 0 ? (
            <p style={{ marginTop: 40, fontSize: 15, color: DI.body }}>
              Industry leaders appear here after the first survey run completes.
            </p>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: 16, marginTop: 40 }}>
              {industryCards.map((c) => (
                <IndustryCard key={c.id} id={c.id} name={c.name} leader={c.leader} score={c.score} onOpen={() => setLocation(`/industry/${c.id}`)} />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between" style={{ gap: 16, marginTop: 32 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>
              Every card opens the full industry analysis
            </div>
            <Link href="/explore">
              <BrandButton variant="ghost">Explore all rankings →</BrandButton>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Rank your brand ──────────────────────────────────── */}
      <section id="rank-form" style={{ padding: '96px 0' }}>
        <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '0 24px' }}>
          <SectionHeading number="02" title="Rank your brand. Free to start." />
          <div className="di-two-col grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', gap: 48, marginTop: 40, alignItems: 'start' }}>
            <div>
              <p style={{ fontSize: 15, lineHeight: 1.625, color: DI.body, maxWidth: '34rem', margin: 0 }}>
                Commercial brand-research against the four major AI engines. Enter your brand and up to three competitors, create your account, and confirm your email — your ranking kicks off automatically and lands on a private results page, scored across seven perception metrics. Your first ranking is free.
              </p>
              <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  'Submit your brand and up to three competitors',
                  'Create your account & confirm your email',
                  'Your ranking runs — results on your own private page',
                ].map((t, i) => (
                  <div key={i} className="flex items-baseline" style={{ gap: 12 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.teal }}>0{i + 1}</span>
                    <span style={{ fontSize: 14, color: DI.body }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', padding: 28 }}>
              <form onSubmit={handleSubmit}>
                <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 16 }}>
                  <div>
                    <FieldLabel htmlFor="brand-name">Your brand / product</FieldLabel>
                    <input id="brand-name" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Notion, Tesla, Airbnb" style={inputStyle} />
                  </div>
                  <div>
                    <FieldLabel htmlFor="country">Market</FieldLabel>
                    <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle}>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: 18 }}>
                  <div className="flex items-center justify-between">
                    <FieldLabel>Competitors</FieldLabel>
                    <button type="button" onClick={handleSuggest} disabled={isSuggesting || !brand.trim()}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: DI.teal, background: 'none', border: 'none', cursor: brand.trim() ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      {isSuggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {isSuggesting ? 'Thinking…' : 'AI suggest'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {competitors.map((c, idx) => (
                      <div key={idx} className="flex" style={{ gap: 8 }}>
                        <input value={c} onChange={(e) => setCompetitors((p) => p.map((x, i) => (i === idx ? e.target.value : x)))} placeholder={`Competitor ${idx + 1}`} style={inputStyle} />
                        {competitors.length > 1 && (
                          <button type="button" onClick={() => setCompetitors((p) => p.filter((_, i) => i !== idx))}
                            style={{ width: 42, height: 42, flexShrink: 0, background: '#fff', border: `1px solid ${DI.line}`, color: DI.steel, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {competitors.length < 8 && (
                    <button type="button" onClick={() => setCompetitors((p) => [...p, ''])}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.teal, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                      <Plus className="w-3 h-3" /> Add competitor
                    </button>
                  )}
                </div>

                {formError && (
                  <p style={{ fontSize: 13, color: DI.danger, background: 'rgba(229,72,77,0.10)', padding: '8px 12px', marginTop: 16 }}>{formError}</p>
                )}
                {rateLimitMsg && (
                  <div style={{ background: 'rgba(217,119,6,0.10)', border: '1px solid rgba(217,119,6,0.3)', padding: '10px 12px', marginTop: 16 }}>
                    <p style={{ fontWeight: 600, color: DI.warn, margin: '0 0 2px', fontSize: 13 }}>Daily limit reached</p>
                    <p style={{ color: DI.body, margin: 0, fontSize: 13 }}>{rateLimitMsg}</p>
                  </div>
                )}

                <div style={{ marginTop: 24 }}>
                  <BrandButton type="submit" fullWidth disabled={isRunning || !brand.trim() || validCompetitors.length === 0}>
                    {isRunning ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting survey…</> : 'Rank this brand — free'}
                  </BrandButton>
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint, marginTop: 14 }}>
                  Free first ranking &middot; Verify your email &middot; No spam, ever
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* ── Methodology ──────────────────────────────────────── */}
      <section id="methodology" style={{ background: DI.surface, borderTop: `1px solid ${DI.line}`, borderBottom: `1px solid ${DI.line}`, padding: '96px 0' }}>
        <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '0 24px' }}>
          <SectionHeading number="03" title="Scoring you can check, end to end." />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', border: `1px solid ${DI.line}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', marginTop: 40, background: '#fff' }}>
            {[
              { tag: 'Step 1 · Ask', title: 'The questions consumers ask', meta: '92 brands · 4 engines · daily', desc: 'Every day we put the same plain-language questions to ChatGPT, Claude, Gemini, and Grok. Fresh sessions, no history, no steering.' },
              { tag: 'Step 2 · Score', title: 'Every answer becomes a number', meta: '7 metrics · Rank · Sentiment', desc: 'We record who gets named, in what order, and how each brand is described across seven perception metrics — then roll it into a 0–100 AI Consensus Score.', active: true },
              { tag: 'Step 3 · Publish', title: 'The full log is public', meta: 'Every prompt · Every response', desc: 'Raw model responses are archived, so journalists and researchers can check every number we publish against the source.' },
              { tag: 'Step 4 · Explain', title: 'Outliers, explained by the model', meta: '±3σ detection · self-explained', desc: 'When a brand’s score breaks its normal range (±3σ), the very engine that moved it is asked — at its most capable model — to explain what specific developments support the shift. The same outlier analysis runs on your own brand in a custom query.' },
            ].map((s, i, arr) => (
              <div key={i} style={{ position: 'relative', padding: 40, background: s.active ? DI.paper : '#fff', borderRight: i < arr.length - 1 ? `1px solid ${DI.line}` : undefined }}>
                {s.active && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(to right, ${DI.teal}, ${DI.tealLight})` }} />}
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: DI.teal, textTransform: 'uppercase', marginBottom: 16 }}>{s.tag}</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: DI.ink, margin: '0 0 6px' }}>{s.title}</h3>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.steel, marginBottom: 14 }}>{s.meta}</div>
                <p style={{ fontSize: 14, lineHeight: 1.625, color: DI.body, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: '96px 0' }}>
        <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '0 24px' }}>
          <SectionHeading number="04" title="Pricing that scales with your research." />
          <p style={{ fontSize: 15, lineHeight: 1.625, color: DI.body, maxWidth: '40rem', margin: '20px 0 0' }}>
            Every plan is token-based — you&rsquo;re billed per token used, and you can top up anytime at your tier&rsquo;s rate. Start free, upgrade when you need the volume.
          </p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16, marginTop: 40, alignItems: 'stretch' }}>
            {(pricing?.tiers ?? []).map((t) => (
              <PricingCard
                key={t.key}
                tier={t}
                onStart={scrollToRank}
                onSubscribe={onSubscribe}
                stripeReady={stripeReady}
                subscribing={checkout.isPending}
              />
            ))}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint, marginTop: 24 }}>
            All tiers billed per token used &middot; Refill anytime at your account rate &middot; Proposed — subject to change
          </div>
        </div>
      </section>

      {/* ── Built to be cited ────────────────────────────────── */}
      <section id="cite" style={{ background: DI.surface, borderTop: `1px solid ${DI.line}`, padding: '96px 0' }}>
        <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '0 24px' }}>
          <SectionHeading number="05" title="Built to be cited." />
          <div className="di-two-col grid" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 48, marginTop: 40, alignItems: 'start' }}>
            <div>
              <p style={{ fontSize: 15, lineHeight: 1.625, color: DI.body, maxWidth: '36rem', margin: 0 }}>
                Every figure on this site links back to an archived model response. The dataset is free for editorial and academic use — no signup, no license fee. If a number moves, we publish why.
              </p>
              <div className="flex flex-wrap" style={{ gap: 14, marginTop: 28 }}>
                <Link href="/explore"><BrandButton>Explore the rankings</BrandButton></Link>
              </div>
            </div>
            <div style={{ background: '#fff', border: `1px solid ${DI.line}`, padding: 24 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint, marginBottom: 12 }}>Cite as</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.7, color: DI.ink }}>
                AI Ranked US, &ldquo;AI Consensus Index.&rdquo; airanked.us
              </div>
            </div>
          </div>
        </div>
      </section>

      {showAuthModal && (
        <AuthModal
          title={authModalMsg}
          description="Verify your email and your ranking starts automatically — results land on your own page."
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}

function fmtRate(v: number): string {
  // Show a readable per-token rate, e.g. $0.000020 or $0.02 / 1K.
  const per1k = v * 1000;
  return per1k >= 0.01 ? `$${per1k.toFixed(2)} / 1K tokens` : `$${v.toFixed(6)} / token`;
}

function PricingCard({ tier, onStart, onSubscribe, stripeReady, subscribing }: { tier: PricingTier; onStart: () => void; onSubscribe: (tierKey: string) => void; stripeReady: boolean; subscribing: boolean }) {
  const hl = tier.highlighted;
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${hl ? DI.teal : DI.line}`, padding: 28, boxShadow: hl ? '0 4px 6px rgba(0,0,0,0.06)' : '0 1px 2px rgba(0,0,0,0.05)' }}>
      {hl && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(to right, ${DI.teal}, ${DI.tealLight})` }} />}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: hl ? DI.teal : DI.faint }}>{tier.name}</div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {tier.monthlyPriceUsd != null ? (
          <>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 40, letterSpacing: '-0.02em', color: DI.ink }}>${tier.monthlyPriceUsd.toFixed(0)}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.steel }}>/ month</span>
          </>
        ) : (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, letterSpacing: '-0.02em', color: DI.ink }}>Custom</span>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.teal, marginTop: 8 }}>{fmtRate(tier.costPerTokenUsd)}</div>
      <p style={{ fontSize: 13, lineHeight: 1.5, color: DI.body, margin: '14px 0 0' }}>{tier.blurb}</p>
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        {tier.features.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: DI.teal, fontSize: 12 }}>▸</span>
            <span style={{ fontSize: 13, color: DI.body }}>{f}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tier.monthlyPriceUsd != null ? (
          <>
            <BrandButton
              variant={hl ? 'primary' : 'ghost'}
              fullWidth
              onClick={() => (stripeReady ? onSubscribe(tier.key) : onStart())}
            >
              {subscribing ? 'Redirecting…' : stripeReady ? `Subscribe · $${tier.monthlyPriceUsd.toFixed(0)}/mo` : 'Start free'}
            </BrandButton>
            {stripeReady && (
              <button onClick={onStart} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: DI.faint }}>
                or try a free ranking first
              </button>
            )}
          </>
        ) : (
          <BrandButton variant="ghost" fullWidth href="mailto:hello@airanked.us?subject=Enterprise%20plan">Contact sales</BrandButton>
        )}
      </div>
    </div>
  );
}

function IndustryCard({ id, name, leader, score, onOpen }: { id: number; name: string; leader: string; score: number; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-testid={`card-industry-${id}`}
      style={{
        background: '#fff',
        border: `1px solid ${DI.line}`,
        padding: 24,
        cursor: 'pointer',
        transition: 'all 0.3s',
        transform: hover ? 'translateY(-4px)' : 'none',
        boxShadow: hover ? '0 4px 6px rgba(0,0,0,0.07)' : 'none',
      }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.teal, marginBottom: 14 }}>{name}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: DI.ink }}>{leader}</div>
      <div className="flex items-baseline" style={{ gap: 10, marginTop: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26, fontWeight: 700, color: DI.ink }}>{score.toFixed(0)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.steel }}>/ 100</span>
      </div>
      <div style={{ fontSize: 12, color: DI.steel, marginTop: 12, borderTop: `1px solid ${DI.line}`, paddingTop: 12 }}>Top-ranked brand this period</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: hover ? '#fff' : DI.teal, background: hover ? DI.teal : 'transparent', border: `1px solid ${hover ? DI.teal : 'rgba(14,168,142,0.35)'}`, padding: '7px 12px', marginTop: 12, transition: 'all 0.3s' }}>
        Analyze <ArrowRight className="w-3 h-3" />
      </div>
    </div>
  );
}
