import React from 'react';
import { Redirect } from 'wouter';
import {
  useGetAdminMe,
  getGetAdminMeQueryKey,
} from '@workspace/api-client-react';
import { Loader2, ShieldX } from 'lucide-react';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
      {children}
    </div>
  );
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const me = useGetAdminMe({
    query: { queryKey: getGetAdminMeQueryKey(), retry: false },
  });

  if (me.isLoading) {
    return (
      <Centered>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Centered>
    );
  }

  if (me.isError) {
    const status = (me.error as { status?: number } | null)?.status;
    if (status === 503) {
      return (
        <Centered>
          <div className="text-center max-w-sm space-y-3">
            <ShieldX className="w-10 h-10 mx-auto text-muted-foreground" />
            <h2 className="font-bold text-lg">Admin sign-in isn&apos;t set up</h2>
            <p className="text-sm text-muted-foreground">
              This deployment has no Google OAuth credentials. Set
              {' '}<code>GOOGLE_CLIENT_ID</code> and{' '}
              <code>GOOGLE_CLIENT_SECRET</code> and redeploy to enable the
              admin console.
            </p>
          </div>
        </Centered>
      );
    }
    // 401 (or anything else) — send to the Google sign-in page.
    return <Redirect to="/sign-in" />;
  }

  if (!me.data?.isAdmin) {
    return <Redirect to="/sign-in?error=not_authorized" />;
  }

  return <>{children}</>;
}
