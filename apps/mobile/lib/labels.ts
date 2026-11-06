import type { OfferStatus, RequestStatus, SwapStatus } from '@shifthub/shared';

type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue';

export const offerLabel: Record<OfferStatus, [string, Tone]> = {
  open: ['On the marketplace', 'blue'],
  filled: ['Picked up', 'green'],
  cancelled: ['Taken back', 'slate'],
  expired: ['Expired', 'slate'],
};

export const requestLabel: Record<RequestStatus, [string, Tone]> = {
  pending: ['Waiting for manager', 'amber'],
  approved: ['Approved — it’s yours', 'green'],
  rejected: ['Not approved', 'red'],
  withdrawn: ['Withdrawn', 'slate'],
};

export const swapLabel = (status: SwapStatus, iAmTarget: boolean): [string, Tone] =>
  ({
    pending_peer: iAmTarget ? (['Waiting for you', 'amber'] as [string, Tone]) : (['Waiting for coworker', 'amber'] as [string, Tone]),
    pending_manager: ['Waiting for manager', 'amber'] as [string, Tone],
    approved: ['Swapped', 'green'] as [string, Tone],
    rejected: ['Not approved', 'red'] as [string, Tone],
    declined: ['Declined', 'slate'] as [string, Tone],
    cancelled: ['Cancelled', 'slate'] as [string, Tone],
  })[status];

export const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
