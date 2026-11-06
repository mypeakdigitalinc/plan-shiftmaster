/**
 * Smoke test of the mobile app's web build at phone size.
 *   pnpm --filter @shifthub/mobile export:web, serve apps/mobile/dist on :8081 (SPA fallback),
 *   API on :8787 with DEV_LOGIN=true and CORS_ORIGINS including http://localhost:8081, fresh seed.
 *   node apps/mobile/e2e-web.cjs [screenshot-dir]
 */
const { chromium, devices } = require('playwright');
const BASE = process.env.MOBILE_URL ?? 'http://localhost:8081';
const API = process.env.API_URL ?? 'http://localhost:8787';
const out = process.argv[2] ?? require('node:os').tmpdir();

async function apiAs(email, path) {
  const t = await (await fetch(`${API}/dev/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json();
  return (await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${t.accessToken}` } })).json();
}

(async () => {
  let failures = 0;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.request().method()} ${r.url()}`));
  const step = async (name, fn) => {
    try { await fn(); console.log('OK  ', name); }
    catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: `${out}/m-fail-${name.replace(/\W+/g, '-')}.png` }); }
  };
  const login = async (email) => {
    await page.goto(`${BASE}/`);
    await page.getByLabel('Email').waitFor();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Sign in' }).click();
  };

  await step('employee logs in and sees their schedule', async () => {
    await login('staff1@maplegrove.test');
    await page.getByText('Hi Staff').waitFor();
    await page.getByText(/h this week/).waitFor();
    await page.screenshot({ path: `${out}/m1-schedule.png` });
  });

  await step('team schedule lists coworkers who share', async () => {
    await page.getByRole('button', { name: 'Team schedule' }).click();
    await page.getByText('Coworkers who share their schedule.', { exact: false }).waitFor();
    await page.getByText(/^Staff \d+$/).first().waitFor();
    await page.screenshot({ path: `${out}/m6-team.png` });
    await page.goBack();
    await page.getByText('Hi Staff').waitFor();
  });

  await step('opens a shift', async () => {
    const card = page.getByRole('button', { name: /^Shift \d\d:\d\d to/ }).first();
    if (await card.count()) {
      await card.click();
      await page.getByText('Status').waitFor();
      await page.getByText('published').first().waitFor();
      await page.screenshot({ path: `${out}/m2-shift.png` });
      await page.goBack();
    } else {
      console.log('      (no upcoming shifts for staff1 this week — skipped)');
    }
  });

  await step('turns schedule sharing off and on', async () => {
    await page.getByRole('tab', { name: /Profile/ }).click();
    const sw = page.getByLabel('Share my schedule with coworkers');
    await sw.waitFor();
    const before = (await apiAs('staff1@maplegrove.test', '/v1/me')).profile.shareSchedule;
    await sw.click();
    await page.waitForTimeout(800);
    const after = (await apiAs('staff1@maplegrove.test', '/v1/me')).profile.shareSchedule;
    if (after === before) throw new Error('share toggle did not save');
    await sw.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/m3-profile.png` });
  });

  await step('edits availability', async () => {
    await page.getByRole('button', { name: "Times I can't work" }).click();
    await page.getByText('Add a time').waitFor();
    await page.getByRole('radio', { name: 'Fri' }).click();
    await page.getByLabel('Note (optional)').fill('Daycare');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('Fri · All day').waitFor();
    await page.screenshot({ path: `${out}/m4-availability.png` });
    await page.getByRole('button', { name: 'Save availability' }).click();
    await page.getByLabel('Share my schedule with coworkers').waitFor();
    const av = await apiAs('staff1@maplegrove.test', '/v1/me/availability');
    if (!av.slots.some((s) => s.weekday === 5 && s.note === 'Daycare')) throw new Error('availability not saved');
  });

  await step('new person joins a worker group with a code', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await login('newbie.owl@example.test');
    await page.getByLabel('Invite code').waitFor();
    await page.getByLabel('Invite code').fill('WRONG1');
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await page.getByText('invalid invite code').waitFor();
    await page.getByLabel('Invite code').fill('OWLS000002');
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await page.getByText('Night Owls Crew').waitFor();
  });

  await step('group member adds their own shift', async () => {
    await page.getByRole('button', { name: '+ Add my shift' }).click();
    await page.getByText('Where').waitFor();
    const tomorrow = page.getByRole('radio').nth(2); // second date chip after the single location chip
    await tomorrow.click();
    await page.screenshot({ path: `${out}/m5-add-shift.png` });
    await page.getByRole('button', { name: 'Add shift' }).click();
    await page.getByText('Hi newbie.owl').waitFor();
    await page.getByRole('button', { name: /^Shift 19:00 to 07:00/ }).first().waitFor();
  });

  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors');
  await browser.close();
  process.exitCode = failures ? 1 : 0;
})();
