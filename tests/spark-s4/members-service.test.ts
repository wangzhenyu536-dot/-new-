import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment, type RulesTestContext } from '@firebase/rules-unit-testing';
import { collection, doc, getDocFromServer, getDocsFromServer, setDoc, type Firestore } from 'firebase/firestore';
import type { RoleChangeInput } from '@evertrace/shared';
import { seedS1 } from '../spark-s1/fixtures';
import { setSparkMemberRole } from '../../apps/web/src/services/spark-members';

let env: RulesTestEnvironment;
const modular = (context: RulesTestContext) => (context.firestore() as unknown as { _delegate: Firestore })._delegate;
const client = (uid: string) => modular(env.authenticatedContext(uid, { email: `${uid}@example.test` }));
const trusted = async <T>(action: (db: Firestore) => Promise<T>): Promise<T> => {
  let result!: T; await env.withSecurityRulesDisabled(async context => { result = await action(modular(context)); }); return result;
};
const promote = (uid = 'member', operationId = randomUUID()): RoleChangeInput => ({ uid, role: 'admin', expectedRole: 'member', operationId });
const demote = (uid = 'admin', operationId = randomUUID()): RoleChangeInput => ({ uid, role: 'member', expectedRole: 'admin', operationId });
async function state() {
  return trusted(async db => ({ profiles: (await getDocsFromServer(collection(db, 'users'))).docs.map(saved => [saved.id, saved.data()]), roles: (await getDocFromServer(doc(db, 'system', 'roles'))).data(), receipts: (await getDocsFromServer(collection(db, 'roleOps'))).docs.map(saved => [saved.id, saved.data()]) }));
}
beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:28090') throw new Error('S4 member adapter tests require isolated Firestore 28090.');
  env = await initializeTestEnvironment({ projectId: 'demo-evertrace-spark-test', firestore: { host: '127.0.0.1', port: 28090, rules: readFileSync('firebase/spark.rules', 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); await trusted(db => seedS1(db)); });
afterAll(async () => { await env?.clearFirestore(); await env?.cleanup(); });

it('the real Spark adapter atomically promotes a member, preserves profile identity, and creates its exact role receipt', async () => {
  const input = promote(), before = await state(), result = await setSparkMemberRole(client('admin'), 'admin', input);
  expect(result).toEqual({ uid: 'member', role: 'admin', changed: true, adminCount: 2 });
  const saved = await state(); expect(saved.roles).toMatchObject({ adminCount: 2, revision: 1, changedUid: 'member', fromRole: 'member', toRole: 'admin', operationId: input.operationId });
  expect(saved.receipts).toEqual([[input.operationId, { uid: 'member', actorId: 'admin', fromRole: 'member', toRole: 'admin', revision: 1 }]]);
  expect(saved.profiles.map(([uid, data]) => [uid, uid === 'member' ? { ...(data as object), role: 'member' } : data])).toEqual(before.profiles);
});
it('an administrator demotes another administrator while keeping an exact positive count', async () => {
  await trusted(db => seedS1(db, 2)); const result = await setSparkMemberRole(client('admin'), 'admin', demote('admin2'));
  expect(result).toEqual({ uid: 'admin2', role: 'member', changed: true, adminCount: 1 }); expect((await state()).roles).toMatchObject({ adminCount: 1, revision: 1 });
});
it('an identical request replay confirms its receipt without another role write or revision', async () => {
  const input = promote(), db = client('admin'); await setSparkMemberRole(db, 'admin', input); const before = await state();
  expect(await setSparkMemberRole(db, 'admin', input)).toEqual({ uid: 'member', role: 'admin', changed: false, adminCount: 2 }); expect(await state()).toEqual(before);
});
it.each(['uid', 'role', 'expectedRole', 'actorId'] as const)('a reused receipt refuses changed %s rather than silently reporting a different request as done', async field => {
  await trusted(db => seedS1(db, 2)); const input = promote(); await setSparkMemberRole(client('admin'), 'admin', input); const before = await state();
  const changed = field === 'uid' ? { ...input, uid: 'viewer' } : field === 'role' ? { ...input, role: 'member' as const } : field === 'expectedRole' ? { ...input, expectedRole: 'admin' as const } : input;
  await expect(setSparkMemberRole(client(field === 'actorId' ? 'admin2' : 'admin'), field === 'actorId' ? 'admin2' : 'admin', changed)).rejects.toMatchObject({ code: 'requestChanged' }); expect(await state()).toEqual(before);
});
it('a newly selected operation refuses a stale expected role and keeps the saved profile and counter', async () => {
  await setSparkMemberRole(client('admin'), 'admin', promote()); const before = await state();
  await expect(setSparkMemberRole(client('admin'), 'admin', promote())).rejects.toMatchObject({ code: 'roleChanged' }); expect(await state()).toEqual(before);
});
it('the final administrator cannot demote themselves even when bypassing UI controls', async () => {
  const before = await state(); await expect(setSparkMemberRole(client('admin'), 'admin', demote())).rejects.toMatchObject({ code: 'lastAdminRequired' }); expect(await state()).toEqual(before);
});
it.each(['member', 'viewer', 'anonymous'])('%s has no authority to create administrator roles or role receipts', async uid => {
  const before = await state(), db = uid === 'anonymous' ? modular(env.unauthenticatedContext()) : client(uid);
  await expect(setSparkMemberRole(db, uid === 'anonymous' ? 'member' : uid, promote(uid === 'viewer' ? 'member' : uid))).rejects.toMatchObject({ code: 'forbidden' }); expect(await state()).toEqual(before);
});
it('a forged administrator actor argument cannot change a role under another authenticated identity', async () => {
  await trusted(db => seedS1(db, 2)); const before = await state();
  await expect(setSparkMemberRole(client('admin'), 'admin2', promote())).rejects.toMatchObject({ code: 'forbidden' }); expect(await state()).toEqual(before);
});
it('a missing or malformed member is reported without partial role state', async () => {
  for (const uid of ['missing', 'viewer']) {
    if (uid === 'viewer') await trusted(db => setDoc(doc(db, 'users', uid), { role: 'unknown' }, { merge: true }));
    const before = await state(); await expect(setSparkMemberRole(client('admin'), 'admin', promote(uid))).rejects.toMatchObject({ code: 'memberUnavailable' }); expect(await state()).toEqual(before);
  }
});
it('invalid identifiers, role names and no-change requests are rejected before role writes', async () => {
  const before = await state(), invalid = [{ ...promote(), uid: '../member' }, { ...promote(), operationId: 'bad/id' }, { ...promote(), role: 'owner' }, { ...promote(), role: 'member' }, { ...promote(), expectedRole: 'unknown' }];
  for (const input of invalid) await expect(setSparkMemberRole(client('admin'), 'admin', input as RoleChangeInput)).rejects.toMatchObject({ code: 'invalid' }); expect(await state()).toEqual(before);
});
it('an unavailable trusted counter fails closed without trying to repair it from client writes', async () => {
  await trusted(db => setDoc(doc(db, 'system', 'roles'), { adminCount: 0, revision: 0, changedUid: '', fromRole: 'member', toRole: 'member', operationId: '' }));
  const before = await state(); await expect(setSparkMemberRole(client('admin'), 'admin', promote())).rejects.toMatchObject({ code: 'roleStateUnavailable' }); expect(await state()).toEqual(before);
});
it.each([false, true])('concurrent %s cross demotions serialize through the trusted counter and leave one actual administrator', async cross => {
  await trusted(db => seedS1(db, 2)); const results = await Promise.allSettled([setSparkMemberRole(client('admin'), 'admin', demote(cross ? 'admin2' : 'admin')), setSparkMemberRole(client('admin2'), 'admin2', demote(cross ? 'admin' : 'admin2'))]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
  const saved = await state(); expect(saved.profiles.filter(([, data]) => (data as { role: string }).role === 'admin')).toHaveLength(1); expect(saved.roles).toMatchObject({ adminCount: 1, revision: 1 }); expect(saved.receipts).toHaveLength(1);
});
it('self-demotion can be confirmed using its own receipt after access becomes member-only', async () => {
  await trusted(db => seedS1(db, 2)); const input = demote(), db = client('admin');
  expect(await setSparkMemberRole(db, 'admin', input)).toMatchObject({ role: 'member', changed: true, adminCount: 1 }); const before = await state();
  expect(await setSparkMemberRole(db, 'admin', input)).toEqual({ uid: 'admin', role: 'member', changed: false, adminCount: 1 }); expect(await state()).toEqual(before);
  await expect(setSparkMemberRole(db, 'admin', promote('viewer'))).rejects.toMatchObject({ code: 'forbidden' });
});
it('two identical simultaneous requests commit one receipt and only one revision', async () => {
  const input = promote(), results = await Promise.all([setSparkMemberRole(client('admin'), 'admin', input), setSparkMemberRole(client('admin'), 'admin', input)]);
  expect(results.map(result => result.changed).sort()).toEqual([false, true]); const saved = await state(); expect(saved.roles).toMatchObject({ adminCount: 2, revision: 1 }); expect(saved.receipts).toHaveLength(1);
});
