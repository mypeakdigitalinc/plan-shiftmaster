/**
 * D3 routes: shifts, publish, copy week.
 * Visibility (drafts, schedule sharing) is enforced by Postgres RLS; these
 * handlers only translate between local dates/times and timestamps.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  copyWeekInput,
  createShiftInput,
  listShiftsQuery,
  publishShiftsInput,
  shift,
  updateShiftInput,
} from '@shifthub/shared';
import type { Tx } from '../db';
import { HttpError } from '../errors';
import {
  body,
  errors,
  idParam,
  isManager,
  json,
  notFound,
  requireManager,
  requireOrg,
  secured,
  type Api,
  type Run,
} from '../http';
import { hhmm, toShift } from '../mappers';

type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fragment = any;

const MAX_RANGE_DAYS = 62;
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

export function selectShifts(tx: Tx, where: Fragment) {
  return tx`
    select s.*, p.name as employee_name, z.tz,
           to_char(s.starts_at at time zone z.tz, 'YYYY-MM-DD') as local_date,
           (s.starts_at at time zone z.tz)::time::text as local_start,
           (s.ends_at at time zone z.tz)::time::text as local_end
    from app.shifts s
    cross join lateral (select app.area_timezone(s.area_id) as tz) z
    left join app.profiles p on p.id = s.employee_id
    where s.deleted_at is null ${where}
    order by s.starts_at, s.area_id, s.assignment_id`;
}

async function loadShift(tx: Tx, id: string): Promise<Row> {
  const [row] = await selectShifts(tx, tx`and s.id = ${id}`);
  if (!row) throw notFound('Shift');
  return row;
}

/** Local date + template or explicit times → timestamps in the area's timezone. */
async function resolveTimes(
  tx: Tx,
  areaId: string,
  date: string,
  templateId: string | null | undefined,
  startTime: string | undefined,
  endTime: string | undefined,
) {
  let start = startTime;
  let end = endTime;
  if (templateId) {
    const [t] = await tx`
      select start_time::text, end_time::text from app.shift_templates
      where id = ${templateId} and deleted_at is null`;
    if (!t) throw notFound('Shift template');
    start ??= hhmm(t.start_time);
    end ??= hhmm(t.end_time);
  }
  if (!start || !end) throw new HttpError(400, 'bad_request', 'Give shiftTemplateId or startTime + endTime');
  if (start === end) throw new HttpError(400, 'bad_request', 'Start and end cannot be the same');

  const [area] = await tx`select app.area_timezone(id) as tz from app.areas where id = ${areaId} and deleted_at is null`;
  if (!area) throw notFound('Area');
  const [r] = await tx`select * from app.local_range(${date}::date, ${start}::time, ${end}::time, ${area.tz})`;
  return { starts_at: r!.starts_at as Date, ends_at: r!.ends_at as Date };
}

export function registerShiftRoutes(app: Api, run: Run) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/shifts',
      tags: ['Shifts'],
      summary: 'Shifts in a local date range (managers: all; employees: own + coworkers who share)',
      security: secured,
      request: { query: listShiftsQuery },
      responses: { 200: json(z.array(shift), 'Shifts'), 400: errors[400], 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const q = c.req.valid('query');
      const range = daysBetween(q.from, q.to);
      if (!(range >= 0 && range <= MAX_RANGE_DAYS)) {
        throw new HttpError(400, 'bad_request', `Range must be 0–${MAX_RANGE_DAYS} days with to >= from`);
      }
      const me = c.get('user').sub;
      const rows = await run(c, async (tx) => {
        await requireOrg(tx);
        const filters = [
          // coarse UTC window uses the index; exact local-date filter follows
          // timestamptz bounds (not date) so the comparison is leakproof and can use the index under RLS
          tx`and s.starts_at >= (${q.from}::date - 1)::timestamptz and s.starts_at < (${q.to}::date + 2)::timestamptz`,
          tx`and (s.starts_at at time zone z.tz)::date between ${q.from}::date and ${q.to}::date`,
          q.areaId ? tx`and s.area_id = ${q.areaId}` : tx``,
          q.employeeId ? tx`and s.employee_id = ${q.employeeId}` : tx``,
          q.mine === 'true' ? tx`and s.employee_id = ${me}` : tx``,
          q.status ? tx`and s.status = ${q.status}` : tx``,
        ];
        return selectShifts(tx, filters.reduce((a, b) => tx`${a} ${b}`));
      });
      return c.json(rows.map(toShift), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/shifts/{id}',
      tags: ['Shifts'],
      security: secured,
      request: { params: idParam },
      responses: { 200: json(shift, 'Shift'), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const row = await run(c, (tx) => loadShift(tx, id));
      return c.json(toShift(row), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/shifts',
      tags: ['Shifts'],
      summary: 'Create a shift (Manager; or yourself when self-scheduling is on)',
      security: secured,
      request: body(createShiftInput),
      responses: {
        201: json(shift, 'Created'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
        409: errors[409],
      },
    }),
    async (c) => {
      const input = c.req.valid('json');
      const me = c.get('user').sub;
      const row = await run(c, async (tx) => {
        await requireOrg(tx);
        const manager = await isManager(tx);
        if (!manager) {
          const [{ ok }] = (await tx`select app.self_scheduling_enabled() as ok`) as unknown as [{ ok: boolean }];
          if (!ok) throw new HttpError(403, 'forbidden', 'Only managers can add shifts in this organization');
          if (input.employeeId !== undefined && input.employeeId !== me) {
            throw new HttpError(403, 'forbidden', 'You can only add shifts for yourself');
          }
        }
        const times = await resolveTimes(tx, input.areaId, input.date, input.shiftTemplateId, input.startTime, input.endTime);
        const [r] = await tx`
          insert into app.shifts ${tx({
            area_id: input.areaId,
            assignment_id: input.assignmentId ?? null,
            employee_id: manager ? (input.employeeId ?? null) : me,
            shift_template_id: input.shiftTemplateId ?? null,
            notes: input.notes ?? null,
            status: input.status ?? (manager ? 'draft' : 'published'),
            ...times,
          })}
          returning id`;
        return loadShift(tx, r!.id);
      });
      return c.json(toShift(row), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'patch',
      path: '/v1/shifts/{id}',
      tags: ['Shifts'],
      summary: 'Edit, reassign, cancel or move a shift',
      security: secured,
      request: { params: idParam, ...body(updateShiftInput) },
      responses: {
        200: json(shift, 'Updated'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
        404: errors[404],
        409: errors[409],
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const row = await run(c, async (tx) => {
        await requireOrg(tx);
        const current = await loadShift(tx, id);
        const fields: Record<string, unknown> = {};
        if (input.assignmentId !== undefined) fields.assignment_id = input.assignmentId;
        if (input.employeeId !== undefined) fields.employee_id = input.employeeId;
        if (input.notes !== undefined) fields.notes = input.notes;
        if (input.status !== undefined) fields.status = input.status;

        const timesChanged =
          input.date !== undefined ||
          input.startTime !== undefined ||
          input.endTime !== undefined ||
          input.shiftTemplateId !== undefined;
        if (timesChanged) {
          const templateId =
            input.shiftTemplateId !== undefined
              ? input.shiftTemplateId
              : input.startTime || input.endTime
                ? null
                : current.shift_template_id;
          const explicit = !templateId || input.startTime || input.endTime;
          Object.assign(
            fields,
            { shift_template_id: templateId },
            await resolveTimes(
              tx,
              current.area_id,
              input.date ?? current.local_date,
              templateId,
              input.startTime ?? (explicit ? hhmm(current.local_start) : undefined),
              input.endTime ?? (explicit ? hhmm(current.local_end) : undefined),
            ),
          );
        }
        if (!Object.keys(fields).length) return current;

        const updated = await tx`update app.shifts set ${tx(fields)} where id = ${id} and deleted_at is null returning id`;
        if (!updated.length) throw new HttpError(403, 'forbidden', 'You cannot edit this shift');
        return loadShift(tx, id);
      });
      return c.json(toShift(row), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/shifts/{id}',
      tags: ['Shifts'],
      summary: 'Delete a shift (use status=cancelled to keep a record of published shifts)',
      security: secured,
      request: { params: idParam },
      responses: { 204: { description: 'Deleted' }, 401: errors[401], 403: errors[403], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await run(c, async (tx) => {
        await loadShift(tx, id);
        const rows = await tx`update app.shifts set deleted_at = now() where id = ${id} and deleted_at is null returning id`;
        if (!rows.length) throw new HttpError(403, 'forbidden', 'You cannot delete this shift');
      });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/shifts/publish',
      tags: ['Shifts'],
      summary: 'Publish all draft shifts in a local date range (Manager)',
      security: secured,
      request: body(publishShiftsInput),
      responses: {
        200: json(z.object({ published: z.number().int() }), 'Count published'),
        400: errors[400],
        401: errors[401],
        403: errors[403],
      },
    }),
    async (c) => {
      const { from, to, areaId } = c.req.valid('json');
      const [r] = await run(c, async (tx) => {
        await requireManager(tx);
        return tx`select app.publish_shifts(${from}::date, ${to}::date, ${areaId ?? null}::uuid) as n`;
      });
      return c.json({ published: r!.n as number }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/shifts/copy-week',
      tags: ['Shifts'],
      summary: 'Copy a week of shifts to another week as drafts (Manager)',
      security: secured,
      request: body(copyWeekInput),
      responses: {
        200: json(
          z.object({ copied: z.number().int(), unassigned: z.number().int().describe('Copies left open to avoid double-booking') }),
          'Result',
        ),
        400: errors[400],
        401: errors[401],
        403: errors[403],
      },
    }),
    async (c) => {
      const { sourceWeekStart, targetWeekStart, areaId, includeEmployees } = c.req.valid('json');
      const [r] = await run(c, async (tx) => {
        await requireManager(tx);
        return tx`
          select * from app.copy_week(${sourceWeekStart}::date, ${targetWeekStart}::date,
                                      ${areaId ?? null}::uuid, ${includeEmployees})`;
      });
      return c.json({ copied: r!.copied as number, unassigned: r!.unassigned as number }, 200);
    },
  );
}
