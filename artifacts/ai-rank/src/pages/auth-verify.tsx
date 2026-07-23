import React, { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useVerifyMagicLink } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetMeQueryKey } from '@workspace/api-client-react';
import { Loader2, CheckCircle, XCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AuthVerify() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const ranOnce = useRef(false);

  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  const { mutate, isPending, isSuccess, isError, error } = useVerifyMagicLink({
    mutation: {
      onSuccess: (user) => {
        queryClient.setQueryData(getGetMeQueryKey(), user);
        setTimeout(() => setLocation('/'), 2000);
      },
    },
  });

  useEffect(() => {
    if (token && !ranOnce.current) {
      ranOnce.current = true;
      mutate({ data: { token } });
    }
  }, [token, mutate]);

  const errorMessage = isError
    ? ((error as { data?: { message?: string } }).data?.message ??
        'This link is invalid or has expired.')
    : null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="bg-primary/10 rounded-full p-4">
            {isPending && <Loader2 className="w-10 h-10 text-primary animate-spin" />}
            {isSuccess && <CheckCircle className="w-10 h-10 text-green-500" />}
            {isError && <XCircle className="w-10 h-10 text-destructive" />}
            {!isPending && !isSuccess && !isError && (
              <Zap className="w-10 h-10 text-primary" />
            )}
          </div>
        </div>

        {isPending && (
          <>
            <h1 className="text-xl font-bold text-foreground mb-2">Signing you in…</h1>
            <p className="text-muted-foreground text-sm">Verifying your link, just a moment.</p>
          </>
        )}

        {isSuccess && (
          <>
            <h1 className="text-xl font-bold text-foreground mb-2">You're signed in!</h1>
            <p className="text-muted-foreground text-sm">Redirecting you to AI Rank…</p>
          </>
        )}

        {isError && (
          <>
            <h1 className="text-xl font-bold text-foreground mb-2">Link expired</h1>
            <p className="text-muted-foreground text-sm mb-6">{errorMessage}</p>
            <Button onClick={() => setLocation('/')}>Back to home</Button>
          </>
        )}

        {!token && (
          <>
            <h1 className="text-xl font-bold text-foreground mb-2">Invalid link</h1>
            <p className="text-muted-foreground text-sm mb-6">No token found in this URL.</p>
            <Button onClick={() => setLocation('/')}>Back to home</Button>
          </>
        )}
      </div>
    </div>
  );
}
