import type { MyTrades, Swap } from '@shifthub/shared';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ShiftLine } from '@/components/shift-line';
import { Badge, Button, Card, Empty, ErrorText, Loading, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { tradeKeys, useApiMutation, useMyTrades } from '@/lib/hooks';
import { offerLabel, requestLabel, swapLabel } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

export default function Requests() {
  const { me } = useSession();
  const trades = useMyTrades();
  const myId = me?.profile.id;
  const data = trades.data;

  const incoming = (data?.swaps ?? []).filter((w) => w.target.id === myId && w.status === 'pending_peer');
  const otherSwaps = (data?.swaps ?? []).filter((w) => !incoming.includes(w));
  const empty = data && !data.offers.length && !data.requests.length && !data.swaps.length;

  return (
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={trades.isRefetching} onRefresh={() => void trades.refetch()} />}
      >
        <ErrorText error={trades.error} />
        {trades.isPending && <Loading />}
        {empty && (
          <Empty title="Nothing here yet">Give away or swap a shift from its details, or pick one up under Open shifts.</Empty>
        )}

        {incoming.length > 0 && (
          <>
            <Text style={[styles.section, { color: colors.warn }]}>Swap requests for you</Text>
            {incoming.map((w) => (
              <IncomingSwap key={w.id} swap={w} />
            ))}
          </>
        )}

        {otherSwaps.length > 0 && (
          <>
            <Text style={styles.section}>Swaps</Text>
            {otherSwaps.map((w) => (
              <SwapCard key={w.id} swap={w} myId={myId!} />
            ))}
          </>
        )}

        {data && data.offers.length > 0 && (
          <>
            <Text style={styles.section}>Shifts I gave away</Text>
            {data.offers.map((o) => (
              <OfferRow key={o.id} offer={o} />
            ))}
          </>
        )}

        {data && data.requests.length > 0 && (
          <>
            <Text style={styles.section}>Shifts I asked for</Text>
            {data.requests.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function IncomingSwap({ swap }: { swap: Swap }) {
  const respond = useApiMutation((accept: boolean) => api.swaps.respond(swap.id, accept), tradeKeys);
  return (
    <Card style={{ borderColor: '#fcd34d' }}>
      <Text style={styles.rowValue}>{swap.requester.name} wants to swap</Text>
      {swap.note && <Text style={styles.hint}>“{swap.note}”</Text>}
      <Text style={styles.label}>You’d work</Text>
      <ShiftLine shift={swap.requesterShift} />
      <Text style={styles.label}>Instead of</Text>
      <ShiftLine shift={swap.targetShift} />
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <Button title="Decline" variant="secondary" style={{ flex: 1 }} onPress={() => respond.mutate(false)} disabled={respond.isPending} />
        <Button title="Accept swap" style={{ flex: 1 }} onPress={() => respond.mutate(true)} loading={respond.isPending} />
      </View>
      <ErrorText error={respond.error} />
    </Card>
  );
}

function SwapCard({ swap, myId }: { swap: Swap; myId: string }) {
  const iAmTarget = swap.target.id === myId;
  const [label, tone] = swapLabel(swap.status, iAmTarget);
  const cancel = useApiMutation(() => api.swaps.cancel(swap.id), tradeKeys);
  const other = iAmTarget ? swap.requester : swap.target;
  const give = iAmTarget ? swap.targetShift : swap.requesterShift;
  const get = iAmTarget ? swap.requesterShift : swap.targetShift;
  const pending = swap.status === 'pending_peer' || swap.status === 'pending_manager';
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Text style={styles.rowValue}>Swap with {other.name}</Text>
        <Badge label={label} tone={tone} />
      </View>
      <Text style={styles.label}>You give</Text>
      <ShiftLine shift={give} />
      <Text style={styles.label}>You get</Text>
      <ShiftLine shift={get} />
      {!iAmTarget && pending && (
        <Button title="Cancel swap" variant="danger" onPress={() => cancel.mutate(undefined)} loading={cancel.isPending} />
      )}
      <ErrorText error={cancel.error} />
    </Card>
  );
}

function OfferRow({ offer }: { offer: MyTrades['offers'][number] }) {
  const [label, tone] = offerLabel[offer.status];
  const takeBack = useApiMutation(() => api.marketplace.cancelOffer(offer.id), tradeKeys);
  return (
    <Card>
      <ShiftLine shift={offer.shift} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Badge label={offer.status === 'open' ? `${label} · ${offer.pendingRequests} request${offer.pendingRequests === 1 ? '' : 's'}` : label} tone={tone} />
        {offer.status === 'open' && (
          <Button title="Take back" variant="secondary" onPress={() => takeBack.mutate(undefined)} loading={takeBack.isPending} />
        )}
      </View>
      <ErrorText error={takeBack.error} />
    </Card>
  );
}

function RequestRow({ request }: { request: MyTrades['requests'][number] }) {
  const [label, tone] = requestLabel[request.status];
  const withdraw = useApiMutation(() => api.marketplace.withdraw(request.id), tradeKeys);
  return (
    <Card>
      <ShiftLine shift={request.offer?.shift ?? null} who={request.offer?.offeredBy?.name ?? (request.offer ? 'Open slot' : null)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Badge label={label} tone={tone} />
        {request.status === 'pending' && (
          <Button title="Withdraw" variant="secondary" onPress={() => withdraw.mutate(undefined)} loading={withdraw.isPending} />
        )}
      </View>
      <ErrorText error={withdraw.error} />
    </Card>
  );
}
