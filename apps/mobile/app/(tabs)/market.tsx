import type { Offer } from '@shifthub/shared';
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShiftLine } from '@/components/shift-line';
import { Badge, Button, Card, Empty, ErrorText, Loading, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { tradeKeys, useApiMutation, useMarketplace } from '@/lib/hooks';
import { shortDate } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { space } from '@/lib/theme';

export default function OpenShifts() {
  const { me } = useSession();
  const market = useMarketplace();
  const [showAll, setShowAll] = useState(false);
  const [won, setWon] = useState<string | null>(null);
  const myId = me?.profile.id;
  const settings = me?.organization?.settings;

  const offers = market.data ?? [];
  const mine = offers.filter((o) => o.offeredBy?.id === myId);
  const others = offers.filter((o) => o.offeredBy?.id !== myId);
  const takeable = others.filter((o) => o.eligible && !o.conflict);
  const notForMe = others.filter((o) => !(o.eligible && !o.conflict));

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={market.isRefetching} onRefresh={() => void market.refetch()} />}
      >
        {settings && !settings.allowPickup && <ErrorText error="Shift pickups are turned off for your organization." />}
        <Text style={styles.muted}>
          {settings?.requireApproval
            ? 'Request a shift and your manager picks who gets it.'
            : 'The first eligible person to request a shift gets it.'}
        </Text>
        {won && (
          <Card style={{ backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }}>
            <Text accessibilityRole="alert" style={{ color: '#047857', fontWeight: '600' }}>
              It’s yours — {won} is now on your schedule.
            </Text>
          </Card>
        )}
        <ErrorText error={market.error} />
        {market.isPending ? (
          <Loading />
        ) : takeable.length === 0 ? (
          <Empty title="No shifts you can pick up right now">Pull down to refresh.</Empty>
        ) : (
          takeable.map((o) => <OfferCard key={o.id} offer={o} onWon={setWon} />)
        )}

        {mine.length > 0 && (
          <>
            <Text style={styles.section}>Shifts you’re giving away</Text>
            {mine.map((o) => (
              <Card key={o.id}>
                <ShiftLine shift={o.shift} />
                <Badge label={`${o.pendingRequests} request${o.pendingRequests === 1 ? '' : 's'}`} tone="blue" />
              </Card>
            ))}
          </>
        )}

        {notForMe.length > 0 && (
          <Button
            variant="ghost"
            title={showAll ? 'Hide shifts you can’t take' : `Show ${notForMe.length} shift${notForMe.length === 1 ? '' : 's'} you can’t take`}
            onPress={() => setShowAll((v) => !v)}
          />
        )}
        {showAll &&
          notForMe.map((o) => (
            <Card key={o.id} style={{ opacity: 0.7 }}>
              <ShiftLine shift={o.shift} who={o.offeredBy?.name ?? 'Open slot'} />
              <Badge label={o.conflict ? 'You’re working then' : 'Not your unit or position'} />
            </Card>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function OfferCard({ offer, onWon }: { offer: Offer; onWon: (label: string) => void }) {
  const request = useApiMutation(async () => {
    const r = await api.marketplace.requestShift(offer.id);
    if (r.status === 'approved') onWon(`the ${offer.shift.startTime}–${offer.shift.endTime} shift on ${shortDate(offer.shift.date)}`);
    return r;
  }, tradeKeys);
  const withdraw = useApiMutation(() => api.marketplace.withdraw(offer.myRequest!.id), tradeKeys);
  const pending = offer.myRequest?.status === 'pending';

  return (
    <Card>
      <ShiftLine shift={offer.shift} who={offer.offeredBy ? `From ${offer.offeredBy.name}` : 'Open slot'} />
      {offer.reason && <Text style={styles.hint}>“{offer.reason}”</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        {pending ? <Badge label="Requested — waiting for manager" tone="amber" /> : <View />}
        {pending ? (
          <Button title="Withdraw" variant="secondary" onPress={() => withdraw.mutate(undefined)} loading={withdraw.isPending} />
        ) : (
          <Button title="Request shift" onPress={() => request.mutate(undefined)} loading={request.isPending} />
        )}
      </View>
      <ErrorText error={request.error ?? withdraw.error} />
    </Card>
  );
}
