import { rangesOverlap, type Shift } from '@shifthub/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ShiftLine } from '@/components/shift-line';
import { Button, Card, Empty, ErrorText, Loading, Screen, SectionTitle, styles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, tradeKeys, useApiMutation, useLocations, useMyAreas, useMyShifts, useVisibleShifts } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

/**
 * Pick a coworker's shift to swap for mine. Candidates are coworkers' published, future shifts that
 * I can see (they share their schedule), that I'm eligible for and free to work. The server re-checks
 * everything, including whether the coworker can take my shift.
 */
export default function SwapPicker() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { me, session } = useSession();
  const myShift = useQuery({ queryKey: [...keys.shifts, 'one', id], queryFn: () => api.shifts.get(id), enabled: !!session });
  const visible = useVisibleShifts();
  const mine = useMyShifts();
  const myAreas = useMyAreas();
  const locations = useLocations();
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const candidates = useMemo(() => {
    if (!myShift.data || !visible.data || !mine.data || !myAreas.data || !locations.data) return null;
    const isGroup = me?.organization?.settings.mode === 'group';
    const areaOk = new Set(myAreas.data.areaIds);
    const required = new Map(locations.data.flatMap((s) => s.areas.flatMap((a) => a.assignments.map((x) => [x.id, x.requiredPosition]))));
    const myOthers = mine.data.filter((s) => s.id !== myShift.data.id && s.status !== 'cancelled');
    return visible.data.filter(
      (s: Shift) =>
        s.employeeId &&
        s.employeeId !== me?.profile.id &&
        s.status === 'published' &&
        Date.parse(s.startsAt) > Date.now() &&
        (isGroup || areaOk.has(s.areaId)) &&
        (!s.assignmentId || !required.get(s.assignmentId) || required.get(s.assignmentId) === me?.profile.position) &&
        !myOthers.some((m) => rangesOverlap(m.startsAt, m.endsAt, s.startsAt, s.endsAt)),
    );
  }, [myShift.data, visible.data, mine.data, myAreas.data, locations.data, me]);

  const propose = useApiMutation(
    () => api.swaps.propose({ myShiftId: id, theirShiftId: picked!, note: note.trim() || null }),
    tradeKeys,
  );

  if (!candidates) return <Loading />;

  return (
    <Screen>
      <SectionTitle>Your shift</SectionTitle>
      <Card>
        <ShiftLine shift={myShift.data ?? null} />
      </Card>

      <SectionTitle>Swap for</SectionTitle>
      {candidates.length === 0 ? (
        <Empty title="No shifts to swap with">
          You can only swap with coworkers who share their schedule, for shifts you’re able and free to work.
        </Empty>
      ) : (
        candidates.map((s) => {
          const on = picked === s.id;
          return (
            <Pressable
              key={s.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${s.employeeName} ${s.date} ${s.startTime}`}
              onPress={() => setPicked(s.id)}
              style={{
                borderWidth: on ? 2 : 1,
                borderColor: on ? colors.brand : colors.border,
                borderRadius: radius,
                backgroundColor: '#fff',
                padding: space.md,
                gap: 2,
              }}
            >
              <ShiftLine shift={s} who={s.employeeName} />
            </Pressable>
          );
        })
      )}

      {picked && (
        <View style={{ gap: space.md }}>
          <TextField label="Message (optional)" value={note} onChangeText={setNote} placeholder="e.g. family event" />
          <Text style={styles.hint}>
            Your coworker has to accept{me?.organization?.settings.requireApproval ? ', then a manager approves' : ''}.
          </Text>
          <ErrorText error={propose.error} />
          <Button
            title="Send swap request"
            loading={propose.isPending}
            onPress={() => propose.mutate(undefined, { onSuccess: () => router.replace('/(tabs)/requests') })}
          />
        </View>
      )}
    </Screen>
  );
}
