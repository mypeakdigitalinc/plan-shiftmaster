'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Home() {
  const { session, me, meError } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session === null) router.replace('/login');
    else if (me) router.replace(me.organization ? '/dashboard' : '/onboarding');
  }, [session, me, router]);

  if (meError) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center text-sm text-red-700">
        Could not reach the ShiftHub API. Is it running? (<code>pnpm dev:api</code>)
      </main>
    );
  }
  return <Spinner />;
}
