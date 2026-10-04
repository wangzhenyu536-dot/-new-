import { afterAll, expect, test } from 'vitest';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, confirmPasswordReset } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { initializeApp as adminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app';
import { getFirestore as adminDb } from 'firebase-admin/firestore';
const projectId = 'demo-evertrace-test';
const trusted = adminApp({ projectId }, 'R1-tests');
const db = adminDb(trusted);
const apps: FirebaseApp[] = [];
function client() {
  const app = initializeApp({ projectId, apiKey: 'local-emulator-key', authDomain: `${projectId}.firebaseapp.com` }, `test-${Date.now()}-${Math.random()}`); apps.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:10099', { disableWarnings: true });
  const functions = getFunctions(app, 'us-central1'); connectFunctionsEmulator(functions, '127.0.0.1', 15001);
  const firestore = getFirestore(app); connectFirestoreEmulator(firestore, '127.0.0.1', 18080);
  return { auth, firestore, profile: httpsCallable(functions, 'ensureProfile') };
}
const email = () => `r1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
const password = 'Evertrace-test-2026!';
afterAll(async () => { await Promise.all(apps.map(deleteApp)); await deleteAdminApp(trusted); });
test('anonymous callers cannot initialize a profile', async () => { await expect(client().profile({})).rejects.toMatchObject({ code: 'functions/unauthenticated' }); });
test('registration creates member server-side, ignores forged identity/role, and is idempotent', async () => {
  const c = client(), address = email(); const user = (await createUserWithEmailAndPassword(c.auth, address, password)).user;
  await c.profile({ uid: 'attacker', email: 'forged@example.test', role: 'admin', displayName: 'Researcher' });
  const profile = (await getDoc(doc(c.firestore, 'users', user.uid))).data();
  expect(profile).toMatchObject({ uid: user.uid, email: address, role: 'member', displayName: 'Researcher' });
  expect(profile?.createdAt).toBeTruthy();
  await c.profile({}); const again = (await getDoc(doc(c.firestore, 'users', user.uid))).data();
  expect(again?.createdAt.isEqual(profile?.createdAt)).toBe(true);
  expect((await db.doc('users/attacker').get()).exists).toBe(false);
});
test('members can read their own profile but cannot list, read others, change roles or write packs', async () => {
  const c = client(), user = (await createUserWithEmailAndPassword(c.auth, email(), password)).user;
  await db.doc(`users/${user.uid}`).set({ uid: user.uid, role: 'member' });
  await expect(getDoc(doc(c.firestore, 'users', user.uid))).resolves.toMatchObject({ exists: expect.any(Function) });
  await expect(getDoc(doc(c.firestore, 'users', 'other'))).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(getDocs(collection(c.firestore, 'users'))).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(setDoc(doc(c.firestore, 'users', user.uid), { role: 'admin' })).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(setDoc(doc(c.firestore, 'packs', 'injected'), { ownerId: user.uid })).rejects.toMatchObject({ code: 'permission-denied' });
});
test('invalid profile names are rejected without a partial profile', async () => {
  const c = client(), user = (await createUserWithEmailAndPassword(c.auth, email(), password)).user;
  await expect(c.profile({ displayName: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'functions/invalid-argument' });
  expect((await db.doc(`users/${user.uid}`).get()).exists).toBe(false);
});
test('first admin bootstrap protects concurrent initialization and profile reinitialization preserves role', async () => {
  const path = '../../scripts/bootstrap-admin.mjs'; const { bootstrapAdmin } = await import(path);
  const a = client(), b = client();
  const ua = (await createUserWithEmailAndPassword(a.auth, email(), password)).user;
  const ub = (await createUserWithEmailAndPassword(b.auth, email(), password)).user;
  await Promise.all([a.profile({}), b.profile({})]);
  const results = await Promise.allSettled([bootstrapAdmin(db, ua.uid), bootstrapAdmin(db, ub.uid)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const profiles = await Promise.all([db.doc(`users/${ua.uid}`).get(), db.doc(`users/${ub.uid}`).get()]);
  const winner = profiles[0].get('role') === 'admin' ? a : b;
  expect(profiles.filter(p => p.get('role') === 'admin')).toHaveLength(1);
  await winner.profile({ role: 'member' });
  expect((await db.doc(`users/${winner.auth.currentUser!.uid}`).get()).get('role')).toBe('admin');
  await expect(bootstrapAdmin(db, winner.auth.currentUser!.uid)).resolves.toBeDefined();
});
test('password reset generates a real emulator code; new password works and old password fails', async () => {
  const c = client(), address = email(); await createUserWithEmailAndPassword(c.auth, address, password);
  await sendPasswordResetEmail(c.auth, address);
  const codes = await (await fetch(`http://127.0.0.1:10099/emulator/v1/projects/${projectId}/oobCodes`)).json() as { oobCodes: { email: string; oobCode: string; requestType: string }[] };
  const code = codes.oobCodes.find(x => x.email === address && x.requestType === 'PASSWORD_RESET'); expect(code).toBeDefined();
  await confirmPasswordReset(c.auth, code!.oobCode, 'New-Evertrace-2026!');
  await expect(signInWithEmailAndPassword(c.auth, address, password)).rejects.toBeTruthy();
  await expect(signInWithEmailAndPassword(c.auth, address, 'New-Evertrace-2026!')).resolves.toBeTruthy();
});
