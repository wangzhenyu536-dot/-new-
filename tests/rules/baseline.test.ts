import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, getBytes, uploadBytes } from 'firebase/storage';
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-evertrace',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firebase/firestore.rules', 'utf8') },
    storage: { host: '127.0.0.1', port: 9199, rules: readFileSync('firebase/storage.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'packs/baseline'), { title: 'Synthetic test only', status: 'ready' });
    await uploadBytes(ref(context.storage(), 'packs/baseline/files/test.txt'), new TextEncoder().encode('Synthetic only'));
  });
});
afterAll(async () => { if (env) { await env.clearFirestore(); await env.clearStorage(); await env.cleanup(); } });
describe('R0: business access is closed before authentication features exist', () => {
  it('rejects anonymous pack reads', async () => { await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'packs/baseline'))); });
  it('rejects anonymous pack writes', async () => { await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'packs/injected'), { ownerId: 'fake' })); });
  it('rejects anonymous original-file downloads', async () => { await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), 'packs/baseline/files/test.txt'))); });
  it('rejects anonymous file uploads', async () => { await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), 'staging/fake/a/test.txt'), new Uint8Array([1]))); });
  it('rejects member role self-assignment', async () => { await assertFails(setDoc(doc(env.authenticatedContext('member').firestore(), 'users/member'), { role: 'admin' })); });
  it('rejects authenticated direct business writes', async () => { await assertFails(setDoc(doc(env.authenticatedContext('member').firestore(), 'packs/injected'), { status: 'ready' })); });
});
