import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, Router as WouterRouter } from 'wouter';

import { Layout } from './components/layout';
import Dashboard from './pages/dashboard';
import Industry from './pages/industry';
import Runs from './pages/runs';
import { AdminLayout } from './pages/admin/layout';
import AdminCatalog from './pages/admin/catalog';
import AdminEngines from './pages/admin/engines';
import AdminApiKeys from './pages/admin/api-keys';
import AdminData from './pages/admin/data';
import { Terms, Privacy } from './pages/legal';
import Alerts from './pages/alerts';

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
    <AdminLayout>
      <Switch>
        <Route path="/admin">
          <Redirect to="/admin/runs" />
        </Route>
        <Route path="/admin/runs" component={Runs} />
        <Route path="/admin/catalog" component={AdminCatalog} />
        <Route path="/admin/engines" component={AdminEngines} />
        <Route path="/admin/api-keys" component={AdminApiKeys} />
        <Route path="/admin/data" component={AdminData} />
        <Route component={NotFound} />
      </Switch>
    </AdminLayout>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/industry/:id" component={Industry} />
        <Route path="/runs">
          <Redirect to="/admin/runs" />
        </Route>
        <Route path="/admin/*?" component={AdminRoutes} />
        <Route path="/terms" component={Terms} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/alerts" component={Alerts} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
