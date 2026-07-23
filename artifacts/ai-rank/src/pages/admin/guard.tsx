import React from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { Redirect } from 'wouter';
import { useGetAdminMe, getGetAdminMeQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ShieldX, Loader2 } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4">
      {children}
    </div>
  );
}

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const me = useGetAdminMe({
    query: {
      queryKey: getGetAdminMeQueryKey(),
      enabled: isLoaded && !!isSignedIn,
    },
  });

  if (!isLoaded || (isSignedIn && me.isLoading)) {
    return (
      <Centered>
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </Centered>
    );
  }

  if (!isSignedIn) {
    return <Redirect to="/sign-in" />;
  }

  if (me.isError || !me.data?.isAdmin) {
    return (
      <Centered>
        <div className="text-center max-w-sm space-y-3">
          <ShieldX className="w-10 h-10 mx-auto text-destructive" />
          <h2 className="font-bold text-lg">Admin access required</h2>
          <p className="text-sm text-muted-foreground">
            Your account doesn&apos;t have access to the admin console. Sign in
            with the admin account to manage settings.
          </p>
          <Button
            variant="outline"
            onClick={() => signOut({ redirectUrl: basePath || '/' })}
          >
            Sign out
          </Button>
        </div>
      </Centered>
    );
  }

  return <>{children}</>;
}
