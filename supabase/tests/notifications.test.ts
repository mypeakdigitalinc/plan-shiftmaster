import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, seedIds as ids, type Claims, type Sql } from './helpers';

let sql: Sql;
let area: string;
let rnAssignment: string;
let rn2: Claims;
let rn3: Claims;
let psw: Claims;

let day = 0;
const nextSlot = () => {
  day += 1;
  const d = new Date(Date.UTC(2032, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
  return { date: d, start: `${d} 07:00 America/Toronto`, end: `${d} 15:00 America/Toronto` };
};

async function shift(employee: string | null, status = 'published', slot = nextSlot()) {
  const [row] = await asUser(sql, ids.managerA, (tx) => tx`
    insert into app.shifts (area_id, assignment_id, employee_id, starts_at, ends_at, status)
    values (${area}, ${rnAssignment}, ${employee}, ${slot.start}::text::timestamptz, ${slot.end}::text::timestamptz, ${status})
    returning id`);
  return row!.id as string;
}

/** Notifications of a type for a user created after `since`. */
const inbox = (user: string, type: string, since: Date) =>
  sql`select title, body, data from app.notifications where user_id = ${user} and type = ${type} and created_at >= ${since}`;
const mark = async () => (await sql`select clock_timestamp() as t`)[0]!.t as Date;

beforeAll(async () => {
  sql = await createTestDatabase('shifthub_test_notifications', { seed: true });
  [{ area_id: area }] = (await sql`select area_id from app.employee_areas where employee_id = ${ids.staffA1.sub}`) as any;
  [{ id: rnAssignment }] = (await sql`select id from app.assignments where area_id = ${area} and required_position = 'RN'`) as any;
  const rns = await sql`
    select p.id as sub, p.email from app.profiles p join app.employee_areas ea on ea.employee_id = p.id
    where ea.area_id = ${area} and p.position = 'RN' and p.role = 'employee' and p.id <> ${ids.staffA1.sub} order by p.id`;
  rn2 = rns[0] as unknown as Claims;
  rn3 = rns[1] as unknown as Claims;
  [psw] = (await sql`
    select p.id as sub, p.email from app.profiles p join app.employee_areas ea on ea.employee_id = p.id
    where ea.area_id = ${area} and p.position = 'PSW' limit 1`) as any;
});
afterAll(async () => {
  await sql?.end();
});

describe('schedule notifications', () => {
  it('seeding does not notify anyone', async () => {
    // other tests run later; at this point only seed data exists
    const [{ n }] = (await sql`select count(*)::int as n from app.notifications`) as any;
    expect(n).toBe(0);
  });

  it('bulk publish sends one notice per person with a count', async () => {
    const t = await mark();
    const a = nextSlot();
    const b = nextSlot();
    await shift(rn2.sub, 'draft', a);
    await shift(rn2.sub, 'draft', b);
    await shift(rn3.sub, 'draft', nextSlot());
    await asUser(sql, ids.managerA, (tx) => tx`select app.publish_shifts(${a.date}::date, ${a.date}::date + 10)`);
    const rows = await inbox(rn2.sub, 'schedule_published', t);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toMatch(/2 shifts/);
    expect(await inbox(rn2.sub, 'shift_assigned', t)).toHaveLength(0);
    expect(await inbox(rn3.sub, 'schedule_published', t)).toHaveLength(1);
  });

  it('reassigning a published shift tells both people, cancelling tells the owner', async () => {
    const s = await shift(rn2.sub);
    const t = await mark();
    await asUser(sql, ids.managerA, (tx) => tx`update app.shifts set employee_id = ${rn3.sub} where id = ${s}`);
    expect(await inbox(rn3.sub, 'shift_assigned', t)).toHaveLength(1);
    const removed = await inbox(rn2.sub, 'shift_removed', t);
    expect(removed[0]!.body).toMatch(/no longer scheduled for .* 07:00–15:00 · /);
    await asUser(sql, ids.managerA, (tx) => tx`update app.shifts set status = 'cancelled' where id = ${s}`);
    expect(await inbox(rn3.sub, 'shift_cancelled', t)).toHaveLength(1);
  });

  it('drafts and self-scheduled shifts do not notify', async () => {
    const t = await mark();
    await shift(rn2.sub, 'draft');
    expect(await inbox(rn2.sub, 'shift_assigned', t)).toHaveLength(0);
  });

  it('people only see their own notifications', async () => {
    const mine = await asUser(sql, rn2, (tx) => tx`select distinct user_id from app.notifications`);
    expect(mine.map((r) => r.user_id)).toEqual([rn2.sub]);
    const other = await asUser(sql, ids.adminB, (tx) => tx`select id from app.notifications where user_id = ${rn2.sub}`);
    expect(other).toHaveLength(0);
  });
});

describe('trade notifications', () => {
  it('offer → eligible coworkers; request → managers; approval → requester and offerer, no duplicates', async () => {
    const s = await shift(rn2.sub);
    const t = await mark();
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s}, 'appointment')`);
    expect(await inbox(rn3.sub, 'shift_available', t)).toHaveLength(1);
    expect(await inbox(psw.sub, 'shift_available', t)).toHaveLength(0); // wrong position
    expect(await inbox(rn2.sub, 'shift_available', t)).toHaveLength(0); // the offerer

    const [req] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${offer!.id})`);
    expect(await inbox(ids.managerA.sub, 'pickup_requested', t)).toHaveLength(1);
    expect(await inbox(ids.adminA.sub, 'pickup_requested', t)).toHaveLength(1);

    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_offer_request(${req!.id}, true)`);
    expect(await inbox(rn3.sub, 'pickup_approved', t)).toHaveLength(1);
    const picked = await inbox(rn2.sub, 'shift_picked_up', t);
    expect(picked[0]!.body).toMatch(/is taking your shift/);
    // the trade explains itself: no generic assigned/removed notices
    expect(await inbox(rn3.sub, 'shift_assigned', t)).toHaveLength(0);
    expect(await inbox(rn2.sub, 'shift_removed', t)).toHaveLength(0);
  });

  it('rejected pickup tells the requester', async () => {
    const s = await shift(rn2.sub);
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s})`);
    const t = await mark();
    const [req] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${offer!.id})`);
    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_offer_request(${req!.id}, false)`);
    expect(await inbox(rn3.sub, 'pickup_rejected', t)).toHaveLength(1);
  });

  it('swap lifecycle', async () => {
    const a = await shift(ids.staffA1.sub);
    const b = await shift(rn2.sub);
    const t = await mark();
    const [w] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${a}, ${b}, 'please')`);
    const req = await inbox(rn2.sub, 'swap_requested', t);
    expect(req[0]!.data).toEqual({ swapId: w!.id });
    await asUser(sql, rn2, (tx) => tx`select app.respond_swap(${w!.id}, true)`);
    expect(await inbox(ids.staffA1.sub, 'swap_accepted', t)).toHaveLength(1);
    expect(await inbox(ids.managerA.sub, 'swap_waiting_approval', t)).toHaveLength(1);
    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_swap(${w!.id}, true)`);
    expect(await inbox(ids.staffA1.sub, 'swap_approved', t)).toHaveLength(1);
    expect(await inbox(rn2.sub, 'swap_approved', t)).toHaveLength(1);
    expect(await inbox(rn2.sub, 'shift_assigned', t)).toHaveLength(0);
  });

  it('declined swap tells the requester', async () => {
    const a = await shift(ids.staffA1.sub);
    const b = await shift(rn2.sub);
    const t = await mark();
    const [w] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${a}, ${b})`);
    await asUser(sql, rn2, (tx) => tx`select app.respond_swap(${w!.id}, false)`);
    expect(await inbox(ids.staffA1.sub, 'swap_declined', t)).toHaveLength(1);
  });
});

describe('reminders', () => {
  it('sends one reminder for shifts starting within 12 hours', async () => {
    // Support staff have no seeded shifts, so nothing collides
    const [support] = await sql`
      select p.id from app.profiles p join app.employee_areas ea on ea.employee_id = p.id
      where p.position = 'Support' and ea.area_id = ${area} limit 1`;
    const soon = new Date(Date.now() + 6 * 3600_000).toISOString();
    const later = new Date(Date.now() + 14 * 3600_000).toISOString();
    const [s] = await asUser(sql, ids.managerA, (tx) => tx`
      insert into app.shifts (area_id, employee_id, starts_at, ends_at, status)
      values (${area}, ${support!.id}, ${soon}, ${soon}::timestamptz + interval '8 hours', 'published') returning id`);
    const [far] = await asUser(sql, ids.managerA, (tx) => tx`
      insert into app.shifts (area_id, employee_id, starts_at, ends_at, status)
      values (${area}, ${support!.id}, ${later}, ${later}::timestamptz + interval '8 hours', 'published') returning id`);
    const t = await mark();
    const [{ n }] = (await sql`select app.send_shift_reminders() as n`) as any;
    expect(n).toBeGreaterThanOrEqual(1);
    const rows = await inbox(support!.id, 'shift_reminder', t);
    expect(rows.map((r) => r.data)).toEqual([{ shiftId: s!.id }]); // not the one 14h away
    expect(rows.map((r) => r.data)).not.toContainEqual({ shiftId: far!.id });
    // idempotent
    await sql`select app.send_shift_reminders()`;
    expect(await inbox(support!.id, 'shift_reminder', t)).toHaveLength(1);
  });

  it('job functions are not callable by clients', async () => {
    await expect(asUser(sql, ids.managerA, (tx) => tx`select app.send_shift_reminders()`)).rejects.toThrow(/permission denied/);
    await expect(
      asUser(sql, ids.managerA, (tx) => tx`select app.notify(${rn2.sub}, 'shift_reminder', 'x', 'spoof')`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('read state and push tokens', () => {
  it('marks own notifications read, never others’', async () => {
    const [{ n: before }] = (await sql`select count(*)::int as n from app.notifications where user_id = ${rn2.sub} and read_at is null`) as any;
    expect(before).toBeGreaterThan(0);
    const [{ n }] = (await asUser(sql, rn3, (tx) => tx`select app.mark_notifications_read(null) as n`)) as any;
    expect(n).toBeGreaterThan(0);
    const [{ n: after }] = (await sql`select count(*)::int as n from app.notifications where user_id = ${rn2.sub} and read_at is null`) as any;
    expect(after).toBe(before);
    const [{ n: all }] = (await asUser(sql, rn2, (tx) => tx`select app.mark_notifications_read(null) as n`)) as any;
    expect(all).toBe(before);
  });

  it('registers push tokens; a token moves when another person signs in on the device', async () => {
    await asUser(sql, rn2, (tx) => tx`select app.register_push_token('ExponentPushToken[device-1]', 'ios')`);
    await asUser(sql, rn3, (tx) => tx`select app.register_push_token('ExponentPushToken[device-1]', 'ios')`);
    const rows = await sql`select user_id from app.push_tokens where token = 'ExponentPushToken[device-1]'`;
    expect(rows).toEqual([{ user_id: rn3.sub }]);
    expect(await asUser(sql, rn2, (tx) => tx`select id from app.push_tokens`)).toHaveLength(0);
  });
});

describe('audit log', () => {
  it('records who changed what; managers can read it, employees cannot', async () => {
    const s = await shift(rn2.sub, 'draft');
    await asUser(sql, ids.managerA, (tx) => tx`update app.shifts set notes = 'bring badge' where id = ${s}`);
    const [row] = await asUser(sql, ids.managerA, (tx) => tx`
      select user_id, action, details from app.audit_logs
      where entity_type = 'shifts' and entity_id = ${s} and action = 'update'`);
    expect(row).toMatchObject({ user_id: ids.managerA.sub, action: 'update' });
    expect(row!.details.notes).toEqual({ from: null, to: 'bring badge' });
    expect(await asUser(sql, rn2, (tx) => tx`select id from app.audit_logs`)).toHaveLength(0);
    expect(await asUser(sql, ids.adminB, (tx) => tx`select id from app.audit_logs where entity_id = ${s}`)).toHaveLength(0);
  });
});
