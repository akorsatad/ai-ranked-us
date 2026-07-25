import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  useVerifyMagicLink,
  useRunAdHocRank,
  getGetMeQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DI, Logo } from '@/components/brand';
import { PENDING_RANK_KEY } from './home';

type Phase = 'verifying' | 'starting' | 'done' | 'error';

export default function AuthVerify() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const ranOnce = useRef(false);
  const [phase, setPhase] = useState<Phase>('verifying');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const runRank = useRunAdHocRank({
    mutation: {
      onSuccess: (data: { id: number }) => {
        try { localStorage.removeItem(PENDING_RANK_KEY); } catch { /* ignore */ }
        setPhase('done');
        setLocation(`/results/${data.id}`);
      },
      onError: () => {
        // Verified, but the run couldn't start — send them home to retry.
        try { localStorage.removeItem(PENDING_RANK_KEY); } catch { /* ignore */ }
        setPhase('done');
        setLocation('/');
      },
    },
  });

  const verify = useVerifyMagicLink({
    mutation: {
      onSuccess: (user) => {
        queryClient.setQueryData(getGetMeQueryKey(), user);
        // If a ranking was queued before account setup, kick it off now.
        let pending: { brand: string; competitors: string[]; country: string } | null = null;
        try {
          const raw = localStorage.getItem(PENDING_RANK_KEY);
          if (raw) pending = JSON.parse(raw);
        } catch { /* ignore */ }
        if (pending && pending.brand && Array.isArray(pending.competitors)) {
          setPhase('starting');
          runRank.mutate({ data: pending });
        } else {
          setPhase('done');
          setTimeout(() => setLocation('/'), 1200);
        }
      },
      onError: (error: unknown) => {
        setPhase('error');
        setErrorMessage(
          (error as { data?: { message?: string } }).data?.message ??
            'This link is invalid or has expired.',
        );
      },
    },
  });

  useEffect(() => {
    if (token && !ranOnce.current) {
      ranOnce.current = true;
      verify.mutate({ data: { token } });
    }
  }, [token, verify]);

  return (
    <div style={{ minHeight: '100vh', background: DI.paper }} className="flex items-center justify-center p-6">
      <div className="text-center" style={{ maxWidth: 420 }}>
        <div className="flex justify-center" style={{ marginBottom: 24 }}>
          <Logo size={32} />
        </div>
        <div className="flex justify-center" style={{ marginBottom: 20 }}>
          {(phase === 'verifying' || phase === 'starting') && <Loader2 className="w-9 h-9 animate-spin" style={{ color: DI.teal }} />}
          {phase === 'done' && <CheckCircle className="w-9 h-9" style={{ color: DI.teal }} />}
          {phase === 'error' && <XCircle className="w-9 h-9" style={{ color: DI.danger }} />}
        </div>

        {phase === 'verifying' && (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: DI.ink, margin: 0 }}>Confirming your email…</h1>
            <p style={{ fontSize: 14, color: DI.body, marginTop: 8 }}>Verifying your link, one moment.</p>
          </>
        )}
        {phase === 'starting' && (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: DI.ink, margin: 0 }}>Starting your ranking…</h1>
            <p style={{ fontSize: 14, color: DI.body, marginTop: 8 }}>Your account is confirmed. Kicking off the survey and taking you to your results.</p>
          </>
        )}
        {phase === 'done' && (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: DI.ink, margin: 0 }}>You&rsquo;re all set</h1>
            <p style={{ fontSize: 14, color: DI.body, marginTop: 8 }}>Redirecting…</p>
          </>
        )}
        {(phase === 'error' || !token) && (
          <>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: DI.ink, margin: 0 }}>Link expired</h1>
            <p style={{ fontSize: 14, color: DI.body, margin: '8px 0 20px' }}>{errorMessage ?? 'No token found in this link.'}</p>
            <Button onClick={() => setLocation('/')}>Back to home</Button>
          </>
        )}
      </div>
    </div>
  );
}
