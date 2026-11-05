'use client';

import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui';
import { useLocations, useMembers, useTemplates } from '@/lib/hooks';
import { useSession } from '@/lib/session';

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-shadow hover:shadow-md">
        <p className="text-sm text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { me } = useSession();
  const members = useMembers();
  const locations = useLocations();
  const templates = useTemplates();
  const org = me!.organization!;

  const areas = locations.data?.flatMap((s) => s.areas) ?? [];
  const positions = areas.flatMap((a) => a.assignments);
  const active = members.data?.filter((m) => m.status === 'active') ?? [];

  return (
    <>
      <PageHeader
        title={org.name}
        description={`${org.settings.mode === 'group' ? 'Worker group' : 'Facility'} · ${org.timezone}`}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="People" value={members.isPending ? '…' : active.length} href="/employees" />
        <Stat label="Sites" value={locations.isPending ? '…' : (locations.data?.length ?? 0)} href="/locations" />
        <Stat label="Areas / positions" value={locations.isPending ? '…' : `${areas.length} / ${positions.length}`} href="/locations" />
        <Stat label="Shift templates" value={templates.isPending ? '…' : (templates.data?.length ?? 0)} href="/templates" />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold">Scheduling rules</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={org.settings.requireApproval ? 'amber' : 'green'}>
            {org.settings.requireApproval ? 'Manager approves trades' : 'Trades auto-approve'}
          </Badge>
          <Badge tone={org.settings.allowPickup ? 'green' : 'slate'}>Pickups {org.settings.allowPickup ? 'on' : 'off'}</Badge>
          <Badge tone={org.settings.allowSwaps ? 'green' : 'slate'}>Swaps {org.settings.allowSwaps ? 'on' : 'off'}</Badge>
          <Badge tone={org.settings.allowSelfScheduling ? 'green' : 'slate'}>
            Self-scheduling {org.settings.allowSelfScheduling ? 'on' : 'off'}
          </Badge>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Coverage and pending approvals appear here once the schedule and approval screens ship (W2–W4).
        </p>
      </Card>
    </>
  );
}
