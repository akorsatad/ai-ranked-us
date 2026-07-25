import React, { useMemo, useState } from 'react';
import { useRoute, Link } from 'wouter';
import {
  useGetCatalog,
  getGetCatalogQueryKey,
  useGetIndustryRankings,
  getGetIndustryRankingsQueryKey,
  useGetIndustryTrends,
  getGetIndustryTrendsQueryKey,
  useGetIndustryHistory,
  getGetIndustryHistoryQueryKey,
  useGetMovers,
  getGetMoversQueryKey,
} from '@workspace/api-client-react';
import { DI, brandColor } from '@/components/brand';
import { Ticker, sy, sx, niceDomain, axisTicks, CHART as CH } from '@/components/home-board';

const MAX_W = '72rem';
const DAY = 24 * 60 * 60 * 1000;
const MAX_LINES = 6;

export default function Industry() {
  const [, params] = useRoute('/industry/:id');
  const industryId = parseInt(params?.id || '0', 10);

  const { data: catalog } = useGetCatalog({ query: { queryKey: getGetCatalogQueryKey() } });
  const { data: moversData } = useGetMovers({ query: { queryKey: getGetMoversQueryKey() } });
  const [activeMetric, setActiveMetric] = useState('');
  const [showMeasured, setShowMeasured] = useState(true);
  const [showEstimate, setShowEstimate] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState<number | null>(null);
  const [hoverWk, setHoverWk] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);

  React.useEffect(() => {
    if (catalog?.metrics?.length && !activeMetric) setActiveMetric(catalog.metrics[0]!.key);
  }, [catalog, activeMetric]);

  const enabled = !!industryId && !!activeMetric;
  const { data: rankings } = useGetIndustryRankings(industryId, { metric: activeMetric }, { query: { enabled, queryKey: getGetIndustryRankingsQueryKey(industryId, { metric: activeMetric }) } });
  const { data: trends } = useGetIndustryTrends(industryId, { metric: activeMetric }, { query: { enabled, queryKey: getGetIndustryTrendsQueryKey(industryId, { metric: activeMetric }) } });
  const { data: history } = useGetIndustryHistory(industryId, { metric: activeMetric }, { query: { enabled, queryKey: getGetIndustryHistoryQueryKey(industryId, { metric: activeMetric }) } });

  const industry = catalog?.industries.find((i) => i.id === industryId);
  const metricInfo = catalog?.metrics.find((m) => m.key === activeMetric);
  const rows = rankings?.average ?? [];
  const engineCount = rankings?.byEngine.length ?? 0;

  // Which brands are plotted. Defaults to the top 5 for each metric, but any
  // brand can be swapped in/out from the ranking list (up to MAX_LINES).
  const [shown, setShown] = useState<Set<number>>(new Set());
  React.useEffect(() => {
    setShown(new Set(rows.slice(0, 5).map((r) => r.brandId)));
    // Reset the selection whenever the metric/industry data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMetric, industryId, rankings?.average?.length]);
  const shownBrands = rows.filter((r) => shown.has(r.brandId));
  const toggleShown = (brandId: number) => {
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) next.delete(brandId);
      else if (next.size < MAX_LINES) next.add(brandId);
      return next;
    });
  };

  // Scale the y-axis to the top-5 brands' measured + estimated scores so no
  // line clips below the plot floor.
  const domain = useMemo(() => {
    const scores: number[] = [];
    const estByBrand = new Map(trends?.brands.map((b) => [b.brandId, b.points]) ?? []);
    const histByBrand = new Map(history?.brands.map((b) => [b.brandId, b.points]) ?? []);
    for (const entry of shownBrands) {
      for (const p of estByBrand.get(entry.brandId) ?? []) scores.push(p.score);
      for (const p of histByBrand.get(entry.brandId) ?? []) scores.push(p.score);
    }
    return niceDomain(scores);
  }, [shownBrands, trends, history]);
  const ticks = axisTicks(domain.lo, domain.hi);

  // Build the chart series for the shown brands: dashed 13-week estimate +
  // solid measured. Each brand keeps its consistent color across the site.
  const series = useMemo(() => {
    const estByBrand = new Map(trends?.brands.map((b) => [b.brandId, b.points]) ?? []);
    const histByBrand = new Map(history?.brands.map((b) => [b.brandId, b.points]) ?? []);
    // Measured window = 13 weeks ending at the newest measured date (or now).
    let end = 0;
    for (const b of history?.brands ?? []) for (const p of b.points) end = Math.max(end, new Date(p.date).getTime());
    if (!end) end = Date.now();
    const start = end - 12 * 7 * DAY;

    return shownBrands.map((entry) => {
      const color = brandColor(entry.brandId);
      const emphasis = entry.rank === 1;
      const est = estByBrand.get(entry.brandId) ?? [];
      const estN = est.length;
      const estPoly = est.map((p, i) => `${sx(i, estN).toFixed(1)},${sy(p.score, domain.lo, domain.hi).toFixed(1)}`).join(' ');
      const hist = histByBrand.get(entry.brandId) ?? [];
      const measPts = hist.map((p) => {
        const frac = start === end ? 1 : Math.max(0, Math.min(1, (new Date(p.date).getTime() - start) / (end - start)));
        return { x: CH.x0 + frac * (CH.x1 - CH.x0), y: sy(p.score, domain.lo, domain.hi) };
      });
      const measPoly = measPts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const lastMeas = measPts[measPts.length - 1];
      const legendScore = hist[hist.length - 1]?.score ?? est[estN - 1]?.score ?? entry.score;
      // Estimate score by week index, for the hover readout table.
      const estByWeek: (number | null)[] = [];
      for (const p of est) estByWeek[p.weekIndex] = p.score;
      return { brandId: entry.brandId, name: entry.brandName, color, emphasis, estPoly, measPoly, last: lastMeas, legendScore, estByWeek };
    });
  }, [shownBrands, trends, history, domain]);

  const weekLabels = (trends?.brands?.[0]?.points ?? []).map((p) => p.weekLabel);
  const hasChart = series.some((s) => (showEstimate && s.estPoly) || (showMeasured && s.measPoly));
  const nWeeks = weekLabels.length || 13;

  const dim = (brandId: number) => selectedBrand != null && selectedBrand !== brandId;

  // Hover-to-inspect: map the cursor x to the nearest week index.
  function onChartMove(e: React.MouseEvent<SVGSVGElement>) {
    if (pinned) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 640;
    const step = nWeeks > 1 ? (CH.x1 - CH.x0) / (nWeeks - 1) : 1;
    const wk = Math.max(0, Math.min(nWeeks - 1, Math.round((vx - CH.x0) / step)));
    setHoverWk(wk);
  }
  const hoverX = hoverWk != null ? sx(hoverWk, nWeeks) : 0;
  const hoverLabel = hoverWk != null ? weekLabels[hoverWk] ?? `W${hoverWk}` : '';
  const hoverRows = hoverWk != null
    ? series
        .filter((s) => !dim(s.brandId) && s.estByWeek[hoverWk!] != null)
        .map((s) => ({ name: s.name, color: s.color, val: s.estByWeek[hoverWk!]! }))
        .sort((a, b) => b.val - a.val)
    : [];
  const hoverLeftPct = hoverWk != null ? (hoverX / 640) * 100 : 0;

  return (
    <div style={{ background: DI.paper }}>
      <Ticker movers={moversData} />
      <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '40px 24px 96px' }}>
        {/* Breadcrumb */}
        <div className="flex items-center" style={{ gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          <Link href="/explore" style={{ color: DI.body }}>← All rankings</Link>
          <span style={{ color: DI.faint }}>/</span>
          <span style={{ color: DI.ink }}>{industry?.name ?? '…'}</span>
        </div>

        {/* Title */}
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.teal }}>
            {industry?.country ?? 'US'} &middot; Industry sector
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(2.5rem,5vw,3.25rem)', lineHeight: 1.05, letterSpacing: '-0.02em', color: DI.ink, margin: '14px 0 0' }}>
            {industry?.name ?? ' '}
          </h1>
        </div>

        {/* Metric tabs */}
        <div className="flex flex-wrap" style={{ border: `1px solid ${DI.line}`, background: '#fff', marginTop: 28 }}>
          {(catalog?.metrics ?? []).map((m) => {
            const on = m.key === activeMetric;
            return (
              <button
                key={m.key}
                onClick={() => { setActiveMetric(m.key); setSelectedBrand(null); }}
                style={{ appearance: 'none', background: on ? DI.paper : 'transparent', border: 'none', borderBottom: `2px solid ${on ? DI.teal : 'transparent'}`, color: on ? DI.ink : DI.body, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '14px 16px', cursor: 'pointer' }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {metricInfo && (
          <div style={{ background: DI.surface, border: `1px solid ${DI.line}`, borderTop: 'none', padding: '13px 20px', fontSize: 13.5, color: DI.body }}>
            {metricInfo.description}
          </div>
        )}

        {/* Chart + ranking */}
        <div className="di-two-col grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 24, marginTop: 24, alignItems: 'start' }}>
          {/* Chart card */}
          <div style={{ background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', padding: '28px 24px 20px' }}>
            <div className="flex flex-wrap items-center justify-between" style={{ gap: 12, marginBottom: 16 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase', color: DI.faint }}>
                FIG. 01 &middot; {metricInfo?.label ?? ''} &middot; top 5 &middot; 13 wk
              </span>
              <span className="flex" style={{ gap: 8 }}>
                <Toggle on={showMeasured} onClick={() => setShowMeasured((v) => !v)} label="▬ Measured" />
                <Toggle on={showEstimate} onClick={() => setShowEstimate((v) => !v)} label="┄ 13W estimate" />
              </span>
            </div>

            {/* Legend chips */}
            <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 14 }}>
              {series.map((s) => {
                const active = selectedBrand === s.brandId;
                return (
                  <span
                    key={s.brandId}
                    onClick={() => setSelectedBrand(active ? null : s.brandId)}
                    className="inline-flex items-center"
                    style={{ gap: 7, padding: '5px 10px', border: `1px solid ${active ? DI.teal : DI.line}`, background: active ? 'rgba(14,168,142,0.05)' : '#fff', opacity: dim(s.brandId) ? 0.4 : 1, cursor: 'pointer', transition: 'all 0.2s' }}
                  >
                    <span style={{ width: 10, height: 10, background: s.color, display: 'inline-block' }} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: DI.ink }}>{s.name} {s.legendScore.toFixed(0)}</span>
                  </span>
                );
              })}
            </div>

            {hasChart ? (
              <div style={{ position: 'relative' }}>
                <svg
                  viewBox="0 0 640 300"
                  style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
                  onMouseMove={onChartMove}
                  onMouseLeave={() => { if (!pinned) setHoverWk(null); }}
                  onClick={() => { if (hoverWk != null) setPinned((p) => !p); }}
                >
                {ticks.map((t) => <line key={t.y} x1="0" y1={t.y} x2="530" y2={t.y} stroke={DI.line} strokeWidth="1" />)}
                {ticks.map((t) => (
                  <text key={`l${t.y}`} x="0" y={t.y - 4} fill={DI.faint} fontFamily="JetBrains Mono, monospace" fontSize="9">{t.value}</text>
                ))}
                {hoverWk != null && (
                  <line x1={hoverX} y1="16" x2={hoverX} y2="272" stroke={DI.ink} strokeWidth="1" strokeDasharray="3 3" opacity={0.5} />
                )}
                {showEstimate && series.map((s) => s.estPoly && (
                  <polyline key={`e${s.brandId}`} points={s.estPoly} fill="none" stroke={s.color} strokeWidth="1.5" strokeDasharray="5 4" opacity={dim(s.brandId) ? 0.15 : 0.75} />
                ))}
                {showMeasured && series.map((s) => s.measPoly && (
                  <polyline key={`m${s.brandId}`} points={s.measPoly} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 2.5 : 2} opacity={dim(s.brandId) ? 0.15 : 1} />
                ))}
                {/* Markers at the hovered week (estimate value). */}
                {hoverWk != null && series.map((s) =>
                  !dim(s.brandId) && s.estByWeek[hoverWk] != null ? (
                    <circle key={`h${s.brandId}`} cx={sx(hoverWk, nWeeks)} cy={sy(s.estByWeek[hoverWk]!, domain.lo, domain.hi)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />
                  ) : null,
                )}
                {showMeasured && series.map((s) => s.last && (
                  <g key={`d${s.brandId}`} opacity={dim(s.brandId) ? 0.15 : 1}>
                    <circle cx={s.last.x} cy={s.last.y} r={s.emphasis ? 4 : 3} fill={s.color} />
                    <text x={s.last.x + 6} y={s.last.y + 3} fill={s.color} fontFamily="JetBrains Mono, monospace" fontSize="11" fontWeight={s.emphasis ? 700 : 400}>{s.name}</text>
                  </g>
                ))}
                <line x1="0" y1="272" x2="530" y2="272" stroke={DI.faint} strokeWidth="1" />
                {weekLabels.length > 0 && (
                  <>
                    <text x="16" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="middle">{weekLabels[0]}</text>
                    <text x="530" y="293" fill={DI.body} fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">{weekLabels[weekLabels.length - 1]}</text>
                  </>
                )}
                </svg>

                {/* Hover / pinned readout table */}
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
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: DI.ink }}>{hoverLabel}</span>
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
              <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint, textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', padding: '0 24px' }}>
                {!showMeasured && !showEstimate ? 'Both series hidden — toggle one on' : 'No trend data yet'}
              </div>
            )}

            {hasChart && (
              <div className="flex flex-wrap items-center justify-between" style={{ gap: 8, marginTop: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.faint }}>X-axis &middot; week ending</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: pinned ? DI.teal : DI.faint }}>
                  Hover to inspect a week &middot; click to {pinned ? 'unpin' : 'pin it'}
                </span>
              </div>
            )}
            <div style={{ borderTop: `1px solid ${DI.line}`, marginTop: 16, paddingTop: 12 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>
                Brand journal &middot; {selectedBrand != null ? series.find((s) => s.brandId === selectedBrand)?.name : '—'}
              </div>
              <p style={{ fontSize: 13, color: DI.body, margin: '6px 0 0' }}>
                Solid = measured scores from completed runs. Dashed = the engines&rsquo; own 13-week lookback estimate. Select a brand from the legend to isolate its lines.
              </p>
            </div>
          </div>

          {/* Ranking card */}
          <div style={{ background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <div className="flex items-center justify-between" style={{ padding: '20px 24px', borderBottom: `1px solid ${DI.line}` }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: DI.ink, margin: 0 }}>
                {metricInfo?.label ?? ''} ranking
              </h2>
              {engineCount > 0 && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: DI.teal, border: `1px solid rgba(14,168,142,0.35)`, padding: '4px 8px' }}>Avg of {engineCount}</span>
              )}
            </div>
            {rows.length === 0 ? (
              <div style={{ padding: '32px 24px', fontFamily: 'var(--font-mono)', fontSize: 12, color: DI.faint }}>No ranking data yet.</div>
            ) : (
              rows.map((entry) => {
                const prev = (entry as { previousRank?: number | null }).previousRank ?? null;
                const wk = prev != null ? prev - entry.rank : 0;
                const up = wk > 0;
                return (
                  <div key={entry.brandId} style={{ padding: '16px 24px', borderBottom: `1px solid ${DI.line}` }}>
                    <div className="flex items-baseline justify-between" style={{ gap: 12 }}>
                      <div className="flex items-baseline" style={{ gap: 10, minWidth: 0 }}>
                        <button
                          onClick={() => toggleShown(entry.brandId)}
                          title={shown.has(entry.brandId) ? 'Hide from chart' : 'Show on chart'}
                          style={{ alignSelf: 'center', width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${brandColor(entry.brandId)}`, background: shown.has(entry.brandId) ? brandColor(entry.brandId) : 'transparent', cursor: 'pointer', flexShrink: 0, padding: 0 }}
                        />
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: DI.faint }}>{String(entry.rank).padStart(2, '0')}</span>
                        <Link href={`/brand/${entry.brandId}`} style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: DI.ink, textDecoration: 'none' }}>{entry.brandName}</Link>
                      </div>
                      <div className="flex items-baseline" style={{ gap: 10 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: wk === 0 ? DI.faint : up ? DI.teal : DI.danger }}>
                          {wk === 0 ? '—' : `${up ? '▲' : '▼'} ${Math.abs(wk)}`}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: DI.teal }}>{entry.score.toFixed(1)}</span>
                      </div>
                    </div>
                    {entry.rationale && (
                      <p style={{ fontSize: 13, lineHeight: 1.5, color: DI.body, fontStyle: 'italic', margin: '8px 0 0', paddingLeft: 28 }}>
                        &ldquo;{entry.rationale}&rdquo;
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <span
      onClick={onClick}
      style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', padding: '5px 10px', border: `1px solid ${on ? DI.teal : DI.line}`, color: on ? DI.teal : DI.faint, cursor: 'pointer', transition: 'all 0.3s', whiteSpace: 'nowrap' }}
    >
      {label}
    </span>
  );
}
