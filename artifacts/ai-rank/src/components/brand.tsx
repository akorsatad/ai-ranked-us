import React from 'react';

/**
 * DataInc.ai brand primitives — a faithful port of the design-system
 * components used across the public "AI Ranked US" pages. Square corners,
 * Barlow display / JetBrains Mono labels, teal (#0EA88E) accent.
 */

export const DI = {
  teal: '#0EA88E',
  tealLight: '#5BD0B4',
  ink: '#0B0F19',
  paper: '#FCFCFB',
  surface: '#F4F6F5',
  line: '#E6E9E8',
  steel: '#8A93A0',
  body: '#4B5563',
  faint: '#9CA3AF',
  danger: '#E5484D',
  warn: '#D97706',
} as const;

/**
 * A distinct, reasonably color-blind-friendly palette for per-brand series.
 * Teal (the brand accent) leads so the top brand reads as "ours". Colors are
 * assigned deterministically by brand id via `brandColor`, so a brand keeps the
 * same color across every chart and list on the site.
 */
export const BRAND_PALETTE = [
  '#0EA88E', // teal
  '#2563EB', // blue
  '#D97706', // amber
  '#7C3AED', // violet
  '#DB2777', // pink
  '#0891B2', // cyan
  '#65A30D', // lime
  '#E5484D', // red
  '#4F46E5', // indigo
  '#CA8A04', // gold
  '#0D9488', // deep teal
  '#9333EA', // purple
] as const;

/** Deterministic, stable color for a brand id — consistent across all charts. */
export function brandColor(brandId: number): string {
  const idx = ((brandId % BRAND_PALETTE.length) + BRAND_PALETTE.length) % BRAND_PALETTE.length;
  return BRAND_PALETTE[idx]!;
}

/** Black square glyph "A¹" + AI RANKED.US wordmark. */
export function Logo({ size = 32 }: { size?: number }) {
  const glyph = Math.round(size * 0.56);
  const sup = Math.round(size * 0.28);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: size,
          height: size,
          background: DI.ink,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: glyph, color: '#fff', lineHeight: 1 }}>A</span>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: sup, color: DI.teal, lineHeight: 1, transform: 'translateY(-30%)' }}>1</span>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: Math.round(size / 2), letterSpacing: '0.28em', color: DI.ink, whiteSpace: 'nowrap' }}>
        AI&nbsp;RANKED<span style={{ color: DI.teal }}>.US</span>
      </div>
    </div>
  );
}

export function Eyebrow({
  children,
  color = 'primary',
  size = 10,
  className,
}: {
  children: React.ReactNode;
  color?: 'primary' | 'muted' | 'faint';
  size?: number;
  className?: string;
}) {
  const col = color === 'primary' ? DI.teal : color === 'muted' ? DI.body : DI.faint;
  return (
    <div
      className={className}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: size,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: col,
      }}
    >
      {children}
    </div>
  );
}

/** Numbered section heading: teal rule + mono index, Barlow title. */
export function SectionHeading({
  number,
  title,
  align = 'left',
}: {
  number: string;
  title: React.ReactNode;
  align?: 'left' | 'center';
}) {
  const center = align === 'center';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', textAlign: center ? 'center' : 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{ height: 1, width: 32, background: 'rgba(14,168,142,0.5)' }} />
        <span style={{ fontFamily: 'var(--font-mono)', color: DI.teal, fontSize: 14, letterSpacing: '0.2em' }}>{number}</span>
      </div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'clamp(2rem,4vw,3rem)', lineHeight: 1.05, letterSpacing: '-0.02em', color: DI.ink, margin: 0 }}>
        {title}
      </h2>
    </div>
  );
}

/** Barlow uppercase button — primary (teal→ink hover) or ghost. */
export function BrandButton({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  href,
  type = 'button',
  disabled,
  fullWidth,
  className,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
  onClick?: () => void;
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  fullWidth?: boolean;
  className?: string;
}) {
  const [hover, setHover] = React.useState(false);
  const pad = size === 'sm' ? '10px 20px' : '14px 24px';
  const base: React.CSSProperties = {
    display: fullWidth ? 'flex' : 'inline-flex',
    width: fullWidth ? '100%' : undefined,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'var(--font-display)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontSize: size === 'sm' ? 12 : 14,
    fontWeight: 700,
    padding: pad,
    borderRadius: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 300ms cubic-bezier(0.4,0,0.2,1)',
    opacity: disabled ? 0.6 : 1,
  };
  const active = hover && !disabled;
  const variantStyle: React.CSSProperties =
    variant === 'primary'
      ? active
        ? { background: DI.ink, color: '#fff', borderColor: DI.ink }
        : { background: DI.teal, color: '#fff', borderColor: DI.teal }
      : active
        ? { background: DI.ink, color: '#fff', borderColor: DI.ink }
        : { background: 'transparent', color: DI.ink, borderColor: DI.line };
  const style = { ...base, ...variantStyle };
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  };
  if (href) {
    return (
      <a href={href} className={className} style={style} {...handlers}>
        {children}
      </a>
    );
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={className} style={style} {...handlers}>
      {children}
    </button>
  );
}

/** Mono field label (uppercase, wide tracking). */
export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.2em',
        color: DI.body,
        marginBottom: 8,
      }}
    >
      {children}
    </label>
  );
}

/** Bordered card with teal "+" register marks in each corner. */
export function CornerCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  const mark = (pos: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: DI.teal,
    ...pos,
  });
  return (
    <div style={{ position: 'relative', border: `1px solid ${DI.line}`, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', ...style }}>
      <span style={mark({ top: -8, left: -5 })}>+</span>
      <span style={mark({ top: -8, right: -5 })}>+</span>
      <span style={mark({ bottom: -9, left: -5 })}>+</span>
      <span style={mark({ bottom: -9, right: -5 })}>+</span>
      {children}
    </div>
  );
}
