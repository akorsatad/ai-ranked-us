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

  // Which individual brand lines to draw. Default: ONLY this company — the
  // page is about this brand vs. its peer-group average. Peers can be toggled
  // on as an optional overlay. Reset to the focal brand whenever the route's
  // brand changes (client-side nav between brand pages keeps this component
  // mounted, so without this the previous brand's line would persist).
  const [shown, setShown] = useState<Set<number>>(() => new Set([brandId]));
  useEffect(() => {
    setShown(new Set([brandId]));
  }, [brandId]);

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

  // Currently-opened outlier (from a chart marker or the insights list).
  const [openOutlierId, setOpenOutlierId] = useState<number | null>(null);

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

      {/* Two separate charts — different time intervals — plus peer selector. */}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 28 }}>
          <div>
            <SectionTitle>Daily measured · {activeMetric?.label}</SectionTitle>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint, marginTop: -8, marginBottom: 14 }}>
              {focal.name}&rsquo;s real daily readings vs. the peer-group average. ◆ marks a statistical outlier; click it for the engine&rsquo;s explanation.
            </p>
            <MeasuredDailyChart
              history={history}
              shown={shown}
              focalId={brandId}
              focalName={focal.name}
              outliers={data.outliers.filter((o) => o.metricKey === metric)}
              openOutlierId={openOutlierId}
              onPickOutlier={setOpenOutlierId}
            />
          </div>
          <div>
            <SectionTitle>13-week AI estimate · {activeMetric?.label}</SectionTitle>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint, marginTop: -8, marginBottom: 14 }}>
              {focal.name} vs. peer-group average — the engines&rsquo; own 13-week lookback, shown until enough daily history accrues. Weekly interval, not daily.
            </p>
            <LookbackChart trends={trends} shown={shown} focalId={brandId} focalName={focal.name} />
          </div>
        </div>
        <PeerList
          peers={data.peers}
          shown={shown}
          focalId={brandId}
          onToggle={toggle}
        />
      </div>

      {data.outliers.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <SectionTitle>Insights · statistical outliers</SectionTitle>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint, marginTop: -8, marginBottom: 16 }}>
            Every point where this brand moved beyond its normal range (±σ), explained by the engine that produced it. Click one to focus its metric and marker.
          </p>
          <InsightsPanel
            outliers={data.outliers}
            activeMetric={metric}
            openOutlierId={openOutlierId}
            onPick={(o) => { setOpenOutlierId(o.id); if (o.metricKey !== metric) setMetric(o.metricKey); }}
          />
        </div>
      )}
    </div>
  );
}

type OutlierRow = {
  id: number; metricKey: string; metricLabel: string; engineName: string;
  value: number; mean: number; sigma: number; direction: string;
  measuredAt: string; explanation: string | null; explanationModel: string | null;
};

function InsightsPanel({
  outliers, activeMetric, openOutlierId, onPick,
}: {
  outliers: OutlierRow[];
  activeMetric: string | null;
  openOutlierId: number | null;
  onPick: (o: OutlierRow) => void;
}) {
  // Most extreme first; outliers on the selected metric bubble up.
  const sorted = [...outliers].sort((a, b) => {
    const am = a.metricKey === activeMetric ? 1 : 0;
    const bm = b.metricKey === activeMetric ? 1 : 0;
    if (am !== bm) return bm - am;
    return Math.abs(b.sigma) - Math.abs(a.sigma);
  });
  return (
    <div className="grid" style={{ gap: 10 }}>
      {sorted.map((o) => {
        const open = openOutlierId === o.id;
        const up = o.direction === 'up';
        return (
          <div key={o.id} style={{ border: `1px solid ${open ? (up ? DI.teal : DI.danger) : DI.line}`, background: '#fff', borderLeft: `3px solid ${up ? DI.teal : DI.danger}` }}>
            <button
              onClick={() => onPick(o)}
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: up ? DI.teal : DI.danger, width: 54 }}>
                {up ? '▲' : '▼'} {Math.abs(o.sigma).toFixed(1)}σ
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: DI.ink }}>{o.metricLabel}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.body }}>{o.value} vs {o.mean} avg</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.faint, marginLeft: 'auto' }}>
                {o.engineName} · {new Date(o.measuredAt).toLocaleDateString()}
              </span>
            </button>
            {open && (
              <div style={{ padding: '0 16px 14px 16px', borderTop: `1px solid ${DI.line}` }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.faint, margin: '10px 0 6px' }}>
                  {o.explanationModel ? `${o.explanationModel} explains` : 'Explanation'}
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: DI.body, margin: 0 }}>
                  {o.explanation ?? 'Explanation pending — will populate on the next detection pass.'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface DailyOutlier {
  id: number; value: number; sigma: number; direction: string;
  measuredAt: string; explanation: string | null; explanationModel: string | null; engineName: string;
}

/** Daily measured chart — REAL date x-axis, continuously appended. Shows the
 *  focal brand vs. the peer-group average, with outliers as clickable ◆
 *  reference points. Separate from the weekly lookback. */
function MeasuredDailyChart({
  history, shown, focalId, focalName, outliers, openOutlierId, onPickOutlier,
}: {
  history: { brands: { brandId: number; brandName: string; points: { date: string; score: number }[] }[] } | undefined;
  shown: Set<number>;
  focalId: number;
  focalName: string;
  outliers: DailyOutlier[];
  openOutlierId: number | null;
  onPickOutlier: (id: number | null) => void;
}) {
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const toDay = (d: string) => new Date(d).toISOString().slice(0, 10);
  const allBrands = (history?.brands ?? [])
    .map((b) => ({ ...b, points: [...b.points].sort((a, c) => +new Date(a.date) - +new Date(c.date)) }));
  const shownBrands = allBrands.filter((b) => shown.has(b.brandId));

  // Categorical x-axis: one slot per DAY MEASURED across ALL industry brands
  // (so the peer-average line spans every measured day) plus any outlier days.
  const dayKeys = [...new Set([
    ...allBrands.flatMap((b) => b.points.map((p) => toDay(p.date))),
    ...outliers.map((o) => toDay(o.measuredAt)),
  ])].filter((k) => k && k !== 'Invalid Date').sort();
  const nDays = dayKeys.length;
  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));

  // Peer-group average per day = mean of every OTHER industry brand that day.
  const peerAvgByDay: (number | null)[] = new Array(nDays).fill(null);
  {
    const sums = new Array(nDays).fill(0);
    const counts = new Array(nDays).fill(0);
    for (const b of allBrands) {
      if (b.brandId === focalId) continue;
      for (const p of b.points) { const i = dayIndex.get(toDay(p.date)); if (i != null) { sums[i] += p.score; counts[i]++; } }
    }
    for (let i = 0; i < nDays; i++) if (counts[i] > 0) peerAvgByDay[i] = sums[i] / counts[i];
  }

  const scores: number[] = [];
  for (const b of shownBrands) for (const p of b.points) scores.push(p.score);
  for (const v of peerAvgByDay) if (v != null) scores.push(v);
  for (const o of outliers) scores.push(o.value);

  const hasFocal = shownBrands.some((b) => b.points.length);
  const hasPeers = peerAvgByDay.some((v) => v != null);
  if (nDays === 0 || (!hasFocal && !hasPeers)) {
    return <ChartEmpty text="No daily measurements yet — the trusted baseline builds up as daily runs accrue." />;
  }
  const domain = niceDomain(scores);
  const ticks = axisTicks(domain.lo, domain.hi);
  const xOfDay = (i: number) => sx(i, nDays);
  const fmtDay = (k: string) => new Date(`${k}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const series = shownBrands.map((b) => {
    const byDay: (number | null)[] = new Array(nDays).fill(null);
    for (const p of b.points) { const i = dayIndex.get(toDay(p.date)); if (i != null) byDay[i] = p.score; }
    const pts = byDay.map((v, i) => (v == null ? null : `${xOfDay(i).toFixed(1)},${sy(v, domain.lo, domain.hi).toFixed(1)}`)).filter(Boolean) as string[];
    return { brandId: b.brandId, name: b.brandName, color: brandColor(b.brandId), emphasis: b.brandId === focalId, poly: pts.join(' '), byDay };
  });
  const peerPoly = peerAvgByDay
    .map((v, i) => (v == null ? null : `${xOfDay(i).toFixed(1)},${sy(v, domain.lo, domain.hi).toFixed(1)}`))
    .filter(Boolean).join(' ');
  const markers = outliers.map((o) => {
    const i = dayIndex.get(toDay(o.measuredAt)) ?? 0;
    return { o, x: xOfDay(i), y: sy(o.value, domain.lo, domain.hi) };
  });
  const open = outliers.find((o) => o.id === openOutlierId) ?? null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 640;
    const step = nDays > 1 ? (CHART.x1 - CHART.x0) / (nDays - 1) : 1;
    setHoverDay(Math.max(0, Math.min(nDays - 1, Math.round((vx - CHART.x0) / step))));
  };
  const hoverRows = hoverDay != null
    ? [
        ...series.filter((s) => s.byDay[hoverDay] != null).map((s) => ({ name: s.name, color: s.color, val: s.byDay[hoverDay]! })),
        ...(peerAvgByDay[hoverDay] != null ? [{ name: 'Peer average', color: DI.steel, val: peerAvgByDay[hoverDay]! }] : []),
      ].sort((a, b) => b.val - a.val)
    : [];
  const hoverX = hoverDay != null ? xOfDay(hoverDay) : 0;
  const hoverLeftPct = (hoverX / 640) * 100;

  return (
    <div style={{ border: `1px solid ${DI.line}`, background: '#fff', padding: '20px 16px', position: 'relative' }}>
      <ChartLegend focalName={focalName} focalColor={brandColor(focalId)} />
      <svg viewBox="0 0 640 300" style={{ width: '100%', height: 'auto', cursor: 'crosshair' }} onMouseMove={onMove} onMouseLeave={() => setHoverDay(null)}>
        {ticks.map((t) => <line key={t.y} x1="0" y1={t.y} x2="530" y2={t.y} stroke={DI.line} strokeWidth="1" />)}
        {ticks.map((t) => <text key={`l${t.y}`} x="0" y={t.y - 4} fill={DI.faint} fontFamily="JetBrains Mono, monospace" fontSize="9">{t.value}</text>)}
        {hoverDay != null && <line x1={hoverX} y1="16" x2={hoverX} y2="272" stroke={DI.ink} strokeWidth="1" strokeDasharray="3 3" opacity={0.4} />}
        {/* Peer-group average — drawn under the brand line(s) */}
        {peerPoly && <polyline points={peerPoly} fill="none" stroke={DI.steel} strokeWidth="1.5" strokeDasharray="5 4" opacity={0.75} />}
        {series.map((s) => s.poly ? <polyline key={s.brandId} points={s.poly} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2.5 : 1.5} opacity={0.95} /> : null)}
        {/* Every measured day is an inspectable point */}
        {series.map((s) => s.byDay.map((v, i) => v == null ? null : (
          <circle key={`${s.brandId}-${i}`} cx={xOfDay(i)} cy={sy(v, domain.lo, domain.hi)} r={hoverDay === i ? 3.5 : 2} fill={hoverDay === i ? '#fff' : s.color} stroke={s.color} strokeWidth={hoverDay === i ? 2 : 0} />
        )))}
        {/* Outlier reference markers (◆) for the focal brand on this metric */}
        {markers.map(({ o, x, y }) => {
          const up = o.direction === 'up';
          const active = o.id === openOutlierId;
          const col = up ? DI.teal : DI.danger;
          return (
            <g key={o.id} style={{ cursor: 'pointer' }} onClick={() => onPickOutlier(active ? null : o.id)}>
              <path d={`M ${x},${y - 7} L ${x + 7},${y} L ${x},${y + 7} L ${x - 7},${y} Z`} fill={active ? col : '#fff'} stroke={col} strokeWidth="2" />
              <text x={x} y={y - 11} fill={col} fontFamily="JetBrains Mono, monospace" fontSize="9" fontWeight="700" textAnchor="middle">{Math.abs(o.sigma).toFixed(1)}σ</text>
            </g>
          );
        })}
        <line x1="0" y1="272" x2="530" y2="272" stroke={DI.faint} strokeWidth="1" />
        <text x="16" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10">{fmtDay(dayKeys[0]!)}</text>
        <text x="530" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">{fmtDay(dayKeys[nDays - 1]!)}</text>
      </svg>
      {hoverDay != null && hoverRows.length > 0 && (
        <div style={{ position: 'absolute', top: 20, left: `${hoverLeftPct}%`, transform: hoverLeftPct > 60 ? 'translateX(-105%)' : 'translateX(12px)', background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 4px 6px rgba(0,0,0,0.1)', padding: '10px 12px', minWidth: 150, pointerEvents: 'none' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: DI.ink, marginBottom: 6 }}>{fmtDay(dayKeys[hoverDay]!)}</div>
          {hoverRows.map((r) => (
            <div key={r.name} className="flex items-center" style={{ gap: 8, padding: '2px 0' }}>
              <span style={{ width: 8, height: 8, background: r.color }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.body, flex: 1 }}>{r.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: DI.ink }}>{r.val.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div style={{ borderTop: `1px solid ${DI.line}`, marginTop: 8, paddingTop: 12 }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: open.direction === 'up' ? DI.teal : DI.danger }}>
              {open.direction === 'up' ? '▲' : '▼'} {Math.abs(open.sigma).toFixed(1)}σ outlier
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.faint }}>
              {open.engineName} · {new Date(open.measuredAt).toLocaleDateString()} · {open.explanationModel ?? ''}
            </span>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: DI.body, margin: 0 }}>
            {open.explanation ?? 'Explanation pending — will populate on the next detection pass.'}
          </p>
        </div>
      )}
    </div>
  );
}

/** 13-week AI estimate — WEEK-index x-axis (provisional lookback). Focal brand
 *  vs. peer-group average. Separate chart. */
function LookbackChart({
  trends, shown, focalId, focalName,
}: {
  trends: { brands: { brandId: number; brandName: string; points: { weekIndex: number; weekLabel: string; score: number }[] }[] } | undefined;
  shown: Set<number>;
  focalId: number;
  focalName: string;
}) {
  const [hoverWk, setHoverWk] = useState<number | null>(null);
  const allBrands = trends?.brands ?? [];
  const shownBrands = allBrands.filter((b) => shown.has(b.brandId));
  const weekLabels = allBrands[0]?.points.map((p) => p.weekLabel) ?? [];
  const nWeeks = weekLabels.length || 13;

  // Peer-group average per week = mean of every OTHER industry brand.
  const peerAvgByWeek: (number | null)[] = new Array(nWeeks).fill(null);
  {
    const sums = new Array(nWeeks).fill(0);
    const counts = new Array(nWeeks).fill(0);
    for (const b of allBrands) {
      if (b.brandId === focalId) continue;
      for (const p of b.points) { if (p.weekIndex >= 0 && p.weekIndex < nWeeks) { sums[p.weekIndex] += p.score; counts[p.weekIndex]++; } }
    }
    for (let i = 0; i < nWeeks; i++) if (counts[i] > 0) peerAvgByWeek[i] = sums[i] / counts[i];
  }

  const scores: number[] = [];
  for (const b of shownBrands) for (const p of b.points) scores.push(p.score);
  for (const v of peerAvgByWeek) if (v != null) scores.push(v);
  const domain = niceDomain(scores);
  const ticks = axisTicks(domain.lo, domain.hi);
  const series = shownBrands.map((b) => {
    const byWeek: (number | null)[] = [];
    for (const p of b.points) byWeek[p.weekIndex] = p.score;
    return {
      brandId: b.brandId, name: b.brandName, color: brandColor(b.brandId), emphasis: b.brandId === focalId,
      poly: b.points.map((p) => `${sx(p.weekIndex, nWeeks).toFixed(1)},${sy(p.score, domain.lo, domain.hi).toFixed(1)}`).join(' '),
      byWeek,
    };
  });
  const peerPoly = peerAvgByWeek
    .map((v, i) => (v == null ? null : `${sx(i, nWeeks).toFixed(1)},${sy(v, domain.lo, domain.hi).toFixed(1)}`))
    .filter(Boolean).join(' ');
  const hasFocal = series.some((s) => s.poly);
  const hasPeers = peerAvgByWeek.some((v) => v != null);
  if (!hasFocal && !hasPeers) return <ChartEmpty text="No 13-week estimate yet." />;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 640;
    const step = nWeeks > 1 ? (CHART.x1 - CHART.x0) / (nWeeks - 1) : 1;
    setHoverWk(Math.max(0, Math.min(nWeeks - 1, Math.round((vx - CHART.x0) / step))));
  };
  const hoverRows = hoverWk != null
    ? [
        ...series.filter((s) => s.byWeek[hoverWk] != null).map((s) => ({ name: s.name, color: s.color, val: s.byWeek[hoverWk]! })),
        ...(peerAvgByWeek[hoverWk] != null ? [{ name: 'Peer average', color: DI.steel, val: peerAvgByWeek[hoverWk]! }] : []),
      ].sort((a, b) => b.val - a.val)
    : [];

  return (
    <div style={{ border: `1px solid ${DI.line}`, background: '#fff', padding: '20px 16px', position: 'relative' }}>
      <ChartLegend focalName={focalName} focalColor={brandColor(focalId)} />
      <svg viewBox="0 0 640 300" style={{ width: '100%', height: 'auto', cursor: 'crosshair' }} onMouseMove={onMove} onMouseLeave={() => setHoverWk(null)}>
        {ticks.map((t) => <line key={t.y} x1="0" y1={t.y} x2="530" y2={t.y} stroke={DI.line} strokeWidth="1" />)}
        {ticks.map((t) => <text key={`l${t.y}`} x="0" y={t.y - 4} fill={DI.faint} fontFamily="JetBrains Mono, monospace" fontSize="9">{t.value}</text>)}
        {hoverWk != null && <line x1={sx(hoverWk, nWeeks)} y1="16" x2={sx(hoverWk, nWeeks)} y2="272" stroke={DI.ink} strokeWidth="1" strokeDasharray="3 3" opacity={0.4} />}
        {peerPoly && <polyline points={peerPoly} fill="none" stroke={DI.steel} strokeWidth="1.5" strokeDasharray="5 4" opacity={0.7} />}
        {series.map((s) => <polyline key={s.brandId} points={s.poly} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2 : 1.25} strokeDasharray="4 3" opacity={0.85} />)}
        {hoverWk != null && series.map((s) => s.byWeek[hoverWk] != null ? (
          <circle key={s.brandId} cx={sx(hoverWk, nWeeks)} cy={sy(s.byWeek[hoverWk]!, domain.lo, domain.hi)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />
        ) : null)}
        {hoverWk != null && peerAvgByWeek[hoverWk] != null && (
          <circle cx={sx(hoverWk, nWeeks)} cy={sy(peerAvgByWeek[hoverWk]!, domain.lo, domain.hi)} r="4" fill="#fff" stroke={DI.steel} strokeWidth="2" />
        )}
        <line x1="0" y1="272" x2="530" y2="272" stroke={DI.faint} strokeWidth="1" />
        <text x="16" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10">{weekLabels[0] ?? ''}</text>
        <text x="530" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">{weekLabels[weekLabels.length - 1] ?? ''}</text>
      </svg>
      {hoverWk != null && hoverRows.length > 0 && (
        <div style={{ position: 'absolute', top: 20, right: 16, background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 4px 6px rgba(0,0,0,0.1)', padding: '10px 12px', minWidth: 150 }}>
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

function ChartEmpty({ text }: { text: string }) {
  return <div style={{ border: `1px solid ${DI.line}`, padding: 40, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint }}>{text}</div>;
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
        Overlay peers (optional) · up to {MAX_LINES}
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

/** Legend for the two charts: this company (solid, brand color) vs. the
 *  peer-group average (dashed steel). */
function ChartLegend({ focalName, focalColor }: { focalName: string; focalColor: string }) {
  return (
    <div className="flex items-center" style={{ gap: 18, marginBottom: 12, flexWrap: 'wrap' }}>
      <span className="flex items-center" style={{ gap: 6 }}>
        <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={focalColor} strokeWidth="2.5" /></svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: DI.body, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{focalName}</span>
      </span>
      <span className="flex items-center" style={{ gap: 6 }}>
        <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={DI.steel} strokeWidth="2" strokeDasharray="5 4" /></svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: DI.faint }}>Peer average</span>
      </span>
    </div>
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
