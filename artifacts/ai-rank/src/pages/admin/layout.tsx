import React from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { History, Building2, Cpu, KeyRound, Database, FileText, LogOut } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const NAV = [
  { href: '/admin/runs', label: 'Runs', icon: History },
  { href: '/admin/catalog', label: 'Brands & Industries', icon: Building2 },
  { href: '/admin/engines', label: 'Engines', icon: Cpu },
  { href: '/admin/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/admin/queries', label: 'Queries', icon: FileText },
  { href: '/admin/data', label: 'Data Browser', icon: Database },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  return (
    <div className="flex flex-col md:flex-row min-h-[calc(100vh-4rem)]">
      <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-border bg-card/50">
        <div className="p-4">
          <div className="px-2 pb-3">
            <h2 className="font-sans font-bold text-lg tracking-tight">Admin</h2>
            <p className="text-xs text-muted-foreground font-mono">Operations console</p>
          </div>
          <nav className="flex md:flex-col gap-1 overflow-x-auto">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = location.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
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
          <div className="mt-4 pt-3 border-t border-border px-2 hidden md:block">
            {user?.primaryEmailAddress && (
              <p className="text-xs text-muted-foreground font-mono truncate mb-2">
                {user.primaryEmailAddress.emailAddress}
              </p>
            )}
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: basePath || '/' })}
              className="flex items-center gap-2 px-1 py-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
