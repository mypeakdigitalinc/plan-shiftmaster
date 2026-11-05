import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, seedIds as ids, type Sql } from './helpers';

let sql: Sql;

beforeAll(async () => {
  sql = await createTestDatabase('shifthub_test_structure', { seed: true });
});
afterAll(async () => {
  await sql?.end();
});

describe('shift templates', () => {
  it('every org gets Day / Evening / Night by default', async () => {
    const rows = await asUser(sql, ids.staffA1, (tx) =>
      tx`select name, start_time::text as s, end_time::text as e from app.shift_templates order by start_time`,
    );
    expect(rows).toEqual([
      { name: 'Day', s: '07:00:00', e: '15:00:00' },
      { name: 'Evening', s: '15:00:00', e: '23:00:00' },
      { name: 'Night', s: '23:00:00', e: '07:00:00' },
    ]);
  });

  it('a newly created organization gets defaults too', async () => {
    const u = { sub: randomUUID(), email: `${randomUUID().slice(0, 8)}@example.test` };
    const count = await asUser(sql, u, async (tx) => {
      await tx`select app.ensure_profile()`;
      await tx`select app.create_organization('Fresh Org')`;
      return (await tx`select count(*)::int as n from app.shift_templates`)[0]!.n;
    });
    expect(count).toBe(3);
  });

  it('employees cannot create templates; managers can', async () => {
    await expect(
      asUser(sql, ids.staffA1, (tx) =>
        tx`insert into app.shift_templates (name, start_time, end_time) values ('X', '08:00', '12:00')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const [row] = await asUser(sql, ids.managerA, (tx) =>
      tx`insert into app.shift_templates (name, start_time, end_time) values ('Short Day', '07:00', '11:00') returning organization_id`,
    );
    expect(row?.organization_id).toBe(ids.orgA);
  });
});

describe('structure isolation', () => {
  it('members only see their own org sites, areas and assignments', async () => {
    const r = await asUser(sql, ids.adminB, async (tx) => ({
      sites: await tx`select organization_id from app.sites`,
      areas: await tx`select organization_id from app.areas`,
      assignments: await tx`select organization_id from app.assignments`,
    }));
    for (const rows of Object.values(r)) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((x) => x.organization_id === ids.orgB)).toBe(true);
    }
  });

  it('cannot create an area under another org site (composite FK)', async () => {
    await expect(
      asUser(sql, ids.adminA, (tx) => tx`insert into app.areas (site_id, name) values (${ids.siteB}, 'Sneaky')`),
    ).rejects.toThrow(/foreign key/);
  });

  it('cannot insert rows for another org even when naming it explicitly', async () => {
    await expect(
      asUser(sql, ids.adminA, (tx) =>
        tx`insert into app.sites (organization_id, name) values (${ids.orgB}, 'Sneaky Site')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot assign an org B employee to an org A area', async () => {
    await expect(
      asUser(sql, ids.adminA, (tx) =>
        tx`insert into app.employee_areas (employee_id, area_id) values (${ids.owlB2.sub}, ${ids.areaA1})`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('org A manager cannot update org B sites', async () => {
    const rows = await asUser(sql, ids.managerA, (tx) =>
      tx`update app.sites set name = 'Hacked' where id = ${ids.siteB} returning id`,
    );
    expect(rows).toHaveLength(0);
  });

  it('organization_id cannot be changed on update', async () => {
    await expect(
      asUser(sql, ids.adminA, (tx) => tx`update app.sites set organization_id = ${ids.orgB} where id = ${ids.siteA}`),
    ).rejects.toThrow();
  });
});

describe('employee areas', () => {
  it('managers can add and remove areas for employees; employees cannot', async () => {
    await expect(
      asUser(sql, ids.staffA1, (tx) =>
        tx`insert into app.employee_areas (employee_id, area_id) values (${ids.staffA1.sub}, ${ids.areaA2})`,
      ),
    ).rejects.toThrow(/row-level security/);

    const target = '00000000-0000-4000-b000-000000000050';
    await asUser(sql, ids.managerA, (tx) =>
      tx`insert into app.employee_areas (employee_id, area_id) values (${target}, ${ids.areaA2}) on conflict do nothing`,
    );
    const deleted = await asUser(sql, ids.managerA, (tx) =>
      tx`delete from app.employee_areas where employee_id = ${target} and area_id = ${ids.areaA2} returning id`,
    );
    expect(deleted).toHaveLength(1);
  });
});

describe('availability', () => {
  it('employees see only their own; managers see everyone in the org', async () => {
    const own = await asUser(sql, ids.staffA1, (tx) => tx`select employee_id from app.availability`);
    const other = await asUser(sql, ids.staffA2, (tx) => tx`select employee_id from app.availability`);
    const mgr = await asUser(sql, ids.managerA, (tx) => tx`select employee_id from app.availability`);
    const orgB = await asUser(sql, ids.adminB, (tx) => tx`select employee_id from app.availability`);
    expect(own).toHaveLength(2);
    expect(other).toHaveLength(0);
    expect(mgr).toHaveLength(2);
    expect(orgB).toHaveLength(0);
  });

  it('employees add their own availability (defaults fill org and employee)', async () => {
    const [row] = await asUser(sql, ids.staffA2, (tx) =>
      tx`insert into app.availability (weekday, start_time, end_time) values (6, '00:00', '24:00') returning employee_id, organization_id`,
    );
    expect(row).toEqual({ employee_id: ids.staffA2.sub, organization_id: ids.orgA });
  });

  it('employees cannot write availability for someone else, managers cannot either', async () => {
    await expect(
      asUser(sql, ids.staffA2, (tx) =>
        tx`insert into app.availability (employee_id, weekday, start_time, end_time) values (${ids.staffA1.sub}, 1, '08:00', '10:00')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(sql, ids.managerA, (tx) =>
        tx`insert into app.availability (employee_id, weekday, start_time, end_time) values (${ids.staffA1.sub}, 1, '08:00', '10:00')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('rejects invalid ranges', async () => {
    await expect(
      asUser(sql, ids.staffA2, (tx) =>
        tx`insert into app.availability (weekday, start_time, end_time) values (1, '10:00', '09:00')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
