import React from 'react';
import { Link, useParams } from 'wouter';
import {
  useGetAdHocRequest,
  getGetAdHocRequestQueryKey,
  useGetMovers,
  getGetMoversQueryKey,
} from '@workspace/api-client-react';
import type { AdHocMetricResult, AdHocEngineResult } from '@workspace/api-client-react';
import { Loader2, AlertCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { DI, BrandButton } from '@/components/brand';
import { Ticker } from '@/components/home-board';

const COUNTRY_LABELS: Record<string, string> = {
  US: 'United States', UK: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', JP: 'Japan', IN: 'India', BR: 'Brazil', MX: 'Mexico',
};

const MAX_W = '72rem';

function MetricBlock({ metric, focusBrand }: { metric: AdHocMetricResult; focusBrand: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
      <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: `1px solid ${DI.line}` }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: DI.ink, margin: 0 }}>{metric.metricLabel}</h3>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.faint }}>
          {metric.higherIsBetter ? 'Higher = better' : 'Higher = more'}
        </span>
      </div>
      <div>
        {metric.entries.map((entry) => {
          const isTarget = entry.brandName.toLowerCase() === focusBrand.toLowerCase();
          return (
            <div key={entry.brandName} style={{ padding: '13px 20px', borderBottom: `1px solid ${DI.line}`, background: isTarget ? 'rgba(14,168,142,0.05)' : '#fff' }}>
              <div className="flex items-baseline justify-between" style={{ gap: 12 }}>
                <div className="flex items-baseline" style={{ gap: 10, minWidth: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint }}>{String(entry.rank).padStart(2, '0')}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: DI.ink }}>{entry.brandName}</span>
                  {isTarget && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.teal }}>your brand</span>}
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: isTarget ? DI.teal : DI.ink }}>{entry.score.toFixed(1)}</span>
              </div>
              <span style={{ display: 'block', height: 3, background: DI.surface, marginTop: 8 }}>
                <span style={{ display: 'block', height: 3, background: isTarget ? DI.teal : DI.steel, width: `${Math.max(0, Math.min(100, entry.score))}%` }} />
              </span>
              {entry.rationale && (
                <p style={{ fontSize: 12.5, lineHeight: 1.5, color: DI.body, fontStyle: 'italic', margin: '8px 0 0' }}>&ldquo;{entry.rationale}&rdquo;</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Results() {
  const params = useParams<{ id: string }>();
  const requestId = parseInt(params.id ?? '', 10);
  const { data: movers } = useGetMovers({ query: { queryKey: getGetMoversQueryKey() } });

  const { data, isLoading, isError } = useGetAdHocRequest(requestId, {
    query: {
      queryKey: getGetAdHocRequestQueryKey(requestId),
      enabled: !isNaN(requestId),
      refetchInterval: (query: { state: { data: unknown } }) => {
        const status = (query.state.data as { status?: string })?.status;
        return status === 'pending' || status === 'running' ? 2000 : false;
      },
    },
  });

  const shell = (children: React.ReactNode) => (
    <div style={{ background: DI.paper, minHeight: '100vh' }}>
      <Ticker movers={movers} />
      <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '40px 24px 96px' }}>{children}</div>
    </div>
  );

  if (isNaN(requestId) || isError || (!isLoading && !data)) {
    return shell(
      <div className="flex flex-col items-center justify-center" style={{ minHeight: '50vh', gap: 16 }}>
        <AlertCircle className="w-9 h-9" style={{ color: DI.danger }} />
        <p style={{ color: DI.body }}>Results not found.</p>
        <Link href="/"><BrandButton variant="ghost">← Back to home</BrandButton></Link>
      </div>,
    );
  }

  if (isLoading || !data) {
    return shell(
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[1, 2, 3].map((i) => <div key={i} style={{ height: i === 1 ? 60 : 200, background: '#fff', border: `1px solid ${DI.line}` }} />)}
      </div>,
    );
  }

  const isPending = data.status === 'pending' || data.status === 'running';
  const isFailed = data.status === 'failed';
  const countryLabel = COUNTRY_LABELS[data.country] ?? data.country;

  return shell(
    <>
      {/* Breadcrumb */}
      <div className="flex items-center" style={{ gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
        <Link href="/rank" style={{ color: DI.body }}>← Rank another</Link>
        <span style={{ color: DI.faint }}>/</span>
        <span style={{ color: DI.ink }}>Your ranking</span>
      </div>

      {/* Header */}
      <div style={{ marginTop: 28 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.teal }}>
          {countryLabel} &middot; Custom ranking
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(2.25rem,5vw,3.25rem)', lineHeight: 1.05, letterSpacing: '-0.02em', color: DI.ink, margin: '14px 0 0' }}>
          {data.brand}
        </h1>
        <p style={{ fontSize: 14, color: DI.body, margin: '10px 0 0' }}>vs. {data.competitors.join(', ')}</p>
      </div>

      {/* Status */}
      {isPending && (
        <div className="flex items-center" style={{ gap: 12, background: '#fff', border: `1px solid ${DI.line}`, padding: '14px 20px', marginTop: 24 }}>
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: DI.teal }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: DI.ink, margin: 0 }}>Surveying AI engines…</p>
            <p style={{ fontSize: 12, color: DI.steel, margin: '2px 0 0' }}>About 30–60 seconds. Results appear automatically.</p>
          </div>
        </div>
      )}
      {isFailed && (
        <div className="flex items-center" style={{ gap: 12, background: 'rgba(229,72,77,0.05)', border: `1px solid rgba(229,72,77,0.25)`, padding: '14px 20px', marginTop: 24 }}>
          <AlertCircle className="w-5 h-5" style={{ color: DI.danger }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: DI.ink, margin: 0 }}>Survey failed</p>
            <p style={{ fontSize: 12, color: DI.steel, margin: '2px 0 0' }}>{data.error ?? 'Unknown error occurred.'}</p>
          </div>
        </div>
      )}

      {/* Results */}
      {data.results && (
        <>
          <div style={{ marginTop: 32 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint }}>
              Consensus &middot; averaged across AI engines
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 16, marginTop: 16 }}>
              {data.results.averaged.map((metric: AdHocMetricResult) => (
                <MetricBlock key={metric.metricKey} metric={metric} focusBrand={data.brand} />
              ))}
            </div>
          </div>

          {data.results.byEngine.length > 1 && (
            <div style={{ marginTop: 40 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint, marginBottom: 16 }}>
                Per-engine breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.results.byEngine.map((engine: AdHocEngineResult) => (
                  <details key={engine.engineKey}>
                    <summary style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', listStyle: 'none', padding: '12px 16px', background: '#fff', border: `1px solid ${DI.line}` }}>
                      <ChevronDown className="w-4 h-4" style={{ color: DI.faint }} />
                      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: DI.ink }}>{engine.engineName}</span>
                      <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.faint }}>{engine.metrics.length} metrics</span>
                    </summary>
                    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 16, marginTop: 12 }}>
                      {engine.metrics.map((metric: AdHocMetricResult) => (
                        <MetricBlock key={metric.metricKey} metric={metric} focusBrand={data.brand} />
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* CTA */}
      <div className="flex flex-wrap" style={{ gap: 14, marginTop: 48, borderTop: `1px solid ${DI.line}`, paddingTop: 32 }}>
        <Link href="/rank"><BrandButton variant="ghost">← Rank another brand</BrandButton></Link>
        <Link href="/explore"><BrandButton>Explore all rankings <ChevronRight className="w-4 h-4" /></BrandButton></Link>
      </div>
    </>,
  );
}
