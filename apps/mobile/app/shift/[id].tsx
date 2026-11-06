import { durationHours } from '@shifthub/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Loading, Row, Screen, SectionTitle, styles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, tradeKeys, useApiMutation, useMyTrades, useNames } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { offerLabel, swapLabel } from '@/lib/labels';

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
      {mine && s.status === 'published' && Date.parse(s.startsAt) > Date.now() && <TradeActions shiftId={s.id} />}
    </Screen>
  );
}

/** Give away / swap / take back, depending on what is already happening with this shift. */
function TradeActions({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const { me } = useSession();
  const trades = useMyTrades();
  const [reason, setReason] = useState('');
  const settings = me?.organization?.settings;
  const offer = trades.data?.offers.find((o) => o.shift.id === shiftId && o.status === 'open');
  const swap = trades.data?.swaps.find(
    (w) =>
      (w.requesterShift?.id === shiftId || w.targetShift?.id === shiftId) &&
      (w.status === 'pending_peer' || w.status === 'pending_manager'),
  );
  const give = useApiMutation(() => api.marketplace.offer({ shiftId, reason: reason.trim() || null }), tradeKeys);
  const takeBack = useApiMutation(() => api.marketplace.cancelOffer(offer!.id), tradeKeys);

  if (trades.isPending) return <Loading />;

  if (offer) {
    const [label, tone] = offerLabel.open;
    return (
      <Card>
        <Badge label={`${label} · ${offer.pendingRequests} request${offer.pendingRequests === 1 ? '' : 's'}`} tone={tone} />
        <Text style={styles.muted}>Coworkers who can work it can request it. You keep the shift until someone is approved.</Text>
        <Button title="Take it back" variant="secondary" onPress={() => takeBack.mutate(undefined)} loading={takeBack.isPending} />
        <ErrorText error={takeBack.error} />
      </Card>
    );
  }
  if (swap) {
    const [label, tone] = swapLabel(swap.status, swap.target.id === me?.profile.id);
    return (
      <Card>
        <Badge label={`Swap · ${label}`} tone={tone} />
        <Button title="See in Requests" variant="secondary" onPress={() => router.push('/(tabs)/requests')} />
      </Card>
    );
  }

  return (
    <>
      <SectionTitle>Can’t make it?</SectionTitle>
      {settings?.allowPickup && (
        <Card>
          <Text style={styles.rowValue}>Give it away</Text>
          <TextField label="Reason (optional)" value={reason} onChangeText={setReason} placeholder="e.g. appointment" />
          <Button title="Give away shift" variant="secondary" onPress={() => give.mutate(undefined)} loading={give.isPending} />
          <ErrorText error={give.error} />
        </Card>
      )}
      {settings?.allowSwaps && (
        <Button title="Swap with a coworker" variant="secondary" onPress={() => router.push(`/swap/${shiftId}`)} />
      )}
      {!settings?.allowPickup && !settings?.allowSwaps && (
        <Text style={styles.hint}>Trading shifts is turned off. Talk to your manager.</Text>
      )}
    </>
  );
}
