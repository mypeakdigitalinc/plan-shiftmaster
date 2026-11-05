'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { Button, ErrorText, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { session, me, signOut } = useSession();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session === null) router.replace(`/login?next=/invite/${token}`);
  }, [session, token, router]);

  if (!me) return <Spinner />;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(['me'], await api.onboarding.acceptInvitation(token));
      router.replace('/dashboard');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Join your team" subtitle={`Signed in as ${me.profile.email}`}>
      <div className="space-y-4">
        {me.organization ? (
          <p className="text-sm text-slate-600">You already belong to {me.organization.name}.</p>
        ) : (
          <Button className="w-full" onClick={accept} disabled={busy}>
            {busy ? 'Joining…' : 'Accept invitation'}
          </Button>
        )}
        <ErrorText error={error} />
        <button onClick={signOut} className="w-full text-center text-xs text-slate-500 hover:underline">
          Not you? Sign out
        </button>
      </div>
    </AuthLayout>
  );
}
