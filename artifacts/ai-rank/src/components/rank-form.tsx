import React, { useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  useSuggestCompetitors,
  useRunAdHocRank,
  useGetMe,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { Plus, X, Sparkles, Loader2 } from 'lucide-react';
import { AuthModal } from '@/components/auth-modal';
import { DI, BrandButton, FieldLabel } from '@/components/brand';

/** Query stashed while the visitor sets up their account; run after verify. */
export const PENDING_RANK_KEY = 'airank_pending_rank';

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

/**
 * Self-contained "Rank your brand" form: brand + market + competitors, AI
 * suggestions, and submit. Handles the logged-out path (stash the query, open
 * the auth modal — the ranking auto-runs after magic-link verify) and the
 * logged-in path (run immediately, route to the private results page). Reused
 * on the home page and the dedicated /rank page.
 */
export function RankForm() {
  const [, setLocation] = useLocation();

  const [brand, setBrand] = useState('');
  const [country, setCountry] = useState('US');
  const [competitors, setCompetitors] = useState<string[]>(['', '']);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMsg, setAuthModalMsg] = useState('Sign in to continue');
  const [formError, setFormError] = useState<string | null>(null);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);

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

  const validCompetitors = competitors.filter((c) => c.trim().length > 0);

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

  return (
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
