'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Badge, Button, cn, Spinner } from '@/components/ui';
import { isManagerRole, useRequireOrg, useSession } from '@/lib/session';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/employees', label: 'Employees' },
  { href: '/locations', label: 'Locations' },
  { href: '/templates', label: 'Shift templates' },
  { href: '/settings', label: 'Settings' },
];

const ROLE_LABEL = { employee: 'Employee', manager: 'Manager', org_admin: 'Org admin' } as const;

export default function AppLayout({ children }: { children: ReactNode }) {
  const { ready, me } = useRequireOrg();
  const { signOut } = useSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!ready || !me?.organization) return <Spinner />;

  if (!isManagerRole(me.profile.role)) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold">Hi {me.profile.name}</p>
        <p className="mt-2 text-sm text-slate-600">
          The admin portal is for managers. Use the ShiftHub mobile app to see your schedule and trade shifts.
        </p>
        <Button variant="secondary" className="mt-6" onClick={signOut}>
          Sign out
        </Button>
      </main>
    );
  }

  const nav = (
    <nav className="space-y-0.5">
      {NAV.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMenuOpen(false)}
            className={cn(
              'block rounded-md px-3 py-2 text-sm font-medium',
              active ? 'bg-brand-light/60 text-brand-dark' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-slate-200 pt-3 text-sm">
      <p className="truncate font-medium text-slate-800">{me.profile.name}</p>
      <p className="truncate text-xs text-slate-500">{me.profile.email}</p>
      <div className="mt-2 flex items-center justify-between">
        <Badge tone="blue">{ROLE_LABEL[me.profile.role]}</Badge>
        <button onClick={signOut} className="text-xs text-slate-500 hover:underline">
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* mobile top bar */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <span className="font-semibold text-brand">ShiftHub</span>
        <Button variant="ghost" size="sm" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
          Menu
        </Button>
      </header>
      {menuOpen && (
        <div className="space-y-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          {nav}
          {footer}
        </div>
      )}

      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-4 lg:flex lg:min-h-screen">
        <div>
          <p className="px-3 text-lg font-semibold text-brand">ShiftHub</p>
          <p className="mb-6 truncate px-3 text-xs text-slate-500">{me.organization.name}</p>
          {nav}
        </div>
        {footer}
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
