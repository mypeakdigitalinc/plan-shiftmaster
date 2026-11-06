import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useMyTrades, useNotifications } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
const icon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  };

function Bell() {
  const router = useRouter();
  const unread = useNotifications().data?.unreadCount ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      onPress={() => router.push('/notifications')}
      style={{ paddingHorizontal: 16, paddingVertical: 6 }}
    >
      <Ionicons name="notifications-outline" size={24} color={colors.text} />
      {unread > 0 && (
        <View
          style={{
            position: 'absolute', right: 10, top: 0, minWidth: 18, height: 18, borderRadius: 9,
            backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

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
        headerRight: () => <Bell />,
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
