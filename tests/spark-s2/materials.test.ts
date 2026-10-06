import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, collection, doc, getDoc, getDocs, query, setDoc, Timestamp, where, writeBatch, type Firestore } from 'firebase/firestore';
import { workbook } from '../fixtures/workbooks.mjs';
import {
  S2_PROJECT, S2_FIRESTORE_PORT, MAX_FILE_BYTES, MAX_PACK_BYTES, SEARCH_INDEX_BYTES,
  binaryFile, originalFile, bundleFromFiles, packBundle, commitBundle, addBundle, createOnce, seedProfiles,
  type PackBundle,
} from './fixtures';

let env: RulesTestEnvironment;
const firestore = (context: RulesTestContext): Firestore => (context.firestore() as unknown as { _delegate: Firestore })._delegate;
const client = (uid: string) => firestore(env.authenticatedContext(uid, { email: `${uid}@example.test` }));
const anonymous = () => firestore(env.unauthenticatedContext());
const trusted = async (action: (db: Firestore) => Promise<void>) => env.withSecurityRulesDisabled(async context => action(firestore(context)));
const rootRef = (db: Firestore, id: string) => doc(db, 'packs', id);
const seedBundle = (bundle: PackBundle) => trusted(db => commitBundle(db, bundle));
const assertNoResidue = (id: string) => trusted(async db => {
  expect((await getDoc(rootRef(db, id))).exists()).toBe(false);
  expect((await getDocs(collection(db, 'packs', id, 'groups'))).empty).toBe(true);
  expect((await getDocs(collection(db, 'packs', id, 'files'))).empty).toBe(true);
});
const rejectWithoutResidue = async (bundle: PackBundle, omit?: Parameters<typeof addBundle>[3]) => {
  await assertFails(commitBundle(client('owner'), bundle, omit));
  await assertNoResidue(bundle.id);
};

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${S2_FIRESTORE_PORT}`) throw new Error('S2 requires isolated Firestore 28090');
  env = await initializeTestEnvironment({ projectId: S2_PROJECT, firestore: {
    host: '127.0.0.1', port: S2_FIRESTORE_PORT,
    rules: readFileSync(new URL('../../firebase/spark.rules', import.meta.url), 'utf8'),
  } });
});
beforeEach(async () => { await env.clearFirestore(); await trusted(db => seedProfiles(db)); });
afterAll(async () => { if (env) { await env.clearFirestore(); await env.cleanup(); } });

describe('S2 formal pack creation, attribution, category, and trusted time', () => {
  it('atomically creates a ready pack with its actual member name and a shared trusted creation time', async () => {
    const bundle = packBundle(3), started = Date.now();
    await assertSucceeds(commitBundle(client('owner'), bundle));
    const snapshot = await getDoc(rootRef(client('viewer'), bundle.id));
    expect(snapshot.data()).toMatchObject({ title: bundle.pack.title, ownerId: 'owner', ownerName: 'S2 owner',
      categoryId: 'active', status: 'ready', version: 1, totalBytes: 384, textFileCount: 1, imageCount: 1, eegCount: 1,
      submissionHash: bundle.pack.submissionHash });
    const createdAt = snapshot.get('createdAt') as Timestamp, updatedAt = snapshot.get('updatedAt') as Timestamp;
    expect(createdAt).toBeInstanceOf(Timestamp);
    expect(updatedAt.isEqual(createdAt)).toBe(true);
    expect(createdAt.toMillis()).toBeGreaterThanOrEqual(started - 1000);
    expect(createdAt.toMillis()).toBeLessThanOrEqual(Date.now() + 1000);
    expect((await getDocs(collection(client('viewer'), 'packs', bundle.id, 'groups'))).docs).toHaveLength(2);
    expect((await getDocs(collection(client('viewer'), 'packs', bundle.id, 'files'))).docs).toHaveLength(3);
  });
  it('allows an administrator to create only under its own actual identity', async () => {
    const bundle = packBundle(3, 128, { ownerId: 'admin', ownerName: 'S2 admin' });
    await assertSucceeds(commitBundle(client('admin'), bundle));
    expect((await getDoc(rootRef(client('viewer'), bundle.id))).get('ownerId')).toBe('admin');
    await assertFails(commitBundle(client('admin'), packBundle(3)));
  });
  it('rejects forged creator IDs or names, even when the name points to another real profile', async () => {
    for (const options of [{ ownerId: 'viewer', ownerName: 'S2 viewer' }, { ownerName: 'S2 admin' }, { ownerName: '' }]) {
      await rejectWithoutResidue(packBundle(3, 128, options));
    }
  });
  it('rejects client-supplied creation or update timestamps', async () => {
    for (const options of [{ createdAt: Timestamp.fromMillis(1) }, { updatedAt: Timestamp.fromMillis(1) }]) {
      await rejectWithoutResidue(packBundle(3, 128, options));
    }
  });
  it('rejects absent, migrating, or deleted categories without leaving an orphan pack', async () => {
    for (const categoryId of ['missing', 'migrating', 'deleted', '']) await rejectWithoutResidue(packBundle(3, 128, { categoryId }));
  });
  it('accepts an existing active category whose canonical ID contains 60 Chinese characters', async () => {
    const categoryId = '脑'.repeat(60);
    await trusted(db => setDoc(doc(db, 'categories', categoryId), { name: categoryId, status: 'active', createdBy: 'owner', createdAt: Timestamp.fromMillis(1) }));
    const bundle = packBundle(3, 128, { categoryId });
    await assertSucceeds(commitBundle(client('owner'), bundle));
    expect((await getDoc(rootRef(client('viewer'), bundle.id))).get('categoryId')).toBe(categoryId);
  });
  it('keeps a 160-character Chinese title and its 480-byte normalized search field', async () => {
    const bundle = packBundle(3, 128, { title: '脑'.repeat(160) });
    expect(new TextEncoder().encode(bundle.pack.titleSearch)).toHaveLength(480);
    await assertSucceeds(commitBundle(client('owner'), bundle));
    expect((await getDoc(rootRef(client('viewer'), bundle.id))).get('titleSearch')).toBe(bundle.pack.titleSearch);
  });
  it('rejects malformed pack shape, title, version, status, body, fingerprint, or search-size data', async () => {
    for (const mutate of [
      (bundle: PackBundle) => { bundle.pack.title = ' \n\t'; },
      (bundle: PackBundle) => { bundle.pack.title = 'x'.repeat(161); },
      (bundle: PackBundle) => { bundle.pack.titleSearch = 'x'.repeat(SEARCH_INDEX_BYTES + 1); },
      (bundle: PackBundle) => { bundle.pack.titleSearch = '脑'.repeat(Math.floor(SEARCH_INDEX_BYTES / 3) + 1); },
      (bundle: PackBundle) => { bundle.pack.textContent = 'x'.repeat(100001); },
      (bundle: PackBundle) => { bundle.pack.version = 2; bundle.groups.forEach(group => { group.version = 2; }); bundle.files.forEach(file => { file.version = 2; }); },
      (bundle: PackBundle) => { Object.assign(bundle.pack, { status: 'uploading' }); },
      (bundle: PackBundle) => { bundle.pack.submissionHash = 'invalid'; },
      (bundle: PackBundle) => { Object.assign(bundle.pack, { validated: true }); },
    ]) {
      const bundle = packBundle(3); mutate(bundle); await rejectWithoutResidue(bundle);
    }
  });
});

describe('S2 preserves original bytes and agreed attachment limits', () => {
  it('publishes exactly 12 attachments and 3 MiB, and a second member reads every original byte and hash', async () => {
    const bundle = packBundle(12, 256 * 1024);
    expect(bundle.pack.totalBytes).toBe(MAX_PACK_BYTES);
    expect(bundle.groups.map(group => group.slots.length)).toEqual([6, 6]);
    await assertSucceeds(commitBundle(client('owner'), bundle));
    for (const original of bundle.files) {
      const snapshot = await getDoc(doc(client('viewer'), 'packs', bundle.id, 'files', original.slot));
      const stored = snapshot.get('bytes') as Bytes;
      expect(stored).toBeInstanceOf(Bytes);
      const bytes = stored.toUint8Array();
      expect(bytes.byteLength).toBe(original.size);
      expect(Buffer.from(bytes)).toEqual(Buffer.from(original.bytes.toUint8Array()));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(snapshot.get('sha256'));
      expect(snapshot.get('sha256')).toBe(original.sha256);
    }
  });
  it('round-trips a real synthetic Excel workbook, PNG, and multilingual TXT for a second member', async () => {
    const excel = await workbook();
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC', 'base64'));
    const txt = new TextEncoder().encode('Synthetic notes\n设备原始数值，无单位。');
    const originals = [originalFile(0, 'eeg', excel), originalFile(1, 'image', png), originalFile(2, 'text', txt)];
    const bundle = bundleFromFiles(originals, { textContent: '' });
    await assertSucceeds(commitBundle(client('owner'), bundle));
    for (const original of originals) {
      const snapshot = await getDoc(doc(client('viewer'), 'packs', bundle.id, 'files', original.slot));
      const bytes = (snapshot.get('bytes') as Bytes).toUint8Array();
      expect(Buffer.from(bytes)).toEqual(Buffer.from(original.bytes.toUint8Array()));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(original.sha256);
      expect(snapshot.get('name')).toBe(original.name);
    }
  });
  it('accepts one attachment at exactly 512 KiB with body content as the required text', async () => {
    const bundle = bundleFromFiles([binaryFile(0, 'eeg', MAX_FILE_BYTES)]);
    await assertSucceeds(commitBundle(client('owner'), bundle));
    expect((await getDoc(doc(client('viewer'), 'packs', bundle.id, 'files', '0'))).get('size')).toBe(MAX_FILE_BYTES);
  });
  it('accepts TXT plus Excel without body text and accepts body plus Excel without TXT', async () => {
    for (const bundle of [bundleFromFiles([binaryFile(0, 'text'), binaryFile(1, 'eeg')], { textContent: '' }),
      bundleFromFiles([binaryFile(0, 'eeg')], { textContent: 'Body notes' })]) {
      await assertSucceeds(commitBundle(client('owner'), bundle));
      expect((await getDoc(rootRef(client('viewer'), bundle.id))).get('status')).toBe('ready');
    }
  });
  it('rejects a 512 KiB plus one-byte attachment even below the aggregate limit', async () => {
    const bundle = bundleFromFiles([binaryFile(0, 'eeg', MAX_FILE_BYTES + 1)]);
    expect(bundle.pack.totalBytes).toBeLessThan(MAX_PACK_BYTES);
    await rejectWithoutResidue(bundle);
  });
  it('rejects a 3 MiB plus one-byte aggregate even when every attachment fits', async () => {
    const files = packBundle(12, 256 * 1024).files;
    files[0] = binaryFile(0, 'text', 256 * 1024 + 1);
    const bundle = bundleFromFiles(files);
    expect(bundle.pack.totalBytes).toBe(MAX_PACK_BYTES + 1);
    expect(bundle.files.every(file => file.size <= MAX_FILE_BYTES)).toBe(true);
    await rejectWithoutResidue(bundle);
  });
  it('rejects 13 attachments and an undeclared thirteenth file', async () => {
    await rejectWithoutResidue(packBundle(13));
    const bundle = packBundle(), db = client('owner'), batch = writeBatch(db);
    addBundle(batch, db, bundle); batch.set(doc(db, 'packs', bundle.id, 'files', '12'), binaryFile(12, 'eeg'));
    await assertFails(batch.commit()); await assertNoResidue(bundle.id);
  });
  it('rejects no Excel or neither nonblank body nor TXT', async () => {
    for (const bundle of [bundleFromFiles([binaryFile(0, 'image'), binaryFile(1, 'text')]),
      bundleFromFiles([binaryFile(0, 'eeg')], { textContent: ' \n\t' }), bundleFromFiles([])]) await rejectWithoutResidue(bundle);
  });
});

describe('S2 atomic attachment manifests cannot publish partial or forged originals', () => {
  it.each([0, 1])('requires group %i even when that group would be empty', async missing => {
    await rejectWithoutResidue(packBundle(3), { groups: [missing] });
  });
  it.each(['0', '5', '6', '11'])('rejects a declared but missing file at slot %s atomically', async missing => {
    await rejectWithoutResidue(packBundle(), { files: [missing] });
  });
  it('rejects standalone groups or files without a parent creation in the same request', async () => {
    const bundle = packBundle(3);
    await rejectWithoutResidue(bundle, { root: true });
    const db = client('owner');
    await assertFails(setDoc(doc(db, 'packs', bundle.id, 'groups', '0'), bundle.groups[0]));
    await assertFails(setDoc(doc(db, 'packs', bundle.id, 'files', '0'), bundle.files[0]));
    await assertNoResidue(bundle.id);
  });
  it('rejects root-only ready publication and unlisted files in a legal slot', async () => {
    const rootOnly = packBundle(3);
    await assertFails(setDoc(rootRef(client('owner'), rootOnly.id), rootOnly.pack));
    await assertNoResidue(rootOnly.id);
    const bundle = bundleFromFiles([binaryFile(0, 'eeg')]), db = client('owner'), batch = writeBatch(db);
    addBundle(batch, db, bundle); batch.set(doc(db, 'packs', bundle.id, 'files', '5'), binaryFile(5, 'image'));
    await assertFails(batch.commit()); await assertNoResidue(bundle.id);
  });
  it('rejects missing or wrong slot IDs, duplicate group slots, unlisted manifest keys, and version mismatch', async () => {
    for (const mutate of [
      (bundle: PackBundle) => { bundle.files[0].slot = '5'; },
      (bundle: PackBundle) => { bundle.groups[0].slots.push('0'); },
      (bundle: PackBundle) => { bundle.groups[0].slots.push('6'); },
      (bundle: PackBundle) => { bundle.groups[0].files['5'] = bundle.groups[0].files['0']; },
      (bundle: PackBundle) => { bundle.files[0].version = 2; },
      (bundle: PackBundle) => { bundle.groups[0].version = 2; },
    ]) {
      const bundle = packBundle(3); mutate(bundle); await rejectWithoutResidue(bundle);
    }
  });
  it('rejects mismatched group and original size, media type, hash, and kind metadata', async () => {
    for (const field of ['size', 'mediaType', 'sha256', 'kind'] as const) {
      const bundle = packBundle(3), metadata = bundle.groups[0].files['0'];
      if (field === 'size') metadata.size += 1;
      else if (field === 'mediaType') metadata.mediaType = 'image/png';
      else if (field === 'sha256') metadata.sha256 = '0'.repeat(64);
      else metadata.kind = 'image';
      await rejectWithoutResidue(bundle);
    }
  });
  it('rejects byte-length lies, non-Bytes payloads, invalid file hashes, filename paths, and extra file flags', async () => {
    for (const mutate of [
      (bundle: PackBundle) => { bundle.files[0].size -= 1; },
      (bundle: PackBundle) => { Object.assign(bundle.files[0], { bytes: 'not Firestore Bytes' }); },
      (bundle: PackBundle) => { bundle.files[0].sha256 = 'invalid'; },
      (bundle: PackBundle) => { bundle.files[0].name = '../synthetic.txt'; },
      (bundle: PackBundle) => { Object.assign(bundle.files[0], { validated: true }); },
    ]) {
      const bundle = packBundle(3); mutate(bundle);
      // Rebuild agreeing group metadata so actual original validation causes rejection.
      await rejectWithoutResidue(bundleFromFiles(bundle.files, {}, bundle.id));
    }
  });
  it.each([
    { label: 'TAB', name: 'synthetic\ttext.txt' },
    { label: 'NUL', name: 'synthetic\u0000text.txt' },
    { label: 'DEL', name: 'synthetic\u007ftext.txt' },
  ])('rejects an original filename containing $label even with agreeing manifests', async ({ name }) => {
    const files = packBundle(3).files;
    files[0].name = name;
    await rejectWithoutResidue(bundleFromFiles(files));
  });
  it('rejects false aggregate totals or kind counts and extra group fields', async () => {
    for (const mutate of [
      (bundle: PackBundle) => { bundle.pack.totalBytes -= 1; },
      (bundle: PackBundle) => { bundle.pack.eegCount += 1; },
      (bundle: PackBundle) => { bundle.groups[0].totalBytes += 1; },
      (bundle: PackBundle) => { bundle.groups[1].imageCount += 1; },
      (bundle: PackBundle) => { Object.assign(bundle.groups[0], { published: true }); },
    ]) {
      const bundle = packBundle(); mutate(bundle); await rejectWithoutResidue(bundle);
    }
  });
});

describe('S2 ready community access and stable submission replay', () => {
  it('allows a member to read a missing pack for a creation transaction', async () => {
    expect((await assertSucceeds(getDoc(rootRef(client('owner'), 'new-attempt')))).exists()).toBe(false);
  });
  it('lists only ready packs for a second member and keeps unpublished originals unreadable', async () => {
    const ready = packBundle(3), unpublished = packBundle(3);
    Object.assign(unpublished.pack, { status: 'uploading' });
    await seedBundle(ready); await seedBundle(unpublished);
    const db = client('viewer');
    const list = await assertSucceeds(getDocs(query(collection(db, 'packs'), where('status', '==', 'ready'))));
    expect(list.docs.map(snapshot => snapshot.id)).toEqual([ready.id]);
    await assertFails(getDoc(rootRef(db, unpublished.id)));
    await assertFails(getDoc(doc(db, 'packs', unpublished.id, 'groups', '0')));
    await assertFails(getDoc(doc(db, 'packs', unpublished.id, 'files', '0')));
  });
  it('refuses anonymous or unregistered identities reading or writing packs, groups, or files', async () => {
    const bundle = packBundle(3); await seedBundle(bundle);
    for (const db of [anonymous(), client('unregistered')]) {
      await assertFails(getDoc(rootRef(db, bundle.id)));
      await assertFails(getDoc(doc(db, 'packs', bundle.id, 'groups', '0')));
      await assertFails(getDoc(doc(db, 'packs', bundle.id, 'files', '0')));
      await assertFails(getDocs(query(collection(db, 'packs'), where('status', '==', 'ready'))));
      await assertFails(commitBundle(db, packBundle(3)));
    }
  });
  it('refuses another member forging a pack or modifying someone else original outside creation', async () => {
    const bundle = packBundle(3); await seedBundle(bundle);
    await assertFails(commitBundle(client('viewer'), packBundle(3)));
    await assertFails(setDoc(rootRef(client('viewer'), bundle.id), { title: 'Foreign overwrite' }, { merge: true }));
    await assertFails(setDoc(doc(client('viewer'), 'packs', bundle.id, 'files', '0'), binaryFile(0, 'text')));
    await assertFails(setDoc(doc(client('owner'), 'packs', bundle.id, 'files', '0'), binaryFile(0, 'text')));
    await trusted(async db => {
      expect((await getDoc(rootRef(db, bundle.id))).get('title')).toBe(bundle.pack.title);
      expect((await getDoc(doc(db, 'packs', bundle.id, 'files', '0'))).get('sha256')).toBe(bundle.files[0].sha256);
    });
  });
  it('retries a failed atomic request using the same ID with no residue and no duplicate pack or files', async () => {
    const db = client('owner'), bundle = packBundle();
    await assertFails(commitBundle(db, bundle, { files: ['11'] }));
    await assertNoResidue(bundle.id);
    expect(await assertSucceeds(createOnce(db, bundle))).toEqual({ id: bundle.id, created: true });
    const first = (await getDoc(rootRef(db, bundle.id))).data();
    expect(await assertSucceeds(createOnce(db, bundle))).toEqual({ id: bundle.id, created: false });
    expect((await getDoc(rootRef(db, bundle.id))).data()).toEqual(first);
    expect((await getDocs(query(collection(db, 'packs'), where('status', '==', 'ready')))).docs.map(snapshot => snapshot.id)).toEqual([bundle.id]);
    expect((await getDocs(collection(db, 'packs', bundle.id, 'groups'))).docs).toHaveLength(2);
    expect((await getDocs(collection(db, 'packs', bundle.id, 'files'))).docs).toHaveLength(12);
    // A raw replay cannot overwrite trusted timestamps or original bytes; retry is a read-only transaction.
    await assertFails(commitBundle(db, bundle));
  });
  it('deduplicates concurrent identical attempts through the real transaction and immutable creation', async () => {
    const bundle = packBundle(3);
    const results = await Promise.all([createOnce(client('owner'), bundle), createOnce(client('owner'), bundle)]);
    expect(results.map(result => result.id)).toEqual([bundle.id, bundle.id]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect((await getDocs(query(collection(client('viewer'), 'packs'), where('status', '==', 'ready')))).docs).toHaveLength(1);
    expect((await getDocs(collection(client('viewer'), 'packs', bundle.id, 'files'))).docs).toHaveLength(3);
  });
  it('rejects replay with a changed fingerprint or owner without silently accepting different content', async () => {
    const db = client('owner'), original = packBundle(3);
    await assertSucceeds(createOnce(db, original));
    const changed = packBundle(3, 128, { title: 'Different submission' }, original.id);
    await expect(createOnce(db, changed)).rejects.toThrow('attemptConflict');
    const foreign = packBundle(3, 128, { ownerId: 'viewer', ownerName: 'S2 viewer' }, original.id);
    await expect(createOnce(client('viewer'), foreign)).rejects.toThrow('attemptConflict');
    expect((await getDoc(rootRef(db, original.id))).get('title')).toBe(original.pack.title);
    expect((await getDoc(rootRef(db, original.id))).get('submissionHash')).toBe(original.pack.submissionHash);
  });
});
