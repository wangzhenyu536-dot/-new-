import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc, Timestamp, writeBatch, type Firestore } from 'firebase/firestore';
import {
  S3_PROJECT, S3_FIRESTORE_PORT, MAX_FILE_BYTES, MAX_PACK_BYTES,
  packBundle, commitBundle, createOnce, seedProfiles, binaryFile, bundleFromFiles, editBundle, replacementFiles,
  addEdit, commitEdit, editTransaction, storedBundle, snapshotBundle, type EditOmit, type PackBundle,
} from './fixtures';

let env: RulesTestEnvironment;
const firestore = (context: RulesTestContext): Firestore => (context.firestore() as unknown as { _delegate: Firestore })._delegate;
const client = (uid: string) => firestore(env.authenticatedContext(uid, { email: `${uid}@example.test` }));
const anonymous = () => firestore(env.unauthenticatedContext());
const trusted = async <T>(action: (db: Firestore) => Promise<T>): Promise<T> => {
  let result!: T;
  await env.withSecurityRulesDisabled(async context => { result = await action(firestore(context)); });
  return result;
};
const rootRef = (db: Firestore, id: string) => doc(db, 'packs', id);
const seedPack = async (source = packBundle()) => {
  await trusted(db => commitBundle(db, source));
  return storedBundle(client('owner'), source);
};
const capture = (id: string) => trusted(db => snapshotBundle(db, id));
const rejectKeepingOld = async (previous: PackBundle, next: PackBundle, omit?: EditOmit, db = client('owner')) => {
  const before = await capture(previous.id);
  await assertFails(commitEdit(db, previous, next, omit));
  expect(await capture(previous.id)).toEqual(before);
};

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${S3_FIRESTORE_PORT}`) throw new Error('S3 requires isolated Firestore 28090');
  env = await initializeTestEnvironment({ projectId: S3_PROJECT, firestore: { host: '127.0.0.1', port: S3_FIRESTORE_PORT,
    rules: readFileSync(new URL('../../firebase/spark.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await trusted(db => seedProfiles(db)); });
afterAll(async () => { if (env) { await env.clearFirestore(); await env.cleanup(); } });

describe('S3 atomic edits preserve original ownership and creation time', () => {
  it('replaces all 12 originals at exactly 3 MiB, keeps the creator, and lets another member read every new byte', async () => {
    const previous = await seedPack(packBundle(12, 256 * 1024));
    const next = editBundle(previous, replacementFiles(12, 256 * 1024));
    expect(next.pack.totalBytes).toBe(MAX_PACK_BYTES);
    expect(next.files.every((file, index) => file.sha256 !== previous.files[index].sha256)).toBe(true);
    await assertSucceeds(commitEdit(client('owner'), previous, next));
    const db = client('viewer'), saved = (await getDocFromServer(rootRef(db, next.id))).data()!;
    expect(saved).toMatchObject({ ownerId: 'owner', ownerName: 'S2 owner', version: 2, status: 'ready', totalBytes: MAX_PACK_BYTES });
    expect((saved.createdAt as Timestamp).isEqual(previous.pack.createdAt as Timestamp)).toBe(true);
    expect(saved.updatedAt).toBeInstanceOf(Timestamp);
    expect((saved.updatedAt as Timestamp).toMillis()).toBeGreaterThanOrEqual((previous.pack.updatedAt as Timestamp).toMillis());
    for (const original of next.files) {
      const data = (await getDocFromServer(doc(db, 'packs', next.id, 'files', original.slot))).data()!;
      expect(data.version).toBe(2);
      const bytes = (data.bytes as Bytes).toUint8Array();
      expect(Buffer.from(bytes)).toEqual(Buffer.from(original.bytes.toUint8Array()));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(original.sha256);
    }
    expect((await getDocsFromServer(collection(db, 'packs', next.id, 'files'))).docs).toHaveLength(12);
  });
  it('allows an administrator to edit another member pack while preserving its actual creator snapshot', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3));
    await assertSucceeds(commitEdit(client('admin'), previous, next));
    const root = await getDocFromServer(rootRef(client('viewer'), previous.id));
    expect(root.get('ownerId')).toBe('owner'); expect(root.get('ownerName')).toBe('S2 owner');
    expect((root.get('createdAt') as Timestamp).isEqual(previous.pack.createdAt as Timestamp)).toBe(true);
    expect(root.get('version')).toBe(2);
  });
  it('atomically reduces 12 originals to one Excel and precisely removes all eleven old slots', async () => {
    const previous = await seedPack(), next = editBundle(previous, [binaryFile(0, 'eeg')]);
    await assertSucceeds(commitEdit(client('owner'), previous, next));
    const db = client('viewer'), files = await getDocsFromServer(collection(db, 'packs', next.id, 'files'));
    expect(files.docs.map(file => file.id)).toEqual(['0']);
    expect(files.docs[0].get('kind')).toBe('eeg'); expect(files.docs[0].get('version')).toBe(2);
    for (const slot of previous.files.slice(1).map(file => file.slot)) expect((await getDocFromServer(doc(db, 'packs', next.id, 'files', slot))).exists()).toBe(false);
    const emptyGroup = (await getDocFromServer(doc(db, 'packs', next.id, 'groups', '1'))).data();
    expect(emptyGroup).toMatchObject({ version: 2, slots: [], files: {}, totalBytes: 0, eegCount: 0, textCount: 0, imageCount: 0 });
    expect((await getDocFromServer(rootRef(db, next.id))).get('eegCount')).toBe(1);
  });
  it('grows one Excel to all twelve originals at the full capacity', async () => {
    const previous = await seedPack(bundleFromFiles([binaryFile(0, 'eeg')]));
    const full = editBundle(previous, replacementFiles(12, 256 * 1024));
    await assertSucceeds(commitEdit(client('owner'), previous, full));
    expect((await getDocsFromServer(collection(client('viewer'), 'packs', full.id, 'files'))).docs).toHaveLength(12);
    expect((await getDocFromServer(rootRef(client('viewer'), full.id))).get('version')).toBe(2);
    expect((await getDocFromServer(rootRef(client('viewer'), full.id))).get('totalBytes')).toBe(MAX_PACK_BYTES);
  });
  it('rewrites retained originals to the new version without changing their bytes', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, previous.files);
    await assertSucceeds(commitEdit(client('owner'), previous, next));
    for (const file of previous.files) {
      const saved = await getDocFromServer(doc(client('viewer'), 'packs', next.id, 'files', file.slot));
      expect(saved.get('version')).toBe(2); expect(saved.get('sha256')).toBe(file.sha256);
      expect(Buffer.from((saved.get('bytes') as Bytes).toUint8Array())).toEqual(Buffer.from(file.bytes.toUint8Array()));
    }
  });
  it('allows an explicit unchanged-content save using a new version-bound fingerprint', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, previous.files, { title: previous.pack.title });
    expect(next.pack.submissionHash).not.toBe(previous.pack.submissionHash);
    await assertSucceeds(commitEdit(client('owner'), previous, next));
    const saved = await getDocFromServer(rootRef(client('viewer'), next.id));
    expect(saved.get('title')).toBe(previous.pack.title); expect(saved.get('version')).toBe(2);
  });
  it('can move a complete pack to another active category in the same edit', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, previous.files, { categoryId: 'other' });
    await assertSucceeds(commitEdit(client('owner'), previous, next));
    expect((await getDocFromServer(rootRef(client('viewer'), previous.id))).get('categoryId')).toBe('other');
  });
  it('keeps new creation and stable submission retries working after editing is enabled', async () => {
    const db = client('owner'), bundle = packBundle(3);
    expect(await assertSucceeds(createOnce(db, bundle))).toEqual({ id: bundle.id, created: true });
    const before = await capture(bundle.id);
    expect(await assertSucceeds(createOnce(db, bundle))).toEqual({ id: bundle.id, created: false });
    expect(await capture(bundle.id)).toEqual(before);
  });
});

describe('S3 edit authority, immutable identity, and exact version boundary', () => {
  it('refuses another member, anonymous, or unregistered identities while retaining the old complete data', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3));
    for (const db of [client('viewer'), anonymous(), client('unregistered')]) await rejectKeepingOld(previous, next, {}, db);
  });
  it('does not grant former administrators authority to edit another member pack', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3));
    await trusted(db => setDoc(doc(db, 'users', 'admin'), { uid: 'admin', email: 'admin@example.test', displayName: 'S2 admin', role: 'member' }));
    await rejectKeepingOld(previous, next, {}, client('admin'));
  });
  it.each(['ownerId', 'ownerName', 'createdAt'] as const)('keeps %s immutable even for administrator edits', async field => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3));
    if (field === 'ownerId') next.pack.ownerId = 'viewer';
    else if (field === 'ownerName') next.pack.ownerName = 'Forged creator';
    else next.pack.createdAt = Timestamp.fromMillis(1);
    await rejectKeepingOld(previous, next, {}, client('admin'));
  });
  it('rejects unchanged, skipped, stale, negative, or fractional versions', async () => {
    const previous = await seedPack(packBundle(3));
    for (const version of [1, 3, 0, -1, 1.5]) {
      const next = editBundle(previous, replacementFiles(3));
      next.pack.version = version; next.groups.forEach(group => { group.version = version; }); next.files.forEach(file => { file.version = version; });
      await rejectKeepingOld(previous, next);
    }
  });
  it('requires a fresh fingerprint, server update time, ready status, and exact schema', async () => {
    const previous = await seedPack(packBundle(3));
    for (const mutate of [
      (next: PackBundle) => { next.pack.submissionHash = previous.pack.submissionHash; },
      (next: PackBundle) => { next.pack.submissionHash = 'invalid'; },
      (next: PackBundle) => { next.pack.updatedAt = Timestamp.fromMillis(1); },
      (next: PackBundle) => { Object.assign(next.pack, { status: 'deleting' }); },
      (next: PackBundle) => { Object.assign(next.pack, { approved: true }); },
    ]) { const next = editBundle(previous, replacementFiles(3)); mutate(next); await rejectKeepingOld(previous, next); }
  });
  it('refuses missing, migrating, or deleted destination categories', async () => {
    const previous = await seedPack(packBundle(3));
    for (const categoryId of ['missing', 'migrating', 'deleted']) await rejectKeepingOld(previous, editBundle(previous, previous.files, { categoryId }));
  });
  it('does not edit an unpublished or deleting parent as if it were a ready pack', async () => {
    const previous = await seedPack(packBundle(3));
    await trusted(db => setDoc(rootRef(db, previous.id), { status: 'deleting' }, { merge: true }));
    const next = editBundle(previous, replacementFiles(3));
    await rejectKeepingOld(previous, next);
  });
});

describe('S3 replacement manifests and deletion remain fully atomic', () => {
  it.each([0, 1])('requires group %i to be rewritten to the new version', async missing => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3));
    await rejectKeepingOld(previous, next, { groups: [missing] });
  });
  it.each(['0', '5', '6', '11'])('refuses an edit with omitted or old-version original slot %s', async missing => {
    const previous = await seedPack(), next = editBundle(previous, replacementFiles(12));
    await rejectKeepingOld(previous, next, { files: [missing] });
  });
  it('rejects an undeleted removed slot in each of the two groups', async () => {
    const previous = await seedPack(), next = editBundle(previous, [binaryFile(0, 'eeg')]);
    for (const slot of ['5', '11']) await rejectKeepingOld(previous, next, { deletes: [slot] });
  });
  it('rejects deleted originals still listed in a new manifest', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3));
    await rejectKeepingOld(previous, next, { files: ['2'], extraDeletes: ['2'] });
  });
  it('does not authorize deleting a nonexistent slot outside the old manifest during an otherwise complete edit', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3));
    await rejectKeepingOld(previous, next, { extraDeletes: ['11'] });
  });
  it('cannot publish an undeclared file in an otherwise legal slot or outside the 12 allowed slots', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3)), db = client('owner');
    for (const slot of [5, 12]) {
      const before = await capture(previous.id), batch = writeBatch(db); addEdit(batch, db, previous, next);
      batch.set(doc(db, 'packs', next.id, 'files', String(slot)), binaryFile(slot, 'image', 128, 2));
      await assertFails(batch.commit()); expect(await capture(previous.id)).toEqual(before);
    }
  });
  it('refuses direct root-only edits, standalone original or group mutation, and standalone original deletion', async () => {
    const previous = await seedPack(packBundle(3)), next = editBundle(previous, replacementFiles(3)), db = client('owner'), before = await capture(previous.id);
    await assertFails(setDoc(rootRef(db, previous.id), next.pack));
    await assertFails(setDoc(doc(db, 'packs', previous.id, 'files', '0'), next.files[0]));
    await assertFails(setDoc(doc(db, 'packs', previous.id, 'groups', '0'), next.groups[0]));
    await assertFails(deleteDoc(doc(db, 'packs', previous.id, 'files', '0')));
    expect(await capture(previous.id)).toEqual(before);
  });
  it('keeps whole-pack and group deletion unavailable even to the creator or administrator', async () => {
    const previous = await seedPack(packBundle(3)), before = await capture(previous.id);
    for (const db of [client('owner'), client('admin')]) {
      await assertFails(deleteDoc(rootRef(db, previous.id)));
      await assertFails(deleteDoc(doc(db, 'packs', previous.id, 'groups', '0')));
    }
    expect(await capture(previous.id)).toEqual(before);
  });
  it('rejects no Excel or neither body nor TXT after removal without changing the old version', async () => {
    const previous = await seedPack();
    await rejectKeepingOld(previous, editBundle(previous, [binaryFile(0, 'text'), binaryFile(1, 'image')]));
    await rejectKeepingOld(previous, editBundle(previous, [binaryFile(0, 'eeg')], { textContent: ' \n\t' }));
  });
  it('retains file, aggregate, and count capacity guards on edits', async () => {
    const previous = await seedPack(packBundle(3));
    await rejectKeepingOld(previous, editBundle(previous, [binaryFile(0, 'eeg', MAX_FILE_BYTES + 1)]));
    const files = replacementFiles(12, 256 * 1024); files[0] = binaryFile(0, 'text', 256 * 1024 + 1, 2);
    expect(files.every(file => file.size <= MAX_FILE_BYTES)).toBe(true);
    await rejectKeepingOld(previous, editBundle(previous, files));
    await rejectKeepingOld(previous, editBundle(previous, replacementFiles(13)));
  });
  it('rejects forged metadata, byte sizes, totals, and filename control characters while retaining every old byte', async () => {
    const previous = await seedPack(packBundle(3));
    for (const mutate of [
      (next: PackBundle) => { next.groups[0].files['0'].sha256 = '0'.repeat(64); },
      (next: PackBundle) => { next.files[0].size += 1; next.groups[0].files['0'].size += 1; next.groups[0].totalBytes += 1; next.pack.totalBytes += 1; },
      (next: PackBundle) => { next.pack.totalBytes += 1; },
      (next: PackBundle) => { next.groups[0].eegCount += 1; },
      (next: PackBundle) => { next.files[0].name = 'invalid\tname.txt'; next.groups[0].files['0'].name = next.files[0].name; },
      (next: PackBundle) => { Object.assign(next.groups[0], { edited: true }); },
    ]) { const next = editBundle(previous, replacementFiles(3)); mutate(next); await rejectKeepingOld(previous, next); }
  });
  it('rejects a stale edit after another edit commits and keeps the winner version intact', async () => {
    const previous = await seedPack(packBundle(3)), winner = editBundle(previous, replacementFiles(3), { title: 'Winner' });
    await assertSucceeds(commitEdit(client('owner'), previous, winner));
    const saved = await capture(previous.id), stale = editBundle(previous, replacementFiles(3), { title: 'Stale' });
    await assertFails(commitEdit(client('owner'), previous, stale));
    expect(await capture(previous.id)).toEqual(saved);
  });
  it('allows exactly one concurrent owner/admin edit from the same baseline and never mixes their originals', async () => {
    const previous = await seedPack(packBundle(3));
    const a = editBundle(previous, replacementFiles(3, 128, 2), { title: 'Owner candidate' });
    const b = editBundle(previous, replacementFiles(3, 192, 2), { title: 'Admin candidate' });
    const results = await Promise.allSettled([editTransaction(client('owner'), previous, a), editTransaction(client('admin'), previous, b)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const saved = await getDocFromServer(rootRef(client('viewer'), previous.id)), winner = saved.get('title') === a.pack.title ? a : b;
    expect(saved.get('version')).toBe(2); expect(saved.get('submissionHash')).toBe(winner.pack.submissionHash);
    for (const file of winner.files) {
      const actual = await getDocFromServer(doc(client('viewer'), 'packs', previous.id, 'files', file.slot));
      expect(actual.get('version')).toBe(2); expect(actual.get('sha256')).toBe(file.sha256);
      expect(Buffer.from((actual.get('bytes') as Bytes).toUint8Array())).toEqual(Buffer.from(file.bytes.toUint8Array()));
    }
  });
});
