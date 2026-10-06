import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment, type RulesTestContext } from '@firebase/rules-unit-testing';
import { Bytes, collection, doc, getDoc, getDocs, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { workbook } from '../fixtures/workbooks.mjs';
import {
  SPARK_PROJECT, SPARK_PORT, MAX_FILE_BYTES, MAX_PACK_BYTES,
  binaryFile, originalFile, bundleFromFiles, packBundle, commitBundle, addBundle,
  seedProfiles, changeRole, readRole, type PackBundle,
} from './fixtures';

let env: RulesTestEnvironment;
// rules-unit-testing exposes compat contexts; official modular SDK APIs accept their delegates.
const firestore = (context: RulesTestContext): Firestore => (context.firestore() as unknown as { _delegate: Firestore })._delegate;
const client = (uid: string) => firestore(env.authenticatedContext(uid, { email: `${uid}@example.test` }));
const anonymous = () => firestore(env.unauthenticatedContext());
const trusted = async (action: (db: Firestore) => Promise<void>) => env.withSecurityRulesDisabled(async context => action(firestore(context)));
const seedBundle = (bundle: PackBundle) => trusted(db => commitBundle(db, bundle));
const packRef = (db: Firestore, id: string) => doc(db, 's0Packs', id);

beforeAll(async () => {
  const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
  if (endpoint !== `127.0.0.1:${SPARK_PORT}`) throw new Error('S0 requires its isolated Firestore emulator at 28080');
  env = await initializeTestEnvironment({ projectId: SPARK_PROJECT,
    firestore: { host: '127.0.0.1', port: SPARK_PORT, rules: readFileSync(new URL(process.env.SPARK_S0_RED === '1' ? './deny-all.rules' : '../../firebase/spark-s0.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await trusted(db => seedProfiles(db)); });
afterAll(async () => { if (env) { await env.clearFirestore(); await env.cleanup(); } });

describe('S0 isolated Spark original bytes, capacity, and atomic publication', () => {
  it('publishes all 12 files at exactly 3 MiB and a second member reads every original byte and SHA-256', async () => {
    const bundle = packBundle(12, 256 * 1024);
    expect(bundle.pack.totalBytes).toBe(MAX_PACK_BYTES);
    expect(bundle.groups.map(group => group.slots.length)).toEqual([6, 6]);
    await assertSucceeds(commitBundle(client('owner'), bundle));
    const viewer = client('viewer');
    expect((await getDoc(packRef(viewer, bundle.id))).data()).toEqual(bundle.pack);
    for (const file of bundle.files) {
      const stored = (await getDoc(doc(viewer, 's0Packs', bundle.id, 'files', file.slot))).data()!;
      expect(stored.bytes).toBeInstanceOf(Bytes);
      const bytes = (stored.bytes as Bytes).toUint8Array();
      expect(bytes.byteLength).toBe(file.size);
      expect(Buffer.from(bytes).equals(Buffer.from(file.bytes.toUint8Array()))).toBe(true);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
  });
  it('round-trips a real synthetic Excel workbook, PNG, and TXT without changing their original bytes', async () => {
    const excel = await workbook();
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgaPgPAAIDAYAkYfWXAAAAAElFTkSuQmCC', 'base64'));
    const txt = new TextEncoder().encode('Synthetic notes\n设备原始数值，无单位。');
    const files = [originalFile(0, 'eeg', excel), originalFile(1, 'image', png), originalFile(2, 'text', txt)];
    const bundle = bundleFromFiles(files, { textContent: '' });
    await assertSucceeds(commitBundle(client('owner'), bundle));
    const sampleDirectory = new URL('../../outputs/S0/samples/', import.meta.url);
    mkdirSync(sampleDirectory, { recursive: true });
    const checksums: { filename: string; size: number; sha256: string }[] = [];
    for (const file of files) {
      const stored = await getDoc(doc(client('viewer'), 's0Packs', bundle.id, 'files', file.slot));
      expect(Buffer.from((stored.get('bytes') as Bytes).toUint8Array())).toEqual(Buffer.from(file.bytes.toUint8Array()));
      expect(stored.get('sha256')).toBe(createHash('sha256').update(file.bytes.toUint8Array()).digest('hex'));
      const bytes = (stored.get('bytes') as Bytes).toUint8Array();
      const filename = { eeg: 'original.xlsx', image: 'original.png', text: 'original.txt' }[file.kind];
      writeFileSync(new URL(filename, sampleDirectory), bytes);
      checksums.push({ filename, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    writeFileSync(new URL('checksums.json', sampleDirectory), JSON.stringify({
      synthetic: true, source: 'Original bytes read by a second member from the isolated S0 Firestore emulator', files: checksums,
    }, null, 2) + '\n');
  });
  it('accepts an individual file of exactly 512 KiB', async () => {
    const bundle = bundleFromFiles([binaryFile(0, 'eeg', MAX_FILE_BYTES)]);
    await assertSucceeds(commitBundle(client('owner'), bundle));
    expect((await getDoc(doc(client('viewer'), 's0Packs', bundle.id, 'files', '0'))).get('size')).toBe(MAX_FILE_BYTES);
  });
  it('rejects a 512 KiB plus one byte file even when aggregate size is below 3 MiB', async () => {
    const bundle = bundleFromFiles([binaryFile(0, 'eeg', MAX_FILE_BYTES + 1)]);
    await assertFails(commitBundle(client('owner'), bundle));
  });
  it('rejects 3 MiB plus one byte aggregate even when every file fits', async () => {
    const files = packBundle(12, 256 * 1024).files;
    files[0] = binaryFile(0, 'text', 256 * 1024 + 1);
    const bundle = bundleFromFiles(files);
    expect(bundle.pack.totalBytes).toBe(MAX_PACK_BYTES + 1);
    await assertFails(commitBundle(client('owner'), bundle));
  });
  it('rejects 13 files and an unlisted thirteenth original', async () => {
    const db = client('owner');
    const bundle = packBundle(13);
    await assertFails(commitBundle(db, bundle));
    const valid = packBundle();
    const batch = writeBatch(db); addBundle(batch, db, valid);
    batch.set(doc(db, 's0Packs', valid.id, 'files', '12'), binaryFile(12, 'eeg'));
    await assertFails(batch.commit());
  });
  it.each([0, 1])('rejects publication missing group %i including when its slots are empty', async missing => {
    const bundle = packBundle(3);
    await assertFails(commitBundle(client('owner'), bundle, { groups: [missing] }));
  });
  it.each(['0', '5', '6', '11'])('rejects publication that lists but omits file slot %s', async missing => {
    await assertFails(commitBundle(client('owner'), packBundle(), { files: [missing] }));
  });
  it('rejects mismatched file size, media type, hash, or kind metadata', async () => {
    for (const field of ['size', 'mediaType', 'sha256', 'kind'] as const) {
      const bundle = packBundle();
      const meta = bundle.groups[0].files['0'];
      if (field === 'size') meta.size += 1;
      else if (field === 'mediaType') meta.mediaType = 'image/png';
      else if (field === 'sha256') meta.sha256 = '0'.repeat(64);
      else meta.kind = 'image';
      await assertFails(commitBundle(client('owner'), bundle));
    }
  });
  it('rejects file size lies, non-Bytes payload, invalid hash, and filename path injection', async () => {
    for (const field of ['size', 'bytes', 'sha256', 'name'] as const) {
      const bundle = packBundle(3);
      if (field === 'size') bundle.files[0].size -= 1;
      else if (field === 'bytes') Object.assign(bundle.files[0], { bytes: 'not Firestore Bytes' });
      else if (field === 'sha256') bundle.files[0].sha256 = 'invalid';
      else bundle.files[0].name = '../synthetic.txt';
      // Rebuild every manifest so rejection must inspect the actual file shape, not just a metadata mismatch.
      await assertFails(commitBundle(client('owner'), bundleFromFiles(bundle.files, {}, bundle.id)));
    }
  });
  it('rejects inflated or understated pack and group totals and counts', async () => {
    for (const mutate of [
      (bundle: PackBundle) => { bundle.pack.totalBytes -= 1; },
      (bundle: PackBundle) => { bundle.pack.eegCount += 1; },
      (bundle: PackBundle) => { bundle.groups[0].totalBytes += 1; },
      (bundle: PackBundle) => { bundle.groups[1].imageCount -= 1; },
    ]) {
      const bundle = packBundle(); mutate(bundle);
      await assertFails(commitBundle(client('owner'), bundle));
    }
  });
  it('rejects no Excel or neither body nor TXT without trusting a client flag', async () => {
    const noExcel = bundleFromFiles([binaryFile(0, 'image'), binaryFile(1, 'text')]);
    const noText = bundleFromFiles([binaryFile(0, 'eeg')], { textContent: '' });
    await assertFails(commitBundle(client('owner'), noExcel));
    await assertFails(commitBundle(client('owner'), noText));
  });
  it('rejects anonymous reads and writes, and another member cannot edit or directly overwrite an original', async () => {
    const bundle = packBundle(); await seedBundle(bundle);
    const anon = anonymous();
    await assertFails(getDoc(packRef(anon, bundle.id)));
    await assertFails(getDoc(doc(anon, 's0Packs', bundle.id, 'files', '0')));
    await assertFails(commitBundle(anon, packBundle()));
    const viewer = client('viewer');
    const edit = packBundle(12, 128, { version: 2, title: 'Foreign edit' }, bundle.id);
    await assertFails(commitBundle(viewer, edit));
    await assertFails(setDoc(doc(viewer, 's0Packs', bundle.id, 'files', '0'), binaryFile(0, 'text', 128, 2)));
  });
  it('rejects owner forgery, changing ownership, and edits after administrator demotion', async () => {
    await assertFails(commitBundle(client('owner'), packBundle(3, 128, { ownerId: 'viewer' })));
    const bundle = packBundle(); await seedBundle(bundle);
    await assertFails(commitBundle(client('owner'), packBundle(12, 128, { ownerId: 'viewer', version: 2 }, bundle.id)));
    await trusted(db => setDoc(doc(db, 's0Users', 'admin'), { uid: 'admin', displayName: 'S0 admin', email: 'admin@example.test', role: 'member' }));
    await assertFails(commitBundle(client('admin'), packBundle(12, 128, { version: 2 }, bundle.id)));
  });
  it('allows owner and administrator full replacement, keeps the original creator, and advances version exactly once', async () => {
    const original = packBundle(); await seedBundle(original);
    const ownerEdit = packBundle(12, 192, { version: 2, title: 'Owner edit' }, original.id);
    await assertSucceeds(commitBundle(client('owner'), ownerEdit));
    const adminEdit = packBundle(12, 256, { version: 3, title: 'Administrator edit' }, original.id);
    await assertSucceeds(commitBundle(client('admin'), adminEdit));
    const stored = await getDoc(packRef(client('viewer'), original.id));
    expect(stored.get('ownerId')).toBe('owner');
    expect(stored.get('version')).toBe(3);
    expect(stored.get('title')).toBe('Administrator edit');
  });
  it('replaces an old 3 MiB pack with a new 3 MiB pack atomically within request limits', async () => {
    const original = packBundle(12, 256 * 1024); await seedBundle(original);
    const files = original.files.map(file => originalFile(Number(file.slot), file.kind,
      new Uint8Array(256 * 1024).fill(200 + Number(file.slot)), 2));
    const next = bundleFromFiles(files, { version: 2 }, original.id);
    expect(next.pack.totalBytes).toBe(MAX_PACK_BYTES);
    await assertSucceeds(commitBundle(client('owner'), next));
    const viewer = client('viewer');
    expect((await getDoc(packRef(viewer, original.id))).get('version')).toBe(2);
    for (const file of files) {
      const stored = await getDoc(doc(viewer, 's0Packs', original.id, 'files', file.slot));
      const bytes = (stored.get('bytes') as Bytes).toUint8Array();
      expect(Buffer.from(bytes).equals(Buffer.from(file.bytes.toUint8Array()))).toBe(true);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      expect(stored.get('sha256')).not.toBe(original.files[Number(file.slot)].sha256);
    }
  });
  it('removes six originals only in an atomic valid replacement and leaves no unlisted old slot', async () => {
    const original = packBundle(); await seedBundle(original);
    const files = original.files.slice(0, 6).map(file => originalFile(Number(file.slot), file.kind, file.bytes.toUint8Array(), 2));
    const next = bundleFromFiles(files, { version: 2 }, original.id);
    const db = client('owner');
    // A manifest-only shrink must fail while the old files still exist.
    await assertFails(commitBundle(db, next));
    expect((await getDoc(packRef(client('viewer'), original.id))).get('version')).toBe(1);
    const batch = writeBatch(db); addBundle(batch, db, next);
    for (const file of original.files.slice(6)) batch.delete(doc(db, 's0Packs', original.id, 'files', file.slot));
    await assertSucceeds(batch.commit());
    const stored = await getDocs(collection(client('viewer'), 's0Packs', original.id, 'files'));
    expect(stored.docs.map(file => file.id).sort()).toEqual(['0', '1', '2', '3', '4', '5']);
    expect((await getDoc(packRef(client('viewer'), original.id))).get('version')).toBe(2);
    expect((await getDoc(doc(client('viewer'), 's0Packs', original.id, 'groups', '1'))).get('slots')).toEqual([]);
  });
  it('allows exactly one of two concurrent edits from the same published version', async () => {
    const original = packBundle(); await seedBundle(original);
    const owner = client('owner');
    const results = await Promise.allSettled([
      commitBundle(owner, packBundle(12, 192, { version: 2, title: 'First concurrent edit' }, original.id)),
      commitBundle(owner, packBundle(12, 256, { version: 2, title: 'Second concurrent edit' }, original.id)),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const stored = await getDoc(packRef(client('viewer'), original.id));
    expect(stored.get('version')).toBe(2);
    expect(['First concurrent edit', 'Second concurrent edit']).toContain(stored.get('title'));
  });
  it('rejects same-length byte tampering with unchanged metadata and version', async () => {
    const original = packBundle(3); await seedBundle(original);
    const before = original.files[0];
    const forged = { ...before, bytes: Bytes.fromUint8Array(new Uint8Array(before.size).fill(42)) };
    expect(forged.size).toBe(before.size);
    expect(forged.sha256).toBe(before.sha256);
    await assertFails(setDoc(doc(client('owner'), 's0Packs', original.id, 'files', '0'), forged));
    const stored = await getDoc(doc(client('viewer'), 's0Packs', original.id, 'files', '0'));
    expect(Buffer.from((stored.get('bytes') as Bytes).toUint8Array())).toEqual(Buffer.from(before.bytes.toUint8Array()));
  });
  it('rejects stale versions and version leaps, leaving all old metadata and originals unchanged', async () => {
    const original = packBundle(12, 256 * 1024); await seedBundle(original);
    for (const version of [1, 3]) await assertFails(commitBundle(client('owner'), packBundle(12, 128, { version }, original.id)));
    const viewer = client('viewer');
    expect((await getDoc(packRef(viewer, original.id))).data()).toEqual(original.pack);
    for (const file of original.files) {
      const stored = await getDoc(doc(viewer, 's0Packs', original.id, 'files', file.slot));
      expect(stored.get('version')).toBe(1);
      expect(Buffer.from((stored.get('bytes') as Bytes).toUint8Array())).toEqual(Buffer.from(file.bytes.toUint8Array()));
    }
  });
  it('rejects partial replacement without touching the published version or old originals', async () => {
    const original = packBundle(); await seedBundle(original);
    const next = packBundle(12, 256, { version: 2 }, original.id);
    await assertFails(commitBundle(client('owner'), next, { files: ['11'] }));
    const viewer = client('viewer');
    expect((await getDoc(packRef(viewer, original.id))).get('version')).toBe(1);
    expect((await getDoc(doc(viewer, 's0Packs', original.id, 'files', '0'))).get('sha256')).toBe(original.files[0].sha256);
    expect((await getDoc(doc(viewer, 's0Packs', original.id, 'files', '11'))).get('sha256')).toBe(original.files[11].sha256);
  });
  it('rejects direct file mutation or an extra hidden original without atomic manifest changes', async () => {
    const original = packBundle(3); await seedBundle(original);
    const db = client('owner');
    await assertFails(setDoc(doc(db, 's0Packs', original.id, 'files', '0'), binaryFile(0, 'text', 192)));
    await assertFails(setDoc(doc(db, 's0Packs', original.id, 'files', '5'), binaryFile(5, 'eeg')));
  });
  it('moves an edited pack only to an active existing category and preserves the original on invalid targets', async () => {
    const original = packBundle(); await seedBundle(original);
    for (const categoryId of ['migrating', 'deleted', 'missing']) {
      await assertFails(commitBundle(client('owner'), packBundle(12, 128, { version: 2, categoryId }, original.id)));
      expect((await getDoc(packRef(client('viewer'), original.id))).get('categoryId')).toBe('active');
    }
    await assertSucceeds(commitBundle(client('owner'), packBundle(12, 128, { version: 2, categoryId: 'other' }, original.id)));
    expect((await getDoc(packRef(client('viewer'), original.id))).get('categoryId')).toBe('other');
  });
  it('rejects replacing the last Excel or removing both required text sources', async () => {
    const original = packBundle(3); await seedBundle(original);
    const noEeg = bundleFromFiles([binaryFile(0, 'text', 128, 2), binaryFile(1, 'image', 128, 2)], { version: 2 }, original.id);
    const noText = bundleFromFiles([binaryFile(0, 'eeg', 128, 2)], { version: 2, textContent: '' }, original.id);
    await assertFails(commitBundle(client('owner'), noEeg));
    await assertFails(commitBundle(client('owner'), noText));
    expect((await getDoc(packRef(client('viewer'), original.id))).get('version')).toBe(1);
  });
});

describe('S0 direct profiles and rule-enforced role transactions', () => {
  it('creates only the signed-in user own member profile and never a client administrator', async () => {
    const profile = { uid: 'new-member', displayName: 'Synthetic member', email: 'new-member@example.test', role: 'member' };
    await assertSucceeds(setDoc(doc(client('new-member'), 's0Users', 'new-member'), profile));
    await assertFails(setDoc(doc(client('self-admin'), 's0Users', 'self-admin'), { ...profile, uid: 'self-admin', role: 'admin' }));
    await assertFails(setDoc(doc(client('new-member'), 's0Users', 'other-new'), { ...profile, uid: 'other-new' }));
    await assertFails(setDoc(doc(anonymous(), 's0Users', 'anonymous-new'), { ...profile, uid: 'anonymous-new' }));
  });
  it('rejects member listing, self promotion, direct role writes, and fake administrator counts', async () => {
    const owner = client('owner');
    await assertFails(getDocs(collection(owner, 's0Users')));
    await assertFails(setDoc(doc(owner, 's0Users', 'owner'), { role: 'admin' }, { merge: true }));
    await assertFails(changeRole(owner, 'owner', 'owner', 'admin'));
    await assertFails(setDoc(doc(client('admin'), 's0System', 'roles'), {
      adminCount: 99, revision: 1, changedUid: 'owner', fromRole: 'member', toRole: 'admin', operationId: randomUUID(),
    }));
    await assertFails(setDoc(doc(client('admin'), 's0Users', 'owner'), { role: 'admin' }, { merge: true }));
  });
  it('promotes and demotes a member atomically with the exact administrator count and immutable identity', async () => {
    const db = client('admin');
    const before = (await getDoc(doc(db, 's0Users', 'owner'))).data()!;
    await assertSucceeds(changeRole(db, 'admin', 'owner', 'admin'));
    expect(await readRole(db, 'owner')).toBe('admin');
    expect((await getDoc(doc(db, 's0System', 'roles'))).get('adminCount')).toBe(2);
    await assertSucceeds(changeRole(db, 'admin', 'owner', 'member'));
    expect((await getDoc(doc(db, 's0System', 'roles'))).get('adminCount')).toBe(1);
    expect((await getDoc(doc(db, 's0Users', 'owner'))).data()).toEqual(before);
  });
  it('rejects final administrator demotion with no count, user, or receipt modification', async () => {
    const db = client('admin'); const operationId = randomUUID();
    await assertFails(changeRole(db, 'admin', 'admin', 'member', operationId));
    expect(await readRole(db, 'admin')).toBe('admin');
    const roles = await getDoc(doc(db, 's0System', 'roles'));
    expect(roles.get('adminCount')).toBe(1); expect(roles.get('revision')).toBe(0);
    expect((await getDoc(doc(db, 's0RoleOps', operationId))).exists()).toBe(false);
  });
  it('concurrent self demotions of two administrators allow exactly one and retain exactly one administrator', async () => {
    await trusted(db => seedProfiles(db, 2));
    const results = await Promise.allSettled([
      changeRole(client('admin'), 'admin', 'admin', 'member'),
      changeRole(client('admin2'), 'admin2', 'admin2', 'member'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await trusted(async db => {
      const users = await getDocs(collection(db, 's0Users'));
      expect(users.docs.filter(user => user.get('role') === 'admin')).toHaveLength(1);
      expect((await getDoc(doc(db, 's0System', 'roles'))).get('adminCount')).toBe(1);
    });
  });
  it('concurrent cross demotions recheck authority and leave one administrator', async () => {
    await trusted(db => seedProfiles(db, 2));
    const results = await Promise.allSettled([
      changeRole(client('admin'), 'admin', 'admin2', 'member'),
      changeRole(client('admin2'), 'admin2', 'admin', 'member'),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    await trusted(async db => {
      const users = await getDocs(collection(db, 's0Users'));
      expect(users.docs.filter(user => user.get('role') === 'admin')).toHaveLength(1);
      expect((await getDoc(doc(db, 's0System', 'roles'))).get('adminCount')).toBe(1);
    });
  });
  it('idempotent operation receipts cannot replay an old promotion over a later demotion', async () => {
    const db = client('admin'); const operationId = randomUUID();
    const first = await changeRole(db, 'admin', 'owner', 'admin', operationId, 'member');
    const retry = await changeRole(db, 'admin', 'owner', 'admin', operationId, 'member');
    expect(retry).toEqual(first);
    await changeRole(db, 'admin', 'owner', 'member');
    expect(await changeRole(db, 'admin', 'owner', 'admin', operationId)).toEqual(first);
    expect(await readRole(db, 'owner')).toBe('member');
    expect((await getDoc(doc(db, 's0System', 'roles'))).get('adminCount')).toBe(1);
    await expect(changeRole(db, 'admin', 'owner', 'member', operationId)).rejects.toThrow('Operation reuse');
  });
  it('rejects receipt fabrication, receipt rewrites, and an atomic change targeting two members', async () => {
    const db = client('admin'); const operationId = randomUUID();
    await assertFails(setDoc(doc(db, 's0RoleOps', operationId), { uid: 'owner', actorId: 'admin', fromRole: 'member', toRole: 'admin', revision: 1 }));
    await changeRole(db, 'admin', 'owner', 'admin', operationId);
    await assertFails(setDoc(doc(db, 's0RoleOps', operationId), { uid: 'viewer', actorId: 'admin', fromRole: 'member', toRole: 'admin', revision: 1 }));
    const batch = writeBatch(db); const extraOperationId = randomUUID();
    batch.update(doc(db, 's0Users', 'owner'), { role: 'member' });
    batch.update(doc(db, 's0Users', 'viewer'), { role: 'admin' });
    batch.set(doc(db, 's0System', 'roles'), { adminCount: 3, revision: 2, changedUid: 'viewer', fromRole: 'member', toRole: 'admin', operationId: extraOperationId });
    batch.set(doc(db, 's0RoleOps', extraOperationId), { uid: 'viewer', actorId: 'admin', fromRole: 'member', toRole: 'admin', revision: 2 });
    await assertFails(batch.commit());
    expect(await readRole(db, 'owner')).toBe('admin');
    expect(await readRole(db, 'viewer')).toBe('member');
  });
});
