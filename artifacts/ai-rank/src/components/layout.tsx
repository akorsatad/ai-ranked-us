import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Activity,
  History,
  ServerCrash,
  LogOut,
  ChevronDown,
  Menu,
  X,
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
import { AuthModal } from './auth-modal';
import { Logo, BrandButton, DI } from './brand';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const [showAuth, setShowAuth] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: health, isError } = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60000 },
  });

  const { data: user, isLoading: isLoadingUser } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false, retryOnMount: false },
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
        enabled: !!user,
        retry: false,
      },
    },
  );
  const unreadAlerts = alertData?.unreadCount ?? 0;

  const navLinks: { href: string; label: string; badge?: number }[] = [
    { href: '/', label: 'Rankings' },
    { href: '/explore', label: 'Explore' },
    ...(user ? [{ href: '/alerts', label: 'Alerts', badge: unreadAlerts }] : []),
  ];

  const linkStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 14,
    color: active ? DI.ink : DI.body,
    fontWeight: active ? 600 : 400,
    transition: 'color 0.2s',
  });

  return (
    <div className="min-h-screen w-full flex flex-col" style={{ background: DI.paper }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${DI.line}`,
        }}
      >
        <div className="mx-auto w-full flex items-center justify-between" style={{ maxWidth: '72rem', padding: '0 24px', height: 64 }}>
          <Link href="/" className="shrink-0">
            <Logo size={32} />
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center" style={{ gap: 28 }}>
            {navLinks.map((item) => {
              const active =
                item.href === '/' ? location === '/' : location.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} style={linkStyle(active)}>
                  {item.label}
                  {(item.badge ?? 0) > 0 && (
                    <span
                      data-testid="badge-unread-alerts"
                      style={{
                        marginLeft: 6,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        fontWeight: 700,
                        color: DI.danger,
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}

            <span className="flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {isError ? (
                <>
                  <ServerCrash className="w-3 h-3" style={{ color: DI.danger }} />
                  <span style={{ color: DI.danger }}>Offline</span>
                </>
              ) : health?.status === 'ok' ? (
                <>
                  <Activity className="w-3 h-3" style={{ color: DI.teal }} />
                  <span style={{ color: DI.steel }}>Live</span>
                </>
              ) : (
                <span style={{ color: DI.faint }}>…</span>
              )}
            </span>

            {!isLoadingUser &&
              (user ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu((v) => !v)}
                    className="flex items-center gap-2"
                    style={{ fontSize: 14, color: DI.body, cursor: 'pointer', background: 'none', border: 'none' }}
                  >
                    {user.firstName}
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  {showUserMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                      <div
                        className="absolute right-0 top-full mt-2 z-50 py-1 w-48"
                        style={{ background: '#fff', border: `1px solid ${DI.line}`, boxShadow: '0 4px 6px rgba(0,0,0,0.07)' }}
                      >
                        <Link
                          href="/history"
                          className="flex items-center gap-2 px-4 py-2"
                          style={{ fontSize: 14, color: DI.ink }}
                          onClick={() => setShowUserMenu(false)}
                        >
                          <History className="w-4 h-4" style={{ color: DI.steel }} />
                          My rankings
                        </Link>
                        <div style={{ borderTop: `1px solid ${DI.line}`, margin: '4px 0' }} />
                        <button
                          onClick={() => signOut()}
                          className="flex items-center gap-2 w-full px-4 py-2"
                          style={{ fontSize: 14, color: DI.body, background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          <LogOut className="w-4 h-4" />
                          Sign out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <BrandButton size="sm" onClick={() => setShowAuth(true)}>
                  Sign in
                </BrandButton>
              ))}
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Menu"
            style={{ background: 'none', border: 'none', color: DI.ink, cursor: 'pointer' }}
          >
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden" style={{ borderTop: `1px solid ${DI.line}`, background: '#fff' }}>
            <div style={{ maxWidth: '72rem', margin: '0 auto', padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {navLinks.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  style={{ ...linkStyle(location === item.href), padding: '10px 0' }}
                >
                  {item.label}
                  {(item.badge ?? 0) > 0 && (
                    <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: DI.danger }}>{item.badge}</span>
                  )}
                </Link>
              ))}
              {!isLoadingUser && !user && (
                <button
                  onClick={() => { setMobileOpen(false); setShowAuth(true); }}
                  style={{ ...linkStyle(false), padding: '10px 0', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Sign in
                </button>
              )}
              {user && (
                <>
                  <Link href="/history" onClick={() => setMobileOpen(false)} style={{ ...linkStyle(false), padding: '10px 0' }}>My rankings</Link>
                  <button onClick={() => { setMobileOpen(false); signOut(); }} style={{ ...linkStyle(false), padding: '10px 0', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>Sign out</button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer style={{ borderTop: `1px solid ${DI.line}`, background: '#fff' }}>
        <div
          className="mx-auto flex flex-wrap items-center justify-between"
          style={{ maxWidth: '72rem', padding: '40px 24px', gap: 20 }}
        >
          <Logo size={26} />
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: DI.faint }}>
            Updated daily &middot; 4 AI engines &middot; 92 brands
          </div>
          <nav className="flex items-center" style={{ gap: 20, fontSize: 13 }}>
            <Link href="/terms" style={{ color: DI.body }}>Terms</Link>
            <Link href="/privacy" style={{ color: DI.body }}>Privacy</Link>
          </nav>
        </div>
      </footer>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
