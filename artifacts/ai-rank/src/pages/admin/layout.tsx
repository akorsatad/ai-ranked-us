import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  useGetAdminMe,
  getGetAdminMeQueryKey,
  useAdminSignOut,
} from '@workspace/api-client-react';
import { History, Building2, Cpu, KeyRound, Database, FileText, LogOut, Microscope, Users, ShieldCheck, DollarSign, Receipt, LineChart, Siren } from 'lucide-react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const NAV = [
  { href: '/admin/runs', label: 'Runs', icon: History },
  { href: '/admin/catalog', label: 'Brands & Industries', icon: Building2 },
  { href: '/admin/engines', label: 'Engines', icon: Cpu },
  { href: '/admin/model-results', label: 'Model Results', icon: Microscope },
  { href: '/admin/analysis', label: 'Analysis', icon: LineChart },
  { href: '/admin/outliers', label: 'Outliers', icon: Siren },
  { href: '/admin/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/admin/costs', label: 'API Costs', icon: Receipt },
  { href: '/admin/pricing', label: 'Pricing', icon: DollarSign },
  { href: '/admin/queries', label: 'Queries', icon: FileText },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/admins', label: 'Admins', icon: ShieldCheck },
  { href: '/admin/data', label: 'Data Browser', icon: Database },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const me = useGetAdminMe({
    query: { queryKey: getGetAdminMeQueryKey(), retry: false },
  });
  const signOut = useAdminSignOut({
    mutation: {
      onSettled: () => {
        window.location.href = `${basePath}/` || '/';
      },
    },
  });
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
            {me.data?.email && (
              <p className="text-xs text-muted-foreground font-mono truncate mb-2">
                {me.data.email}
              </p>
            )}
            <button
              type="button"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
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
