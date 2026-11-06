import type { Notification } from '@shifthub/shared';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Empty, ErrorText, Loading, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { routeForNotification, useApiMutation, useNotifications } from '@/lib/hooks';
import { colors, radius, space } from '@/lib/theme';

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

export default function Notifications() {
  const router = useRouter();
  const list = useNotifications();
  const markAll = useApiMutation(() => api.notifications.markRead(), [['notifications']]);
  const markOne = useApiMutation((id: string) => api.notifications.markRead([id]), [['notifications']]);

  const open = (n: Notification) => {
    if (!n.readAt) markOne.mutate(n.id);
    router.push(routeForNotification(n.type, n.data) as never);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
      >
        {!!list.data?.unreadCount && (
          <Button title="Mark all read" variant="ghost" onPress={() => markAll.mutate(undefined)} loading={markAll.isPending} />
        )}
        <ErrorText error={list.error} />
        {list.isPending ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty title="You’re all caught up">Schedule changes, swaps and open shifts show up here.</Empty>
        ) : (
          list.data.items.map((n) => (
            <Pressable
              key={n.id}
              accessibilityRole="button"
              accessibilityLabel={`${n.readAt ? '' : 'Unread: '}${n.title}. ${n.body}`}
              onPress={() => open(n)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: space.md,
                backgroundColor: n.readAt ? colors.card : colors.infoBg,
                borderWidth: 1,
                borderColor: n.readAt ? colors.border : '#bae6fd',
                borderRadius: radius,
                padding: space.md,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: n.readAt ? '500' : '700', color: colors.text }}>{n.title}</Text>
                <Text style={styles.muted}>{n.body}</Text>
              </View>
              <Text style={styles.hint}>{ago(n.createdAt)}</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
