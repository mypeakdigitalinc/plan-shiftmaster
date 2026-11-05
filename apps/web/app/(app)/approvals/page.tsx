'use client';

import type { Approvals, Swap } from '@shifthub/shared';
import { useMemo, useState } from 'react';
import { ShiftSummary } from '@/components/shift-summary';
import { Badge, Button, Card, EmptyState, ErrorText, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { tradeKeys, useApiMutation, useApprovals, useLocations } from '@/lib/hooks';

type Pickup = Approvals['pickups'][number];

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function ApprovalsPage() {
  const approvals = useApprovals();
  const locations = useLocations();

  const names = useMemo(() => {
    const areas = new Map<string, string>();
    const positions = new Map<string, string>();
    for (const site of locations.data ?? []) {
      for (const a of site.areas) {
        areas.set(a.id, a.name);
        for (const x of a.assignments) positions.set(x.id, x.name);
      }
    }
    return { areas, positions };
  }, [locations.data]);

  // Group pickup requests by offer (requests arrive oldest first)
  const offers = useMemo(() => {
    const map = new Map<string, Pickup[]>();
    for (const p of approvals.data?.pickups ?? []) map.set(p.offerId, [...(map.get(p.offerId) ?? []), p]);
    return [...map.values()].sort((a, b) => a[0]!.offer.shift.startsAt.localeCompare(b[0]!.offer.shift.startsAt));
  }, [approvals.data]);

  const summary = (s: Pickup['offer']['shift'] | null) => (
    <ShiftSummary
      shift={s}
      areaName={s ? names.areas.get(s.areaId) : undefined}
      positionName={s?.assignmentId ? names.positions.get(s.assignmentId) : undefined}
    />
  );

  const swaps = approvals.data?.swaps ?? [];
  const total = offers.length + swaps.length;

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Shift pickups and swaps waiting for a manager. Every approval re-checks eligibility and conflicts."
      />
      <ErrorText error={approvals.error} />
      {approvals.isPending ? (
        <Spinner />
      ) : total === 0 ? (
        <EmptyState title="Nothing waiting">New pickup requests and accepted swaps will show up here.</EmptyState>
      ) : (
        <div className="space-y-8">
          {offers.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Shift pickups ({offers.length})</h2>
              <div className="space-y-4">
                {offers.map((requests) => (
                  <PickupCard key={requests[0]!.offerId} requests={requests} summary={summary} />
                ))}
              </div>
            </section>
          )}
          {swaps.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Swaps ({swaps.length})</h2>
              <div className="space-y-4">
                {swaps.map((w) => (
                  <SwapCard key={w.id} swap={w} summary={summary} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function PickupCard({ requests, summary }: { requests: Pickup[]; summary: (s: Pickup['offer']['shift']) => React.ReactNode }) {
  const offer = requests[0]!.offer;
  const [busyId, setBusyId] = useState<string | null>(null);
  const decide = useApiMutation(
    ({ id, approve }: { id: string; approve: boolean }) => api.marketplace.decide(id, approve),
    tradeKeys,
  );
  const act = (id: string, approve: boolean) => {
    setBusyId(id);
    decide.mutate({ id, approve }, { onSettled: () => setBusyId(null) });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div className="text-sm">
          {summary(offer.shift)}
          <p className="mt-0.5 text-xs text-slate-500">
            {offer.offeredBy ? `Offered by ${offer.offeredBy.name}` : 'Open slot posted by a manager'}
            {offer.reason && ` · “${offer.reason}”`}
          </p>
        </div>
        <Badge tone="amber">
          {requests.length} request{requests.length === 1 ? '' : 's'}
        </Badge>
      </div>
      <ul className="divide-y divide-slate-100">
        {requests.map((r, i) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <div>
              <p className="font-medium text-slate-900">
                {r.employee.name}
                {r.employee.position && <span className="ml-1.5 text-xs text-slate-500">{r.employee.position}</span>}
                {i === 0 && (
                  <span className="ml-2">
                    <Badge tone="green">first request</Badge>
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                Requested {ago(r.createdAt)}
                {r.note && ` · “${r.note}”`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={!!busyId} onClick={() => act(r.id, false)}>
                Reject
              </Button>
              <Button size="sm" disabled={!!busyId} onClick={() => act(r.id, true)}>
                {busyId === r.id && decide.variables?.approve ? 'Approving…' : 'Approve'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {decide.error && (
        <div className="px-5 pb-3">
          <ErrorText error={decide.error} />
        </div>
      )}
    </Card>
  );
}

function SwapCard({ swap, summary }: { swap: Swap; summary: (s: Swap['requesterShift']) => React.ReactNode }) {
  const decide = useApiMutation((approve: boolean) => api.swaps.decide(swap.id, approve), tradeKeys);
  return (
    <Card className="px-5 py-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {swap.requester.name} gives
          </p>
          <p className="mt-1">{summary(swap.requesterShift)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{swap.target.name} gives</p>
          <p className="mt-1">{summary(swap.targetShift)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Proposed by {swap.requester.name} {ago(swap.createdAt)}, accepted by {swap.target.name}
          {swap.note && ` · “${swap.note}”`}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
            Reject
          </Button>
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate(true)}>
            Approve swap
          </Button>
        </div>
      </div>
      <ErrorText error={decide.error} />
    </Card>
  );
}
