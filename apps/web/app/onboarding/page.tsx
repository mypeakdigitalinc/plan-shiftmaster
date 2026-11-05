'use client';

import type { OrgMode } from '@shifthub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button, cn, ErrorText, Field, Input, Select, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

const TIMEZONES = [
  'America/St_Johns',
  'America/Halifax',
  'America/Toronto',
  'America/Winnipeg',
  'America/Regina',
  'America/Edmonton',
  'America/Vancouver',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
];

export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { session, me, signOut } = useSession();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<OrgMode>('facility');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session === null) router.replace('/login');
    else if (me?.organization) router.replace('/dashboard');
  }, [session, me, router]);

  if (!me) return <Spinner />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        tab === 'create'
          ? await api.onboarding.createOrganization({ name, mode, timezone })
          : await api.onboarding.join(code);
      qc.setQueryData(['me'], result);
      router.replace('/dashboard');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={`Welcome, ${me.profile.name}`} subtitle="Set up your organization, or join one with an invite code.">
      <div className="mb-5 grid grid-cols-2 rounded-md bg-slate-100 p-1 text-sm">
        {(['create', 'join'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn('rounded px-3 py-1.5 font-medium', tab === t ? 'bg-white shadow-xs' : 'text-slate-600')}
          >
            {t === 'create' ? 'Create organization' : 'Join with code'}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-4">
        {tab === 'create' ? (
          <>
            <Field label="Organization name">
              <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="Maple Grove Care Home" />
            </Field>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Type</legend>
              {(
                [
                  ['facility', 'Facility', 'Managers build schedules and approve trades.'],
                  ['group', 'Worker group', 'Coworkers add their own shifts and trade freely.'],
                ] as const
              ).map(([value, label, desc]) => (
                <label
                  key={value}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-md border p-3',
                    mode === value ? 'border-brand bg-brand-light/30' : 'border-slate-200',
                  )}
                >
                  <input type="radio" name="mode" checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-slate-500">{desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field label="Timezone">
              <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </Select>
            </Field>
          </>
        ) : (
          <Field label="Invite code" hint="Ask your manager or group admin for the code.">
            <Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="OWLS000002" />
          </Field>
        )}
        <ErrorText error={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Please wait…' : tab === 'create' ? 'Create organization' : 'Join'}
        </Button>
        <button type="button" onClick={signOut} className="w-full text-center text-xs text-slate-500 hover:underline">
          Sign out ({me.profile.email})
        </button>
      </form>
    </AuthLayout>
  );
}
