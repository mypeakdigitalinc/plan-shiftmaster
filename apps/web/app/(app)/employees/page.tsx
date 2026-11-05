'use client';

import type { Profile, UserRole } from '@shifthub/shared';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useApiMutation, useInvitations, useLocations, useMemberAreas, useMembers } from '@/lib/hooks';
import { useSession } from '@/lib/session';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Manager' },
  { value: 'org_admin', label: 'Org admin' },
];
const roleLabel = (r: UserRole) => ROLES.find((x) => x.value === r)!.label;

export default function EmployeesPage() {
  const { me } = useSession();
  const isAdmin = me?.profile.role === 'org_admin';
  const members = useMembers();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | UserRole>('');
  const [editing, setEditing] = useState<Profile | null>(null);
  const [inviting, setInviting] = useState(false);

  const positions = useMemo(
    () => [...new Set((members.data ?? []).map((m) => m.position).filter(Boolean) as string[])].sort(),
    [members.data],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (members.data ?? []).filter(
      (m) =>
        (!roleFilter || m.role === roleFilter) &&
        (!q || [m.name, m.email ?? '', m.position ?? ''].some((v) => v.toLowerCase().includes(q))),
    );
  }, [members.data, search, roleFilter]);

  return (
    <>
      <PageHeader
        title="Employees"
        description={members.data ? `${members.data.length} people` : undefined}
        actions={<Button onClick={() => setInviting(true)}>Invite</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full max-w-xs">
        <Input
          placeholder="Search name, email, position"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search employees"
        />
        </div>
        <div className="w-44">
        <Select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        </div>
      </div>

      <ErrorText error={members.error} />
      {members.isPending ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title="No one matches" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Position</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Shares schedule</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-500">{m.email}</p>
                  </td>
                  <td className="px-4 py-2.5">{m.position ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={m.role === 'employee' ? 'slate' : 'blue'}>{roleLabel(m.role)}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={m.status === 'active' ? 'green' : 'red'}>{m.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{m.shareSchedule ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <PendingInvitations />

      <datalist id="positions">
        {positions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>

      {inviting && <InviteModal isAdmin={isAdmin} onClose={() => setInviting(false)} />}
      {editing && (
        <EditMemberModal
          member={editing}
          isAdmin={isAdmin}
          isSelf={editing.id === me?.profile.id}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function PendingInvitations() {
  const invitations = useInvitations();
  const revoke = useApiMutation(api.invitations.revoke, [keys.invitations]);
  if (!invitations.data?.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Pending invitations</h2>
      <Card className="divide-y divide-slate-100">
        {invitations.data.map((inv) => (
          <div key={inv.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span>
              <span className="font-medium">{inv.email}</span>{' '}
              <span className="text-slate-500">
                · {roleLabel(inv.role)}
                {inv.position && ` · ${inv.position}`} · expires {new Date(inv.expiresAt).toLocaleDateString()}
              </span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id)} disabled={revoke.isPending}>
              Revoke
            </Button>
          </div>
        ))}
      </Card>
      <ErrorText error={revoke.error} />
    </section>
  );
}

function InviteModal({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('employee');
  const [position, setPosition] = useState('');
  const create = useApiMutation(api.invitations.create, [keys.invitations]);
  const [copied, setCopied] = useState(false);

  if (create.data) {
    return (
      <Modal open title="Invitation created" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
        <p className="text-sm text-slate-600">
          Send this link to <strong>{create.data.email}</strong>. It works once and expires in 14 days.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={create.data.link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
          <Button
            variant="secondary"
            onClick={() => navigator.clipboard.writeText(create.data!.link).then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-xs text-slate-500">Email delivery is added later; for now share the link yourself.</p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title="Invite someone"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!email || create.isPending}
            onClick={() => create.mutate({ email, role, position: position || null })}
          >
            {create.isPending ? 'Creating…' : 'Create invitation'}
          </Button>
        </>
      }
    >
      <Field label="Email">
        <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Role" hint={isAdmin ? undefined : 'Only org admins can invite managers.'}>
        <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!isAdmin}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Position" hint="e.g. RN, RPN, PSW">
        <Input list="positions" value={position} onChange={(e) => setPosition(e.target.value)} />
      </Field>
      <ErrorText error={create.error} />
    </Modal>
  );
}

function EditMemberModal({
  member,
  isAdmin,
  isSelf,
  onClose,
}: {
  member: Profile;
  isAdmin: boolean;
  isSelf: boolean;
  onClose: () => void;
}) {
  const [role, setRole] = useState(member.role);
  const [status, setStatus] = useState(member.status);
  const [position, setPosition] = useState(member.position ?? '');
  const locations = useLocations();
  const memberAreas = useMemberAreas(member.id);
  const [areaIds, setAreaIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (memberAreas.data && areaIds === null) setAreaIds(new Set(memberAreas.data.areaIds));
  }, [memberAreas.data, areaIds]);

  const save = useApiMutation(
    async () => {
      const changes: Parameters<typeof api.members.update>[1] = {};
      if (position !== (member.position ?? '')) changes.position = position || null;
      if (isAdmin && !isSelf && role !== member.role) changes.role = role;
      if (isAdmin && !isSelf && status !== member.status) changes.status = status;
      if (Object.keys(changes).length) await api.members.update(member.id, changes);
      if (areaIds) await api.members.setAreas(member.id, [...areaIds]);
    },
    [keys.members, keys.memberAreas(member.id)],
  );

  const toggleArea = (id: string) =>
    setAreaIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      open
      title={member.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-500">{member.email}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!isAdmin || isSelf}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as Profile['status'])}
            disabled={!isAdmin || isSelf}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      </div>
      <Field label="Position">
        <Input list="positions" value={position} onChange={(e) => setPosition(e.target.value)} />
      </Field>

      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Can work in</legend>
        {locations.isPending || areaIds === null ? (
          <Spinner />
        ) : (
          <div className="max-h-56 space-y-3 overflow-y-auto rounded-md border border-slate-200 p-3">
            {locations.data?.map((site) => (
              <div key={site.id}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{site.name}</p>
                {site.areas.map((area) => (
                  <label key={area.id} className="mt-1 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={areaIds.has(area.id)} onChange={() => toggleArea(area.id)} />
                    {area.name}
                  </label>
                ))}
                {site.areas.length === 0 && <p className="text-xs text-slate-400">No areas yet</p>}
              </div>
            ))}
          </div>
        )}
      </fieldset>
      <ErrorText error={save.error} />
    </Modal>
  );
}
