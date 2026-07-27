import React from 'react';
import { RankForm } from '@/components/rank-form';
import { DI, Eyebrow } from '@/components/brand';

const MAX_W = '46rem';

export default function RankPage() {
  return (
    <div style={{ background: DI.paper, minHeight: '78vh' }}>
      <div className="mx-auto" style={{ maxWidth: MAX_W, padding: '56px 24px 96px' }}>
        <Eyebrow color="faint" size={11}>Rank your brand</Eyebrow>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(2rem,5vw,2.75rem)', letterSpacing: '-0.025em', color: DI.ink, margin: '10px 0 12px' }}>
          Run a new ranking
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.625, color: DI.body, margin: '0 0 32px', maxWidth: '38rem' }}>
          Enter your brand and up to eight competitors, pick your market, and we&rsquo;ll score them across seven perception metrics against ChatGPT, Claude, Gemini, and Grok. Results land on your own private page.
        </p>
        <RankForm />
      </div>
    </div>
  );
}
