/**
 * Smoke test against a running local stack with a FRESH seed:
 *   pnpm db:reset shifthub --seed && pnpm dev:api (DEV_LOGIN=true) && pnpm --filter @shifthub/web build && next start
 *   node apps/web/e2e/schedule.cjs [screenshot-dir]
 * Uses the Playwright that is installed on the machine (require('playwright')).
 */
const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const { chromium } = require('playwright');
const out = process.argv[2] ?? require('node:os').tmpdir();
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  let failures = 0;
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); await page.screenshot({ path: `${out}/fail-${name.replace(/\W+/g, '-')}.png` }); } };

  await step('login + open schedule', async () => {
    await page.goto(`${BASE}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill('manager1@maplegrove.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    await page.getByRole('link', { name: 'Schedule', exact: true }).click();
    await page.getByText('147 published').waitFor();
    await page.getByText('14 open').waitFor();
    await page.screenshot({ path: `${out}/s1-week.png` });
  });

  await step('fill an open slot', async () => {
    await page.getByRole('button', { name: 'Open', exact: true }).first().click();
    const d = page.getByRole('dialog');
    await d.getByText('Edit shift').waitFor();
    const sel = d.getByLabel('Employee');
    const value = await sel.evaluate((el) => [...el.options].find((o) => o.value && !o.disabled)?.value);
    if (!value) throw new Error('no eligible employee');
    await sel.selectOption(value);
    await page.screenshot({ path: `${out}/s2-edit.png` });
    await d.getByRole('button', { name: 'Save' }).click();
    await d.waitFor({ state: 'detached' });
    await page.getByText('13 open').waitFor();
  });

  await step('next week: copy + publish', async () => {
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.getByText('0 published').waitFor();
    await page.getByRole('button', { name: 'Copy last week' }).click();
    let d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Copy', exact: true }).click();
    await d.getByText('Copied').waitFor();
    const text = await d.innerText();
    console.log('     ', text.split('\n').find((l) => l.startsWith('Copied')));
    await d.getByRole('button', { name: 'Done' }).click();
    await page.getByText('147 draft').waitFor();
    await page.screenshot({ path: `${out}/s3-drafts.png` });
    await page.getByRole('button', { name: /^Publish 147$/ }).click();
    d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Publish 147 shifts' }).click();
    await d.getByText('Published 147 shifts').waitFor();
    await d.getByRole('button', { name: 'Done' }).click();
    await page.getByText('147 published').waitFor();
  });

  await step('add a draft into an empty week, conflict hints shown', async () => {
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.getByText('0 published').waitFor();
    await page.getByRole('button', { name: /^Add Day Charge Nurse shift on/ }).first().click();
    const d = page.getByRole('dialog');
    await d.getByText('New shift').waitFor();
    const opts = await d.getByLabel('Employee').evaluate((el) => [...el.options].map((o) => ({ v: o.value, t: o.text, dis: o.disabled })));
    const enabled = opts.filter((o) => o.v && !o.dis);
    const disabled = opts.filter((o) => o.dis);
    console.log(`      ${enabled.length} eligible RNs, ${disabled.length} disabled (wrong position or busy)`);
    if (!enabled.every((o) => o.t.includes('(RN)'))) throw new Error('non-RN offered for RN slot');
    await d.getByLabel('Employee').selectOption(enabled[0].v);
    await d.getByRole('button', { name: 'Save' }).click();
    await d.waitFor({ state: 'detached' });
    await page.getByText('1 draft').waitFor();
  });

  await step('area switch via URL keeps week', async () => {
    const before = new URL(page.url());
    await page.getByLabel('Area').selectOption({ label: 'Cedar Unit' });
    await page.waitForURL((u) => u.searchParams.get('area') !== before.searchParams.get('area'));
    if (new URL(page.url()).searchParams.get('week') !== before.searchParams.get('week')) throw new Error('week lost');
  });

  await step('mobile width scrolls inside the table only', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error('page-level horizontal overflow');
  });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  process.exitCode = failures ? 1 : 0;
})();
