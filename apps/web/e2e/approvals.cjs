/**
 * Smoke test for the approvals flow against a running local stack with a FRESH seed:
 *   pnpm db:reset shifthub --seed && pnpm dev:api (DEV_LOGIN=true) && web on :3000
 *   node apps/web/e2e/approvals.cjs [screenshot-dir]
 */
const { chromium } = require('playwright');
const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:8787';
const out = process.argv[2] ?? require('node:os').tmpdir();

async function token(email) {
  const r = await fetch(`${API}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  return (await r.json()).accessToken;
}
async function call(email, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await token(email)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

(async () => {
  let failures = 0;
  const MGR = 'manager1@maplegrove.test';
  // ---- data setup through the API (two weeks ahead, Birch Unit) ----
  const tree = await call(MGR, 'GET', '/v1/locations');
  const birch = tree[0].areas.find((a) => a.name === 'Birch Unit');
  const pos = (code) => birch.assignments.find((x) => x.code === code).id;
  const templates = await call(MGR, 'GET', '/v1/shift-templates');
  const day = templates.find((t) => t.name === 'Day').id;
  const evening = templates.find((t) => t.name === 'Evening').id;
  const members = await call(MGR, 'GET', `/v1/members?areaId=${birch.id}`);
  const rns = members.filter((m) => m.position === 'RN' && m.role === 'employee');
  const psw = members.find((m) => m.position === 'PSW' && m.role === 'employee');
  const today = new Date().toISOString().slice(0, 10);
  const monday = addDays(today, 14 - ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const date = addDays(monday, 2);

  const open = await call(MGR, 'POST', '/v1/shifts', { areaId: birch.id, assignmentId: pos('PSW1'), shiftTemplateId: day, date, status: 'published' });
  const a = await call(MGR, 'POST', '/v1/shifts', { areaId: birch.id, assignmentId: pos('RN'), employeeId: rns[0].id, shiftTemplateId: day, date, status: 'published' });
  const b = await call(MGR, 'POST', '/v1/shifts', { areaId: birch.id, assignmentId: pos('RN'), employeeId: rns[1].id, shiftTemplateId: evening, date, status: 'published' });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  const step = async (name, fn) => {
    try { await fn(); console.log('OK  ', name); }
    catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: `${out}/fail-${name.replace(/\W+/g, '-')}.png` }); }
  };

  await step('manager posts the open slot from the schedule', async () => {
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill(MGR);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    await page.goto(`${BASE}/schedule?week=${monday}&area=${birch.id}`);
    await page.getByRole('button', { name: 'Open', exact: true }).first().click();
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Post to marketplace' }).click();
    await d.getByText('On the marketplace').waitFor();
    await d.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByLabel('on the marketplace').first().waitFor();
  });

  await step('staff request and propose a swap (API)', async () => {
    const market = await call(psw.email, 'GET', '/v1/marketplace?eligibleOnly=true');
    const offer = market.find((o) => o.shift.id === open.id);
    if (!offer) throw new Error('PSW cannot see the offer');
    await call(psw.email, 'POST', `/v1/offers/${offer.id}/requests`, { note: 'I can cover' });
    const swap = await call(rns[0].email, 'POST', '/v1/swaps', { myShiftId: a.id, theirShiftId: b.id, note: 'school pickup' });
    await call(rns[1].email, 'POST', `/v1/swaps/${swap.id}/response`, { accept: true });
  });

  await step('badge + approvals page', async () => {
    await page.goto(`${BASE}/approvals`);
    await page.getByLabel('2 pending').waitFor();
    await page.getByText('Shift pickups (1)').waitFor();
    await page.getByText('Swaps (1)').waitFor();
    await page.getByText('“I can cover”').waitFor();
    await page.screenshot({ path: `${out}/a1-approvals.png` });
  });

  await step('approve pickup and swap', async () => {
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByText('Shift pickups (1)').waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Approve swap' }).click();
    await page.getByText('Nothing waiting').waitFor();
  });

  await step('schedule reflects the results', async () => {
    const s = await call(MGR, 'GET', `/v1/shifts/${open.id}`);
    if (s.employeeId !== psw.id) throw new Error('pickup not applied');
    const sa = await call(MGR, 'GET', `/v1/shifts/${a.id}`);
    if (sa.employeeId !== rns[1].id) throw new Error('swap not applied');
    await page.goto(`${BASE}/schedule?week=${monday}&area=${birch.id}`);
    await page.getByText('0 open').waitFor();
  });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  process.exitCode = failures ? 1 : 0;
})();
