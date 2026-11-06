/**
 * Trading smoke test of the mobile web build at phone size (fresh seed; same setup as e2e-web.cjs).
 *   node apps/mobile/e2e-web-trades.cjs [screenshot-dir]
 */
const { chromium, devices } = require('playwright');
const BASE = process.env.MOBILE_URL ?? 'http://localhost:8081';
const API = process.env.API_URL ?? 'http://localhost:8787';
const out = process.argv[2] ?? require('node:os').tmpdir();

const tok = async (email) =>
  (await (await fetch(`${API}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json()).accessToken;
async function call(email, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await tok(email)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

(async () => {
  let failures = 0;
  const MGR = 'manager1@maplegrove.test';
  const tree = await call(MGR, 'GET', '/v1/locations');
  const birch = tree[0].areas.find((a) => a.name === 'Birch Unit');
  const rnPos = birch.assignments.find((x) => x.code === 'RN').id;
  const t = await call(MGR, 'GET', '/v1/shift-templates');
  const tpl = (n) => t.find((x) => x.name === n).id;
  const members = await call(MGR, 'GET', `/v1/members?areaId=${birch.id}`);
  const [A, B, C] = members.filter((m) => m.position === 'RN' && m.role === 'employee');
  await call(B.email, 'PATCH', '/v1/me', { shareSchedule: true });
  const date = addDays(new Date().toISOString().slice(0, 10), 12);
  const mk = (who, template, d = date) =>
    call(MGR, 'POST', '/v1/shifts', { areaId: birch.id, assignmentId: rnPos, employeeId: who, shiftTemplateId: tpl(template), date: d, status: 'published' });
  const aDay = await mk(A.id, 'Day');
  const bEve = await mk(B.id, 'Evening');
  const aNight = await mk(A.id, 'Night', addDays(date, 2));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.request().method()} ${r.url()}`));
  const step = async (name, fn) => {
    try { await fn(); console.log('OK  ', name); }
    catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: `${out}/t-fail-${name.replace(/\W+/g, '-')}.png` }); }
  };
  const login = async (email) => {
    await page.goto(`${BASE}/`);
    await page.getByLabel('Email').waitFor();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText(/^Hi /).waitFor();
  };
  const signOut = async () => {
    await page.getByRole('tab', { name: /Profile/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email').waitFor();
  };

  await step('A proposes a swap from the shift screen', async () => {
    await login(A.email);
    await page.goto(`${BASE}/shift/${aDay.id}`);
    await page.getByText('Can’t make it?').waitFor();
    await page.screenshot({ path: `${out}/t1-actions.png` });
    await page.getByRole('button', { name: 'Swap with a coworker' }).click();
    await page.getByRole('radio', { name: new RegExp(`^${B.name} ${date} 15:00`) }).click();
    await page.getByLabel('Message (optional)').fill('school concert');
    await page.screenshot({ path: `${out}/t2-swap-picker.png` });
    await page.getByRole('button', { name: 'Send swap request' }).click();
    await page.getByText('Waiting for coworker', { exact: true }).waitFor();
  });

  await step('B sees the badge and accepts', async () => {
    await page.goto(`${BASE}/`);
    await signOut();
    await login(B.email);
    await page.getByRole('tab', { name: /Requests/ }).getByText('1').waitFor();
    await page.getByRole('tab', { name: /Requests/ }).click();
    await page.getByText(`${A.name} wants to swap`).waitFor();
    await page.getByText('“school concert”').waitFor();
    await page.screenshot({ path: `${out}/t3-incoming.png` });
    await page.getByRole('button', { name: 'Accept swap' }).click();
    await page.getByText('Waiting for manager').waitFor();
  });

  await step('manager approves; B sees it swapped', async () => {
    const appr = await call(MGR, 'GET', '/v1/approvals');
    await call(MGR, 'POST', `/v1/swaps/${appr.swaps[0].id}/decision`, { approve: true });
    await page.reload();
    await page.getByRole('tab', { name: /Requests/ }).click();
    await page.getByText('Swapped').waitFor();
    if ((await call(MGR, 'GET', `/v1/shifts/${aDay.id}`)).employeeId !== B.id) throw new Error('swap not applied');
  });

  await step('A gives away a night shift', async () => {
    await signOut();
    await login(A.email);
    await page.goto(`${BASE}/shift/${aNight.id}`);
    await page.getByLabel('Reason (optional)').fill('appointment');
    await page.getByRole('button', { name: 'Give away shift' }).click();
    await page.getByText('On the marketplace · 0 requests').waitFor();
  });

  await step('C requests, withdraws, requests again; manager approves', async () => {
    await page.goto(`${BASE}/`);
    await signOut();
    await login(C.email);
    await page.getByRole('tab', { name: /Open shifts/ }).click();
    await page.getByText(`From ${A.name}`).first().waitFor();
    await page.getByText('“appointment”').waitFor();
    await page.screenshot({ path: `${out}/t4-open-shifts.png` });
    await page.getByRole('button', { name: 'Request shift' }).first().click();
    await page.getByText('Requested — waiting for manager').waitFor();
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByRole('button', { name: 'Request shift' }).first().waitFor();
    await page.getByRole('button', { name: 'Request shift' }).first().click();
    await page.getByText('Requested — waiting for manager').waitFor();
    const appr = await call(MGR, 'GET', '/v1/approvals');
    const req = appr.pickups.find((p) => p.offer.shift.id === aNight.id);
    await call(MGR, 'POST', `/v1/offer-requests/${req.id}/decision`, { approve: true });
    await page.reload();
    await page.getByRole('tab', { name: /Requests/ }).click();
    await page.getByText('Approved — it’s yours').waitFor();
    await page.screenshot({ path: `${out}/t5-requests.png` });
  });

  await step('group member picks up a shift instantly', async () => {
    const owlShifts = await call('owl1@nightowls.test', 'GET', `/v1/shifts?from=${date}&to=${date}&mine=true`);
    let s = owlShifts[0];
    if (!s) {
      const loc = await call('owl1@nightowls.test', 'GET', '/v1/locations');
      s = await call('owl1@nightowls.test', 'POST', '/v1/shifts', { areaId: loc[0].areas[0].id, date, startTime: '19:00', endTime: '07:00', status: 'published' });
    }
    await call('owl1@nightowls.test', 'POST', '/v1/offers', { shiftId: s.id });
    await signOut();
    await login('owl3@nightowls.test');
    await page.getByRole('tab', { name: /Open shifts/ }).click();
    await page.getByText('The first eligible person to request a shift gets it.').waitFor();
    await page.getByRole('button', { name: 'Request shift' }).first().click();
    await page.getByText(/It’s yours/).waitFor();
  });

  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors');
  await browser.close();
  process.exitCode = failures ? 1 : 0;
})();
