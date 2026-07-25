import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, Router as WouterRouter } from 'wouter';

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
import AdminPricing from './pages/admin/pricing';
import AdminCosts from './pages/admin/costs';
import AdminModelResults from './pages/admin/model-results';
import AdminData from './pages/admin/data';
import AdminQueries from './pages/admin/queries';
import AdminUsers from './pages/admin/users';
import AdminAdmins from './pages/admin/admins';
import { Terms, Privacy } from './pages/legal';
import Alerts from './pages/alerts';
import Home from './pages/home';
import Results from './pages/results';
import AuthVerify from './pages/auth-verify';
import History from './pages/history';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

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
          <Route path="/admin/model-results" component={AdminModelResults} />
          <Route path="/admin/api-keys" component={AdminApiKeys} />
          <Route path="/admin/pricing" component={AdminPricing} />
          <Route path="/admin/costs" component={AdminCosts} />
          <Route path="/admin/queries" component={AdminQueries} />
          <Route path="/admin/users" component={AdminUsers} />
          <Route path="/admin/admins" component={AdminAdmins} />
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
      {/* Admin Google sign-in — no main layout */}
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

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
