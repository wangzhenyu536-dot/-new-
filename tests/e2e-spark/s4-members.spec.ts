import { expect, test, type Page, type Request } from '@playwright/test';
import { makeSparkBrowserFixtures, loginSpark, watchSparkServices, type SparkBrowserAccount } from '../browser/spark-s3';

test.use({ reducedMotion: 'reduce' });
test.setTimeout(35000);
let fixtures: ReturnType<typeof makeSparkBrowserFixtures>;
let previousRoles: FirebaseFirestore.DocumentData | undefined;
const ownAccounts = new Set<string>();
const row = (page: Page, email: string) => page.getByRole('article').filter({ has: page.getByText(email, { exact: true }) });
function roleCommit(request: Request) { return /\/documents:commit(?:\?.*)?$/.test(request.url()) && (request.postData() || '').includes('/documents/roleOps/'); }
test.beforeEach(async () => { fixtures = makeSparkBrowserFixtures('s4-member-browser'); previousRoles = (await fixtures.database.doc('system/roles').get()).data(); ownAccounts.clear(); });
test.afterEach(async () => {
  // Only receipts authored by this case's synthetic accounts are removed.
  for (const uid of ownAccounts) for (const receipt of (await fixtures.database.collection('roleOps').where('actorId', '==', uid).get()).docs) await receipt.ref.delete();
  // Restore the trusted test counter while the helper's Admin app is still open.
  if (previousRoles) await fixtures.database.doc('system/roles').set(previousRoles); else await fixtures.database.doc('system/roles').delete();
  await fixtures.cleanup();
});
async function setup(administrators = 1) {
  const admin = await fixtures.seedAccount('S4 synthetic administrator', 'admin'), member = await fixtures.seedAccount('S4 synthetic member');
  ownAccounts.add(admin.uid); ownAccounts.add(member.uid);
  let second: SparkBrowserAccount | undefined;
  if (administrators === 2) { second = await fixtures.seedAccount('S4 second administrator', 'admin'); ownAccounts.add(second.uid); }
  const actual = (await fixtures.database.collection('users').where('role', '==', 'admin').get()).size;
  if (actual !== administrators) throw new Error('Member last-admin scenarios require no unrelated administrator fixtures.');
  await fixtures.database.doc('system/roles').set({ adminCount: actual, revision: 0, changedUid: '', fromRole: 'member', toRole: 'member', operationId: '' });
  return { admin, member, second };
}
async function openMembers(page: Page, admin: SparkBrowserAccount) {
  await loginSpark(page, admin.email, '/admin/members');
  await expect(page.getByRole('heading', { name: 'Community members', exact: true })).toBeVisible();
  await expect(row(page, admin.email)).toBeVisible();
}
async function begin(page: Page, email: string, name = 'Make administrator') {
  await row(page, email).getByRole('button', { name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm role change', exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole('checkbox').check(); return dialog;
}
async function ownReceipts(uid: string) { return (await fixtures.database.collection('roleOps').where('actorId', '==', uid).get()).docs; }

test('S4 an administrator confirms promotion and demotion while another signed-in account gains and loses access live', async ({ page, browser }) => {
  const { admin, member } = await setup(), context = await browser.newContext(), target = await context.newPage(), forbidden = watchSparkServices(page);
  try {
    await loginSpark(target, member.email, '/admin/members'); await expect(target.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
    await openMembers(page, admin); await row(page, member.email).getByRole('button', { name: 'Make administrator', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: 'Confirm role change', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); expect((await fixtures.database.doc('users/' + member.uid).get()).get('role')).toBe('member');
    await (await begin(page, member.email)).getByRole('button', { name: 'Confirm role change', exact: true }).click();
    await expect(row(page, member.email).getByText('Administrator', { exact: true })).toBeVisible(); await expect(target.getByRole('heading', { name: 'Community members', exact: true })).toBeVisible();
    await (await begin(page, member.email, 'Remove administrator')).getByRole('button', { name: 'Confirm role change', exact: true }).click();
    await expect(row(page, member.email).getByText('Member', { exact: true })).toBeVisible(); await expect(target.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
    expect((await fixtures.database.doc('system/roles').get()).get('adminCount')).toBe(1); expect(await ownReceipts(admin.uid)).toHaveLength(2); expect(forbidden).toEqual([]);
  } finally { await context.close(); }
});
test('S4 an ordinary creator cannot enter member administration before or after reload', async ({ page }) => {
  const { member } = await setup(); await loginSpark(page, member.email, '/admin/members'); await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Make administrator', exact: true })).toHaveCount(0);
});
test('S4 a failed role commit preserves its selection and retries the same request without false success', async ({ page }) => {
  const { admin, member } = await setup(); await openMembers(page, admin); const dialog = await begin(page, member.email);
  await page.route('**/documents:commit?**', async route => { if (roleCommit(route.request())) await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Synthetic S4 role rejection' } }) }); else await route.continue(); });
  try {
    await dialog.getByRole('button', { name: 'Confirm role change', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible();
    expect((await fixtures.database.doc('users/' + member.uid).get()).get('role')).toBe('member'); expect(await ownReceipts(admin.uid)).toHaveLength(0);
    await expect(dialog.getByRole('checkbox')).toBeChecked(); await expect(page.getByText('Role updated.', { exact: true })).toHaveCount(0);
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
  await dialog.getByRole('button', { name: 'Confirm role change', exact: true }).click(); await expect(row(page, member.email).getByText('Administrator', { exact: true })).toBeVisible();
  expect(await ownReceipts(admin.uid)).toHaveLength(1); expect((await fixtures.database.doc('system/roles').get()).get('revision')).toBe(1);
});
test('S4 a stale open confirmation is refused after a second actual administrator promotes the selected member', async ({ page, browser }) => {
  const { admin, member, second } = await setup(2), context = await browser.newContext(), other = await context.newPage();
  try {
    await openMembers(page, admin); const dialog = await begin(page, member.email);
    await openMembers(other, second!); await (await begin(other, member.email)).getByRole('button', { name: 'Confirm role change', exact: true }).click();
    await expect(row(other, member.email).getByText('Administrator', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm role change', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('role has changed');
    expect(await ownReceipts(admin.uid)).toHaveLength(0); expect((await fixtures.database.doc('system/roles').get()).get('adminCount')).toBe(3);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(row(page, member.email).getByRole('button', { name: 'Remove administrator', exact: true })).toBeVisible();
  } finally { await context.close(); }
});
test('S4 a lost acknowledgement confirms one receipt and one counter revision instead of changing the role twice', async ({ page }) => {
  const { admin, member } = await setup(); await openMembers(page, admin); const dialog = await begin(page, member.email); let lost = false;
  await page.route('**/documents:commit?**', async route => { if (!lost && roleCommit(route.request())) { lost = true; await route.fetch(); await route.abort(); } else await route.continue(); });
  try {
    await dialog.getByRole('button', { name: 'Confirm role change', exact: true }).click();
    await expect.poll(async () => !await dialog.isVisible() || await dialog.getByRole('alert').isVisible(), { timeout: 15000 }).toBe(true);
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
  expect(lost).toBe(true);
  if (await dialog.isVisible()) { await expect(dialog.getByRole('button', { name: 'Confirm role change', exact: true })).toBeEnabled(); await dialog.getByRole('button', { name: 'Confirm role change', exact: true }).click(); }
  await expect(dialog).toHaveCount(0); await expect(row(page, member.email).getByText('Administrator', { exact: true })).toBeVisible();
  expect(await ownReceipts(admin.uid)).toHaveLength(1); expect((await fixtures.database.doc('system/roles').get()).data()).toMatchObject({ adminCount: 2, revision: 1 });
});
test('S4 confirmed self-demotion removes live access and the remaining last administrator is protected', async ({ page, browser }) => {
  const { admin, second } = await setup(2), context = await browser.newContext(), other = await context.newPage();
  try {
    await openMembers(page, admin); await openMembers(other, second!); const dialog = await begin(page, admin.email, 'Remove administrator');
    await expect(dialog).toContainText('You will lose access'); await dialog.getByRole('button', { name: 'Confirm role change', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
    await expect(row(other, admin.email).getByText('Member', { exact: true })).toBeVisible(); await expect(row(other, second!.email).getByText('Last administrator', { exact: true })).toBeVisible();
    await expect(row(other, second!.email).getByRole('button', { name: 'Remove administrator', exact: true })).toBeDisabled();
    expect((await fixtures.database.doc('system/roles').get()).get('adminCount')).toBe(1); expect(await ownReceipts(admin.uid)).toHaveLength(1);
  } finally { await context.close(); }
});
test('S4 Chinese mobile role confirmation keeps live roles, visible consequences and cancellation', async ({ page }) => {
  const { admin, member } = await setup(); await page.setViewportSize({ width: 390, height: 844 }); await openMembers(page, admin);
  await page.getByRole('button', { name: '中文', exact: true }).click(); await expect(page.getByRole('heading', { name: '社区成员', exact: true })).toBeVisible();
  await row(page, member.email).getByRole('button', { name: '设为管理员', exact: true }).click(); const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('管理员'); await expect(dialog.getByRole('button', { name: '确认角色变更', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('checkbox').check(); await dialog.getByRole('button', { name: '确认角色变更', exact: true }).click();
  await expect(row(page, member.email).getByText('管理员', { exact: true })).toBeVisible();
  await row(page, member.email).getByRole('button', { name: '取消管理员', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('普通成员');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); expect((await fixtures.database.doc('users/' + member.uid).get()).get('role')).toBe('admin');
});
