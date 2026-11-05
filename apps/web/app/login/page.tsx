'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button, ErrorText, Field, Input } from '@/components/ui';
import { AUTH_MODE, getAuth } from '@/lib/api';
import { useSession } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/';
  const { session } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  useEffect(() => {
    if (session) router.replace(next);
  }, [session, next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (AUTH_MODE === 'dev') await getAuth().signInWithPassword(email, '');
      else if (password) await getAuth().signInWithPassword(email, password);
      else {
        await getAuth().sendMagicLink(email, `${window.location.origin}${next}`);
        setLinkSent(true);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (linkSent) {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a sign-in link to ${email}.`}>
        <Button variant="secondary" onClick={() => setLinkSent(false)}>
          Use a different email
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in" subtitle="Managers and admins manage schedules here. Staff use the mobile app.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {AUTH_MODE === 'supabase' && (
          <Field label="Password" hint="Leave empty to get a sign-in link by email.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <ErrorText error={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : AUTH_MODE === 'supabase' && !password ? 'Email me a link' : 'Sign in'}
        </Button>
        {AUTH_MODE === 'dev' && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Dev login: any email works, no password. Try <code>admin@maplegrove.test</code> or{' '}
            <code>manager1@maplegrove.test</code>.
          </p>
        )}
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
