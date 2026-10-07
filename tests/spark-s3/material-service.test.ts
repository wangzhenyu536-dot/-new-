import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment, type RulesTestContext } from '@firebase/rules-unit-testing';
import { Bytes, collection, doc, getDocs, setDoc, type Firestore } from 'firebase/firestore';
import { seedS1, seedCategoryState } from '../spark-s1/fixtures';
import { workbook } from '../fixtures/workbooks.mjs';
import { editSparkMaterials, saveSparkMaterials, readSparkPack, readSparkFile, type SparkInput, type SparkAttempt, type SparkEditAttempt, type SparkEditInput } from '../../apps/web/src/services/spark-materials';
const project = 'demo-evertrace-spark-test';
let env: RulesTestEnvironment;
const modular = (context: RulesTestContext) => (context.firestore() as unknown as { _delegate: Firestore })._delegate;
const client = (uid: string) => modular(env.authenticatedContext(uid, { email: `${uid}@example.test` }));
const trusted = (action: (db: Firestore) => Promise<void>) => env.withSecurityRulesDisabled(context => action(modular(context)));
const signal = () => new AbortController().signal;
const attempt = () => ({ current: null as SparkEditAttempt | null });
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090') throw new Error('S3 requires the isolated Spark Firestore.');
  env = await initializeTestEnvironment({ projectId: project, firestore: { host: '127.0.0.1', port: 28090, rules: readFileSync('firebase/spark.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await trusted(async db => { await seedS1(db); for (const id of ['focus training', 'second category']) await seedCategoryState(db,id,id); }); });
afterAll(async () => { await env?.clearFirestore(); await env?.cleanup(); });
async function fixture(count = 2) {
  const attachments: SparkInput['attachments'] = [{ kind: 'eeg', file: new File([Uint8Array.from(await workbook()).buffer], 'original.xlsx') }];
  for (let i = 1; i < count; i++) attachments.push({ kind: 'text', file: new File(['Synthetic original TXT ' + i + '\r\n正文'], `original-${i}.txt`) });
  const source: SparkInput = { title: 'Synthetic S3 original', categoryId: 'focus training', textContent: 'Original notes\nunchanged until commit', attachments };
  const { packId } = await saveSparkMaterials(client('member'), 'member', source, { current: null as SparkAttempt | null }, () => {}, signal());
  const detail = await readSparkPack(client('member'), packId);
  const input: SparkEditInput = { title: detail.pack.title, categoryId: detail.pack.categoryId, textContent: detail.pack.textContent, attachments: detail.files.map(retained => ({ retained })) };
  return { packId, source, detail, input };
}
async function snapshot(packId: string) {
  let result: unknown; await trusted(async db => { const root = (await getDocs(collection(db, 'packs'))).docs.find(item => item.id === packId)!; const groups = await getDocs(collection(db, 'packs', packId, 'groups')), files = await getDocs(collection(db, 'packs', packId, 'files')); result = { root: root.data(), groups: groups.docs.map(d => [d.id, d.data()]), files: files.docs.map(d => [d.id, d.data()]) }; }); return result;
}
it('author edits metadata while retaining every exact original and immutable creator fields', async () => {
  const f = await fixture(); await editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, title: 'Edited title', textContent: 'Edited notes\n保留原件', categoryId: 'second category' }, attempt(), () => {}, signal());
  const current = await readSparkPack(client('viewer'), f.packId);
  expect(current.pack).toMatchObject({ title: 'Edited title', textContent: 'Edited notes\n保留原件', categoryId: 'second category', version: 2, ownerId: 'member', ownerName: f.detail.pack.ownerName });
  expect(current.pack.createdAt).toEqual(f.detail.pack.createdAt); expect(current.pack.updatedAt.toMillis()).toBeGreaterThanOrEqual(f.detail.pack.updatedAt.toMillis());
  for (const [index, file] of current.files.entries()) expect(await readSparkFile(client('viewer'), f.packId, 2, file)).toEqual(new Uint8Array(await f.source.attachments[index].file.arrayBuffer()));
});
it('replacement and removal publish the new originals atomically without retaining removed file documents', async () => {
  const f = await fixture(4), bytes = Uint8Array.from(await workbook([['timestamp_ms', 'value'], [0, 7], [10, -8]]));
  await editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, attachments: [{ retained: f.detail.files[1] }, { kind: 'eeg', file: new File([bytes.buffer], 'replacement.xlsx') }] }, attempt(), () => {}, signal());
  const current = await readSparkPack(client('viewer'), f.packId); expect(current.files.map(file => file.name)).toEqual(['original-1.txt', 'replacement.xlsx']); expect(current.pack.version).toBe(2);
  expect(await readSparkFile(client('viewer'), f.packId, 2, current.files[1])).toEqual(bytes);
  let slots: string[] = []; await trusted(async db => { slots = (await getDocs(collection(db, 'packs', f.packId, 'files'))).docs.map(item => item.id); }); expect(slots.sort()).toEqual(['0', '1']);
});
it('admin edits another author without taking ownership or changing creation time', async () => {
  const f = await fixture(); await editSparkMaterials(client('admin'), 'admin', f.packId, 1, { ...f.input, title: 'Admin revision' }, attempt(), () => {}, signal()); const current = await readSparkPack(client('member'), f.packId); expect(current.pack).toMatchObject({ ownerId: 'member', ownerName: f.detail.pack.ownerName, title: 'Admin revision', version: 2 }); expect(current.pack.createdAt).toEqual(f.detail.pack.createdAt);
});
it('another member cannot edit and leaves root, both groups and every original unchanged', async () => {
  const f = await fixture(), before = await snapshot(f.packId); await expect(editSparkMaterials(client('viewer'), 'viewer', f.packId, 1, { ...f.input, title: 'Foreign edit' }, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'forbidden' }); expect(await snapshot(f.packId)).toEqual(before);
});
it('a stale edit explicitly reports version conflict instead of overwriting the saved revision', async () => {
  const f = await fixture(); await editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, title: 'First revision' }, attempt(), () => {}, signal()); const before = await snapshot(f.packId);
  await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, title: 'Stale revision' }, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'versionConflict' }); expect(await snapshot(f.packId)).toEqual(before);
});
it('a completed edit retried from its original input and version confirms once without another version or timestamp', async () => {
  const f = await fixture(), ref = attempt(), edited = { ...f.input, title: 'Stable retry' }; const first = await editSparkMaterials(client('member'), 'member', f.packId, 1, edited, ref, () => {}, signal()), before = await snapshot(f.packId); expect(await editSparkMaterials(client('member'), 'member', f.packId, 1, edited, ref, () => {}, signal())).toEqual(first); expect(await snapshot(f.packId)).toEqual(before);
});
it('two different simultaneous edits produce one complete revision and one explicit conflict', async () => {
  const f = await fixture(); const results = await Promise.allSettled(['Revision A', 'Revision B'].map(title => editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, title }, attempt(), () => {}, signal())));
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected').map(result => (result as PromiseRejectedResult).reason.code)).toEqual(['versionConflict']); const current = await readSparkPack(client('viewer'), f.packId); expect(current.pack.version).toBe(2); expect(['Revision A', 'Revision B']).toContain(current.pack.title); expect(current.files).toHaveLength(2);
});
it('two identical simultaneous edit attempts confirm the same version without duplicate writes', async () => {
  const f = await fixture(), ref = attempt(), input = { ...f.input, title: 'Concurrent same revision' }; const results = await Promise.all([editSparkMaterials(client('member'), 'member', f.packId, 1, input, ref, () => {}, signal()), editSparkMaterials(client('member'), 'member', f.packId, 1, input, ref, () => {}, signal())]); expect(results[0]).toEqual(results[1]); expect((await readSparkPack(client('viewer'), f.packId)).pack.version).toBe(2);
});
it('saving unchanged contents still uses a new version-bound submission hash and its retry is idempotent', async () => {
  const f = await fixture(), ref = attempt(); await editSparkMaterials(client('member'), 'member', f.packId, 1, f.input, ref, () => {}, signal()); const saved = await readSparkPack(client('viewer'), f.packId); expect(saved.pack.version).toBe(2); expect(saved.pack.submissionHash).not.toBe(f.detail.pack.submissionHash); await editSparkMaterials(client('member'), 'member', f.packId, 1, f.input, ref, () => {}, signal()); expect((await readSparkPack(client('viewer'), f.packId)).pack.version).toBe(2);
});
it('removing all EEG originals is rejected before any stored revision changes', async () => {
  const f = await fixture(), before = await snapshot(f.packId); await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, attachments: [{ retained: f.detail.files[1] }] }, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'validation', issues: expect.arrayContaining([expect.objectContaining({ code: 'eegRequired' })]) }); expect(await snapshot(f.packId)).toEqual(before);
});
it('a category that is no longer active rejects the edit and preserves the entire old version', async () => {
  const f = await fixture(), before = await snapshot(f.packId); await trusted(db => setDoc(doc(db, 'categories', 'second category'), { status: 'migrating' }, { merge: true })); await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, categoryId: 'second category' }, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'categoryUnavailable' }); expect(await snapshot(f.packId)).toEqual(before);
});
it('cancelling an edit before preparation preserves all saved data and allows a fresh retry', async () => {
  const f = await fixture(), before = await snapshot(f.packId), controller = new AbortController(); controller.abort(); await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, f.input, attempt(), () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(await snapshot(f.packId)).toEqual(before); await editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, title: 'Retry after cancel' }, attempt(), () => {}, signal()); expect((await readSparkPack(client('viewer'), f.packId)).pack.title).toBe('Retry after cancel');
});
it('retained file metadata cannot be forged to a different hash and duplicate retained slots are refused', async () => {
  const f = await fixture(), before = await snapshot(f.packId); await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, attachments: [{ retained: { ...f.detail.files[0], sha256: '0'.repeat(64) } }] }, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'integrity' }); await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, attachments: [{ retained: f.detail.files[0] }, { retained: f.detail.files[0] }] }, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'integrity' }); expect(await snapshot(f.packId)).toEqual(before);
});
it('twelve valid originals can shrink to one without orphan files and grow back to twelve', async () => {
  const f = await fixture(12); await editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, attachments: [{ retained: f.detail.files[0] }] }, attempt(), () => {}, signal()); const current = await readSparkPack(client('viewer'), f.packId); expect(current.files).toHaveLength(1); let documents = 0; await trusted(async db => { documents = (await getDocs(collection(db, 'packs', f.packId, 'files'))).size; }); expect(documents).toBe(1); await editSparkMaterials(client('member'), 'member', f.packId, 2, { ...f.input, attachments: f.source.attachments }, attempt(), () => {}, signal()); const grown = await readSparkPack(client('viewer'), f.packId); expect(grown.pack.version).toBe(3); expect(grown.files).toHaveLength(12);
});
it('invalid replacement Excel or an oversized new original cannot modify a ready pack', async () => {
  const f = await fixture(), before = await snapshot(f.packId); for (const file of [new File(['broken XLSX'], 'broken.xlsx'), new File([new Uint8Array(512 * 1024 + 1)], 'large.xlsx')]) { await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, { ...f.input, attachments: [{ kind: 'eeg', file }] }, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'validation' }); expect(await snapshot(f.packId)).toEqual(before); }
});
it('a retired admin cannot confirm or commit a foreign edit and the old pack is intact', async () => {
  const f = await fixture(), before = await snapshot(f.packId); await trusted(db => setDoc(doc(db, 'users', 'admin'), { role: 'member' }, { merge: true })); await expect(editSparkMaterials(client('admin'), 'admin', f.packId, 1, f.input, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'forbidden' }); expect(await snapshot(f.packId)).toEqual(before);
});
it('an original carrying a different version reports versionChanged rather than an integrity-only error', async () => {
  const f = await fixture(); await trusted(db => setDoc(doc(db, 'packs', f.packId, 'files', '0'), { version: 2 }, { merge: true })); await expect(readSparkFile(client('viewer'), f.packId, 1, f.detail.files[0])).rejects.toMatchObject({ code: 'versionChanged' });
});
it('a corrupt retained original fails the edit precheck and preserves the saved revision', async () => {
  const f = await fixture(); await trusted(db => setDoc(doc(db, 'packs', f.packId, 'files', '0'), { bytes: Bytes.fromUint8Array(new Uint8Array(f.detail.files[0].size)) }, { merge: true })); const before = await snapshot(f.packId); await expect(editSparkMaterials(client('member'), 'member', f.packId, 1, f.input, attempt(), () => {}, signal())).rejects.toMatchObject({ code: 'integrity' }); expect(await snapshot(f.packId)).toEqual(before);
});
