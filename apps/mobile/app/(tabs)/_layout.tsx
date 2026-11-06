import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useMyTrades } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

export default function TabsLayout() {
  const { me } = useSession();
  const trades = useMyTrades();
  const waiting = (trades.data?.swaps ?? []).filter((w) => w.target.id === me?.profile.id && w.status === 'pending_peer').length;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        headerTitleStyle: { color: colors.text },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'My schedule', tabBarLabel: 'Schedule', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="market" options={{ title: 'Open shifts', tabBarIcon: icon('swap-horizontal-outline') }} />
      <Tabs.Screen name="requests" options={{
          title: 'My requests',
          tabBarLabel: 'Requests',
          tabBarIcon: icon('list-outline'),
          tabBarBadge: waiting > 0 ? waiting : undefined,
        }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
