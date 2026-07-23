import React from 'react';
import { Link, useLocation } from 'wouter';
import { 
  Database, 
  Boxes, 
  Cpu, 
  Key, 
  History,
  Settings
} from 'lucide-react';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { href: '/admin', label: 'Runs', icon: History },
    { href: '/admin/brands', label: 'Brands', icon: Boxes },
    { href: '/admin/engines', label: 'Engines', icon: Cpu },
    { href: '/admin/api-keys', label: 'API Keys', icon: Key },
    { href: '/admin/data', label: 'Data Browser', icon: Database },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <div className="border-b border-border bg-muted/30 sticky top-16 z-40">
        <div className="max-w-[1600px] mx-auto px-6 md:px-10">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 text-primary p-2 rounded-lg">
                <Settings className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-sans font-bold tracking-tight">Operations Control</h2>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Admin Area</p>
              </div>
            </div>
          </div>
          
          <nav className="flex items-center gap-1 -mb-px">
            {navItems.map((item) => {
              const isActive = item.href === '/admin' 
                ? location === '/admin' || location === '/admin/runs'
                : location.startsWith(item.href);
              const Icon = item.icon;
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium font-mono transition-colors border-b-2 ${
                    isActive 
                      ? 'border-primary text-primary bg-primary/5' 
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
      
      <div className="flex-1 bg-background">
        {children}
      </div>
    </div>
  );
}
