import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, type Firestore } from 'firebase/firestore';
import { S1_PROJECT, S1_FIRESTORE_PORT, profile, seedS1, initializeOwnMember, createCategoryTransaction, roleTransaction, readRole } from './fixtures';

let env: RulesTestEnvironment;
// Official modular SDK calls use the delegate of rules-unit-testing's compat context.
const firestore = (context: RulesTestContext): Firestore => (context.firestore() as unknown as { _delegate: Firestore })._delegate;
const client = (uid: string, email = `${uid}@example.test`) => firestore(env.authenticatedContext(uid, { email }));
const anonymous = () => firestore(env.unauthenticatedContext());
const trusted = async (action: (db: Firestore) => Promise<void>) => env.withSecurityRulesDisabled(async context => action(firestore(context)));
const categoryData = (name: string, uid = 'member') => ({ name, status: 'active', createdBy: uid, createdAt: serverTimestamp() });

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${S1_FIRESTORE_PORT}`) throw new Error('S1 requires isolated Firestore 28090');
  const rules = process.env.SPARK_S1_RED === '1'
    ? new URL('../spark/deny-all.rules', import.meta.url) : new URL('../../firebase/spark.rules', import.meta.url);
  env = await initializeTestEnvironment({ projectId: S1_PROJECT,
    firestore: { host: '127.0.0.1', port: S1_FIRESTORE_PORT, rules: readFileSync(rules, 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await trusted(db => seedS1(db)); });
afterAll(async () => { if (env) { await env.clearFirestore(); await env.cleanup(); } });

describe('S1 member profile initialization and access', () => {
  it('creates only its own four-field member profile with the signed-in email', async () => {
    const db = client('new-member'); const expected = profile('new-member');
    await assertSucceeds(setDoc(doc(db, 'users', 'new-member'), expected));
    expect((await getDoc(doc(db, 'users', 'new-member'))).data()).toEqual(expected);
  });
  it('permits reading a missing own profile and a repeated initialization returns the original without rewriting it', async () => {
    const db = client('new-member');
    expect((await assertSucceeds(getDoc(doc(db, 'users', 'new-member')))).exists()).toBe(false);
    const first = await assertSucceeds(initializeOwnMember(db, 'new-member', 'First registration name'));
    const again = await assertSucceeds(initializeOwnMember(db, 'new-member', 'Repeated request name'));
    expect(again).toEqual(first);
    expect((await getDoc(doc(db, 'users', 'new-member'))).get('displayName')).toBe('First registration name');
  });
  it('cannot register directly as administrator or use an unknown role', async () => {
    for (const role of ['admin', 'owner', 'viewer']) {
      const uid = `forged-${role}`;
      await assertFails(setDoc(doc(client(uid), 'users', uid), { ...profile(uid), role }));
    }
  });
  it('rejects anonymous signup and UID, email, or document-owner impersonation', async () => {
    await assertFails(setDoc(doc(anonymous(), 'users', 'new-member'), profile('new-member')));
    await assertFails(setDoc(doc(client('new-member'), 'users', 'another-user'), profile('another-user')));
    await assertFails(setDoc(doc(client('new-member'), 'users', 'new-member'), { ...profile('new-member'), uid: 'another-user' }));
    await assertFails(setDoc(doc(client('new-member'), 'users', 'new-member'), { ...profile('new-member'), email: 'forged@example.test' }));
  });
  it('rejects malformed or extra profile fields instead of trusting client role flags', async () => {
    for (const mutate of [
      (data: Record<string, unknown>) => { data.displayName = ''; },
      (data: Record<string, unknown>) => { data.displayName = 'x'.repeat(121); },
      (data: Record<string, unknown>) => { data.email = 42; },
      (data: Record<string, unknown>) => { data.uid = false; },
      (data: Record<string, unknown>) => { data.isAdmin = true; },
      (data: Record<string, unknown>) => { delete data.email; },
    ]) {
      const uid = `malformed-${randomUUID()}`, data: Record<string, unknown> = profile(uid); mutate(data);
      await assertFails(setDoc(doc(client(uid), 'users', uid), data));
    }
  });
  it('allows own profile and administrator member listing while refusing nonowner member or anonymous access', async () => {
    expect((await assertSucceeds(getDoc(doc(client('member'), 'users', 'member')))).get('uid')).toBe('member');
    const members = await assertSucceeds(getDocs(collection(client('admin'), 'users')));
    expect(members.docs.map(value => value.id).sort()).toEqual(['admin', 'admin2', 'member', 'viewer']);
    expect((await assertSucceeds(getDoc(doc(client('admin'), 'users', 'member')))).get('role')).toBe('member');
    await assertFails(getDoc(doc(client('viewer'), 'users', 'member')));
    await assertFails(getDocs(collection(client('member'), 'users')));
    await assertFails(getDoc(doc(anonymous(), 'users', 'member')));
  });
  it('denies direct self-promotion, profile identity editing, deletion, and direct administrator role overrides', async () => {
    const db = client('member'), target = doc(db, 'users', 'member');
    await assertFails(setDoc(target, { role: 'admin' }, { merge: true }));
    await assertFails(setDoc(target, { email: 'different@example.test' }, { merge: true }));
    await assertFails(setDoc(target, { displayName: 'Forged edit' }, { merge: true }));
    await assertFails(deleteDoc(target));
    await assertFails(setDoc(doc(client('admin'), 'users', 'member'), { role: 'admin' }, { merge: true }));
    expect((await getDoc(target)).data()).toEqual(profile('member'));
  });
  it('prevents client initialization or tampering of trusted role counters and isolated role receipts', async () => {
    const db = client('member');
    const roles = { adminCount: 99, revision: 1, changedUid: 'member', fromRole: 'member', toRole: 'admin', operationId: randomUUID() };
    for (const uid of ['member', 'admin']) await assertFails(setDoc(doc(client(uid), 'system', 'roles'), roles));
    await assertFails(setDoc(doc(db, 'system', 'forged-bootstrap'), { adminCount: 1 }));
    await assertFails(setDoc(doc(db, 'roleOps', roles.operationId), { uid: 'member', actorId: 'member', fromRole: 'member', toRole: 'admin', revision: 1 }));
    await assertFails(roleTransaction(db, 'member', 'member', 'admin'));
  });
});

describe('S1 denies unknown collections and nested documents', () => {
  it('refuses read and write outside explicitly authorized paths for every role', async () => {
    const paths = ['private/synthetic', 'users/member/private/synthetic'];
    await trusted(async db => {
      for (const path of paths) await setDoc(doc(db, path), { value: 'trusted seed' });
    });
    for (const db of [anonymous(), client('member'), client('admin')]) {
      for (const path of paths) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { value: 'forged replacement' }));
      }
    }
  });
});

describe('S1 retains production role transaction protection', () => {
  it('changes roles and exact counts only atomically and refuses the final administrator demotion', async () => {
    const db = client('admin');
    await assertSucceeds(roleTransaction(db, 'admin', 'member', 'admin'));
    expect(await readRole(db, 'member')).toBe('admin');
    expect((await getDoc(doc(db, 'system', 'roles'))).get('adminCount')).toBe(2);
    await assertSucceeds(roleTransaction(db, 'admin', 'member', 'member'));
    expect(await readRole(db, 'member')).toBe('member');
    await assertFails(roleTransaction(db, 'admin', 'admin', 'member'));
    expect(await readRole(db, 'admin')).toBe('admin');
    expect((await getDoc(doc(db, 'system', 'roles'))).get('adminCount')).toBe(1);
  });
  it('concurrent self and cross demotions of two administrators leave exactly one administrator', async () => {
    for (const cross of [false, true]) {
      await trusted(db => seedS1(db, 2));
      const results = await Promise.allSettled([
        roleTransaction(client('admin'), 'admin', cross ? 'admin2' : 'admin', 'member'),
        roleTransaction(client('admin2'), 'admin2', cross ? 'admin' : 'admin2', 'member'),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      await trusted(async db => {
        expect((await getDocs(collection(db, 'users'))).docs.filter(value => value.get('role') === 'admin')).toHaveLength(1);
        expect((await getDoc(doc(db, 'system', 'roles'))).get('adminCount')).toBe(1);
      });
    }
  });
});

describe('S1 shared category transactions with canonical unique IDs', () => {
  it('permits a member to read a missing category so a transaction can create it', async () => {
    const snapshot = await assertSucceeds(getDoc(doc(client('member'), 'categories', 'new category')));
    expect(snapshot.exists()).toBe(false);
  });
  it('creates an active category with its creator and server time and lets another member read and list it', async () => {
    const db = client('member'), target = doc(db, 'categories', 'brain data');
    await assertSucceeds(setDoc(target, categoryData('Brain Data')));
    const snapshot = await assertSucceeds(getDoc(doc(client('viewer'), 'categories', 'brain data')));
    expect(snapshot.data()).toMatchObject({ name: 'Brain Data', status: 'active', createdBy: 'member' });
    expect(snapshot.get('createdAt')).toBeInstanceOf(Timestamp);
    const categories = await assertSucceeds(getDocs(collection(client('viewer'), 'categories')));
    expect(categories.docs.map(value => value.id)).toEqual(['brain data']);
  });
  it('deduplicates simultaneous case and whitespace variants through a real Firestore transaction', async () => {
    const results = await Promise.all([
      createCategoryTransaction(client('member'), 'member', '  Memory\t\tBasics  '),
      createCategoryTransaction(client('viewer'), 'viewer', 'memory\u00a0\u00a0BASICS'),
    ]);
    expect(results.map(value => value.id)).toEqual(['memory basics', 'memory basics']);
    expect(results.filter(value => value.created)).toHaveLength(1);
    const snapshots = await getDocs(collection(client('member'), 'categories'));
    expect(snapshots.docs).toHaveLength(1);
    expect(['member', 'viewer']).toContain(snapshots.docs[0].get('createdBy'));
  });
  it('retries an existing category without changing its name, timestamp, or original creator', async () => {
    const db = client('member');
    const first = await createCategoryTransaction(db, 'member', 'Memory Basics');
    const before = (await getDoc(doc(db, 'categories', first.id))).data();
    const retry = await createCategoryTransaction(client('viewer'), 'viewer', '  MEMORY    basics ');
    expect(retry).toEqual({ id: first.id, name: 'Memory Basics', created: false });
    expect((await getDoc(doc(db, 'categories', first.id))).data()).toEqual(before);
  });
  it('refuses category create, get, and list by anonymous or authenticated identities without a member profile', async () => {
    await trusted(db => setDoc(doc(db, 'categories', 'existing'), { name: 'Existing', status: 'active', createdBy: 'admin', createdAt: Timestamp.fromMillis(1) }));
    for (const db of [anonymous(), client('unregistered')]) {
      await assertFails(setDoc(doc(db, 'categories', 'new category'), categoryData('New Category', 'unregistered')));
      await assertFails(getDoc(doc(db, 'categories', 'existing')));
      await assertFails(getDocs(collection(db, 'categories')));
    }
  });
  it('rejects spoofed creators, nonactive status, client timestamps, and extra category fields', async () => {
    const db = client('member');
    for (const mutate of [
      (data: Record<string, unknown>) => { data.createdBy = 'admin'; },
      (data: Record<string, unknown>) => { data.status = 'migrating'; },
      (data: Record<string, unknown>) => { data.createdAt = Timestamp.fromMillis(1); },
      (data: Record<string, unknown>) => { data.normalizedName = 'forged'; },
    ]) {
      const data: Record<string, unknown> = categoryData('Brain Data'); mutate(data);
      await assertFails(setDoc(doc(db, 'categories', 'brain data'), data));
    }
  });
  it('rejects a nonlowercase or mismatching category document ID', async () => {
    const db = client('member');
    await assertFails(setDoc(doc(db, 'categories', 'Brain Data'), categoryData('Brain Data')));
    await assertFails(setDoc(doc(db, 'categories', 'unrelated name'), categoryData('Brain Data')));
    await assertSucceeds(setDoc(doc(db, 'categories', '分类 a'), categoryData('分类 A')));
    expect((await getDoc(doc(client('viewer'), 'categories', '分类 a'))).get('name')).toBe('分类 A');
  });
  it('rejects noncanonical whitespace even when the document ID matches the malformed lowercase name', async () => {
    for (const name of [' Brain', 'Brain ', 'Brain  Data', 'Brain\tData', 'Brain\nData', 'Brain\u00a0Data', 'Brain\u2003Data']) {
      await assertFails(setDoc(doc(client('member'), 'categories', name.toLowerCase()), categoryData(name)));
    }
  });
  it('rejects empty, oversized, reserved dot, slash, and backslash category names', async () => {
    const db = client('member');
    for (const name of ['', ' ', 'x'.repeat(61), '.', '..', 'Bad/Name', 'Bad\\Name']) {
      // Path separators/reserved names use a safe forged ID so the request reaches security rules.
      const id = name.includes('/') || name === '' || name === '.' || name === '..' ? `invalid-${randomUUID()}` : name.toLowerCase();
      await assertFails(setDoc(doc(db, 'categories', id), categoryData(name)));
    }
  });
  it('rejects category overwrites and deletes by members and administrators at this stage', async () => {
    const creator = client('member');
    await assertSucceeds(setDoc(doc(creator, 'categories', 'brain data'), categoryData('Brain Data')));
    for (const uid of ['member', 'admin']) {
      const target = doc(client(uid), 'categories', 'brain data');
      await assertFails(setDoc(target, categoryData('BRAIN DATA', uid)));
      await assertFails(deleteDoc(target));
    }
    expect((await getDoc(doc(creator, 'categories', 'brain data'))).get('name')).toBe('Brain Data');
  });
});
