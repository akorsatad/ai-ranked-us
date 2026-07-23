import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ClerkProvider, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

import { Layout } from './components/layout';
import Explore from './pages/explore';
import Industry from './pages/industry';
import Runs from './pages/runs';
import { AdminLayout } from './pages/admin/layout';
import { AdminGuard } from './pages/admin/guard';
import { SignInPage, SignUpPage } from './pages/auth';
import AdminCatalog from './pages/admin/catalog';
import AdminEngines from './pages/admin/engines';
import AdminApiKeys from './pages/admin/api-keys';
import AdminCosts from './pages/admin/costs';
import AdminModelResults from './pages/admin/model-results';
import AdminData from './pages/admin/data';
import AdminQueries from './pages/admin/queries';
import { Terms, Privacy } from './pages/legal';
import Alerts from './pages/alerts';
import Home from './pages/home';
import Results from './pages/results';
import AuthVerify from './pages/auth-verify';
import History from './pages/history';

// REQUIRED — copy verbatim. Resolves the key from window.location.hostname so the
// same build serves multiple Clerk custom domains.
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// REQUIRED — empty in dev (Clerk hits dev FAPI directly), auto-set in prod.
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

// Clerk passes full paths to routerPush/routerReplace, but wouter's
// setLocation prepends the base — strip it to avoid doubling.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(225 85% 55%)',
    colorForeground: 'hsl(220 35% 15%)',
    colorMutedForeground: 'hsl(220 15% 45%)',
    colorDanger: 'hsl(345 80% 55%)',
    colorBackground: 'hsl(0 0% 100%)',
    colorInput: 'hsl(0 0% 100%)',
    colorInputForeground: 'hsl(220 35% 15%)',
    colorNeutral: 'hsl(220 35% 15%)',
    fontFamily: "'Outfit', sans-serif",
    borderRadius: '0.5rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-md border border-[hsl(40_15%_92%)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[hsl(220_35%_15%)] font-bold',
    headerSubtitle: 'text-[hsl(220_15%_45%)]',
    socialButtonsBlockButtonText: 'text-[hsl(220_35%_15%)]',
    formFieldLabel: 'text-[hsl(220_35%_15%)]',
    footerActionLink: 'text-[hsl(225_85%_55%)] hover:text-[hsl(225_85%_45%)]',
    footerActionText: 'text-[hsl(220_15%_45%)]',
    dividerText: 'text-[hsl(220_15%_45%)]',
    identityPreviewEditButton: 'text-[hsl(225_85%_55%)]',
    formFieldSuccessText: 'text-[hsl(220_15%_45%)]',
    alertText: 'text-[hsl(220_35%_15%)]',
    logoBox: 'justify-center',
    logoImage: 'h-8',
    socialButtonsBlockButton: 'border-[hsl(40_10%_88%)] hover:bg-[hsl(40_15%_95%)]',
    formButtonPrimary: 'bg-[hsl(225_85%_55%)] hover:bg-[hsl(225_85%_48%)] text-white',
    formFieldInput: 'bg-white border-[hsl(40_10%_85%)] text-[hsl(220_35%_15%)]',
    footerAction: 'justify-center',
    dividerLine: 'bg-[hsl(40_10%_88%)]',
    alert: 'border-[hsl(345_80%_55%)]',
    otpCodeFieldInput: 'border-[hsl(40_10%_85%)] text-[hsl(220_35%_15%)]',
    formFieldRow: 'gap-2',
    main: 'gap-6',
  },
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Helps the webview stay up-to-date when the signed-in user changes.
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function AdminRoutes() {
  return (
<AdminGuard>
      <AdminLayout>
        <Switch>
          <Route path="/admin">
            <Redirect to="/admin/runs" />
          </Route>
          <Route path="/admin/runs" component={Runs} />
          <Route path="/admin/catalog" component={AdminCatalog} />
          <Route path="/admin/engines" component={AdminEngines} />
          <Route path="/admin/costs" component={AdminCosts} />
          <Route path="/admin/model-results" component={AdminModelResults} />
          <Route path="/admin/api-keys" component={AdminApiKeys} />
          <Route path="/admin/queries" component={AdminQueries} />
          <Route path="/admin/data" component={AdminData} />
          <Route component={NotFound} />
        </Switch>
      </AdminLayout>
    </AdminGuard>
  );
}

function Router() {
  return (
    <Switch>
      {/* Clerk auth pages — no main layout */}
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />

      {/* Magic-link verify — no layout chrome needed */}
      <Route path="/auth/verify" component={AuthVerify} />

      {/* Admin section — uses AdminGuard + AdminLayout */}
      <Route path="/admin/*?" component={AdminRoutes} />

      {/* All other routes use the shared layout */}
      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/explore" component={Explore} />
            <Route path="/industry/:id" component={Industry} />
            <Route path="/runs">
              <Redirect to="/admin/runs" />
            </Route>
            <Route path="/alerts" component={Alerts} />
            <Route path="/results/:id" component={Results} />
            <Route path="/history" component={History} />
            <Route path="/terms" component={Terms} />
            <Route path="/privacy" component={Privacy} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: 'Admin sign in',
            subtitle: 'Sign in to manage AI Rank',
          },
        },
        signUp: {
          start: {
            title: 'Create your account',
            subtitle: 'Set up admin access for AI Rank',
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
