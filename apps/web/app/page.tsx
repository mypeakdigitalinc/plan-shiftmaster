'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export default function Home() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false });

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold text-brand">ShiftHub Admin</h1>
      <p className="mt-2 text-slate-600">Scheduling for care facilities and worker groups.</p>
      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        API status:{' '}
        {health.isPending ? 'checking…' : health.data?.ok ? (
          <span className="font-medium text-emerald-700">connected</span>
        ) : (
          <span className="font-medium text-red-700">unreachable — start it with `pnpm dev:api`</span>
        )}
      </div>
      <p className="mt-6 text-sm text-slate-500">Sign-in, locations and employee screens arrive in phase W1.</p>
    </main>
  );
}
