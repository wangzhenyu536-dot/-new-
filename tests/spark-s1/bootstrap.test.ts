import { afterAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'demo-evertrace-spark-test';
const emulatorHost = '127.0.0.1:28090';
if (process.env.FIRESTORE_EMULATOR_HOST !== emulatorHost) throw new Error('Spark bootstrap tests require the isolated Firestore emulator.');
const app = initializeApp({ projectId }, 'spark-s1-bootstrap-' + randomUUID());
const db = getFirestore(app);
const implementation = process.env.SPARK_S1_BOOTSTRAP_RED === '1' ? '../../scripts/bootstrap-admin.mjs' : '../../scripts/bootstrap-spark-admin.mjs';
const imported = await import(implementation);
const bootstrap = process.env.SPARK_S1_BOOTSTRAP_RED === '1' ? imported.bootstrapAdmin : imported.bootstrapSparkAdmin;
const initialRoles = { adminCount: 1, revision: 0, changedUid: '', fromRole: 'member', toRole: 'member', operationId: '' };
const member = (uid: string, role = 'member') => ({ uid, email: uid + '@example.test', displayName: 'Spark ' + uid, role });
async function seed(uid: string, role = 'member') { await db.doc('users/' + uid).set(member(uid, role)); }
async function clean() {
  if (app.options.projectId !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== emulatorHost) throw new Error('Refusing cleanup outside the isolated Spark project.');
  for (const name of ['users', 'system', 'roleOps']) await db.recursiveDelete(db.collection(name));
}
beforeEach(clean);
afterAll(async () => { await clean(); await deleteApp(app); });

// During the red stage these assertions run against the real legacy Admin operation.
// They establish a schema mismatch, not a missing-module or missing-emulator failure.
test('bootstrap Spark creates the exact role state for the first registered member', async () => {
  await seed('first');
  expect(await bootstrap(db, 'first')).toMatchObject({ uid: 'first', role: 'admin', changed: true });
  expect((await db.doc('system/roles').get()).data()).toEqual(initialRoles);
  expect((await db.doc('system/team').get()).exists).toBe(false);
  expect((await db.collection('users').where('role', '==', 'admin').get()).size).toBe(1);
});
test('bootstrap Spark preserves the four-field profile without adding legacy timestamps', async () => {
  await seed('first');
  await bootstrap(db, 'first');
  expect((await db.doc('users/first').get()).data()).toEqual(member('first', 'admin'));
});
test('bootstrap Spark is idempotent and preserves later revision and receipts', async () => {
  await seed('first', 'admin');
  const laterRoles = { ...initialRoles, revision: 7, changedUid: 'former-admin', fromRole: 'admin', toRole: 'member', operationId: 'completed-role-change' };
  const receipt = { actorUid: 'first', targetUid: 'former-admin', fromRole: 'admin', toRole: 'member', revision: 7 };
  await db.doc('system/roles').set(laterRoles);
  await db.doc('roleOps/completed-role-change').set(receipt);
  expect(await bootstrap(db, 'first')).toMatchObject({ uid: 'first', role: 'admin', changed: false });
  expect((await db.doc('system/roles').get()).data()).toEqual(laterRoles);
  expect((await db.doc('roleOps/completed-role-change').get()).data()).toEqual(receipt);
  expect((await db.doc('users/first').get()).data()).toEqual(member('first', 'admin'));
  expect((await db.doc('system/team').get()).exists).toBe(false);
});
test('bootstrap Spark refuses a second initialization', async () => {
  await seed('first', 'admin'); await seed('second');
  await db.doc('system/roles').set(initialRoles);
  await expect(bootstrap(db, 'second')).rejects.toThrow(/administrator already exists|already initialized/i);
  expect((await db.doc('users/second').get()).get('role')).toBe('member');
  expect((await db.doc('system/roles').get()).data()).toEqual(initialRoles);
});
test('bootstrap Spark refuses an administrator with missing role metadata instead of repairing it', async () => {
  await seed('first', 'admin');
  await expect(bootstrap(db, 'first')).rejects.toThrow(/role state|metadata|inconsistent/i);
  expect((await db.doc('system/roles').get()).exists).toBe(false);
  expect((await db.doc('system/team').get()).exists).toBe(false);
});
test('bootstrap Spark refuses existing zero-count metadata instead of reinitializing it', async () => {
  await seed('first');
  const zeroRoles = { ...initialRoles, adminCount: 0 };
  await db.doc('system/roles').set(zeroRoles);
  await expect(bootstrap(db, 'first')).rejects.toThrow(/already initialized|role state/i);
  expect((await db.doc('users/first').get()).get('role')).toBe('member');
  expect((await db.doc('system/roles').get()).data()).toEqual(zeroRoles);
});
test('bootstrap Spark rejects malformed registered profiles and does not delete extra fields', async () => {
  for (const profile of [
    { ...member('invalid'), uid: 'somebody-else' },
    { ...member('invalid'), email: 42 },
    { ...member('invalid'), displayName: null },
    { ...member('invalid'), role: 'owner' },
    { ...member('invalid'), legacyCreatedAt: 'preserve-for-explicit-migration' },
  ]) {
    await clean(); await db.doc('users/invalid').set(profile);
    await expect(bootstrap(db, 'invalid')).rejects.toThrow(/profile|role/i);
    expect((await db.doc('users/invalid').get()).data()).toEqual(profile);
    expect((await db.doc('system/roles').get()).exists).toBe(false);
  }
});
test('bootstrap Spark rejects invalid UID values before making changes', async () => {
  for (const uid of ['', 'bad/path', ' '.repeat(3), 'x'.repeat(129), undefined, null, 7, { uid: 'first' }]) {
    await expect(bootstrap(db, uid)).rejects.toThrow(/registered account UID/i);
  }
  expect((await db.collection('users').get()).empty).toBe(true);
  expect((await db.doc('system/roles').get()).exists).toBe(false);
});
test('bootstrap Spark rejects a nonexistent registered profile', async () => {
  await expect(bootstrap(db, 'missing')).rejects.toThrow(/register|registered|initialize/i);
  expect((await db.doc('system/roles').get()).exists).toBe(false);
});
test('bootstrap Spark rejects malformed role state without resetting count or revision', async () => {
  await seed('first', 'admin');
  for (const roles of [
    { ...initialRoles, adminCount: -1 },
    { ...initialRoles, adminCount: 1.5 },
    { ...initialRoles, revision: -1 },
    { ...initialRoles, revision: '0' },
    { ...initialRoles, fromRole: 'owner' },
    { ...initialRoles, changedUid: 9 },
    { ...initialRoles, operationId: null },
    { ...initialRoles, unexpected: true },
  ]) {
    await db.doc('system/roles').set(roles);
    await expect(bootstrap(db, 'first')).rejects.toThrow(/role state|metadata|inconsistent/i);
    expect((await db.doc('system/roles').get()).data()).toEqual(roles);
  }
});
test('bootstrap Spark rejects role count mismatches rather than blindly resetting the count', async () => {
  await seed('first', 'admin'); await seed('second', 'admin');
  await db.doc('system/roles').set(initialRoles);
  await expect(bootstrap(db, 'first')).rejects.toThrow(/count|inconsistent/i);
  expect((await db.doc('system/roles').get()).data()).toEqual(initialRoles);
  expect((await db.collection('users').where('role', '==', 'admin').get()).size).toBe(2);
});
test('bootstrap Spark concurrent first-member initialization promotes at most one account', async () => {
  await seed('first'); await seed('second');
  const outcomes = await Promise.allSettled([bootstrap(db, 'first'), bootstrap(db, 'second')]);
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
  expect((await db.collection('users').where('role', '==', 'admin').get()).size).toBe(1);
  expect((await db.doc('system/roles').get()).data()).toEqual(initialRoles);
  expect((await db.doc('system/team').get()).exists).toBe(false);
});

const cliPath = fileURLToPath(new URL('../../scripts/spark-admin.mjs', import.meta.url));
async function cli(args: string[], changes: Record<string, string | undefined> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, FIRESTORE_EMULATOR_HOST: emulatorHost, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099', METADATA_SERVER_DETECTION: 'none', ...changes };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }));
  });
}
test('Spark administrator CLI refuses missing local emulator hosts and non-demo projects before connecting', async () => {
  for (const [project, changes] of [
    ['wisdom-a9e09', {}],
    ['demo-evertrace-spark-test', { FIRESTORE_EMULATOR_HOST: undefined }],
    ['demo-evertrace-spark-test', { FIREBASE_AUTH_EMULATOR_HOST: undefined }],
    ['demo-evertrace-spark-test', { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }],
    ['demo-evertrace-spark-test', { FIREBASE_AUTH_EMULATOR_HOST: 'accounts.example.test:443' }],
    ['demo-evertrace-spark-test', { FIRESTORE_EMULATOR_HOST: '127.0.0.1.evil.test:28090' }],
    ['demo-evertrace-spark-test', { FIRESTORE_EMULATOR_HOST: 'http://127.0.0.1:28090' }],
  ] as [string, Record<string, string | undefined>][]) {
    const result = await cli([project, 'first@example.test'], changes);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/local|loopback|emulator|demo/i);
    expect(result.stderr).not.toMatch(/MODULE_NOT_FOUND|timeout|ENOTFOUND|ECONNREFUSED/);
  }
  expect((await db.doc('system/roles').get()).exists).toBe(false);
});
test('Spark administrator CLI resolves a registered local account and initializes the exact Spark role state', async () => {
  const uid = 'spark-cli-' + randomUUID(), email = uid + '@example.test';
  await getAuth(app).createUser({ uid, email, password: 'Spark-test-2026!' });
  try {
    await db.doc('users/' + uid).set({ uid, email, displayName: 'CLI member', role: 'member' });
    const result = await cli([projectId, email]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(uid);
    expect((await db.doc('system/roles').get()).data()).toEqual(initialRoles);
    expect((await db.doc('users/' + uid).get()).data()).toEqual({ uid, email, displayName: 'CLI member', role: 'admin' });
  } finally { await getAuth(app).deleteUser(uid); }
});
test('Spark administrator CLI rejects disabled accounts without changing their profile', async () => {
  const uid = 'spark-disabled-' + randomUUID(), email = uid + '@example.test';
  await getAuth(app).createUser({ uid, email, password: 'Spark-test-2026!', disabled: true });
  try {
    await db.doc('users/' + uid).set({ uid, email, displayName: 'Disabled member', role: 'member' });
    const result = await cli([projectId, email]);
    expect(result.code).toBe(1); expect(result.stderr).toMatch(/disabled/i);
    expect((await db.doc('users/' + uid).get()).get('role')).toBe('member');
    expect((await db.doc('system/roles').get()).exists).toBe(false);
  } finally { await getAuth(app).deleteUser(uid); }
});
