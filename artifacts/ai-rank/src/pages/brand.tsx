import React, { useEffect, useMemo, useState } from 'react';
import { useRoute, Link } from 'wouter';
import {
  useGetBrandAnalytics,
  getGetBrandAnalyticsQueryKey,
  useGetIndustryTrends,
  getGetIndustryTrendsQueryKey,
  useGetIndustryHistory,
  getGetIndustryHistoryQueryKey,
} from '@workspace/api-client-react';
import { DI, brandColor, Eyebrow } from '../components/brand';
import { CHART, sy, sx, niceDomain, axisTicks } from '../components/home-board';

const MAX_LINES = 6;

export default function BrandAnalytics() {
  const [, params] = useRoute('/brand/:id');
  const brandId = Number(params?.id);

  const { data, isLoading } = useGetBrandAnalytics(brandId, {
    query: { queryKey: getGetBrandAnalyticsQueryKey(brandId), enabled: Number.isFinite(brandId) },
  });

  const [metric, setMetric] = useState<string | null>(null);
  useEffect(() => {
    if (metric == null && data?.metrics.length) setMetric(data.metrics[0]!.key);
  }, [data, metric]);

  // Which brands to draw. Default: focal brand + next 4 peers by rank.
  const [shown, setShown] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (data && shown.size === 0) {
      const ids = [brandId, ...data.peers.filter((p) => p.brandId !== brandId).map((p) => p.brandId)].slice(0, 5);
      setShown(new Set(ids));
    }
  }, [data, brandId, shown.size]);

  const industryId = data?.brand.industryId ?? 0;
  const enabled = industryId > 0 && metric != null;
  const { data: trends } = useGetIndustryTrends(
    industryId, { metric: metric ?? '' },
    { query: { enabled, queryKey: getGetIndustryTrendsQueryKey(industryId, { metric: metric ?? '' }) } },
  );
  const { data: history } = useGetIndustryHistory(
    industryId, { metric: metric ?? '' },
    { query: { enabled, queryKey: getGetIndustryHistoryQueryKey(industryId, { metric: metric ?? '' }) } },
  );

  if (!Number.isFinite(brandId)) return <NotFound />;
  if (isLoading || !data) return <div style={{ padding: 40, fontFamily: 'var(--font-mono)', color: DI.faint }}>Loading analytics…</div>;

  const focal = data.brand;
  const activeMetric = data.metrics.find((m) => m.key === metric) ?? data.metrics[0];

  function toggle(id: number) {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_LINES) next.add(id);
      return next;
    });
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px 80px' }}>
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <Link href={`/industry/${focal.industryId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: DI.teal, textDecoration: 'none' }}>
          ← {focal.industryName}
        </Link>
      </div>
      <div className="flex items-end justify-between" style={{ flexWrap: 'wrap', gap: 16, borderBottom: `1px solid ${DI.line}`, paddingBottom: 20, marginBottom: 24 }}>
        <div>
          <Eyebrow color="faint" size={11}>Brand analytics</Eyebrow>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 40, letterSpacing: '-0.02em', color: DI.ink, lineHeight: 1.05, marginTop: 6 }}>
            {focal.name}
          </h1>
        </div>
        <div className="flex" style={{ gap: 28 }}>
          <Stat label="Overall score" value={data.overallScore != null ? data.overallScore.toFixed(1) : '—'} />
          <Stat label="Rank" value={data.overallRank != null ? `#${data.overallRank}` : '—'} sub={`of ${data.peerCount}`} />
        </div>
      </div>

      {/* Metric breakdown */}
      <SectionTitle>Perception by metric</SectionTitle>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 40 }}>
        {data.metrics.map((m) => {
          const delta = m.previousRank != null && m.rank != null ? m.previousRank - m.rank : 0;
          const on = m.key === metric;
          return (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              style={{
                textAlign: 'left', cursor: 'pointer', background: on ? DI.surface : '#fff',
                border: `1px solid ${on ? DI.teal : DI.line}`, padding: '14px 16px',
              }}
            >
              <div className="flex items-center justify-between" style={{ gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: DI.body }}>{m.label}</span>
                {delta !== 0 && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: delta > 0 ? DI.teal : DI.danger }}>
                    {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
                  </span>
                )}
              </div>
              <div className="flex items-baseline" style={{ gap: 8, marginTop: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: DI.ink }}>{m.score != null ? m.score.toFixed(1) : '—'}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint }}>#{m.rank ?? '—'}/{m.totalBrands}</span>
              </div>
              <div style={{ height: 3, background: DI.surface, marginTop: 10 }}>
                <div style={{ height: 3, background: on ? DI.teal : DI.steel, width: `${Math.max(0, Math.min(100, m.score ?? 0))}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Chart + peer selector */}
      <SectionTitle>
        13-week trajectory · {activeMetric?.label}
      </SectionTitle>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
        <TrendChart
          trends={trends}
          history={history}
          shown={shown}
          focalId={brandId}
        />
        <PeerList
          peers={data.peers}
          shown={shown}
          focalId={brandId}
          onToggle={toggle}
        />
      </div>
    </div>
  );
}

function TrendChart({
  trends, history, shown, focalId,
}: {
  trends: { brands: { brandId: number; brandName: string; points: { weekIndex: number; weekLabel: string; score: number }[] }[] } | undefined;
  history: { brands: { brandId: number; brandName: string; points: { score: number }[] }[] } | undefined;
  shown: Set<number>;
  focalId: number;
}) {
  const [hoverWk, setHoverWk] = useState<number | null>(null);

  const brands = (trends?.brands ?? []).filter((b) => shown.has(b.brandId));
  const weekLabels = trends?.brands?.[0]?.points.map((p) => p.weekLabel) ?? [];
  const nWeeks = weekLabels.length || 13;

  const measuredByBrand = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const b of history?.brands ?? []) m.set(b.brandId, b.points.map((p) => p.score));
    return m;
  }, [history]);

  const domain = useMemo(() => {
    const scores: number[] = [];
    for (const b of brands) for (const p of b.points) scores.push(p.score);
    for (const b of brands) for (const s of measuredByBrand.get(b.brandId) ?? []) scores.push(s);
    return niceDomain(scores);
  }, [brands, measuredByBrand]);
  const ticks = axisTicks(domain.lo, domain.hi);

  const series = brands.map((b) => {
    const est = b.points.map((p) => `${sx(p.weekIndex, nWeeks).toFixed(1)},${sy(p.score, domain.lo, domain.hi).toFixed(1)}`).join(' ');
    const meas = measuredByBrand.get(b.brandId) ?? [];
    const measPoly = meas.map((s, i) => `${sx(i, Math.max(meas.length, 2)).toFixed(1)},${sy(s, domain.lo, domain.hi).toFixed(1)}`).join(' ');
    const scores: (number | null)[] = [];
    for (const p of b.points) scores[p.weekIndex] = p.score;
    return { brandId: b.brandId, name: b.brandName, color: brandColor(b.brandId), emphasis: b.brandId === focalId, est, measPoly, scores };
  });

  if (series.length === 0 || !series.some((s) => s.est)) {
    return <div style={{ border: `1px solid ${DI.line}`, padding: 40, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint }}>No trend data yet.</div>;
  }

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 640;
    const step = nWeeks > 1 ? (CHART.x1 - CHART.x0) / (nWeeks - 1) : 1;
    setHoverWk(Math.max(0, Math.min(nWeeks - 1, Math.round((vx - CHART.x0) / step))));
  }
  const hoverX = hoverWk != null ? sx(hoverWk, nWeeks) : 0;
  const hoverRows = hoverWk != null
    ? series.filter((s) => s.scores[hoverWk] != null).map((s) => ({ name: s.name, color: s.color, val: s.scores[hoverWk]! })).sort((a, b) => b.val - a.val)
    : [];

  return (
    <div style={{ border: `1px solid ${DI.line}`, background: '#fff', padding: '20px 16px', position: 'relative' }}>
      <div className="flex items-center" style={{ gap: 16, marginBottom: 8 }}>
        <LegendSwatch label="Measured" dashed={false} />
        <LegendSwatch label="13-wk estimate" dashed />
      </div>
      <svg viewBox="0 0 640 300" style={{ width: '100%', height: 'auto', cursor: 'crosshair' }} onMouseMove={onMove} onMouseLeave={() => setHoverWk(null)}>
        {ticks.map((t) => <line key={t.y} x1="0" y1={t.y} x2="530" y2={t.y} stroke={DI.line} strokeWidth="1" />)}
        {ticks.map((t) => <text key={`l${t.y}`} x="0" y={t.y - 4} fill={DI.faint} fontFamily="JetBrains Mono, monospace" fontSize="9">{t.value}</text>)}
        {hoverWk != null && <line x1={hoverX} y1="16" x2={hoverX} y2="272" stroke={DI.ink} strokeWidth="1" strokeDasharray="3 3" opacity={0.4} />}
        {series.map((s) => s.measPoly ? <polyline key={`m${s.brandId}`} points={s.measPoly} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2.5 : 1.5} opacity={0.9} /> : null)}
        {series.map((s) => s.est ? <polyline key={`e${s.brandId}`} points={s.est} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2 : 1.25} strokeDasharray="4 3" opacity={0.7} /> : null)}
        {hoverWk != null && series.map((s) => s.scores[hoverWk] != null ? (
          <circle key={`h${s.brandId}`} cx={sx(hoverWk, nWeeks)} cy={sy(s.scores[hoverWk]!, domain.lo, domain.hi)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />
        ) : null)}
        <line x1="0" y1="272" x2="530" y2="272" stroke={DI.faint} strokeWidth="1" />
        <text x="16" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10">{weekLabels[0] ?? ''}</text>
        <text x="530" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">{weekLabels[weekLabels.length - 1] ?? ''}</text>
      </svg>
      {hoverWk != null && hoverRows.length > 0 && (
        <div style={{ position: 'absolute', top: 40, right: 16, background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 4px 6px rgba(0,0,0,0.1)', padding: '10px 12px', minWidth: 150 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: DI.ink, marginBottom: 6 }}>{weekLabels[hoverWk] ?? `W${hoverWk}`}</div>
          {hoverRows.map((r) => (
            <div key={r.name} className="flex items-center" style={{ gap: 8, padding: '2px 0' }}>
              <span style={{ width: 8, height: 8, background: r.color }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.body, flex: 1 }}>{r.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: DI.ink }}>{r.val.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PeerList({
  peers, shown, focalId, onToggle,
}: {
  peers: { brandId: number; brandName: string; overallScore: number; rank: number }[];
  shown: Set<number>;
  focalId: number;
  onToggle: (id: number) => void;
}) {
  return (
    <div style={{ border: `1px solid ${DI.line}`, background: '#fff' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${DI.line}`, fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint }}>
        Compare brands · toggle up to {MAX_LINES}
      </div>
      {peers.map((p) => {
        const on = shown.has(p.brandId);
        const isFocal = p.brandId === focalId;
        return (
          <div key={p.brandId} className="flex items-center" style={{ gap: 10, padding: '10px 16px', borderBottom: `1px solid ${DI.line}`, background: isFocal ? DI.surface : '#fff' }}>
            <button
              onClick={() => onToggle(p.brandId)}
              title={on ? 'Hide from chart' : 'Show on chart'}
              style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${brandColor(p.brandId)}`, background: on ? brandColor(p.brandId) : 'transparent', cursor: 'pointer', flexShrink: 0 }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint, width: 22 }}>#{p.rank}</span>
            <Link href={`/brand/${p.brandId}`} style={{ flex: 1, fontSize: 13, fontWeight: isFocal ? 700 : 500, color: DI.ink, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.brandName}
            </Link>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: DI.ink }}>{p.overallScore.toFixed(1)}</span>
          </div>
        );
      })}
    </div>
  );
}

function LegendSwatch({ label, dashed }: { label: string; dashed: boolean }) {
  return (
    <span className="flex items-center" style={{ gap: 6 }}>
      <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={DI.steel} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} /></svg>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: DI.faint }}>{label}</span>
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.ink, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 20, height: 2, background: DI.teal }} /> {children}
    </h2>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 30, color: DI.ink, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.faint }}>{sub}</div>}
    </div>
  );
}

function NotFound() {
  return <div style={{ padding: 40, fontFamily: 'var(--font-mono)', color: DI.faint }}>Brand not found.</div>;
}
