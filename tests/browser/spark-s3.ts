import { expect, type Page } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { normalizeTitleSearch } from '@evertrace/shared';
import { workbook } from '../fixtures/workbooks.mjs';

export const SPARK_BROWSER_PROJECT = 'demo-evertrace-spark-test';
export const sparkPassword = 'Evertrace-test-2026!';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:29099') throw new Error('S3 browser fixtures require the isolated Spark test emulators.');
export type SparkBrowserFile = { kind: 'text' | 'eeg' | 'image'; name: string; mimeType: string; buffer: Buffer };
export type SparkBrowserAccount = { uid: string; email: string; displayName: string; role: 'member' | 'admin' };
export const s3Excel = Buffer.from(await workbook());
export const s3Image = await readFile(new URL('../../apps/web/public/samples/synthetic-image.png', import.meta.url));
export const s3Text = Buffer.from('\ufeffSynthetic S3 original TXT\r\n第二行原件');
export const s3TextFile = (name = 'original.txt', buffer = s3Text): SparkBrowserFile => ({ kind: 'text', name, mimeType: 'text/plain', buffer });
export const s3EegFile = (name = 'original.xlsx', buffer = s3Excel): SparkBrowserFile => ({ kind: 'eeg', name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
export const s3ImageFile = (name = 'original.png', buffer = s3Image): SparkBrowserFile => ({ kind: 'image', name, mimeType: 'image/png', buffer });
export function makeSparkBrowserFixtures(tag: string) {
  const app = initializeApp({ projectId: SPARK_BROWSER_PROJECT }, tag + '-' + randomUUID()), database = getFirestore(app), identity = getAuth(app);
  const accountIds = new Set<string>(), categoryIds = new Set<string>(), packIds = new Set<string>();
  async function seedAccount(displayName = 'S3 synthetic member', role: 'member' | 'admin' = 'member'): Promise<SparkBrowserAccount> {
    const email = tag + '-' + randomUUID() + '@example.test', user = await identity.createUser({ email, password: sparkPassword });
    accountIds.add(user.uid); await database.doc('users/' + user.uid).set({ uid: user.uid, email, displayName, role });
    return { uid: user.uid, email, displayName, role };
  }
  async function seedCategory(uid: string, suffix = '') {
    const name = tag + ' category ' + (suffix || randomUUID()), id = normalizeTitleSearch(name);
    categoryIds.add(id); const batch = database.batch();
    batch.set(database.doc('categories/' + id), { name, status: 'active', createdBy: uid, createdAt: Timestamp.now() });
    batch.set(database.doc('categoryKeys/' + name.toLowerCase()), { categoryId: id });
    batch.set(database.doc('categoryStats/' + id), { packCount: 0, revision: 0, packId: '', operationId: '', kind: 'init', updatedAt: Timestamp.now() });
    await batch.commit();
    return { id, name };
  }
  async function seedPack(account: SparkBrowserAccount, title: string, categoryId: string, options: { files?: SparkBrowserFile[]; textContent?: string; id?: string; createdAt?: Timestamp } = {}) {
    const id = options.id ?? randomUUID(), files = options.files ?? [s3TextFile(), s3EegFile(), s3ImageFile()], version = 1;
    const createdAt = options.createdAt ?? Timestamp.now(), textContent = options.textContent ?? 'Synthetic S3 saved notes';
    const metas = files.map((file, slot) => ({ slot: String(slot), kind: file.kind, name: file.name, mediaType: file.mimeType, size: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex') }));
    const batch = database.batch(), root = database.doc('packs/' + id); packIds.add(id);
    batch.set(root, { title, titleSearch: normalizeTitleSearch(title), textContent, ownerId: account.uid, ownerName: account.displayName, categoryId, version, status: 'ready', totalBytes: files.reduce((sum, file) => sum + file.buffer.length, 0), textFileCount: files.filter(file => file.kind === 'text').length, imageCount: files.filter(file => file.kind === 'image').length, eegCount: files.filter(file => file.kind === 'eeg').length, submissionHash: createHash('sha256').update(id).digest('hex'), createdAt, updatedAt: createdAt });
    for (let group = 0; group < 2; group++) {
      const selected = metas.slice(group * 6, group * 6 + 6);
      batch.set(root.collection('groups').doc(String(group)), { version, slots: selected.map(file => file.slot), files: Object.fromEntries(selected.map(({ slot, ...file }) => [slot, file])), totalBytes: selected.reduce((sum, file) => sum + file.size, 0), textCount: selected.filter(file => file.kind === 'text').length, imageCount: selected.filter(file => file.kind === 'image').length, eegCount: selected.filter(file => file.kind === 'eeg').length });
    }
    metas.forEach((file, index) => batch.set(root.collection('files').doc(file.slot), { ...file, version, bytes: files[index].buffer }));
    // Admin increments are atomic even when fixtures create twenty-five packs in parallel.
    batch.update(database.doc('categoryStats/' + categoryId), { packCount: FieldValue.increment(1), revision: FieldValue.increment(1), packId: id, operationId: createHash('sha256').update(id).digest('hex'), kind: 'createPack', updatedAt: Timestamp.now() });
    await batch.commit(); return { id, url: '/packs/' + id, title, files, version };
  }
  async function cleanup() {
    if (app.options.projectId !== SPARK_BROWSER_PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:29099') throw new Error('Refusing S3 cleanup outside the isolated test project.');
    // Include UI-created records by this instance's exact synthetic actors.
    for (const uid of accountIds) {
      for (const saved of (await database.collection('categories').where('createdBy', '==', uid).get()).docs) categoryIds.add(saved.id);
      for (const saved of (await database.collection('packs').where('ownerId', '==', uid).get()).docs) packIds.add(saved.id);
    }
    const registry = await database.collection('categoryKeys').get();
    for (const saved of registry.docs) if (categoryIds.has(saved.get('categoryId'))) await saved.ref.delete();
    // The exact resource IDs, including completed receipts, belong to this helper.
    for (const id of packIds) { await database.recursiveDelete(database.doc('packs/' + id)); await database.doc('sparkOperations/pack-' + id).delete(); }
    for (const id of categoryIds) { await database.doc('categories/' + id).delete(); await database.doc('categoryStats/' + id).delete(); await database.doc('sparkOperations/category-' + id).delete(); }
    for (const uid of accountIds) { await database.doc('users/' + uid).delete(); await identity.deleteUser(uid); }
    await deleteApp(app);
  }
  return { database, identity, seedAccount, seedCategory, seedPack, cleanup };
}
export async function loginSpark(page: Page, email: string, path = '/packs') {
  await page.goto(path); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(sparkPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
export async function downloadSparkOriginal(page: Page, name: string) {
  const section = page.locator('.stored-material').filter({ has: page.getByRole('heading', { name, exact: true }) }), waiting = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Download original', exact: true }).click({ delay: 200 }); const download = await waiting;
  expect(download.suggestedFilename()).toBe(name); const path = await download.path(); expect(path).not.toBeNull(); return readFile(path!);
}
export function watchSparkServices(page: Page) {
  const forbidden: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (/^(?:[^.]+\.)*(?:cloudfunctions\.net|firebasestorage\.googleapis\.com|storage\.googleapis\.com)$/.test(url.hostname) || ['5001', '9199', '15001', '19199', '9099', '8080'].includes(url.port)) forbidden.push(request.url()); });
  return forbidden;
}
