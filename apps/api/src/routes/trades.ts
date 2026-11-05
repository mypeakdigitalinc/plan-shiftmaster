/**
 * D4 routes: marketplace (offers + pickup requests), swaps, manager approvals.
 * All decisions run in SQL RPCs that re-validate state; these handlers shape data.
 */
import { createRoute, z } from '@hono/zod-openapi';
import {
  approvals,
  createOfferInput,
  createSwapInput,
  decisionInput,
  myTrades,
  offer,
  offerRequest,
  requestOfferInput,
  swap,
  swapResponseInput,
  type Offer,
  type OfferRequest,
  type Swap,
} from '@shifthub/shared';
import type { Tx } from '../db';
import { body, errors, idParam, isManager, json, requireManager, requireOrg, secured, type Api, type Run } from '../http';
import { toShift } from '../mappers';
import { selectShifts } from './shifts';

type Row = Record<string, any>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const person = (id: string | null, name: string | null, position: string | null) =>
  id ? { id, name: name ?? '', position: position ?? null } : null;

async function shiftsById(tx: Tx, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter(Boolean))] as string[];
  if (!wanted.length) return new Map<string, ReturnType<typeof toShift>>();
  const rows = await selectShifts(tx, tx`and s.id = any(${wanted}::uuid[])`);
  return new Map(rows.map((r: Row) => [r.id as string, toShift(r)]));
}

/** Offers matching `where`, shaped for the caller. */
async function loadOffers(tx: Tx, me: string, where: ReturnType<Tx>): Promise<Offer[]> {
  const manager = await isManager(tx);
  const rows = await tx`
    select o.*, p.name as offered_by_name, p.position as offered_by_position,
           coalesce(app.is_eligible(${me}, s.area_id, s.assignment_id), false) as eligible,
           coalesce(app.has_overlap(${me}, s.starts_at, s.ends_at, array[s.id]), false) as conflict,
           (select count(*) from app.shift_offer_requests r where r.offer_id = o.id and r.status = 'pending')::int as pending_requests,
           mr.id as my_request_id, mr.status as my_request_status
    from app.shift_offers o
    join app.shifts s on s.id = o.shift_id
    left join app.profiles p on p.id = o.offered_by
    left join lateral (
      select id, status from app.shift_offer_requests r
      where r.offer_id = o.id and r.employee_id = ${me}
      order by r.created_at desc limit 1
    ) mr on true
    where o.organization_id = app.current_org_id() ${where}
    order by s.starts_at`;
  const shifts = await shiftsById(tx, rows.map((r) => r.shift_id));
  return rows
    .filter((r) => shifts.has(r.shift_id))
    .map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      expiresAt: iso(r.expires_at)!,
      createdAt: iso(r.created_at)!,
      offeredBy: person(r.offered_by, r.offered_by_name, r.offered_by_position),
      shift: shifts.get(r.shift_id)!,
      eligible: r.eligible,
      conflict: r.conflict,
      myRequest: r.my_request_id ? { id: r.my_request_id, status: r.my_request_status } : null,
      pendingRequests: manager || r.offered_by === me ? r.pending_requests : 0,
    }));
}

async function loadRequests(tx: Tx, where: ReturnType<Tx>): Promise<(OfferRequest & { offerIdRef: string })[]> {
  const rows = await tx`
    select r.*, p.name, p.position from app.shift_offer_requests r
    join app.profiles p on p.id = r.employee_id
    where r.organization_id = app.current_org_id() ${where}
    order by r.created_at`;
  return rows.map((r) => ({
    id: r.id,
    offerId: r.offer_id,
    offerIdRef: r.offer_id,
    status: r.status,
    note: r.note,
    createdAt: iso(r.created_at)!,
    decidedAt: iso(r.decided_at),
    employee: person(r.employee_id, r.name, r.position)!,
  }));
}

async function loadSwaps(tx: Tx, where: ReturnType<Tx>): Promise<Swap[]> {
  const rows = await tx`
    select w.*, a.name as requester_name, a.position as requester_position,
           b.name as target_name, b.position as target_position
    from app.shift_swaps w
    join app.profiles a on a.id = w.requester_id
    join app.profiles b on b.id = w.target_id
    where w.organization_id = app.current_org_id() ${where}
    order by w.created_at desc
    limit 200`;
  const shifts = await shiftsById(tx, rows.flatMap((r) => [r.requester_shift_id, r.target_shift_id]));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    note: r.note,
    createdAt: iso(r.created_at)!,
    peerRespondedAt: iso(r.peer_responded_at),
    decidedAt: iso(r.decided_at),
    requester: person(r.requester_id, r.requester_name, r.requester_position)!,
    target: person(r.target_id, r.target_name, r.target_position)!,
    requesterShift: shifts.get(r.requester_shift_id) ?? null,
    targetShift: shifts.get(r.target_shift_id) ?? null,
  }));
}

const strip = <T extends { offerIdRef?: string }>({ offerIdRef: _, ...rest }: T) => rest;

export function registerTradeRoutes(app: Api, run: Run) {
  // ---------------- marketplace ----------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/marketplace',
      tags: ['Marketplace'],
      summary: 'Open shifts on offer in my organization',
      security: secured,
      request: { query: z.object({ eligibleOnly: z.enum(['true', 'false']).optional() }) },
      responses: { 200: json(z.array(offer), 'Open offers'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const me = c.get('user').sub;
      const { eligibleOnly } = c.req.valid('query');
      const offers = await run(c, async (tx) => {
        await requireOrg(tx);
        return loadOffers(tx, me, tx`and o.status = 'open' and o.expires_at > now()`);
      });
      return c.json(eligibleOnly === 'true' ? offers.filter((o) => o.eligible && !o.conflict && o.offeredBy?.id !== me) : offers, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/offers',
      tags: ['Marketplace'],
      summary: 'Give away a shift (your own; managers: any, including open slots)',
      security: secured,
      request: body(createOfferInput),
      responses: { 201: json(offer, 'Offered'), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const { shiftId, reason } = c.req.valid('json');
      const me = c.get('user').sub;
      const result = await run(c, async (tx) => {
        await requireOrg(tx);
        const [row] = await tx`select id from app.offer_shift(${shiftId}, ${reason ?? null})`;
        return (await loadOffers(tx, me, tx`and o.id = ${row!.id}`))[0]!;
      });
      return c.json(result, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/offers/{id}',
      tags: ['Marketplace'],
      summary: 'Take a shift off the marketplace (offerer or manager)',
      security: secured,
      request: { params: idParam },
      responses: { 204: { description: 'Cancelled' }, 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await run(c, (tx) => tx`select app.cancel_offer(${id})`);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/offers/{id}/requests',
      tags: ['Marketplace'],
      summary: 'Requests for an offer, oldest first (manager or offerer)',
      security: secured,
      request: { params: idParam },
      responses: { 200: json(z.array(offerRequest), 'Requests'), 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const rows = await run(c, (tx) => loadRequests(tx, tx`and r.offer_id = ${id}`));
      return c.json(rows.map(strip), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/offers/{id}/requests',
      tags: ['Marketplace'],
      summary: 'Ask for an offered shift (auto-approved when the org does not require approval)',
      security: secured,
      request: { params: idParam, ...body(requestOfferInput) },
      responses: { 201: json(offerRequest, 'Requested'), 400: errors[400], 401: errors[401], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { note } = c.req.valid('json');
      const result = await run(c, async (tx) => {
        const [row] = await tx`select id from app.request_offer(${id}, ${note ?? null})`;
        return (await loadRequests(tx, tx`and r.id = ${row!.id}`))[0]!;
      });
      return c.json(strip(result), 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/offer-requests/{id}',
      tags: ['Marketplace'],
      summary: 'Withdraw my pickup request',
      security: secured,
      request: { params: idParam },
      responses: { 204: { description: 'Withdrawn' }, 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await run(c, (tx) => tx`select app.withdraw_offer_request(${id})`);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/offer-requests/{id}/decision',
      tags: ['Approvals'],
      summary: 'Approve or reject a pickup request (Manager)',
      security: secured,
      request: { params: idParam, ...body(decisionInput) },
      responses: { 200: json(offerRequest, 'Decided'), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { approve } = c.req.valid('json');
      const result = await run(c, async (tx) => {
        await tx`select app.decide_offer_request(${id}, ${approve})`;
        return (await loadRequests(tx, tx`and r.id = ${id}`))[0]!;
      });
      return c.json(strip(result), 200);
    },
  );

  // ---------------- swaps ----------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/swaps',
      tags: ['Swaps'],
      summary: 'Swaps I am part of (managers: scope=org for everyone’s)',
      security: secured,
      request: { query: z.object({ scope: z.enum(['mine', 'org']).optional() }) },
      responses: { 200: json(z.array(swap), 'Swaps'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const me = c.get('user').sub;
      const { scope } = c.req.valid('query');
      const rows = await run(c, async (tx) => {
        await requireOrg(tx);
        return loadSwaps(tx, scope === 'org' ? tx`` : tx`and ${me} in (w.requester_id, w.target_id)`);
      });
      return c.json(rows, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/swaps',
      tags: ['Swaps'],
      summary: 'Propose swapping one of my shifts for a coworker’s',
      security: secured,
      request: body(createSwapInput),
      responses: { 201: json(swap, 'Requested'), 400: errors[400], 401: errors[401], 403: errors[403], 409: errors[409] },
    }),
    async (c) => {
      const { myShiftId, theirShiftId, note } = c.req.valid('json');
      const result = await run(c, async (tx) => {
        const [row] = await tx`select id from app.request_swap(${myShiftId}, ${theirShiftId}, ${note ?? null})`;
        return (await loadSwaps(tx, tx`and w.id = ${row!.id}`))[0]!;
      });
      return c.json(result, 201);
    },
  );

  const swapAction = (path: string, summary: string, input: z.ZodType, call: (tx: Tx, id: string, v: any) => Promise<unknown>) =>
    app.openapi(
      createRoute({
        method: 'post',
        path,
        tags: ['Swaps'],
        summary,
        security: secured,
        request: { params: idParam, ...body(input) },
        responses: { 200: json(swap, 'Updated'), 400: errors[400], 401: errors[401], 403: errors[403], 404: errors[404], 409: errors[409] },
      }),
      (async (c: any) => {
        const { id } = c.req.valid('param');
        const v = c.req.valid('json');
        const result = await run(c, async (tx) => {
          await call(tx, id, v);
          return (await loadSwaps(tx, tx`and w.id = ${id}`))[0]!;
        });
        return c.json(result, 200);
      }) as any,
    );

  swapAction('/v1/swaps/{id}/response', 'Accept or decline a swap offered to me', swapResponseInput, (tx, id, v) =>
    tx`select app.respond_swap(${id}, ${v.accept})`,
  );
  swapAction('/v1/swaps/{id}/decision', 'Approve or reject a swap (Manager)', decisionInput, (tx, id, v) =>
    tx`select app.decide_swap(${id}, ${v.approve})`,
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/swaps/{id}',
      tags: ['Swaps'],
      summary: 'Cancel a swap I proposed',
      security: secured,
      request: { params: idParam },
      responses: { 204: { description: 'Cancelled' }, 401: errors[401], 404: errors[404] },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      await run(c, (tx) => tx`select app.cancel_swap(${id})`);
      return c.body(null, 204);
    },
  );

  // ---------------- my trades & approvals ----------------
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me/trades',
      tags: ['Me'],
      summary: 'My offers, pickup requests and swaps (last 60 days)',
      security: secured,
      responses: { 200: json(myTrades, 'Trades'), 401: errors[401], 409: errors[409] },
    }),
    async (c) => {
      const me = c.get('user').sub;
      const result = await run(c, async (tx) => {
        await requireOrg(tx);
        const recent = tx`and o.created_at > now() - interval '60 days'`;
        const offers = await loadOffers(tx, me, tx`and o.offered_by = ${me} ${recent}`);
        const requests = await loadRequests(tx, tx`and r.employee_id = ${me} and r.created_at > now() - interval '60 days'`);
        const reqOffers = requests.length
          ? await loadOffers(tx, me, tx`and o.id = any(${requests.map((r) => r.offerIdRef)}::uuid[])`)
          : [];
        const swaps = await loadSwaps(tx, tx`and ${me} in (w.requester_id, w.target_id) and w.created_at > now() - interval '60 days'`);
        return {
          offers,
          requests: requests.map((r) => ({ ...strip(r), offer: reqOffers.find((o) => o.id === r.offerIdRef) ?? null })),
          swaps,
        };
      });
      return c.json(result, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/approvals',
      tags: ['Approvals'],
      summary: 'Pickup requests and swaps waiting for a manager (oldest first)',
      security: secured,
      responses: { 200: json(approvals, 'Waiting'), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const me = c.get('user').sub;
      const result = await run(c, async (tx) => {
        await requireManager(tx);
        const requests = await loadRequests(
          tx,
          tx`and r.status = 'pending' and exists (
                select 1 from app.shift_offers o where o.id = r.offer_id and o.status = 'open' and o.expires_at > now())`,
        );
        const offers = requests.length
          ? await loadOffers(tx, me, tx`and o.id = any(${requests.map((r) => r.offerIdRef)}::uuid[])`)
          : [];
        const swaps = (await loadSwaps(tx, tx`and w.status = 'pending_manager'`)).reverse();
        return {
          pickups: requests
            .map((r) => ({ ...strip(r), offer: offers.find((o) => o.id === r.offerIdRef)! }))
            .filter((r) => r.offer),
          swaps,
        };
      });
      return c.json(result, 200);
    },
  );
}
