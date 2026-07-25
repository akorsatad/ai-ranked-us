import React from 'react';
import { Link } from 'wouter';
import {
  useGetOverview,
  getGetOverviewQueryKey,
  useListRuns,
  getListRunsQueryKey,
  useGetCatalog,
  getGetCatalogQueryKey,
  useGetMovers,
  getGetMoversQueryKey,
} from '@workspace/api-client-react';
import { ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { DI, Eyebrow } from '@/components/brand';
import { Ticker } from '@/components/home-board';

const MAX_W = '72rem';

export default function Dashboard() {
  const { data: runs } = useListRuns(undefined, {
    query: {
      queryKey: getListRunsQueryKey(),
      refetchInterval: (query) =>
        query.state.data?.some((r) => ['running', 'pausing', 'cancelling'].includes(r.status)) ? 3000 : false,
    },
  });
  const isRunning = runs?.some((r) => ['running', 'pausing', 'cancelling'].includes(r.status));

  const { data: overview, isLoading } = useGetOverview({
    query: { queryKey: getGetOverviewQueryKey(), refetchInterval: isRunning ? 3000 : false },
  });
  const { data: moversReport } = useGetMovers({
    query: { queryKey: getGetMoversQueryKey(), refetchInterval: isRunning ? 3000 : false },
  });
  const { data: catalog } = useGetCatalog({ query: { queryKey: getGetCatalogQueryKey() } });
  const { data: moversTicker } = useGetMovers({ query: { queryKey: getGetMoversQueryKey() } });

  const hasData = overview && overview.responsesCount > 0;

  return (
    <div style={{ background: DI.paper, minHeight: '100vh' }}>
      <Ticker movers={moversTicker} />
      <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '48px 24px 96px' }}>
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between" style={{ gap: 16 }}>
          <div>
            <Eyebrow>The AI consensus index</Eyebrow>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(2.25rem,4vw,3rem)', lineHeight: 1.05, letterSpacing: '-0.02em', color: DI.ink, margin: '14px 0 0' }}>
              Intelligence Overview
            </h1>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em', color: DI.steel, margin: '10px 0 0' }}>
              {overview?.lastRun?.completedAt
                ? `Last updated ${formatDistanceToNow(new Date(overview.lastRun.completedAt), { addSuffix: true })}`
                : 'No completed runs yet'}
            </p>
          </div>
          {isRunning && (
            <span className="flex items-center" style={{ gap: 8, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.teal }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: DI.teal, display: 'inline-block' }} />
              Survey in progress
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginTop: 40 }}>
            {[1, 2, 3, 4].map((i) => <div key={i} style={{ height: 96, background: '#fff', border: `1px solid ${DI.line}` }} />)}
          </div>
        ) : (
          <>
            {/* Stat row */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16, marginTop: 40 }}>
              <Stat label="Industries tracked" value={overview?.industriesCount ?? 0} />
              <Stat label="Brands surveyed" value={overview?.brandsCount ?? 0} />
              <Stat label="AI engines" value={overview?.enginesCount ?? 0} />
              <Stat label="Total responses" value={overview?.responsesCount ?? 0} highlight />
            </div>

            {!hasData && !isRunning && (
              <div style={{ marginTop: 40, background: '#fff', border: `1px solid ${DI.line}`, padding: '28px 24px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.teal, marginBottom: 8 }}>Awaiting intelligence</div>
                <p style={{ fontSize: 14, color: DI.body, margin: 0 }}>No survey data yet. Rankings appear here after the first scheduled AI engine survey completes.</p>
              </div>
            )}

            {/* Biggest movers */}
            {hasData && moversReport && moversReport.movers.length > 0 && (
              <section style={{ marginTop: 64 }}>
                <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 12 }}>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: DI.ink, margin: 0 }}>Biggest movers</h2>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>
                    {moversReport.previousRunAt ? `vs. run ${formatDistanceToNow(new Date(moversReport.previousRunAt), { addSuffix: true })}` : 'vs. previous run'}
                  </span>
                </div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16, marginTop: 24 }}>
                  {moversReport.movers.slice(0, 6).map((m) => {
                    const up = m.rankDelta > 0 || (m.rankDelta === 0 && m.scoreDelta > 0);
                    const flat = m.rankDelta === 0 && m.scoreDelta === 0;
                    const col = flat ? DI.faint : up ? DI.teal : DI.danger;
                    return (
                      <div key={`${m.industryId}-${m.metric}-${m.brandId}`} style={{ background: '#fff', border: `1px solid ${DI.line}`, padding: 20 }}>
                        <div className="flex items-baseline justify-between" style={{ gap: 12 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: DI.ink }}>{m.brandName}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.faint, marginTop: 3 }}>{m.industryName} &middot; {m.metricLabel}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: col }}>
                              {m.rankDelta !== 0 ? `${up ? '▲' : '▼'} ${Math.abs(m.rankDelta)} ${Math.abs(m.rankDelta) === 1 ? 'spot' : 'spots'}` : `${m.scoreDelta > 0 ? '+' : ''}${m.scoreDelta.toFixed(1)} pts`}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.faint, marginTop: 3 }}>#{m.previousRank} → #{m.currentRank} &middot; {m.scoreDelta > 0 ? '+' : ''}{m.scoreDelta.toFixed(1)}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {hasData && moversReport && moversReport.previousRunId == null && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint, marginTop: 24 }}>
                Day-over-day movement appears here once a second survey run completes.
              </p>
            )}

            {/* Industry leadership */}
            {hasData && catalog && overview && (
              <section style={{ marginTop: 64 }}>
                <div className="flex flex-wrap items-baseline justify-between" style={{ gap: 12 }}>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: DI.ink, margin: 0 }}>Industry leadership</h2>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>Leader per metric</span>
                </div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(420px,1fr))', gap: 20, marginTop: 24 }}>
                  {catalog.industries.map((industry) => {
                    const leaders = overview.leaders.filter((l) => l.industryId === industry.id);
                    if (leaders.length === 0) return null;
                    return (
                      <div key={industry.id} style={{ background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                        <div className="flex items-center justify-between" style={{ padding: '18px 24px', borderBottom: `1px solid ${DI.line}`, background: DI.surface }}>
                          <div>
                            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: DI.ink }}>{industry.name}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint, marginTop: 2 }}>{industry.country}</div>
                          </div>
                          <Link href={`/industry/${industry.id}`} className="inline-flex items-center" style={{ gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.teal, border: `1px solid rgba(14,168,142,0.35)`, padding: '7px 12px' }}>
                            Analyze <ArrowRight className="w-3 h-3" />
                          </Link>
                        </div>
                        <div>
                          {leaders.map((leader) => (
                            <div key={leader.metric} className="flex items-center justify-between" style={{ padding: '13px 24px', borderBottom: `1px solid ${DI.line}` }}>
                              <div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.faint }}>{leader.metricLabel}</div>
                                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: DI.ink, marginTop: 2 }}>{leader.brandName}</div>
                              </div>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: DI.teal }}>{leader.score.toFixed(1)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div style={{ position: 'relative', background: highlight ? DI.teal : '#fff', border: `1px solid ${highlight ? DI.teal : DI.line}`, padding: '20px 22px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: highlight ? 'rgba(255,255,255,0.85)' : DI.faint }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 34, letterSpacing: '-0.02em', color: highlight ? '#fff' : DI.ink, marginTop: 8 }}>{value.toLocaleString()}</div>
    </div>
  );
}
