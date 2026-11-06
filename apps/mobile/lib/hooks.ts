import { addDays, todayIn } from '@shifthub/shared';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';
import { useSession } from './session';

export const keys = {
  me: ['me'] as const,
  shifts: ['shifts'] as const,
  locations: ['locations'] as const,
  templates: ['shift-templates'] as const,
  availability: ['my-availability'] as const,
};

export function useToday() {
  const { me } = useSession();
  return todayIn(me?.organization?.timezone ?? 'America/Toronto');
}

/** Only run queries while signed in, so screens unmounting after sign-out don't fire 401s. */
const useSignedIn = () => !!useSession().session;

export function useMyShifts(days = 28) {
  const today = useToday();
  const enabled = useSignedIn();
  const from = addDays(today, -1);
  const to = addDays(today, days);
  return useQuery({
    queryKey: [...keys.shifts, 'mine', from, to],
    queryFn: () => api.shifts.list({ from, to, mine: 'true' }),
    enabled,
  });
}

export const useLocations = () =>
  useQuery({ queryKey: keys.locations, queryFn: api.locations.list, enabled: useSignedIn() });
export const useTemplates = () =>
  useQuery({ queryKey: keys.templates, queryFn: api.shiftTemplates.list, enabled: useSignedIn() });
export const useMyAvailability = () =>
  useQuery({ queryKey: keys.availability, queryFn: api.me.availability, enabled: useSignedIn() });

/** areaId → "Unit name", assignmentId → "Position name" */
export function useNames() {
  const locations = useLocations();
  return useMemo(() => {
    const areas = new Map<string, string>();
    const sites = new Map<string, string>();
    const positions = new Map<string, string>();
    for (const s of locations.data ?? []) {
      sites.set(s.id, s.name);
      for (const a of s.areas) {
        areas.set(a.id, a.name);
        for (const x of a.assignments) positions.set(x.id, x.name);
      }
    }
    return { areas, sites, positions, ready: !!locations.data };
  }, [locations.data]);
}

export function useApiMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, invalidate: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

// ---------- M2: trades ----------
export const tradeKeys: QueryKey[] = [['trades'], ['marketplace'], keys.shifts];

export const useMyTrades = () => useQuery({ queryKey: ['trades'], queryFn: api.trades.mine, enabled: useSignedIn() });
export const useMarketplace = () =>
  useQuery({ queryKey: ['marketplace'], queryFn: () => api.marketplace.list(), enabled: useSignedIn() });

/** Areas I may work (for filtering swap candidates client-side; the server re-checks). */
export function useMyAreas() {
  const { me, session } = useSession();
  return useQuery({
    queryKey: ['my-areas', me?.profile.id],
    queryFn: () => api.members.areas(me!.profile.id),
    enabled: !!session && !!me?.profile.id,
  });
}

/** Coworkers' published future shifts visible to me (shared schedules), next 4 weeks. */
export function useVisibleShifts(days = 28) {
  const today = useToday();
  const enabled = useSignedIn();
  const to = addDays(today, days);
  return useQuery({
    queryKey: [...keys.shifts, 'visible', today, to],
    queryFn: () => api.shifts.list({ from: today, to, status: 'published' }),
    enabled,
  });
}

// ---------- M3: notifications ----------
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api.notifications.list(), enabled: useSignedIn(), refetchInterval: 60_000 });

/** Where tapping a notification should go. */
export function routeForNotification(type: string, data: Record<string, unknown>): string {
  if (type === 'shift_available') return '/(tabs)/market';
  if (data.swapId || data.requestId || data.offerId) return '/(tabs)/requests';
  if (typeof data.shiftId === 'string') return `/shift/${data.shiftId}`;
  return '/(tabs)';
}
