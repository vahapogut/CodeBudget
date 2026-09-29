import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../../packages/core/src/store.js';
import { defaults } from '../../packages/core/src/config.js';
import { startDashboard, type DashboardHandle } from '../../apps/dashboard/src/server.js';

let store: Store;
let directory: string;
let server: DashboardHandle;
test.beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'codebudget-dashboard-e2e-'));
  store = new Store(directory, defaults());
  const session = store.startSession('Repair refresh rotation');
  const artifact = store.putText('FAIL auth.test.ts > prevents token reuse\nExpected: 401\nReceived: 200\n<img src=x onerror="window.xss=true">\n', { sessionId: session.id });
  store.recordRun({ id: 'e2e-run', sessionId: session.id, executable: 'pnpm', args: ['test'], status: 'failure', exitCode: 1, originalSize: 1200, reducedSize: 400, durationMs: 75, artifactId: artifact.id, output: 'FAIL prevents token reuse\nExpected: 401; Received: 200', reducerId: 'test-reducer', truncated: false, reason: 'Fixture record for browser verification' });
  for (const fixture of [
    { id: 'e2e-timeout', executable: 'node', args: ['slow-task.js'], timedOut: true, cancelled: false, output: 'Execution stopped after timeout.\n' },
    { id: 'e2e-cancelled', executable: 'tsc', args: ['--watch'], timedOut: false, cancelled: true, output: 'Execution cancelled by the user.\n' },
  ]) {
    const interruptedArtifact = store.putText(fixture.output, { sessionId: session.id });
    const size = Buffer.byteLength(fixture.output);
    store.recordRun({ ...fixture, sessionId: session.id, status: 'failure', exitCode: null, originalSize: size, reducedSize: size, durationMs: 100, artifactId: interruptedArtifact.id, reducerId: 'passthrough', truncated: true, reason: 'Interrupted-run fixture for browser verification' });
  }
  server = await startDashboard({ store, assetsDir: resolve('dist/dashboard') });
});
test.afterAll(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });

test('real records, navigation, evidence comparison, export and no HTML execution', async ({ page }, testInfo) => {
  const outside: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith(server.origin)) outside.push(request.url()); });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(server.url);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Measurement overview' })).toContainText('800 B');
  await expect(page.getByRole('region', { name: 'Measurement overview' })).toContainText('Unknown');
  await expect(page.getByText('Not measured', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('dashboard-dark.png'), fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('region', { name: 'Measurement overview' })).toContainText('800 B');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await navigation.getByRole('button', { name: /Sessions/ }).click();
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('Repair');
  await page.getByRole('button', { name: /Repair refresh rotation/ }).click();
  await expect(page.getByRole('heading', { name: 'Session detail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compare pnpm output' }).click();
  await expect(page.getByRole('heading', { name: 'Output comparison' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search commands' })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Compare pnpm output' })).toBeVisible();
  await expect(page.getByText('<img src=x onerror="window.xss=true">', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, 'xss'))).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-outputs.png'), fullPage: true, animations: 'disabled' });

  await navigation.getByRole('button', { name: 'Outputs', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search commands' });
  const resultFilter = page.getByRole('combobox', { name: 'Filter command result' });
  await search.fill('test');
  await expect(page.getByRole('button', { name: 'Compare pnpm output' })).toBeVisible();
  await search.fill('no-such-command');
  await expect(page.getByRole('heading', { name: 'No matching commands' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare pnpm output' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(search).toHaveValue('');
  await expect(resultFilter).toHaveValue('all');
  await resultFilter.selectOption('success');
  await expect(page.getByRole('heading', { name: 'No matching commands' })).toBeVisible();
  await resultFilter.selectOption('failure');
  await expect(page.getByRole('button', { name: 'Compare pnpm output' })).toBeVisible();
  await resultFilter.selectOption('timeout');
  await expect(page.getByRole('button', { name: 'Compare node output' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare pnpm output' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compare tsc output' })).toHaveCount(0);
  await resultFilter.selectOption('cancelled');
  await expect(page.getByRole('button', { name: 'Compare tsc output' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare pnpm output' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compare node output' })).toHaveCount(0);
  await search.focus();
  await page.keyboard.press('Tab');
  await expect(resultFilter).toBeFocused();

  await navigation.getByRole('button', { name: 'Context', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No context packages' })).toBeVisible();
  await navigation.getByRole('button', { name: 'Adapters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Claude Code' })).toBeVisible();
  await expect(page.getByText('Version not verified', { exact: true }).first()).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  expect((await downloadEvent).suggestedFilename()).toBe('codebudget-report.json');
  expect(outside).toEqual([]);
});

test('unauthorized browser cannot read data; responsive navigation stays available', async ({ browser, page }, testInfo) => {
  const isolated = await browser.newContext();
  const unauthorized = await isolated.newPage();
  await unauthorized.goto(server.origin);
  await expect(unauthorized.getByRole('alert')).toContainText('authorization required');
  await isolated.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(server.url);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile-dark.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await navigation.getByRole('button', { name: 'Outputs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Compare pnpm output' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dashboard-mobile-outputs.png'), fullPage: true, animations: 'disabled' });
  await navigation.getByRole('button', { name: 'Benchmarks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No benchmark records' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
