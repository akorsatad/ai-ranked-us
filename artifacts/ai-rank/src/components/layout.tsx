import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Activity,
  LayoutDashboard,
  History,
  Zap,
  ServerCrash,
  Settings,
  Bell,
  LogIn,
  LogOut,
  User,
  ChevronDown,
  BarChart3,
} from 'lucide-react';
import {
  useHealthCheck,
  getHealthCheckQueryKey,
  useListAlerts,
  getListAlertsQueryKey,
  useGetMe,
  getGetMeQueryKey,
  useSignOut,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { AuthModal } from './auth-modal';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const [showAuth, setShowAuth] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const { data: health, isError } = useHealthCheck({
    query: {
      queryKey: getHealthCheckQueryKey(),
      refetchInterval: 60000,
    },
  });

  const { data: user, isLoading: isLoadingUser } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      retryOnMount: false,
    },
  });

  const { mutate: signOut } = useSignOut({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(getGetMeQueryKey(), null);
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setShowUserMenu(false);
      },
    },
  });

  const { data: alertData } = useListAlerts(
    { unreadOnly: true, limit: 1 },
    {
      query: {
        queryKey: getListAlertsQueryKey({ unreadOnly: true, limit: 1 }),
        refetchInterval: 60000,
      },
    },
  );
  const unreadAlerts = alertData?.unreadCount ?? 0;

  const navItems = [
    { href: '/explore', label: 'Explore', icon: LayoutDashboard },
    { href: '/alerts', label: 'Alerts', icon: Bell, badge: unreadAlerts },
    { href: '/admin', label: 'Admin', icon: Settings },
  ];

  return (
    <div className="min-h-screen w-full flex flex-col bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 h-16 max-w-7xl mx-auto w-full">
          {/* Logo + nav */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="bg-primary text-primary-foreground p-1.5 rounded-md group-hover:bg-primary/90 transition-colors">
                <Zap className="w-5 h-5 fill-current" />
              </div>
              <span className="font-sans font-bold text-xl tracking-tight text-foreground">
                AI<span className="text-primary">Ranked</span>
                <span className="ml-1.5 text-xs font-semibold tracking-widest text-muted-foreground align-middle">US</span>
              </span>
            </Link>

            <nav className="hidden sm:flex items-center gap-1">
              {/* Home / Rank */}
              <Link
                href="/"
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  location === '/'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                Rank
              </Link>

              {navItems.map((item) => {
                const isActive =
                  location === item.href ||
                  (item.href !== '/' && location.startsWith(item.href));
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
                    {'badge' in item && (item.badge ?? 0) > 0 && (
                      <span
                        className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold"
                        data-testid="badge-unread-alerts"
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right side: status + auth */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs font-mono bg-muted/50 px-3 py-1.5 rounded-full border border-border">
              {isError ? (
                <>
                  <ServerCrash className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-destructive font-medium">Offline</span>
                </>
              ) : health?.status === 'ok' ? (
                <>
                  <Activity className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-foreground">Online</span>
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5 text-muted-foreground animate-pulse" />
                  <span className="text-muted-foreground">…</span>
                </>
              )}
            </div>

            {!isLoadingUser && (
              <>
                {user ? (
                  <div className="relative">
                    <button
                      onClick={() => setShowUserMenu((v) => !v)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
                    >
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span className="text-foreground font-medium">{user.firstName}</span>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>

                    {showUserMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowUserMenu(false)}
                        />
                        <div className="absolute right-0 top-full mt-2 z-50 bg-card border border-border rounded-xl shadow-lg py-1 w-48">
                          <Link
                            href="/history"
                            className="flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                            onClick={() => setShowUserMenu(false)}
                          >
                            <History className="w-4 h-4 text-muted-foreground" />
                            My rankings
                          </Link>
                          <div className="border-t border-border my-1" />
                          <button
                            onClick={() => signOut()}
                            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <LogOut className="w-4 h-4" />
                            Sign out
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowAuth(true)}
                  >
                    <LogIn className="w-4 h-4" />
                    Sign in
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-border bg-card">
        <div className="px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} AI Ranked US. All rights reserved.</span>
          <nav className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          </nav>
        </div>
      </footer>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
