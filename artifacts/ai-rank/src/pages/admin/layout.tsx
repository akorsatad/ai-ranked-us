import React from 'react';
import { Link, useLocation } from 'wouter';
import { History, Building2, Cpu, KeyRound, Database } from 'lucide-react';

const NAV = [
  { href: '/admin/runs', label: 'Runs', icon: History },
  { href: '/admin/catalog', label: 'Brands & Industries', icon: Building2 },
  { href: '/admin/engines', label: 'Engines', icon: Cpu },
  { href: '/admin/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/admin/data', label: 'Data Browser', icon: Database },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
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
        </div>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
