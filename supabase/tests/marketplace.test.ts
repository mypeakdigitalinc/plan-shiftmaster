import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createTestDatabase, seedIds as ids, type Claims, type Sql } from './helpers';

let sql: Sql;
let area: string; // staff1's unit
let rnAssignment: string;
let rn2: Claims; // another RN in the same unit
let rn3: Claims;
let psw: Claims; // a PSW in the same unit
const owl3 = { sub: '00000000-0000-4000-c000-000000000003', email: 'owl3@nightowls.test' };

// Far-future days so nothing collides with the seeded week; each test uses its own day
let day = 0;
const nextSlot = () => {
  day += 1;
  const d = new Date(Date.UTC(2031, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
  return { start: `${d} 07:00 America/Toronto`, end: `${d} 15:00 America/Toronto` };
};

async function shift(employee: string | null, opts: { assignment?: string | null; areaId?: string; slot?: { start: string; end: string }; status?: string } = {}) {
  const slot = opts.slot ?? nextSlot();
  const manager = opts.areaId === ids.areaB ? ids.adminB : ids.managerA;
  const [row] = await asUser(sql, manager, (tx) => tx`
    insert into app.shifts (area_id, assignment_id, employee_id, starts_at, ends_at, status)
    values (${opts.areaId ?? area}, ${opts.assignment === undefined ? rnAssignment : opts.assignment}, ${employee},
            ${slot.start}::text::timestamptz, ${slot.end}::text::timestamptz, ${opts.status ?? 'published'})
    returning id`);
  return row!.id as string;
}

const owner = async (shiftId: string) => (await sql`select employee_id from app.shifts where id = ${shiftId}`)[0]!.employee_id;

beforeAll(async () => {
  sql = await createTestDatabase('shifthub_test_marketplace', { seed: true });
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
  // make sure rn2 does not share, to test marketplace visibility
  await sql`update app.profiles set share_schedule = false where id = ${rn2.sub}`;
});
afterAll(async () => {
  await sql?.end();
});

describe('marketplace', () => {
  it('employee offers own shift; coworkers who otherwise could not see it now can', async () => {
    const s = await shift(rn2.sub);
    expect(await asUser(sql, rn3, (tx) => tx`select id from app.shifts where id = ${s}`)).toHaveLength(0);
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s}, 'family event')`);
    expect(offer).toMatchObject({ status: 'open', offered_by: rn2.sub, reason: 'family event' });
    expect(await asUser(sql, rn3, (tx) => tx`select id from app.shifts where id = ${s}`)).toHaveLength(1);
  });

  it('rejects offering someone else’s shift, drafts and duplicates', async () => {
    const s = await shift(rn2.sub);
    await expect(asUser(sql, rn3, (tx) => tx`select app.offer_shift(${s})`)).rejects.toThrow(/own shifts/);
    const draft = await shift(rn2.sub, { status: 'draft' });
    await expect(asUser(sql, rn2, (tx) => tx`select app.offer_shift(${draft})`)).rejects.toThrow(/only published/);
    await asUser(sql, rn2, (tx) => tx`select app.offer_shift(${s})`);
    await expect(asUser(sql, rn2, (tx) => tx`select app.offer_shift(${s})`)).rejects.toThrow(/already on the marketplace/);
  });

  it('rejects offering a shift that already started', async () => {
    const past = await shift(rn2.sub, { slot: { start: '2020-01-01 07:00Z', end: '2020-01-01 15:00Z' } });
    await expect(asUser(sql, rn2, (tx) => tx`select app.offer_shift(${past})`)).rejects.toThrow(/already started/);
  });

  it('only eligible, available coworkers can request; manager approves one', async () => {
    const slot = nextSlot();
    const s = await shift(rn2.sub, { slot });
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s})`);

    await expect(asUser(sql, rn2, (tx) => tx`select app.request_offer(${offer!.id})`)).rejects.toThrow(/your own shift/);
    await expect(asUser(sql, psw, (tx) => tx`select app.request_offer(${offer!.id})`)).rejects.toThrow(/not eligible/);
    // staff1 is busy at that time
    await shift(ids.staffA1.sub, { assignment: null, slot });
    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.request_offer(${offer!.id})`)).rejects.toThrow(/already have a shift/);

    const [req] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${offer!.id}, 'happy to')`);
    expect(req).toMatchObject({ status: 'pending' });
    await expect(asUser(sql, rn3, (tx) => tx`select app.request_offer(${offer!.id})`)).rejects.toThrow(/already requested/);

    // offerer can see requests on their offer; employees cannot decide
    expect(await asUser(sql, rn2, (tx) => tx`select id from app.shift_offer_requests where offer_id = ${offer!.id}`)).toHaveLength(1);
    await expect(asUser(sql, rn3, (tx) => tx`select app.decide_offer_request(${req!.id}, true)`)).rejects.toThrow(/only managers/);

    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_offer_request(${req!.id}, true)`);
    expect(await owner(s)).toBe(rn3.sub);
    const [o] = await sql`select status, filled_by from app.shift_offers where id = ${offer!.id}`;
    expect(o).toEqual({ status: 'filled', filled_by: rn3.sub });
  });

  it('approving one request rejects the others', async () => {
    const s = await shift(rn2.sub);
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s})`);
    const [a] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${offer!.id})`);
    const [b] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_offer(${offer!.id})`);
    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_offer_request(${b!.id}, true)`);
    const rows = await sql`select id, status from app.shift_offer_requests where offer_id = ${offer!.id}`;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [a!.id]: 'rejected', [b!.id]: 'approved' });
  });

  it('manager posts an open slot; it can be picked up', async () => {
    const s = await shift(null);
    await expect(asUser(sql, rn3, (tx) => tx`select app.offer_shift(${s})`)).rejects.toThrow(/own shifts/);
    const [offer] = await asUser(sql, ids.managerA, (tx) => tx`select * from app.offer_shift(${s}, 'needs cover')`);
    expect(offer!.offered_by).toBeNull();
    const [req] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${offer!.id})`);
    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_offer_request(${req!.id}, true)`);
    expect(await owner(s)).toBe(rn3.sub);
  });

  it('a manager reassigning the shift directly cancels the offer and its requests', async () => {
    const s = await shift(rn2.sub);
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s})`);
    const [req] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${offer!.id})`);
    await asUser(sql, ids.managerA, (tx) => tx`update app.shifts set employee_id = ${ids.staffA1.sub} where id = ${s}`);
    expect((await sql`select status from app.shift_offers where id = ${offer!.id}`)[0]!.status).toBe('cancelled');
    expect((await sql`select status from app.shift_offer_requests where id = ${req!.id}`)[0]!.status).toBe('rejected');
  });

  it('offerer cancels; requester withdraws; rejection by manager', async () => {
    const s1 = await shift(rn2.sub);
    const [o1] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s1})`);
    const [r1] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${o1!.id})`);
    await asUser(sql, rn3, (tx) => tx`select app.withdraw_offer_request(${r1!.id})`);
    await expect(asUser(sql, rn3, (tx) => tx`select app.cancel_offer(${o1!.id})`)).rejects.toThrow(/only the person/);
    await asUser(sql, rn2, (tx) => tx`select app.cancel_offer(${o1!.id})`);
    expect((await sql`select status from app.shift_offers where id = ${o1!.id}`)[0]!.status).toBe('cancelled');

    const s2 = await shift(rn2.sub);
    const [o2] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s2})`);
    const [r2] = await asUser(sql, rn3, (tx) => tx`select * from app.request_offer(${o2!.id})`);
    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_offer_request(${r2!.id}, false)`);
    expect((await sql`select status from app.shift_offer_requests where id = ${r2!.id}`)[0]!.status).toBe('rejected');
    expect(await owner(s2)).toBe(rn2.sub);
  });

  it('other organizations cannot see or request offers', async () => {
    const s = await shift(rn2.sub);
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s})`);
    expect(await asUser(sql, ids.adminB, (tx) => tx`select id from app.shift_offers where id = ${offer!.id}`)).toHaveLength(0);
    await expect(asUser(sql, ids.owlB2, (tx) => tx`select app.request_offer(${offer!.id})`)).rejects.toThrow(/not found/);
  });

  it('respects allow_pickup', async () => {
    const s = await shift(rn2.sub);
    await asUser(sql, ids.adminA, (tx) => tx`update app.org_settings set allow_pickup = false`);
    await expect(asUser(sql, rn2, (tx) => tx`select app.offer_shift(${s})`)).rejects.toThrow(/turned off/);
    await asUser(sql, ids.adminA, (tx) => tx`update app.org_settings set allow_pickup = true`);
  });

  it('group mode: first eligible request wins immediately, even for members without approved areas', async () => {
    const newcomer = { sub: randomUUID(), email: `${randomUUID().slice(0, 8)}@example.test` };
    await asUser(sql, newcomer, async (tx) => {
      await tx`select app.ensure_profile()`;
      await tx`select app.join_organization('OWLS000002')`;
    });
    await sql`update app.profiles set position = 'PSW' where id = ${newcomer.sub}`;
    const s = await shift(ids.owlB2.sub, { areaId: ids.areaB, assignment: null });
    const [offer] = await asUser(sql, ids.owlB2, (tx) => tx`select * from app.offer_shift(${s})`);
    const [req] = await asUser(sql, newcomer, (tx) => tx`select * from app.request_offer(${offer!.id})`);
    expect(req!.status).toBe('approved');
    expect(await owner(s)).toBe(newcomer.sub);
  });
});

describe('swaps', () => {
  it('request → coworker accepts → manager approves → shifts exchanged', async () => {
    const mine = await shift(ids.staffA1.sub);
    const theirs = await shift(rn2.sub);
    const [swap] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${mine}, ${theirs}, 'swap?')`);
    expect(swap).toMatchObject({ status: 'pending_peer', target_id: rn2.sub });

    // the target can now see the requester's shift; a third person cannot see the swap
    expect(await asUser(sql, rn2, (tx) => tx`select id from app.shifts where id = ${mine}`)).toHaveLength(1);
    expect(await asUser(sql, rn3, (tx) => tx`select id from app.shift_swaps where id = ${swap!.id}`)).toHaveLength(0);

    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.respond_swap(${swap!.id}, true)`)).rejects.toThrow(/not found/);
    const [{ s }] = (await asUser(sql, rn2, (tx) => tx`select app.respond_swap(${swap!.id}, true) as s`)) as any;
    expect(s).toBe('pending_manager');
    expect(await owner(mine)).toBe(ids.staffA1.sub);

    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_swap(${swap!.id}, true)`);
    expect(await owner(mine)).toBe(rn2.sub);
    expect(await owner(theirs)).toBe(ids.staffA1.sub);
  });

  it('swaps two shifts at the same time (overlap check ignores the exchanged shifts)', async () => {
    const slot = nextSlot();
    const mine = await shift(ids.staffA1.sub, { assignment: null, slot });
    const theirs = await shift(rn2.sub, { slot });
    const [swap] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${mine}, ${theirs})`);
    await asUser(sql, rn2, (tx) => tx`select app.respond_swap(${swap!.id}, true)`);
    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_swap(${swap!.id}, true)`);
    expect(await owner(mine)).toBe(rn2.sub);
    expect(await owner(theirs)).toBe(ids.staffA1.sub);
  });

  it('decline, cancel and manager rejection leave shifts untouched', async () => {
    const a = await shift(ids.staffA1.sub);
    const b = await shift(rn2.sub);
    const [w1] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${a}, ${b})`);
    await asUser(sql, rn2, (tx) => tx`select app.respond_swap(${w1!.id}, false)`);
    expect((await sql`select status from app.shift_swaps where id = ${w1!.id}`)[0]!.status).toBe('declined');

    const [w2] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${a}, ${b})`);
    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.request_swap(${a}, ${b})`)).rejects.toThrow(/pending swap/);
    await asUser(sql, ids.staffA1, (tx) => tx`select app.cancel_swap(${w2!.id})`);

    const [w3] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${a}, ${b})`);
    await asUser(sql, rn2, (tx) => tx`select app.respond_swap(${w3!.id}, true)`);
    await asUser(sql, ids.managerA, (tx) => tx`select app.decide_swap(${w3!.id}, false)`);
    expect(await owner(a)).toBe(ids.staffA1.sub);
    expect(await owner(b)).toBe(rn2.sub);
  });

  it('rejects swaps across positions, with own shifts, or not owned', async () => {
    const mine = await shift(ids.staffA1.sub); // RN slot
    const pswShift = await shift(psw.sub, { assignment: null });
    // PSW cannot take the RN-only shift
    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.request_swap(${mine}, ${pswShift})`)).rejects.toThrow(
      /not eligible/,
    );
    const another = await shift(ids.staffA1.sub);
    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.request_swap(${mine}, ${another})`)).rejects.toThrow(
      /coworker/,
    );
    const theirs = await shift(rn2.sub);
    await expect(asUser(sql, rn3, (tx) => tx`select app.request_swap(${mine}, ${theirs})`)).rejects.toThrow(/own shifts/);
  });

  it('an approved swap fails safely if a shift changed hands meanwhile', async () => {
    const a = await shift(ids.staffA1.sub);
    const b = await shift(rn2.sub);
    const [w] = await asUser(sql, ids.staffA1, (tx) => tx`select * from app.request_swap(${a}, ${b})`);
    await asUser(sql, rn2, (tx) => tx`select app.respond_swap(${w!.id}, true)`);
    await asUser(sql, ids.managerA, (tx) => tx`update app.shifts set employee_id = ${rn3.sub} where id = ${b}`);
    // the direct reassignment cancelled the swap
    expect((await sql`select status from app.shift_swaps where id = ${w!.id}`)[0]!.status).toBe('cancelled');
    await expect(asUser(sql, ids.managerA, (tx) => tx`select app.decide_swap(${w!.id}, true)`)).rejects.toThrow(
      /not waiting/,
    );
  });

  it('respects allow_swaps', async () => {
    const a = await shift(ids.staffA1.sub);
    const b = await shift(rn2.sub);
    await asUser(sql, ids.adminA, (tx) => tx`update app.org_settings set allow_swaps = false`);
    await expect(asUser(sql, ids.staffA1, (tx) => tx`select app.request_swap(${a}, ${b})`)).rejects.toThrow(/turned off/);
    await asUser(sql, ids.adminA, (tx) => tx`update app.org_settings set allow_swaps = true`);
  });

  it('group mode: accepting executes the swap immediately', async () => {
    const a = await shift(ids.owlB2.sub, { areaId: ids.areaB, assignment: null });
    const b = await shift(owl3.sub, { areaId: ids.areaB, assignment: null });
    const [w] = await asUser(sql, ids.owlB2, (tx) => tx`select * from app.request_swap(${a}, ${b})`);
    const [{ s }] = (await asUser(sql, owl3, (tx) => tx`select app.respond_swap(${w!.id}, true) as s`)) as any;
    expect(s).toBe('approved');
    expect(await owner(a)).toBe(owl3.sub);
    expect(await owner(b)).toBe(ids.owlB2.sub);
  });
});

describe('expiry', () => {
  it('expire_offers closes offers whose shift has started', async () => {
    const s = await shift(rn2.sub);
    const [offer] = await asUser(sql, rn2, (tx) => tx`select * from app.offer_shift(${s})`);
    await sql`update app.shift_offers set expires_at = now() - interval '1 minute' where id = ${offer!.id}`;
    await expect(asUser(sql, rn3, (tx) => tx`select app.request_offer(${offer!.id})`)).rejects.toThrow(/no longer open/);
    const [{ n }] = (await sql`select app.expire_offers() as n`) as any;
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await sql`select status from app.shift_offers where id = ${offer!.id}`)[0]!.status).toBe('expired');
  });

  it('clients cannot call internal functions', async () => {
    await expect(asUser(sql, ids.managerA, (tx) => tx`select app.expire_offers()`)).rejects.toThrow(/permission denied/);
    await expect(asUser(sql, ids.managerA, (tx) => tx`select app._fill_offer(${randomUUID()})`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
