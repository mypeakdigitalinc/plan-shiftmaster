/**
 * Smoke test against a running local stack with a FRESH seed:
 *   pnpm db:reset shifthub --seed && pnpm dev:api (DEV_LOGIN=true) && pnpm --filter @shifthub/web build && next start
 *   node apps/web/e2e/setup-screens.cjs [screenshot-dir]
 * Uses the Playwright that is installed on the machine (require('playwright')).
 */
const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const { chromium } = require('playwright');
const out = process.argv[2] ?? require('node:os').tmpdir();
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = []; page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  let failures = 0;
  const step = async (name, fn) => { try { await fn(); console.log('OK  ', name); } catch (e) { failures++; console.log('FAIL', name, e.message.split('\n')[0]); } };

  await step('login as admin', async () => {
    await page.goto(`${BASE}/`);
    await page.waitForURL('**/login');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill('admin@maplegrove.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');
    await page.getByText('Maple Grove Care Home').first().waitFor();
    await page.getByText('100', { exact: true }).waitFor();
    await page.screenshot({ path: `${out}/1-dashboard.png` });
  });

  await step('employees list + search', async () => {
    await page.getByRole('link', { name: 'Employees' }).click();
    await page.getByText('100 people').waitFor();
    await page.getByLabel('Search employees').fill('staff1');
    await page.getByText('staff1@maplegrove.test').waitFor();
    await page.screenshot({ path: `${out}/2-employees.png` });
    await page.getByLabel('Search employees').fill('');
  });

  await step('edit employee areas', async () => {
    await page.getByLabel('Search employees').fill('staff10@');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Can work in').waitFor();
    await dialog.getByLabel('Willow Unit').waitFor();
    await page.screenshot({ path: `${out}/3-edit-member.png` });
    await dialog.getByLabel('Willow Unit').check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await dialog.waitFor({ state: 'detached' });
    await page.getByLabel('Search employees').fill('');
  });

  await step('invite employee', async () => {
    await page.getByRole('button', { name: 'Invite' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill('psw.new@example.test');
    await dialog.getByLabel('Position').fill('PSW');
    await dialog.getByRole('button', { name: 'Create invitation' }).click();
    await dialog.getByText('Invitation created').waitFor();
    const link = await dialog.getByLabel('Invitation link').inputValue();
    if (!link.includes('/invite/')) throw new Error('bad link ' + link);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.getByText('psw.new@example.test').waitFor();
    global.inviteLink = link;
  });

  await step('locations: add site + area + position', async () => {
    await page.getByRole('link', { name: 'Locations' }).click();
    await page.getByText('Birch Unit').waitFor();
    await page.screenshot({ path: `${out}/4-locations.png`, fullPage: true });
    await page.getByRole('button', { name: 'Add site' }).click();
    let d = page.getByRole('dialog');
    await d.getByLabel('Name').fill('North Annex');
    await d.getByLabel('Code').fill('NA');
    await d.getByRole('button', { name: 'Save' }).click();
    await d.waitFor({ state: 'detached' });
    const card = page.locator('div.rounded-lg', { hasText: 'North Annex' }).first();
    await card.getByRole('button', { name: 'Add area' }).click();
    d = page.getByRole('dialog');
    await d.getByLabel('Name').fill('Rehab');
    await d.getByRole('button', { name: 'Save' }).click();
    await d.waitFor({ state: 'detached' });
    await page.getByText('Rehab', { exact: true }).waitFor();
  });

  await step('templates', async () => {
    await page.getByRole('link', { name: 'Shift templates', exact: true }).click();
    await page.getByText('23:00 – 07:00 · 8h · overnight').waitFor();
    await page.getByRole('button', { name: 'Add template' }).click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Name').fill('12h Night');
    await d.getByLabel('Start').fill('19:00');
    await d.getByLabel('End', { exact: true }).fill('07:00');
    await d.getByText('Ends the next day').waitFor();
    await d.getByRole('button', { name: 'Save' }).click();
    await d.waitFor({ state: 'detached' });
    await page.getByText('19:00 – 07:00 · 12h · overnight').waitFor();
    await page.screenshot({ path: `${out}/5-templates.png` });
  });

  await step('settings toggle', async () => {
    await page.getByRole('link', { name: 'Settings' }).click();
    const sw = page.getByRole('switch', { name: 'Shift swaps' });
    await sw.waitFor();
    if ((await sw.getAttribute('aria-checked')) !== 'true') throw new Error('expected swaps on');
    await sw.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Shift swaps"]')?.getAttribute('aria-checked') === 'false');
    await page.screenshot({ path: `${out}/6-settings.png` });
  });

  await step('employee is redirected to mobile notice', async () => {
    await page.getByRole('button', { name: 'Sign out' }).first().click({ force: true });
    await page.waitForURL('**/login');
    await page.getByLabel('Email').fill('staff1@maplegrove.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('The admin portal is for managers').waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
  });

  await step('invite accept flow', async () => {
    await page.goto(global.inviteLink);
    await page.waitForURL('**/login?next=**');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Email').fill('psw.new@example.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await page.getByText('The admin portal is for managers').waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
  });

  await step('new user creates a worker group', async () => {
    await page.getByLabel('Email').fill('founder@nightcrew.test');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/onboarding');
    await page.getByLabel('Organization name').fill('Night Crew');
    await page.getByText('Worker group', { exact: true }).click();
    await page.screenshot({ path: `${out}/7-onboarding.png` });
    await page.getByRole('button', { name: 'Create organization' }).last().click();
    await page.waitForURL('**/dashboard');
    await page.getByText('Worker group · America/Toronto').waitFor();
    await page.getByText('Trades auto-approve').waitFor();
  });

  await step('mobile width layout', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('link', { name: 'Employees' }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) throw new Error('horizontal overflow');
    await page.screenshot({ path: `${out}/8-mobile.png` });
  });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await browser.close();
  process.exitCode = failures ? 1 : 0;
})();
