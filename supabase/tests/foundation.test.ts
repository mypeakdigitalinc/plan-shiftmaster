import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, seedIds as ids, type Sql } from './helpers';

let sql: Sql;

beforeAll(async () => {
  sql = await createTestDatabase('shifthub_test_db', { seed: true });
});
afterAll(async () => {
  await sql?.end();
});

const newUser = () => {
  const sub = randomUUID();
  return { sub, email: `${sub.slice(0, 8)}@example.test` };
};

describe('tenant isolation', () => {
  it('a user only sees profiles from their own organization', async () => {
    const rows = await asUser(sql, ids.staffA1, (tx) => tx`select organization_id from app.profiles`);
    expect(rows.length).toBe(100);
    expect(new Set(rows.map((r) => r.organization_id))).toEqual(new Set([ids.orgA]));
  });

  it('org B cannot read org A organizations, settings or profiles', async () => {
    const result = await asUser(sql, ids.adminB, async (tx) => ({
      orgs: await tx`select id from app.organizations where id = ${ids.orgA}`,
      settings: await tx`select organization_id from app.org_settings where organization_id = ${ids.orgA}`,
      profiles: await tx`select id from app.profiles where organization_id = ${ids.orgA}`,
    }));
    expect(result.orgs).toHaveLength(0);
    expect(result.settings).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  it('org B admin cannot update org A data', async () => {
    const updated = await asUser(sql, ids.adminB, async (tx) => ({
      org: await tx`update app.organizations set name = 'Hacked' where id = ${ids.orgA} returning id`,
      profile: await tx`update app.profiles set name = 'Hacked' where id = ${ids.staffA1.sub} returning id`,
    }));
    expect(updated.org).toHaveLength(0);
    expect(updated.profile).toHaveLength(0);
  });

  it('a request with no claims sees nothing', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true)`;
      return tx`select id from app.profiles`;
    });
    expect(rows).toHaveLength(0);
  });

  it('org B cannot see org A invitations', async () => {
    const rows = await asUser(sql, ids.adminB, (tx) => tx`select id from app.invitations`);
    expect(rows).toHaveLength(0);
  });
});

describe('role permissions', () => {
  it('employees cannot read invitations; managers can', async () => {
    const asStaff = await asUser(sql, ids.staffA1, (tx) => tx`select id from app.invitations`);
    const asManager = await asUser(sql, ids.managerA, (tx) => tx`select id from app.invitations`);
    expect(asStaff).toHaveLength(0);
    expect(asManager.length).toBeGreaterThan(0);
  });

  it('employees cannot change org settings', async () => {
    const rows = await asUser(sql, ids.staffA1, (tx) =>
      tx`update app.org_settings set require_approval = false returning organization_id`,
    );
    expect(rows).toHaveLength(0);
  });

  it('org admin can change org settings', async () => {
    const rows = await asUser(sql, ids.adminA, (tx) =>
      tx`update app.org_settings set allow_swaps = false returning allow_swaps`,
    );
    expect(rows).toEqual([{ allow_swaps: false }]);
  });

  it('employees cannot escalate their own role', async () => {
    await expect(
      asUser(sql, ids.staffA1, (tx) => tx`update app.profiles set role = 'org_admin' where id = ${ids.staffA1.sub}`),
    ).rejects.toThrow(/only an org admin/);
  });

  it('nobody can move a profile to another org with a plain update', async () => {
    await expect(
      asUser(sql, ids.adminA, (tx) =>
        tx`update app.profiles set organization_id = ${ids.orgB} where id = ${ids.staffA1.sub}`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('employees can update their own name and sharing preference', async () => {
    const rows = await asUser(sql, ids.staffA1, (tx) =>
      tx`update app.profiles set name = 'Sam', share_schedule = true where id = ${ids.staffA1.sub} returning name, share_schedule`,
    );
    expect(rows).toEqual([{ name: 'Sam', share_schedule: true }]);
  });

  it('employees cannot edit coworkers', async () => {
    const rows = await asUser(sql, ids.staffA1, (tx) =>
      tx`update app.profiles set name = 'x' where id = ${ids.staffA2.sub} returning id`,
    );
    expect(rows).toHaveLength(0);
  });

  it('managers cannot change an employee sharing preference', async () => {
    await expect(
      asUser(sql, ids.managerA, (tx) => tx`update app.profiles set share_schedule = true where id = ${ids.staffA2.sub}`),
    ).rejects.toThrow(/schedule sharing preference/);
  });

  it('org admin can change a member role, but not their own', async () => {
    const rows = await asUser(sql, ids.adminA, (tx) =>
      tx`update app.profiles set role = 'manager' where id = ${ids.staffA2.sub} returning role`,
    );
    expect(rows).toEqual([{ role: 'manager' }]);
    await expect(
      asUser(sql, ids.adminA, (tx) => tx`update app.profiles set role = 'employee' where id = ${ids.adminA.sub}`),
    ).rejects.toThrow(/own role/);
  });
});

describe('onboarding RPCs', () => {
  it('ensure_profile creates a profile from token claims, idempotently', async () => {
    const u = newUser();
    const first = await asUser(sql, u, (tx) => tx`select * from app.ensure_profile('Jo')`);
    const second = await asUser(sql, u, (tx) => tx`select * from app.ensure_profile('Ignored')`);
    expect(first[0]).toMatchObject({ id: u.sub, email: u.email, name: 'Jo', organization_id: null });
    expect(second[0]?.name).toBe('Jo');
  });

  it('create_organization makes the caller org_admin with mode defaults', async () => {
    const u = newUser();
    const result = await asUser(sql, u, async (tx) => {
      await tx`select app.ensure_profile()`;
      const [{ org }] = (await tx`select app.create_organization('Sunrise Group', 'group', 'America/Vancouver') as org`) as any;
      const [profile] = await tx`select role, share_schedule, organization_id from app.profiles where id = ${u.sub}`;
      const [settings] = await tx`select mode, require_approval, allow_self_scheduling from app.org_settings`;
      return { org, profile, settings };
    });
    expect(result.profile).toEqual({ role: 'org_admin', share_schedule: true, organization_id: result.org });
    expect(result.settings).toEqual({ mode: 'group', require_approval: false, allow_self_scheduling: true });
  });

  it('create_organization rejects unknown timezones and users already in an org', async () => {
    const u = newUser();
    await asUser(sql, u, (tx) => tx`select app.ensure_profile()`);
    await expect(asUser(sql, u, (tx) => tx`select app.create_organization('X Org', 'facility', 'Mars/Base')`)).rejects.toThrow(
      /unknown timezone/,
    );
    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.create_organization('Another Org')`)).rejects.toThrow(
      /already belong/,
    );
  });

  it('join_organization with an invite code joins as employee', async () => {
    const u = newUser();
    const profile = await asUser(sql, u, async (tx) => {
      await tx`select app.ensure_profile()`;
      await tx`select app.join_organization('owls000002')`;
      return (await tx`select organization_id, role, share_schedule from app.profiles where id = ${u.sub}`)[0];
    });
    expect(profile).toEqual({ organization_id: ids.orgB, role: 'employee', share_schedule: true });
  });

  it('join_organization rejects bad codes', async () => {
    const u = newUser();
    await asUser(sql, u, (tx) => tx`select app.ensure_profile()`);
    await expect(asUser(sql, u, (tx) => tx`select app.join_organization('NOPE')`)).rejects.toThrow(/invalid invite code/);
  });

  it('invitation flow: manager invites, matching email accepts, token cannot be reused', async () => {
    const u = newUser();
    const [inv] = await asUser(sql, ids.managerA, (tx) => tx`select * from app.create_invitation(${u.email}, 'employee', 'RN')`);
    expect(inv?.organization_id).toBe(ids.orgA);

    // someone else with a different email cannot use the token
    const other = newUser();
    await asUser(sql, other, (tx) => tx`select app.ensure_profile()`);
    await expect(asUser(sql, other, (tx) => tx`select app.accept_invitation(${inv!.token})`)).rejects.toThrow(
      /different email/,
    );

    const profile = await asUser(sql, u, async (tx) => {
      await tx`select app.ensure_profile()`;
      await tx`select app.accept_invitation(${inv!.token})`;
      return (await tx`select organization_id, role, position from app.profiles where id = ${u.sub}`)[0];
    });
    expect(profile).toEqual({ organization_id: ids.orgA, role: 'employee', position: 'RN' });

    await expect(asUser(sql, u, (tx) => tx`select app.accept_invitation(${inv!.token})`)).rejects.toThrow(/already used/);
  });

  it('managers cannot invite managers; employees cannot invite at all', async () => {
    await expect(
      asUser(sql, ids.managerA, (tx) => tx`select app.create_invitation('boss@example.test', 'manager')`),
    ).rejects.toThrow(/only org admins/);
    await expect(
      asUser(sql, ids.staffA1, (tx) => tx`select app.create_invitation('friend@example.test')`),
    ).rejects.toThrow(/only managers/);
  });

  it('rotate_invite_code is admin-only and changes the code', async () => {
    await expect(asUser(sql, ids.managerA, (tx) => tx`select app.rotate_invite_code()`)).rejects.toThrow(/only org admins/);
    const [{ code }] = (await asUser(sql, ids.adminA, (tx) => tx`select app.rotate_invite_code() as code`)) as any;
    expect(code).toMatch(/^[0-9A-F]{10}$/);
    expect(code).not.toBe('MAPLE00001');
  });

  it('touch trigger records updated_by', async () => {
    const [row] = await asUser(sql, ids.adminA, (tx) =>
      tx`update app.organizations set name = 'Maple Grove Care' where id = ${ids.orgA} returning updated_by`,
    );
    expect(row?.updated_by).toBe(ids.adminA.sub);
  });
});
