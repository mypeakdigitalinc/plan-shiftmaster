'use client';

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  me: ['me'] as const,
  members: ['members'] as const,
  memberAreas: (id: string) => ['members', id, 'areas'] as const,
  invitations: ['invitations'] as const,
  locations: ['locations'] as const,
  templates: ['shift-templates'] as const,
  organization: ['organization'] as const,
  shifts: ['shifts'] as const,
};

export const useMembers = () => useQuery({ queryKey: keys.members, queryFn: () => api.members.list() });
export const useAreaMembers = (areaId: string | undefined) =>
  useQuery({
    queryKey: [...keys.members, 'area', areaId],
    queryFn: () => api.members.list({ areaId }),
    enabled: !!areaId,
  });
export const useAreaAvailability = (areaId: string | undefined) =>
  useQuery({
    queryKey: ['availability', areaId],
    queryFn: () => api.members.areaAvailability(areaId!),
    enabled: !!areaId,
  });
export const useShifts = (from: string, to: string) =>
  useQuery({ queryKey: [...keys.shifts, from, to], queryFn: () => api.shifts.list({ from, to }) });
export const useInvitations = (enabled = true) =>
  useQuery({ queryKey: keys.invitations, queryFn: api.invitations.list, enabled });
export const useLocations = () => useQuery({ queryKey: keys.locations, queryFn: api.locations.list });
export const useTemplates = () => useQuery({ queryKey: keys.templates, queryFn: api.shiftTemplates.list });
export const useMemberAreas = (id: string | null) =>
  useQuery({ queryKey: keys.memberAreas(id ?? ''), queryFn: () => api.members.areas(id!), enabled: !!id });

/** Mutation that invalidates the given query keys on success. */
export function useApiMutation<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, invalidate: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}
