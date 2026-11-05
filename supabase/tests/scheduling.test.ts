import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, seedIds as ids, type Sql } from './helpers';

let sql: Sql;

// staff1 (b..06) shares their schedule; staff2 (b..07) does not.
// Employees are spread over units round-robin; look up real values from the seed.
let staff1Area: string;
let rnAssignment: { id: string; area_id: string };

beforeAll(async () => {
  sql = await createTestDatabase('shifthub_test_scheduling', { seed: true });
  [{ area_id: staff1Area }] = (await sql`select area_id from app.employee_areas where employee_id = ${ids.staffA1.sub}`) as any;
  [rnAssignment] = (await sql`
    select id, area_id from app.assignments where area_id = ${staff1Area} and required_position = 'RN'`) as any;
});
afterAll(async () => {
  await sql?.end();
});

const count = (rows: unknown[]) => rows.length;

describe('visibility', () => {
  it('managers see the whole org schedule', async () => {
    const rows = await asUser(sql, ids.managerA, (tx) => tx`select id from app.shifts`);
    expect(count(rows)).toBe(441);
  });

  it('employees see own shifts plus coworkers who share, never non-sharers', async () => {
    const rows = await asUser(sql, ids.staffA2, (tx) => tx`
      select s.employee_id, p.share_schedule
      from app.shifts s join app.profiles p on p.id = s.employee_id`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.employee_id === ids.staffA2.sub || r.share_schedule === true).toBe(true);
    }
    expect(rows.some((r) => r.employee_id === ids.staffA2.sub)).toBe(true);
  });

  it('a coworker who turns sharing off disappears from others’ view', async () => {
    const before = await asUser(sql, ids.staffA2, (tx) => tx`select id from app.shifts where employee_id = ${ids.staffA1.sub}`);
    expect(before.length).toBeGreaterThan(0);
    await asUser(sql, ids.staffA1, (tx) => tx`update app.profiles set share_schedule = false where id = ${ids.staffA1.sub}`);
    const after = await asUser(sql, ids.staffA2, (tx) => tx`select id from app.shifts where employee_id = ${ids.staffA1.sub}`);
    expect(after).toHaveLength(0);
    await asUser(sql, ids.staffA1, (tx) => tx`update app.profiles set share_schedule = true where id = ${ids.staffA1.sub}`);
  });

  it('other organizations see nothing', async () => {
    const rows = await asUser(sql, ids.adminB, (tx) => tx`select organization_id from app.shifts`);
    expect(rows.every((r) => r.organization_id === ids.orgB)).toBe(true);
  });

  it('employees cannot create shifts in facility mode', async () => {
    await expect(
      asUser(sql, ids.staffA1, (tx) => tx`
        insert into app.shifts (area_id, employee_id, starts_at, ends_at)
        values (${staff1Area}, ${ids.staffA1.sub}, '2030-01-01 08:00Z', '2030-01-01 16:00Z')`),
    ).rejects.toThrow(/not allowed|row-level security/);
  });
});

describe('integrity', () => {
  const insert = (employee: string | null, area: string, assignment: string | null, from: string, to: string) =>
    asUser(sql, ids.managerA, (tx) => tx`
      insert into app.shifts (area_id, assignment_id, employee_id, starts_at, ends_at)
      values (${area}, ${assignment}, ${employee}, ${from}, ${to}) returning *`);

  it('derives site_id from the area and defaults to draft', async () => {
    const [row] = await insert(null, ids.areaA1, null, '2030-02-01 12:00Z', '2030-02-01 20:00Z');
    expect(row).toMatchObject({ site_id: ids.siteA, status: 'draft', organization_id: ids.orgA });
  });

  it('rejects an employee not approved for the area', async () => {
    const otherArea = [ids.areaA1, ids.areaA2, ids.areaA3].find((a) => a !== staff1Area)!;
    await expect(insert(ids.staffA1.sub, otherArea, null, '2030-02-02 12:00Z', '2030-02-02 20:00Z')).rejects.toThrow(
      /not approved/,
    );
  });

  it('enforces the assignment’s required position', async () => {
    // staffA1 is an RN; find a PSW assignment in their unit
    const [psw] = await sql`select id from app.assignments where area_id = ${staff1Area} and required_position = 'PSW' limit 1`;
    await expect(insert(ids.staffA1.sub, staff1Area, psw!.id, '2030-02-03 12:00Z', '2030-02-03 20:00Z')).rejects.toThrow(
      /requires position PSW/,
    );
    const [ok] = await insert(ids.staffA1.sub, staff1Area, rnAssignment.id, '2030-02-03 12:00Z', '2030-02-03 20:00Z');
    expect(ok?.employee_id).toBe(ids.staffA1.sub);
  });

  it('rejects an assignment from a different area', async () => {
    const otherArea = [ids.areaA1, ids.areaA2, ids.areaA3].find((a) => a !== rnAssignment.area_id)!;
    await expect(insert(null, otherArea, rnAssignment.id, '2030-02-04 12:00Z', '2030-02-04 20:00Z')).rejects.toThrow(
      /does not belong/,
    );
  });

  it('prevents double booking but allows back-to-back shifts', async () => {
    await insert(ids.staffA1.sub, staff1Area, null, '2030-03-01 07:00Z', '2030-03-01 15:00Z');
    await expect(insert(ids.staffA1.sub, staff1Area, null, '2030-03-01 14:00Z', '2030-03-01 22:00Z')).rejects.toThrow(
      /overlaps/,
    );
    const [ok] = await insert(ids.staffA1.sub, staff1Area, null, '2030-03-01 15:00Z', '2030-03-01 23:00Z');
    expect(ok).toBeDefined();
  });

  it('rejects shifts longer than 24h or ending before they start', async () => {
    await expect(insert(null, ids.areaA1, null, '2030-04-01 08:00Z', '2030-04-02 09:00Z')).rejects.toThrow(/check/);
    await expect(insert(null, ids.areaA1, null, '2030-04-01 08:00Z', '2030-04-01 07:00Z')).rejects.toThrow(/check/);
  });

  it('cannot reference another org’s area', async () => {
    await expect(insert(null, ids.areaB, null, '2030-04-03 08:00Z', '2030-04-03 16:00Z')).rejects.toThrow(/area not found/);
  });
});

describe('drafts and publishing', () => {
  it('employees do not see their drafts until published', async () => {
    const [draft] = await asUser(sql, ids.managerA, (tx) => tx`
      insert into app.shifts (area_id, employee_id, starts_at, ends_at)
      values (${staff1Area}, ${ids.staffA1.sub}, '2030-05-06 11:00Z', '2030-05-06 19:00Z') returning id`);
    const hidden = await asUser(sql, ids.staffA1, (tx) => tx`select id from app.shifts where id = ${draft!.id}`);
    expect(hidden).toHaveLength(0);

    const [{ n }] = (await asUser(sql, ids.managerA, (tx) => tx`select app.publish_shifts('2030-05-04', '2030-05-10') as n`)) as any;
    expect(n).toBe(1);
    const [row] = await asUser(sql, ids.staffA1, (tx) => tx`select status, published_at from app.shifts where id = ${draft!.id}`);
    expect(row?.status).toBe('published');
    expect(row?.published_at).toBeInstanceOf(Date);
  });

  it('only managers can publish', async () => {
    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.publish_shifts('2030-05-04', '2030-05-10')`)).rejects.toThrow(
      /only managers/,
    );
  });
});

describe('copy week', () => {
  it('copies this week as drafts to next week, keeping assignments', async () => {
    const [{ monday }] = (await sql`select date_trunc('week', now() at time zone 'America/Toronto')::date::text as monday`) as any;
    const [res] = await asUser(sql, ids.managerA, (tx) => tx`
      select * from app.copy_week(${monday}::date, ${monday}::date + 7, null, true)`);
    expect(res!.copied).toBe(441);
    expect(res!.unassigned).toBe(0);

    const rows = await asUser(sql, ids.managerA, (tx) => tx`
      select status, count(*)::int as n, count(employee_id)::int as assigned from app.shifts
      where starts_at >= (${monday}::date + 7)::timestamp at time zone 'America/Toronto'
        and starts_at <  (${monday}::date + 14)::timestamp at time zone 'America/Toronto'
      group by status`);
    expect(rows).toEqual([{ status: 'draft', n: 441, assigned: 399 }]);
  });

  it('keeps local wall-clock time across a DST change', async () => {
    // DST ends Sun 2031-11-02 in Toronto: Mon 2031-10-27 (EDT) → Mon 2031-11-03 (EST)
    await asUser(sql, ids.managerA, (tx) => tx`
      insert into app.shifts (area_id, starts_at, ends_at, notes)
      values (${ids.areaA1}, '2031-10-27 07:00 America/Toronto', '2031-10-27 15:00 America/Toronto', 'dst-test')`);
    await asUser(sql, ids.managerA, (tx) => tx`select app.copy_week('2031-10-27', '2031-11-03', ${ids.areaA1}, true)`);
    const rows = await sql`
      select to_char(starts_at at time zone 'America/Toronto', 'YYYY-MM-DD HH24:MI') as local,
             extract(epoch from ends_at - starts_at) / 3600 as hours
      from app.shifts where notes = 'dst-test' order by starts_at`;
    expect(rows.map((r) => r.local)).toEqual(['2031-10-27 07:00', '2031-11-03 07:00']);
    expect(rows.map((r) => Number(r.hours))).toEqual([8, 8]);
  });

  it('unassigns copies that would double-book', async () => {
    // put staffA1 on a shift next-next week that collides with a copied one
    const [{ monday }] = (await sql`select date_trunc('week', now() at time zone 'America/Toronto')::date::text as monday`) as any;
    const [src] = await sql`
      select starts_at, ends_at from app.shifts
      where employee_id = ${ids.staffA1.sub} and status = 'published'
        and starts_at >= ${monday}::date::timestamp at time zone 'America/Toronto'
      order by starts_at limit 1`;
    await asUser(sql, ids.managerA, (tx) => tx`
      insert into app.shifts (area_id, employee_id, starts_at, ends_at)
      values (${staff1Area}, ${ids.staffA1.sub}, ${src!.starts_at}::timestamptz + interval '14 days',
              ${src!.ends_at}::timestamptz + interval '14 days')`);
    const [res] = await asUser(sql, ids.managerA, (tx) => tx`
      select * from app.copy_week(${monday}::date, ${monday}::date + 14, ${staff1Area}, true)`);
    expect(res!.unassigned).toBeGreaterThanOrEqual(1);
  });

  it('rejects non-weekly offsets', async () => {
    await expect(
      asUser(sql, ids.managerA, (tx) => tx`select app.copy_week('2030-01-07', '2030-01-09')`),
    ).rejects.toThrow(/multiple of 7/);
  });
});

describe('self-scheduling (group mode)', () => {
  it('members add their own shifts, visible to them immediately', async () => {
    const [row] = await asUser(sql, ids.owlB2, (tx) => tx`
      insert into app.shifts (area_id, employee_id, starts_at, ends_at, status)
      values (${ids.areaB}, ${ids.owlB2.sub}, '2030-06-01 23:00Z', '2030-06-02 07:00Z', 'published') returning id`);
    const mine = await asUser(sql, ids.owlB2, (tx) => tx`select id from app.shifts where id = ${row!.id}`);
    expect(mine).toHaveLength(1);
  });

  it('members cannot add shifts for someone else', async () => {
    await expect(
      asUser(sql, ids.owlB2, (tx) => tx`
        insert into app.shifts (area_id, employee_id, starts_at, ends_at)
        values (${ids.areaB}, ${ids.adminB.sub}, '2030-06-03 23:00Z', '2030-06-04 07:00Z')`),
    ).rejects.toThrow(/not allowed/);
  });

  it('an employee probing a coworker’s schedule gets a permission error, not an overlap error', async () => {
    const [busy] = await sql`select starts_at, ends_at from app.shifts where employee_id = ${ids.adminB.sub} limit 1`;
    await expect(
      asUser(sql, ids.owlB2, (tx) => tx`
        insert into app.shifts (area_id, employee_id, starts_at, ends_at)
        values (${ids.areaB}, ${ids.adminB.sub}, ${busy!.starts_at}, ${busy!.ends_at})`),
    ).rejects.toThrow(/not allowed/);
  });

  it('members cannot edit coworkers’ shifts', async () => {
    const rows = await asUser(sql, ids.owlB2, (tx) => tx`
      update app.shifts set notes = 'x' where employee_id = ${ids.adminB.sub} returning id`);
    expect(rows).toHaveLength(0);
  });
});
