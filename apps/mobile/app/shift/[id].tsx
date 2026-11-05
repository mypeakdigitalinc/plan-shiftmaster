import { durationHours } from '@shifthub/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Badge, Card, ErrorText, Loading, Row, Screen, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useNames } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { space } from '@/lib/theme';

const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function ShiftDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, session } = useSession();
  const names = useNames();
  const shift = useQuery({ queryKey: [...keys.shifts, 'one', id], queryFn: () => api.shifts.get(id), enabled: !!session });

  if (shift.isPending) return <Loading />;
  if (!shift.data) return <Screen><ErrorText error={shift.error ?? 'Shift not found'} /></Screen>;
  const s = shift.data;
  const mine = s.employeeId === me?.profile.id;
  const tone = s.status === 'published' ? 'green' : s.status === 'draft' ? 'amber' : 'red';

  return (
    <Screen>
      <Stack.Screen options={{ title: mine ? 'My shift' : (s.employeeName ?? 'Shift') }} />
      <View style={{ gap: 4 }}>
        <Text style={styles.title}>
          {s.startTime}–{s.endTime}
        </Text>
        <Text style={styles.muted}>{longDate(s.date)}</Text>
      </View>
      <Card>
        <Row label="Status" value={<Badge label={s.status} tone={tone} />} />
        <Row label="Length" value={`${durationHours(s.startTime, s.endTime)} hours${s.endTime <= s.startTime ? ' (overnight)' : ''}`} />
        <Row label="Site" value={names.sites.get(s.siteId) ?? '—'} />
        <Row label="Unit" value={names.areas.get(s.areaId) ?? '—'} />
        <Row label="Position" value={s.assignmentId ? (names.positions.get(s.assignmentId) ?? '—') : '—'} />
        {!mine && <Row label="Who" value={s.employeeName ?? 'Open'} />}
        <Row label="Timezone" value={s.timezone} />
      </Card>
      {s.notes && (
        <Card>
          <Text style={styles.label}>Notes</Text>
          <Text style={styles.muted}>{s.notes}</Text>
        </Card>
      )}
      {mine && s.status === 'published' && (
        <Text style={[styles.hint, { marginTop: space.sm }]}>Giving away and swapping this shift arrives in the next update (M2).</Text>
      )}
    </Screen>
  );
}
