'use client';

import type { Notification } from '@shifthub/shared';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Button, Card, cn, EmptyState, ErrorText, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useApiMutation, useAudit, useNotifications } from '@/lib/hooks';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Where a notification should take a manager. */
const linkFor = (n: Notification) =>
  ['pickup_requested', 'swap_waiting_approval'].includes(n.type) ? '/approvals' : n.data.shiftId ? '/schedule' : null;

const ACTION = { insert: 'created', update: 'changed', delete: 'deleted' } as Record<string, string>;
const ENTITY: Record<string, string> = {
  shifts: 'shift', shift_offers: 'marketplace offer', shift_offer_requests: 'pickup request', shift_swaps: 'swap',
  org_settings: 'settings', organizations: 'organization', profiles: 'member', invitations: 'invitation', sites: 'site',
  areas: 'area', assignments: 'position', shift_templates: 'shift template', employee_areas: 'member area',
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const list = useNotifications();
  const audit = useAudit();
  const markAll = useApiMutation(() => api.notifications.markRead(), [['notifications']]);
  const markOne = (id: string) => api.notifications.markRead([id]).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="secondary" disabled={!list.data?.unreadCount || markAll.isPending} onClick={() => markAll.mutate(undefined)}>
            Mark all read
          </Button>
        }
      />
      <ErrorText error={list.error} />
      {list.isPending ? (
        <Spinner />
      ) : !list.data?.items.length ? (
        <EmptyState title="No notifications yet">Pickup requests and swaps that need you will show up here.</EmptyState>
      ) : (
        <Card className="divide-y divide-slate-100">
          {list.data.items.map((n) => {
            const href = linkFor(n);
            const content = (
              <div className="flex items-start gap-3 px-5 py-3">
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-sky-600')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</p>
                  <p className="text-sm text-slate-600">{n.body}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{when(n.createdAt)}</span>
              </div>
            );
            return href ? (
              <Link key={n.id} href={href} onClick={() => !n.readAt && markOne(n.id)} className="block hover:bg-slate-50">
                {content}
              </Link>
            ) : (
              <div key={n.id} onClick={() => !n.readAt && markOne(n.id)}>
                {content}
              </div>
            );
          })}
        </Card>
      )}

      <h2 className="mb-2 mt-10 text-sm font-semibold text-slate-700">Recent activity</h2>
      <ErrorText error={audit.error} />
      {audit.data && (
        <Card className="divide-y divide-slate-100 text-sm">
          {audit.data.length === 0 && <p className="px-5 py-3 text-slate-500">No changes yet.</p>}
          {audit.data.map((a) => (
            <div key={a.id} className="flex justify-between gap-3 px-5 py-2">
              <span>
                <span className="font-medium">{a.userName ?? 'System'}</span> {ACTION[a.action] ?? a.action} a{' '}
                {ENTITY[a.entityType] ?? a.entityType}
                {a.action === 'update' && (
                  <span className="text-slate-500"> ({Object.keys(a.details).join(', ')})</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{when(a.createdAt)}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
