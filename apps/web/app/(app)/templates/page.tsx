'use client';

import type { ShiftTemplate } from '@shifthub/shared';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Modal, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, useApiMutation, useTemplates } from '@/lib/hooks';

const hours = (t: { startTime: string; endTime: string }) => {
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  let d = toMin(t.endTime) - toMin(t.startTime);
  if (d <= 0) d += 24 * 60;
  return d / 60;
};

export default function TemplatesPage() {
  const templates = useTemplates();
  const [editing, setEditing] = useState<ShiftTemplate | 'new' | null>(null);
  const remove = useApiMutation(api.shiftTemplates.remove, [keys.templates]);

  return (
    <>
      <PageHeader
        title="Shift templates"
        description="Standard shift times used when building schedules."
        actions={<Button onClick={() => setEditing('new')}>Add template</Button>}
      />
      <ErrorText error={templates.error ?? remove.error} />
      {templates.isPending ? (
        <Spinner />
      ) : !templates.data?.length ? (
        <EmptyState title="No templates" />
      ) : (
        <Card className="divide-y divide-slate-100">
          {templates.data.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="h-8 w-1.5 rounded-full" style={{ background: t.color }} aria-hidden />
                <div>
                  <p className="font-medium text-slate-900">
                    {t.name} {t.isDefault && <Badge>default</Badge>} {!t.active && <Badge tone="red">inactive</Badge>}
                  </p>
                  <p className="text-sm text-slate-500">
                    {t.startTime} – {t.endTime} · {hours(t)}h{t.overnight && ' · overnight'}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.confirm(`Delete “${t.name}”?`) && remove.mutate(t.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      {editing && <TemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateModal({ template, onClose }: { template: ShiftTemplate | null; onClose: () => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [startTime, setStart] = useState(template?.startTime ?? '07:00');
  const [endTime, setEnd] = useState(template?.endTime ?? '15:00');
  const [color, setColor] = useState(template?.color ?? '#0f766e');
  const save = useApiMutation(
    () =>
      template
        ? api.shiftTemplates.update(template.id, { name, startTime, endTime, color })
        : api.shiftTemplates.create({ name, startTime, endTime, color }),
    [keys.templates],
  );
  const overnight = endTime <= startTime;

  return (
    <Modal
      open
      title={template ? 'Edit template' : 'Add template'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="12h Day" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start">
          <Input type="time" value={startTime} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End" hint={overnight ? 'Ends the next day' : undefined}>
          <Input type="time" value={endTime} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Color">
        <Input type="color" className="h-10 w-20 p-1" value={color} onChange={(e) => setColor(e.target.value)} />
      </Field>
      <ErrorText error={save.error} />
    </Modal>
  );
}
