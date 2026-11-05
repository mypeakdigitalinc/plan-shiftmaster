'use client';

import type { UpdateOrgSettingsInput } from '@shifthub/shared';
import { useState } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Toggle } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';

export default function SettingsPage() {
  const { me } = useSession();
  const org = me!.organization!;
  const isAdmin = me!.profile.role === 'org_admin';
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);

  const saveOrg = useApiMutation(() => api.organization.update({ name, timezone }), [keys.me]);
  const saveSetting = useApiMutation((input: UpdateOrgSettingsInput) => api.organization.updateSettings(input), [keys.me]);
  const rotate = useApiMutation(api.organization.rotateInviteCode, [keys.me]);

  const s = org.settings;
  const toggles: { key: keyof UpdateOrgSettingsInput; label: string; description: string; value: boolean }[] = [
    {
      key: 'requireApproval',
      label: 'Managers approve trades',
      description: 'Pickups and swaps wait for a manager. Off = first eligible request wins.',
      value: s.requireApproval,
    },
    { key: 'allowPickup', label: 'Shift pickups', description: 'Employees can give away shifts and pick up open ones.', value: s.allowPickup },
    { key: 'allowSwaps', label: 'Shift swaps', description: 'Employees can swap shifts with coworkers.', value: s.allowSwaps },
    {
      key: 'allowSelfScheduling',
      label: 'Self-scheduling',
      description: 'Employees add their own shifts (typical for worker groups).',
      value: s.allowSelfScheduling,
    },
  ];

  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? undefined : 'Only org admins can change settings.'} />
      <div className="grid max-w-3xl gap-6">
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Organization</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} />
            </Field>
            <Field label="Timezone" hint="IANA name, e.g. America/Toronto">
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!isAdmin} />
            </Field>
          </div>
          <ErrorText error={saveOrg.error} />
          {isAdmin && (
            <Button
              disabled={saveOrg.isPending || (name === org.name && timezone === org.timezone)}
              onClick={() => saveOrg.mutate(undefined)}
            >
              {saveOrg.isSuccess && name === org.name && timezone === org.timezone ? 'Saved' : 'Save'}
            </Button>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold">
            Scheduling rules <Badge>{s.mode === 'group' ? 'Worker group' : 'Facility'}</Badge>
          </h2>
          <div className="divide-y divide-slate-100">
            {toggles.map((t) => (
              <Toggle
                key={t.key}
                label={t.label}
                description={t.description}
                checked={t.value}
                disabled={!isAdmin || saveSetting.isPending}
                onChange={(v) => saveSetting.mutate({ [t.key]: v })}
              />
            ))}
          </div>
          <ErrorText error={saveSetting.error} />
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Invite code</h2>
          <p className="text-sm text-slate-500">
            Anyone with this code can join as an employee from the mobile app. Rotate it if it leaks.
          </p>
          <div className="flex items-center gap-3">
            <code className="rounded bg-slate-100 px-3 py-1.5 font-mono text-base tracking-widest">{s.inviteCode}</code>
            {isAdmin && (
              <Button
                variant="secondary"
                size="sm"
                disabled={rotate.isPending}
                onClick={() => window.confirm('Generate a new code? The old one stops working.') && rotate.mutate(undefined)}
              >
                Rotate
              </Button>
            )}
          </div>
          <ErrorText error={rotate.error} />
        </Card>
      </div>
    </>
  );
}
