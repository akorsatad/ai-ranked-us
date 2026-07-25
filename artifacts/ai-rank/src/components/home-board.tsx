import React, { useEffect, useMemo, useState } from 'react';
import {
  useGetCatalog,
  getGetCatalogQueryKey,
  useGetIndustryRankings,
  getGetIndustryRankingsQueryKey,
  useGetIndustryTrends,
  getGetIndustryTrendsQueryKey,
  MoversReport,
} from '@workspace/api-client-react';
import { DI } from './brand';

const SERIES_COLORS = [DI.teal, DI.ink, DI.warn, DI.danger, DI.steel];
const BOARD_METRIC = 'positive_sentiment';

/* ── Scrolling brand ticker ──────────────────────────────────────── */

export function Ticker({ movers }: { movers: MoversReport | undefined }) {
  const items = (movers?.movers ?? []).map((m) => ({
    name: m.brandName,
    score: m.currentScore,
    delta: m.rankDelta !== 0 ? m.rankDelta : m.scoreDelta,
    up: m.rankDelta > 0 || (m.rankDelta === 0 && m.scoreDelta > 0),
    flat: m.rankDelta === 0 && m.scoreDelta === 0,
  }));
  if (items.length === 0) return null;
  // Duplicate the list so the -50% translate loops seamlessly.
  const loop = [...items, ...items];

  return (
    <div style={{ borderBottom: `1px solid ${DI.line}`, background: '#fff', overflow: 'hidden' }}>
      <div className="di-ticker-track" style={{ padding: '9px 0' }}>
        {loop.map((it, i) => (
          <span key={i} className="flex items-center" style={{ padding: '0 20px', borderRight: `1px solid ${DI.line}` }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: DI.ink, fontWeight: 500 }}>
              {it.name}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.body, marginLeft: 8 }}>
              {it.score.toFixed(1)}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginLeft: 6, color: it.flat ? DI.faint : it.up ? DI.teal : DI.danger }}>
              {it.flat ? '▪' : it.up ? '▲' : '▼'}{Math.abs(it.delta).toFixed(1)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Sticky section rail with scroll-spy ─────────────────────────── */

const RAIL_SECTIONS = [
  { id: 'board', num: '01', name: 'Rankings' },
  { id: 'industries', num: '02', name: 'Industries' },
  { id: 'rank-form', num: '03', name: 'Rank a brand' },
  { id: 'methodology', num: '04', name: 'Methodology' },
  { id: 'pricing', num: '05', name: 'Pricing' },
  { id: 'cite', num: '06', name: 'Cite' },
];

export function SideRail() {
  const [active, setActive] = useState('board');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const s of RAIL_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="di-rail"
      style={{ position: 'fixed', left: 26, top: '50%', transform: 'translateY(-50%)', zIndex: 40, flexDirection: 'column', gap: 16 }}
    >
      {RAIL_SECTIONS.map((s) => {
        const on = active === s.id;
        return (
          <button
            key={s.id}
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center"
            style={{ gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: on ? DI.teal : DI.faint }}>{s.num}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: on ? DI.ink : DI.faint, transition: 'color 0.3s' }}>{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Live index board: tabs + FIG.01 chart + ranked list ─────────── */

export const CHART = { x0: 16, x1: 530, yTop: 16, yBot: 272 };
export function sy(score: number, lo: number, hi: number): number {
  const span = hi - lo || 1;
  const t = (score - lo) / span;
  return CHART.yBot - t * (CHART.yBot - CHART.yTop);
}
export function sx(i: number, n: number): number {
  if (n <= 1) return CHART.x0;
  return CHART.x0 + (i * (CHART.x1 - CHART.x0)) / (n - 1);
}

/**
 * A y-axis domain that fits the data: padded min/max snapped to 5s, clamped
 * to [0,100], with a floor on the range so tiny spreads stay readable.
 */
export function niceDomain(scores: number[]): { lo: number; hi: number } {
  const vals = scores.filter((s) => Number.isFinite(s));
  if (vals.length === 0) return { lo: 40, hi: 100 };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = Math.max(4, (max - min) * 0.12);
  let lo = Math.max(0, Math.floor((min - pad) / 5) * 5);
  let hi = Math.min(100, Math.ceil((max + pad) / 5) * 5);
  if (hi - lo < 15) {
    hi = Math.min(100, lo + 15);
    lo = Math.max(0, hi - 15);
  }
  return { lo, hi };
}

/** Four evenly-spaced axis ticks (value + y) for a domain. */
export function axisTicks(lo: number, hi: number): { value: number; y: number }[] {
  return [0, 1, 2, 3].map((i) => {
    const value = hi - (i * (hi - lo)) / 3;
    return { value: Math.round(value), y: sy(value, lo, hi) };
  });
}

export function LiveIndexBoard({ onOpenIndustry }: { onOpenIndustry: (id: number) => void }) {
  const { data: catalog } = useGetCatalog({ query: { queryKey: getGetCatalogQueryKey() } });
  const industries = catalog?.industries ?? [];
  const [industryId, setIndustryId] = useState<number | null>(null);
  const [ddOpen, setDdOpen] = useState(false);
  const [hoverWk, setHoverWk] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  // Default to the first industry once the catalog loads.
  useEffect(() => {
    if (industryId == null && industries.length > 0) setIndustryId(industries[0]!.id);
  }, [industries, industryId]);

  // Clear the chart readout when the selected industry changes.
  useEffect(() => {
    setHoverWk(null);
    setPinned(false);
  }, [industryId]);

  const active = industries.find((i) => i.id === industryId) ?? null;

  const { data: rankings } = useGetIndustryRankings(
    industryId ?? 0,
    { metric: BOARD_METRIC },
    { query: { queryKey: getGetIndustryRankingsQueryKey(industryId ?? 0, { metric: BOARD_METRIC }), enabled: industryId != null } },
  );
  const { data: trends } = useGetIndustryTrends(
    industryId ?? 0,
    { metric: BOARD_METRIC },
    { query: { queryKey: getGetIndustryTrendsQueryKey(industryId ?? 0, { metric: BOARD_METRIC }), enabled: industryId != null } },
  );

  const rows = (rankings?.average ?? []).slice(0, 8);
  const top5 = rows.slice(0, 5);
  const trendByBrand = useMemo(() => {
    const m = new Map<number, { name: string; points: { i: number; score: number }[] }>();
    for (const b of trends?.brands ?? []) {
      m.set(b.brandId, { name: b.brandName, points: b.points.map((p) => ({ i: p.weekIndex, score: p.score })) });
    }
    return m;
  }, [trends]);

  const weekLabels = (trends?.brands?.[0]?.points ?? []).map((p) => p.weekLabel);
  const nWeeks = weekLabels.length || 13;

  // Scale the y-axis to the top-5 brands' actual scores so no line clips.
  const domain = useMemo(() => {
    const scores: number[] = [];
    for (const entry of top5) for (const p of trendByBrand.get(entry.brandId)?.points ?? []) scores.push(p.score);
    return niceDomain(scores);
  }, [top5, trendByBrand]);
  const ticks = axisTicks(domain.lo, domain.hi);

  const series = top5.map((entry, idx) => {
    const t = trendByBrand.get(entry.brandId);
    const pts = t?.points ?? [];
    const poly = pts.map((p) => `${sx(p.i, nWeeks).toFixed(1)},${sy(p.score, domain.lo, domain.hi).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const scores: (number | null)[] = [];
    for (const p of pts) scores[p.i] = p.score;
    return {
      brandId: entry.brandId,
      name: entry.brandName,
      color: SERIES_COLORS[idx % SERIES_COLORS.length]!,
      poly,
      scores,
      lx: last ? sx(last.i, nWeeks) : null,
      ly: last ? sy(last.score, domain.lo, domain.hi) : null,
    };
  });

  const tabIndustries = industries.slice(0, 3);
  const firstWk = weekLabels[0] ?? '';
  const lastWk = weekLabels[weekLabels.length - 1] ?? '';

  function onChartMove(e: React.MouseEvent<SVGSVGElement>) {
    if (pinned) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 640;
    const step = nWeeks > 1 ? (CHART.x1 - CHART.x0) / (nWeeks - 1) : 1;
    setHoverWk(Math.max(0, Math.min(nWeeks - 1, Math.round((vx - CHART.x0) / step))));
  }
  const hoverX = hoverWk != null ? sx(hoverWk, nWeeks) : 0;
  const hoverRows = hoverWk != null
    ? series.filter((s) => s.scores[hoverWk!] != null).map((s) => ({ name: s.name, color: s.color, val: s.scores[hoverWk!]! })).sort((a, b) => b.val - a.val)
    : [];
  const hoverLeftPct = hoverWk != null ? (hoverX / 640) * 100 : 0;

  const tabBtn = (on: boolean): React.CSSProperties => ({
    appearance: 'none',
    background: on ? DI.paper : 'transparent',
    border: 'none',
    borderBottom: `2px solid ${on ? DI.teal : 'transparent'}`,
    color: on ? DI.ink : DI.body,
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    padding: '16px 18px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
      <div style={{ height: 4, background: `linear-gradient(90deg, ${DI.teal}, ${DI.tealLight})` }} />
      {/* Tab bar */}
      <div className="flex items-center justify-between" style={{ borderBottom: `1px solid ${DI.line}`, padding: '0 20px', flexWrap: 'wrap' }}>
        <div className="flex" style={{ alignItems: 'stretch' }}>
          {tabIndustries.map((ind) => (
            <button key={ind.id} onClick={() => setIndustryId(ind.id)} style={tabBtn(ind.id === industryId)}>
              {ind.name}
            </button>
          ))}
          <div className="relative">
            <button
              onClick={() => setDdOpen((v) => !v)}
              style={{ appearance: 'none', background: 'transparent', border: 'none', borderLeft: `1px solid ${DI.line}`, color: DI.body, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '16px 18px', cursor: 'pointer', height: '100%' }}
            >
              All industries ↓
            </button>
            {ddOpen && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 55 }} onClick={() => setDdOpen(false)} />
                <div className="grid" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 60, background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 4px 6px rgba(0,0,0,0.07)', minWidth: 320, gridTemplateColumns: '1fr 1fr' }}>
                  {industries.map((ind) => (
                    <div
                      key={ind.id}
                      onClick={() => { setIndustryId(ind.id); setDdOpen(false); }}
                      style={{ padding: '11px 16px', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: ind.id === industryId ? DI.teal : DI.body, cursor: 'pointer', borderBottom: `1px solid ${DI.line}` }}
                    >
                      {ind.name}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <span className="flex items-center" style={{ gap: 8, paddingRight: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 9999, background: DI.teal, display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', color: DI.body }}>LIVE INDEX</span>
        </span>
      </div>

      {/* Chart + list */}
      <div className="di-board-grid grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        <div style={{ padding: '28px 8px 20px 24px', borderRight: `1px solid ${DI.line}` }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint, marginBottom: 16 }}>
            FIG. 01 &middot; AI consensus score &middot; top 5 &middot; 13 wk &middot; {active?.name ?? ''}
          </div>
          {series.some((s) => s.poly) ? (
            <div style={{ position: 'relative' }}>
              <svg
                viewBox="0 0 640 300"
                style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
                onMouseMove={onChartMove}
                onMouseLeave={() => { if (!pinned) setHoverWk(null); }}
                onClick={() => { if (hoverWk != null) setPinned((p) => !p); }}
              >
              {ticks.map((t) => (
                <line key={t.y} x1="0" y1={t.y} x2="530" y2={t.y} stroke={DI.line} strokeWidth="1" />
              ))}
              {ticks.map((t) => (
                <text key={`l${t.y}`} x="0" y={t.y - 4} fill={DI.faint} fontFamily="JetBrains Mono, monospace" fontSize="9">{t.value}</text>
              ))}
              {hoverWk != null && (
                <line x1={hoverX} y1="16" x2={hoverX} y2="272" stroke={DI.ink} strokeWidth="1" strokeDasharray="3 3" opacity={0.5} />
              )}
              {series.map((s) =>
                s.poly ? <polyline key={s.brandId} points={s.poly} fill="none" stroke={s.color} strokeWidth={s.color === DI.teal ? 2.5 : 2} /> : null,
              )}
              {hoverWk != null && series.map((s) =>
                s.scores[hoverWk] != null ? (
                  <circle key={`h${s.brandId}`} cx={sx(hoverWk, nWeeks)} cy={sy(s.scores[hoverWk]!, domain.lo, domain.hi)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />
                ) : null,
              )}
              {series.map((s) =>
                s.lx != null && s.ly != null ? (
                  <g key={`d${s.brandId}`}>
                    <circle cx={s.lx} cy={s.ly} r={s.color === DI.teal ? 4 : 3} fill={s.color} />
                    <text x={s.lx + 6} y={s.ly + 3} fill={s.color} fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight={s.color === DI.teal ? 700 : 400}>{s.name}</text>
                  </g>
                ) : null,
              )}
              <line x1="0" y1="272" x2="530" y2="272" stroke={DI.faint} strokeWidth="1" />
              <text x="16" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="middle">{firstWk}</text>
              <text x="530" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">{lastWk}</text>
              </svg>
              {hoverWk != null && hoverRows.length > 0 && (
                <div
                  style={{
                    position: 'absolute',
                    top: '8%',
                    left: `${hoverLeftPct}%`,
                    transform: hoverLeftPct > 60 ? 'translateX(-105%)' : 'translateX(12px)',
                    background: '#fff',
                    border: `1px solid ${DI.line}`,
                    boxShadow: '0 4px 6px rgba(0,0,0,0.10)',
                    padding: '10px 12px',
                    minWidth: 150,
                    pointerEvents: 'none',
                    zIndex: 5,
                  }}
                >
                  <div className="flex items-baseline justify-between" style={{ gap: 12, marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: DI.ink }}>{weekLabels[hoverWk] ?? `W${hoverWk}`}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.12em', color: DI.faint }}>{pinned ? 'PINNED' : '13W EST'}</span>
                  </div>
                  {hoverRows.map((r) => (
                    <div key={r.name} className="flex items-center" style={{ gap: 8, padding: '2.5px 0' }}>
                      <span style={{ width: 8, height: 8, background: r.color, display: 'inline-block' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DI.body, flex: 1, whiteSpace: 'nowrap' }}>{r.name}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: DI.ink }}>{r.val.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              No trend data yet
            </div>
          )}
        </div>

        <div>
          <div className="grid" style={{ gridTemplateColumns: '34px 52px 1fr 48px', gap: 8, alignItems: 'center', padding: '12px 20px', borderBottom: `1px solid ${DI.line}`, fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint }}>
            <span>RK</span><span>WK Δ</span><span>Brand</span><span style={{ textAlign: 'right' }}>Score</span>
          </div>
          {rows.length === 0 ? (
            <div style={{ padding: '24px 20px', fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint }}>No ranking data yet.</div>
          ) : (
            rows.map((r) => {
              const prev = (r as { previousRank?: number | null }).previousRank ?? null;
              const wk = prev != null ? prev - r.rank : 0;
              const up = wk > 0;
              return (
                <div
                  key={r.brandId}
                  onClick={() => industryId != null && onOpenIndustry(industryId)}
                  className="grid"
                  style={{ gridTemplateColumns: '34px 52px 1fr 48px', gap: 8, alignItems: 'center', padding: '11px 20px', borderBottom: `1px solid ${DI.line}`, cursor: 'pointer' }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: DI.ink, fontWeight: 700 }}>{String(r.rank).padStart(2, '0')}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: wk === 0 ? DI.faint : up ? DI.teal : DI.danger }}>
                    {wk === 0 ? '—' : `${up ? '▲' : '▼'} ${Math.abs(wk)}`}
                  </span>
                  <span className="flex flex-col" style={{ gap: 4, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: DI.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.brandName}</span>
                    <span style={{ display: 'block', height: 3, background: DI.surface }}>
                      <span style={{ display: 'block', height: 3, background: DI.teal, width: `${Math.max(0, Math.min(100, r.score))}%` }} />
                    </span>
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: DI.ink, textAlign: 'right' }}>{r.score.toFixed(1)}</span>
                </div>
              );
            })
          )}
          <div className="flex items-center justify-between" style={{ padding: '12px 20px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>Click a brand for the readout →</span>
            {industryId != null && (
              <span onClick={() => onOpenIndustry(industryId)} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.teal, cursor: 'pointer' }}>
                Full analysis →
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
