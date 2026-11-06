import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import { routeForNotification } from '@/lib/hooks';
import { onNotificationTap, registerForPush } from '@/lib/push';
import { SessionProvider, useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

/** Sends people to login / onboarding / the app depending on their state. */
function Guard() {
  const { session, me } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] as string | undefined;

  useEffect(() => {
    if (session === undefined) return;
    const inAuth = first === 'login';
    const inOnboarding = first === 'onboarding' || first === 'invite';
    if (!session) {
      if (!inAuth) router.replace('/login');
    } else if (me && !me.organization) {
      if (!inOnboarding) router.replace('/onboarding');
    } else if (me?.organization && (inAuth || inOnboarding || !first)) {
      router.replace('/(tabs)');
    }
  }, [session, me, first, router]);

  return null;
}

/** Registers this device for push once someone is signed in to an organization, and routes taps. */
function PushSetup() {
  const { me } = useSession();
  const router = useRouter();
  const userId = me?.organization ? me.profile.id : null;
  useEffect(() => {
    if (!userId) return;
    registerForPush().catch(() => {});
    return onNotificationTap((data) => router.push(routeForNotification(String(data.type ?? ''), data) as never));
  }, [userId, router]);
  return null;
}

export default function RootLayout() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <StatusBar style="dark" />
          <Guard />
          <PushSetup />
          <Stack
            screenOptions={{
              headerTintColor: colors.brand,
              headerTitleStyle: { color: colors.text },
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="onboarding" options={{ title: 'Join your team', headerBackVisible: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="shift/[id]" options={{ title: 'Shift' }} />
            <Stack.Screen name="availability" options={{ title: 'Availability' }} />
            <Stack.Screen name="swap/[id]" options={{ title: 'Swap shift' }} />
            <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
            <Stack.Screen name="team" options={{ title: 'Team schedule' }} />
            <Stack.Screen name="add-shift" options={{ title: 'Add my shift', presentation: 'modal' }} />
          </Stack>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

export function ErrorBoundary({ error }: { error: Error }) {
  return <Loading key={error.message} />;
}
