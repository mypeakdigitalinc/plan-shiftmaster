/**
 * Scheduled jobs. Call runJobs() every ~5–15 minutes from any scheduler
 * (Vercel Cron → POST /internal/jobs/run, Supabase pg_cron + pg_net, AWS EventBridge → Lambda).
 */
import type { Db, Tx } from './db';
import type { PushSender } from './push';

const MAX_ATTEMPTS = 3;

export type JobResult = { expiredOffers: number; reminders: number; push: { sent: number; skipped: number; failed: number } };

export async function deliverPush(tx: Tx, send: PushSender, limit = 500) {
  // Old undelivered notifications are not worth a late buzz
  await tx`update app.notifications set push_status = 'skipped'
           where push_status = 'pending' and created_at < now() - interval '24 hours'`;

  // Lock a batch first (concurrent runners skip it), then attach each person's device tokens
  const rows = await tx`
    with batch as (
      select id from app.notifications
      where push_status = 'pending'
      order by created_at
      limit ${limit}
      for update skip locked
    )
    select n.id, n.type, n.title, n.body, n.data, n.push_attempts,
           coalesce((select array_agg(t.token) from app.push_tokens t where t.user_id = n.user_id), '{}') as tokens
    from app.notifications n
    join batch b on b.id = n.id
    order by n.created_at`;

  const noTokens = rows.filter((r) => !r.tokens.length).map((r) => r.id as string);
  if (noTokens.length) await tx`update app.notifications set push_status = 'skipped' where id = any(${noTokens}::uuid[])`;

  const withTokens = rows.filter((r) => r.tokens.length);
  const messages = withTokens.flatMap((r) =>
    (r.tokens as string[]).map((to) => ({ to, title: r.title, body: r.body, data: { ...r.data, notificationId: r.id, type: r.type } })),
  );
  const results = messages.length ? await send(messages) : [];
  const okTokens = new Set(results.filter((r) => r.ok).map((r) => r.token));
  const dead = results.filter((r) => r.unregistered).map((r) => r.token);
  if (dead.length) await tx`delete from app.push_tokens where token = any(${dead}::text[])`;

  let sent = 0;
  let failed = 0;
  for (const r of withTokens) {
    const delivered = (r.tokens as string[]).some((t) => okTokens.has(t));
    if (delivered) {
      sent++;
      await tx`update app.notifications set push_status = 'sent', pushed_at = now(), push_attempts = push_attempts + 1 where id = ${r.id}`;
    } else {
      const attempts = (r.push_attempts as number) + 1;
      if (attempts >= MAX_ATTEMPTS) failed++;
      await tx`update app.notifications
               set push_attempts = ${attempts}, push_status = ${attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'}
               where id = ${r.id}`;
    }
  }
  return { sent, skipped: noTokens.length, failed };
}

export async function runJobs(db: Db, send: PushSender): Promise<JobResult> {
  const expiredOffers = await db.asOwner(async (tx) => (await tx`select app.expire_offers() as n`)[0]!.n as number);
  const reminders = await db.asOwner(async (tx) => (await tx`select app.send_shift_reminders() as n`)[0]!.n as number);
  const push = await db.asOwner((tx) => deliverPush(tx, send));
  return { expiredOffers, reminders, push };
}
