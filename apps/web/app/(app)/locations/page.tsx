'use client';

import type { Area, Assignment, Site } from '@shifthub/shared';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useApiMutation, useLocations } from '@/lib/hooks';

type FieldDef = { name: string; label: string; required?: boolean; hint?: string; type?: string };

type Editor =
  | { kind: 'site'; item?: Site }
  | { kind: 'area'; siteId: string; item?: Area }
  | { kind: 'assignment'; areaId: string; item?: Assignment };

const FIELDS: Record<Editor['kind'], FieldDef[]> = {
  site: [
    { name: 'name', label: 'Name', required: true },
    { name: 'code', label: 'Code', hint: 'Short code, e.g. MG' },
    { name: 'address', label: 'Address' },
    { name: 'phone', label: 'Phone' },
  ],
  area: [
    { name: 'name', label: 'Name', required: true, hint: 'A unit or department, e.g. Birch Unit' },
    { name: 'description', label: 'Description' },
  ],
  assignment: [
    { name: 'name', label: 'Name', required: true, hint: 'A position or workstation, e.g. Charge Nurse' },
    { name: 'code', label: 'Code' },
    { name: 'requiredPosition', label: 'Required position', hint: 'Only people with this position can fill it (e.g. RN)' },
    { name: 'displayOrder', label: 'Display order', type: 'number' },
  ],
};

const LABEL = { site: 'site', area: 'area', assignment: 'position' } as const;

export default function LocationsPage() {
  const locations = useLocations();
  const [editor, setEditor] = useState<Editor | null>(null);
  const remove = useApiMutation(
    ({ kind, id }: { kind: Editor['kind']; id: string }) =>
      kind === 'site'
        ? api.locations.deleteSite(id)
        : kind === 'area'
          ? api.locations.deleteArea(id)
          : api.locations.deleteAssignment(id),
    [keys.locations],
  );

  const confirmDelete = (kind: Editor['kind'], id: string, name: string) => {
    if (window.confirm(`Delete ${LABEL[kind]} “${name}”?`)) remove.mutate({ kind, id });
  };

  return (
    <>
      <PageHeader
        title="Locations"
        description="Sites contain areas (units); areas contain positions that shifts are scheduled into."
        actions={<Button onClick={() => setEditor({ kind: 'site' })}>Add site</Button>}
      />
      <ErrorText error={locations.error ?? remove.error} />

      {locations.isPending ? (
        <Spinner />
      ) : !locations.data?.length ? (
        <EmptyState title="No sites yet">Add your first site to start building the schedule.</EmptyState>
      ) : (
        <div className="space-y-6">
          {locations.data.map((site) => (
            <Card key={site.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    {site.name} {site.code && <Badge>{site.code}</Badge>}
                  </h2>
                  <p className="text-sm text-slate-500">{[site.address, site.phone].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setEditor({ kind: 'area', siteId: site.id })}>
                    Add area
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditor({ kind: 'site', item: site })}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => confirmDelete('site', site.id, site.name)}>
                    Delete
                  </Button>
                </div>
              </div>

              {site.areas.length === 0 ? (
                <p className="px-5 py-4 text-sm text-slate-500">No areas yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {site.areas.map((area) => (
                    <div key={area.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-slate-800">{area.name}</p>
                          {area.description && <p className="text-xs text-slate-500">{area.description}</p>}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditor({ kind: 'assignment', areaId: area.id })}
                          >
                            Add position
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditor({ kind: 'area', siteId: site.id, item: area })}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => confirmDelete('area', area.id, area.name)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {area.assignments.map((x) => (
                          <li key={x.id} className="group flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 py-1 pl-2.5 pr-1 text-sm">
                            <button
                              className="hover:underline"
                              onClick={() => setEditor({ kind: 'assignment', areaId: area.id, item: x })}
                            >
                              {x.name}
                            </button>
                            {x.requiredPosition && <Badge tone="blue">{x.requiredPosition}</Badge>}
                            <button
                              aria-label={`Delete ${x.name}`}
                              className="rounded px-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                              onClick={() => confirmDelete('assignment', x.id, x.name)}
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                        {area.assignments.length === 0 && <li className="text-xs text-slate-400">No positions yet</li>}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {editor && <EditorModal editor={editor} onClose={() => setEditor(null)} />}
    </>
  );
}

function EditorModal({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const fields = FIELDS[editor.kind];
  const item = editor.item as Record<string, unknown> | undefined;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, item?.[f.name] == null ? '' : String(item[f.name])])),
  );

  const save = useApiMutation(async () => {
    const v = Object.fromEntries(
      fields.map((f) => [f.name, f.type === 'number' ? (values[f.name] ? Number(values[f.name]) : undefined) : values[f.name]?.trim() || null]),
    ) as Record<string, any>;
    v.name = values.name?.trim();
    if (editor.kind === 'site') {
      return editor.item ? api.locations.updateSite(editor.item.id, v) : api.locations.createSite(v as any);
    }
    if (editor.kind === 'area') {
      return editor.item ? api.locations.updateArea(editor.item.id, v) : api.locations.createArea({ ...v, siteId: editor.siteId } as any);
    }
    return editor.item
      ? api.locations.updateAssignment(editor.item.id, v)
      : api.locations.createAssignment({ ...v, areaId: editor.areaId } as any);
  }, [keys.locations]);

  const title = `${editor.item ? 'Edit' : 'Add'} ${LABEL[editor.kind]}`;
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!values.name?.trim() || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {fields.map((f, i) => (
        <Field key={f.name} label={f.label} hint={f.hint}>
          <Input
            autoFocus={i === 0}
            type={f.type ?? 'text'}
            required={f.required}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
          />
        </Field>
      ))}
      <ErrorText error={save.error} />
    </Modal>
  );
}
