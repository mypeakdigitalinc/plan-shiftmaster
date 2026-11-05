import type { AvailabilitySlot } from '@shifthub/shared';
import { WEEKDAY_SHORT } from '@shifthub/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Chips } from '@/components/chips';
import { Button, Card, Empty, ErrorText, Loading, Screen, SectionTitle, styles, TextField, ToggleRow } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useApiMutation, useMyAvailability } from '@/lib/hooks';
import { colors, space } from '@/lib/theme';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function Availability() {
  const router = useRouter();
  const current = useMyAvailability();
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [day, setDay] = useState<string>('1');
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState('15:00');
  const [end, setEnd] = useState('23:00');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (current.data && slots === null) setSlots(current.data.slots);
  }, [current.data, slots]);

  const save = useApiMutation((s: AvailabilitySlot[]) => api.me.setAvailability(s), [keys.availability]);

  if (!slots) return <Loading />;

  const add = () => {
    const slot = allDay
      ? { weekday: Number(day), startTime: '00:00', endTime: '24:00' }
      : { weekday: Number(day), startTime: start, endTime: end };
    if (!allDay && (!HHMM.test(start) || !(HHMM.test(end) || end === '24:00') || start >= end)) {
      setFormError('Use HH:MM times, with the end after the start (same day).');
      return;
    }
    setFormError(null);
    setSlots([...slots, { ...slot, note: note.trim() || null }].sort((a, b) => ORDER.indexOf(a.weekday) - ORDER.indexOf(b.weekday) || a.startTime.localeCompare(b.startTime)));
    setNote('');
  };

  return (
    <Screen>
      <Text style={styles.muted}>Tell your manager when you can’t work each week. They see this when building the schedule.</Text>

      {slots.length === 0 ? (
        <Empty title="Available any time" />
      ) : (
        <Card>
          {slots.map((s, i) => (
            <View key={`${s.weekday}-${s.startTime}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 }}>
              <View>
                <Text style={styles.rowValue}>
                  {WEEKDAY_SHORT[s.weekday]} · {s.startTime === '00:00' && s.endTime === '24:00' ? 'All day' : `${s.startTime}–${s.endTime}`}
                </Text>
                {s.note ? <Text style={styles.hint}>{s.note}</Text> : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${WEEKDAY_SHORT[s.weekday]} ${s.startTime}`}
                onPress={() => setSlots(slots.filter((_, j) => j !== i))}
                style={{ padding: space.sm }}
              >
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>Add a time</SectionTitle>
      <Card>
        <Chips label="Day" value={day} onChange={setDay} options={ORDER.map((d) => ({ value: String(d), label: WEEKDAY_SHORT[d]! }))} />
        <ToggleRow label="All day" value={allDay} onChange={setAllDay} />
        {!allDay && (
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <TextField label="From" value={start} onChangeText={setStart} placeholder="15:00" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="To" value={end} onChangeText={setEnd} placeholder="23:00" hint="24:00 = end of day" />
            </View>
          </View>
        )}
        <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. class" />
        {formError && <ErrorText error={formError} />}
        <Button title="Add" variant="secondary" onPress={add} />
      </Card>

      <ErrorText error={save.error} />
      <Button
        title={save.isPending ? 'Saving…' : 'Save availability'}
        onPress={() => save.mutate(slots, { onSuccess: () => router.back() })}
        loading={save.isPending}
      />
    </Screen>
  );
}
