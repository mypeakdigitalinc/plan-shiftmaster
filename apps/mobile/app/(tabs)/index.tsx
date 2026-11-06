import { addDays, durationHours, WEEKDAY_SHORT, weekday, weekStart, type Shift } from '@shifthub/shared';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShiftCard } from '@/components/shift-card';
import { Button, Empty, ErrorText, Loading, styles } from '@/components/ui';
import { useMyShifts, useNames, useToday } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

export default function MySchedule() {
  const { me } = useSession();
  const router = useRouter();
  const today = useToday();
  const shifts = useMyShifts();
  const names = useNames();
  const canSelfSchedule = !!me?.organization?.settings.allowSelfScheduling;

  const { upcoming, byDate, weekHours } = useMemo(() => {
    const list = (shifts.data ?? []).filter((s) => s.date >= today || Date.parse(s.endsAt) > Date.now());
    const map = new Map<string, Shift[]>();
    for (const s of list) map.set(s.date, [...(map.get(s.date) ?? []), s]);
    const monday = weekStart(today);
    const hours = list
      .filter((s) => s.status !== 'cancelled' && s.date >= monday && s.date <= addDays(monday, 6))
      .reduce((h, s) => h + durationHours(s.startTime, s.endTime), 0);
    return { upcoming: list, byDate: [...map.entries()], weekHours: hours };
  }, [shifts.data, today]);

  const next = upcoming.find((s) => s.status !== 'cancelled' && Date.parse(s.endsAt) > Date.now());
  const label = (d: string) => (d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : longDate(d));

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={shifts.isRefetching} onRefresh={() => void shifts.refetch()} />}
      >
        <View style={{ gap: 2 }}>
          <Text style={styles.title}>Hi {me?.profile.name.split(' ')[0]}</Text>
          <Text style={styles.muted}>
            {me?.organization?.name} · {weekHours}h this week
          </Text>
        </View>

        {next && (
          <View style={{ backgroundColor: colors.brand, borderRadius: 12, padding: space.lg, gap: 4 }}>
            <Text style={{ color: colors.brandLight, fontSize: 13, fontWeight: '600' }}>NEXT SHIFT</Text>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>
              {label(next.date)} · {next.startTime}–{next.endTime}
            </Text>
            <Text style={{ color: colors.brandLight }}>
              {[names.areas.get(next.areaId), next.assignmentId ? names.positions.get(next.assignmentId) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button title="Team schedule" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/team')} />
          {canSelfSchedule && (
            <Button title="+ Add my shift" variant="secondary" style={{ flex: 1 }} onPress={() => router.push('/add-shift')} />
          )}
        </View>

        <ErrorText error={shifts.error} />
        {shifts.isPending ? (
          <Loading />
        ) : byDate.length === 0 ? (
          <Empty title="No upcoming shifts">Published shifts for the next four weeks appear here.</Empty>
        ) : (
          byDate.map(([date, list]) => (
            <View key={date} style={{ gap: space.sm }}>
              <Text style={[styles.section, date === today && { color: colors.brand }]}>
                {label(date)}
                {date !== today && date !== addDays(today, 1) ? '' : ` · ${WEEKDAY_SHORT[weekday(date)]}`}
              </Text>
              {list.map((s) => (
                <ShiftCard
                  key={s.id}
                  shift={s}
                  areaName={names.areas.get(s.areaId)}
                  positionName={s.assignmentId ? names.positions.get(s.assignmentId) : undefined}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
