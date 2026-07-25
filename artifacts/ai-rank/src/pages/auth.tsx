import { useSearch, Link } from 'wouter';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

const ERROR_MESSAGES: Record<string, string> = {
  not_authorized:
    'This Google account does not have admin access. Ask an existing admin to invite your email.',
  google_denied: 'Google sign-in was cancelled.',
  invalid_state: 'The sign-in attempt expired or was invalid. Please try again.',
  invalid_token: 'Google returned an invalid response. Please try again.',
  exchange_failed: 'Could not complete sign-in with Google. Please try again.',
  not_configured:
    'Google sign-in is not configured on this deployment (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).',
};

function GoogleMark() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29A7.22 7.22 0 0 1 4.9 12c0-.79.14-1.57.38-2.29v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4.01-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.61l4.01 3.1C6.22 6.87 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

export function SignInPage() {
  const search = useSearch();
  const error = new URLSearchParams(search).get('error');
  const errorMessage = error
    ? (ERROR_MESSAGES[error] ?? 'Sign-in failed. Please try again.')
    : null;

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center bg-background px-4 py-10">
      <Card className="w-[420px] max-w-full border-border">
        <CardHeader className="text-center">
          <ShieldCheck className="w-8 h-8 mx-auto text-primary mb-2" />
          <CardTitle className="text-xl">Admin sign in</CardTitle>
          <CardDescription>
            Sign in with your Google account to manage AI Rank.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              data-testid="text-signin-error"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
          <a
            href="/api/auth/google/start"
            className="flex w-full items-center justify-center gap-3 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
            data-testid="button-google-signin"
          >
            <GoogleMark />
            Continue with Google
          </a>
          <p className="text-center text-xs text-muted-foreground">
            Only invited admin accounts can access the console.{' '}
            <Link href="/" className="underline">
              Back to home
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function SignUpPage() {
  // Admin accounts are created by invitation — sign-up is the same Google flow.
  return <SignInPage />;
}
