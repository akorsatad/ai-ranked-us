import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import { Layout } from './components/layout';
import Dashboard from './pages/dashboard';
import Industry from './pages/industry';
import Runs from './pages/runs';
import AdminRuns from './pages/admin/runs';
import AdminBrands from './pages/admin/brands';
import AdminEngines from './pages/admin/engines';
import AdminApiKeys from './pages/admin/api-keys';
import AdminData from './pages/admin/data';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/industry/:id" component={Industry} />
        <Route path="/runs" component={Runs} />
        <Route path="/admin" component={AdminRuns} />
        <Route path="/admin/runs" component={AdminRuns} />
        <Route path="/admin/brands" component={AdminBrands} />
        <Route path="/admin/engines" component={AdminEngines} />
        <Route path="/admin/api-keys" component={AdminApiKeys} />
        <Route path="/admin/data" component={AdminData} />
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
