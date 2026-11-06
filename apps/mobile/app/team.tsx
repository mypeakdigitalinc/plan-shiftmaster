import { addDays, type Shift } from '@shifthub/shared';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Empty, ErrorText, Loading, styles } from '@/components/ui';
import { useNames, useToday, useVisibleShifts } from '@/lib/hooks';
import { shortDate } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** Coworkers' published shifts for the next two weeks — only people who chose to share. */
export default function TeamSchedule() {
  const { me } = useSession();
  const today = useToday();
  const shifts = useVisibleShifts(14);
  const names = useNames();

  const days = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts.data ?? []) {
      if (!s.employeeId || s.employeeId === me?.profile.id || s.status !== 'published') continue;
      map.set(s.date, [...(map.get(s.date) ?? []), s]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts.data, me?.profile.id]);

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => void shifts.refetch()} />}
      >
        <Text style={styles.muted}>Coworkers who share their schedule. Turn yours on or off under Profile.</Text>
        <ErrorText error={shifts.error} />
        {shifts.isPending ? (
          <Loading />
        ) : days.length === 0 ? (
          <Empty title="No shared shifts in the next two weeks" />
        ) : (
          days.map(([date, list]) => (
            <View key={date} style={{ gap: space.sm }}>
              <Text style={[styles.section, date === today && { color: colors.brand }]}>
                {date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : shortDate(date)}
              </Text>
              <Card style={{ gap: 0, paddingVertical: space.sm }}>
                {list.map((s) => (
                  <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: space.md }}>
                    <Text style={[styles.rowValue, { flex: 1 }]} numberOfLines={1}>
                      {s.employeeName}
                    </Text>
                    <Text style={styles.muted}>
                      {s.startTime}–{s.endTime} · {names.areas.get(s.areaId) ?? ''}
                    </Text>
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
