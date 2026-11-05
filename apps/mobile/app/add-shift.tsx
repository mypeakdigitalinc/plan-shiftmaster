import { addDays, WEEKDAY_SHORT, weekday } from '@shifthub/shared';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Chips } from '@/components/chips';
import { Button, Card, ErrorText, Loading, Screen, SectionTitle, styles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useApiMutation, useLocations, useTemplates, useToday } from '@/lib/hooks';
import { space } from '@/lib/theme';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Self-scheduling (worker groups): add a shift you are working. */
export default function AddShift() {
  const router = useRouter();
  const today = useToday();
  const locations = useLocations();
  const templates = useTemplates();
  const areas = useMemo(() => (locations.data ?? []).flatMap((s) => s.areas.map((a) => ({ ...a, siteName: s.name }))), [locations.data]);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [templateId, setTemplateId] = useState<string>('custom');
  const [start, setStart] = useState('19:00');
  const [end, setEnd] = useState('07:00');
  const [notes, setNotes] = useState('');

  const create = useApiMutation(
    () =>
      api.shifts.create({
        areaId: (areaId ?? areas[0]?.id)!,
        date,
        ...(templateId === 'custom' ? { startTime: start, endTime: end } : { shiftTemplateId: templateId }),
        notes: notes.trim() || null,
      }),
    [keys.shifts],
  );

  if (locations.isPending || templates.isPending) return <Loading />;
  if (!areas.length) {
    return (
      <Screen>
        <ErrorText error="Your group has no locations yet. Ask the group admin to add one in the web portal." />
      </Screen>
    );
  }

  const valid = templateId !== 'custom' || (HHMM.test(start) && HHMM.test(end) && start !== end);
  const days = Array.from({ length: 21 }, (_, i) => addDays(today, i));

  return (
    <Screen>
      <SectionTitle>Where</SectionTitle>
      <Chips label="Location" value={areaId ?? areas[0]!.id} onChange={setAreaId} options={areas.map((a) => ({ value: a.id, label: areas.length > 1 ? `${a.siteName} · ${a.name}` : a.name }))} />

      <SectionTitle>When</SectionTitle>
      <Chips
        label="Date"
        value={date}
        onChange={setDate}
        options={days.map((d) => ({ value: d, label: `${WEEKDAY_SHORT[weekday(d)]} ${Number(d.slice(8))}` }))}
      />
      <Chips
        label="Shift"
        value={templateId}
        onChange={setTemplateId}
        options={[
          ...(templates.data ?? []).filter((t) => t.active).map((t) => ({ value: t.id, label: `${t.name} ${t.startTime}–${t.endTime}` })),
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {templateId === 'custom' && (
        <Card>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <TextField label="Start" value={start} onChangeText={setStart} placeholder="19:00" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="End" value={end} onChangeText={setEnd} placeholder="07:00" hint={end <= start ? 'Ends next day' : undefined} />
            </View>
          </View>
        </Card>
      )}
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} />
      <Text style={styles.hint}>Your coworkers who share schedules will see this shift.</Text>
      <ErrorText error={create.error} />
      <Button title="Add shift" onPress={() => create.mutate(undefined, { onSuccess: () => router.back() })} disabled={!valid} loading={create.isPending} />
    </Screen>
  );
}
