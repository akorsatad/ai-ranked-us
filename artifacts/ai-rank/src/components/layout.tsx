import React from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, LayoutDashboard, History, Zap, ServerCrash } from 'lucide-react';
import { useHealthCheck, getHealthCheckQueryKey } from '@workspace/api-client-react';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: health, isError } = useHealthCheck({
    query: {
      queryKey: getHealthCheckQueryKey(),
      refetchInterval: 60000, // Check every minute
    }
  });

  const navItems = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/runs', label: 'Runs History', icon: History },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="bg-primary text-primary-foreground p-1.5 rounded-md group-hover:bg-primary/90 transition-colors">
                <Zap className="w-5 h-5 fill-current" />
              </div>
              <span className="font-sans font-bold text-xl tracking-tight text-foreground">
                AI<span className="text-primary">Rank</span>
              </span>
            </Link>
            
            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive 
                        ? 'bg-primary/10 text-primary' 
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono bg-muted/50 px-3 py-1.5 rounded-full border border-border">
              {isError ? (
                <>
                  <ServerCrash className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-destructive font-medium">System Offline</span>
                </>
              ) : health?.status === 'ok' ? (
                <>
                  <Activity className="w-3.5 h-3.5 text-accent" />
                  <span className="text-foreground">System Nominal</span>
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />
                  <span className="text-muted-foreground">Checking...</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
