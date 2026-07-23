import React, { useState, useCallback } from 'react';
import { useLocation, Link } from 'wouter';
import {
  useSuggestCompetitors,
  useRunAdHocRank,
} from '@workspace/api-client-react';
import {
  Zap,
  BarChart3,
  ArrowRight,
  Plus,
  X,
  Sparkles,
  Globe,
  Loader2,
  Trophy,
  TrendingUp,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AuthModal } from '@/components/auth-modal';

const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'UK', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'AU', label: 'Australia' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'JP', label: 'Japan' },
  { code: 'IN', label: 'India' },
  { code: 'BR', label: 'Brazil' },
  { code: 'MX', label: 'Mexico' },
];

const METRICS_PREVIEW = [
  { icon: Trophy, label: 'Brand Sentiment', desc: 'Positive perception among consumers' },
  { icon: Shield, label: 'Trustworthiness', desc: 'How reliable & honest the brand appears' },
  { icon: TrendingUp, label: 'Innovation Score', desc: 'Perceived leadership & forward-thinking' },
];

export default function Home() {
  const [, setLocation] = useLocation();

  const [brand, setBrand] = useState('');
  const [country, setCountry] = useState('US');
  const [competitors, setCompetitors] = useState<string[]>(['', '']);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMsg, setAuthModalMsg] = useState('Sign in to continue');
  const [formError, setFormError] = useState<string | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);

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
      onSuccess: (data: { id: number }) => {
        setLocation(`/results/${data.id}`);
      },
      onError: (err: unknown) => {
        const apiErr = err as { status: number; data?: { message?: string; requiresAuth?: boolean; retryAt?: string } };
        const status = apiErr.status;
        const body = apiErr.data;

        if (status === 401 && body?.requiresAuth) {
          setAuthModalMsg('Sign in to run more rankings');
          setShowAuthModal(true);
          return;
        }
        if (status === 429) {
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

  function addCompetitor() {
    setCompetitors((prev) => [...prev, '']);
  }

  function removeCompetitor(idx: number) {
    setCompetitors((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateCompetitor(idx: number, value: string) {
    setCompetitors((prev) => prev.map((c, i) => (i === idx ? value : c)));
  }

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

    if (!brand.trim()) {
      setFormError('Brand name is required.');
      return;
    }
    if (validCompetitors.length === 0) {
      setFormError('Add at least one competitor.');
      return;
    }

    runRank({
      data: {
        brand: brand.trim(),
        competitors: validCompetitors,
        country,
      },
    });
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border">
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-xs font-medium text-primary mb-8">
            <Zap className="w-3 h-3 fill-current" />
            Powered by multiple AI engines
          </div>

          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-foreground mb-5 leading-tight">
            How does AI perceive<br />
            <span className="text-primary">your brand?</span>
          </h1>

          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8 leading-relaxed">
            AI Rank surveys leading AI models — ChatGPT, Claude, Gemini — and aggregates their brand
            perceptions into actionable sentiment scores.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 mb-10">
            {METRICS_PREVIEW.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2 text-sm"
              >
                <Icon className="w-4 h-4 text-primary shrink-0" />
                <span className="font-medium text-foreground">{label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="gap-2 px-6" onClick={() => {
              document.getElementById('rank-form')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              <Sparkles className="w-4 h-4" />
              Rank your brand — free
            </Button>
            <Button variant="outline" size="lg" asChild className="gap-2 px-6">
              <Link href="/explore">
                Explore industry rankings
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Rank Your Brand Form ────────────────────────────────────── */}
      <section id="rank-form" className="max-w-2xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
            Rank your brand
          </h2>
          <p className="text-muted-foreground">
            Enter your brand, pick competitors, and let AI engines score them across multiple perception metrics.
            Your <span className="text-foreground font-medium">first ranking is free</span> — no account needed.
          </p>
        </div>

        <Card className="border-border shadow-lg">
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Brand + Country row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label htmlFor="brand-name" className="text-sm font-medium">
                    Your brand / product
                  </Label>
                  <Input
                    id="brand-name"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="e.g. Notion, Tesla, Airbnb"
                    className="h-10"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="country" className="text-sm font-medium flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5" />
                    Market
                  </Label>
                  <select
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Competitors */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Competitors</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSuggest}
                    disabled={isSuggesting || !brand.trim()}
                    className="h-7 text-xs gap-1.5 text-primary hover:text-primary"
                  >
                    {isSuggesting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {isSuggesting ? 'Thinking…' : 'AI suggest'}
                  </Button>
                </div>

                <div className="space-y-2">
                  {competitors.map((c, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        value={c}
                        onChange={(e) => updateCompetitor(idx, e.target.value)}
                        placeholder={`Competitor ${idx + 1}`}
                        className="h-9 flex-1"
                      />
                      {competitors.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => removeCompetitor(idx)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {competitors.length < 8 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs gap-1.5 text-muted-foreground"
                    onClick={addCompetitor}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add competitor
                  </Button>
                )}
              </div>

              {/* Error / rate limit */}
              {formError && (
                <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}
              {rateLimitMsg && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 text-sm">
                  <p className="font-medium text-amber-400 mb-0.5">Daily limit reached</p>
                  <p className="text-muted-foreground">{rateLimitMsg}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={isRunning || !brand.trim() || validCompetitors.length === 0}
                className="w-full gap-2"
                size="lg"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Starting survey…
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-4 h-4" />
                    Rank this brand
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                First ranking is free — no account required. Sign in for daily rankings.
              </p>
            </form>
          </CardContent>
        </Card>
      </section>

      {/* ── How it works ──────────────────────────────────────────── */}
      <section className="border-t border-border bg-muted/20 py-16">
        <div className="max-w-4xl mx-auto px-6">
          <h2 className="text-xl font-bold text-foreground text-center mb-10">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            {[
              {
                step: '1',
                title: 'Enter your brand',
                desc: 'Name your brand and competitors. Use AI Suggest to auto-fill likely rivals.',
              },
              {
                step: '2',
                title: 'AI engines survey',
                desc: 'We query ChatGPT, Claude, Gemini, and more across sentiment, trust, and innovation metrics.',
              },
              {
                step: '3',
                title: 'Get your score',
                desc: 'See how your brand ranks against competitors with per-engine breakdowns and rationale.',
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-sm flex items-center justify-center mx-auto mb-4">
                  {step}
                </div>
                <h3 className="font-semibold text-foreground mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Button variant="outline" asChild className="gap-2">
              <Link href="/explore">
                Explore existing industry rankings
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Auth modal */}
      {showAuthModal && (
        <AuthModal
          title={authModalMsg}
          description="Create a free account to run daily custom rankings."
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
}
