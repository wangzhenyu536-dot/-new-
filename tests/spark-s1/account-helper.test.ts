import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { ensureSparkAccount, validSparkProfile } from '../../apps/web/src/services/spark-account';
import { S1_PROJECT, S1_FIRESTORE_PORT } from './fixtures';

let env: RulesTestEnvironment;
const firestore = (context: RulesTestContext): Firestore => (context.firestore() as unknown as { _delegate: Firestore })._delegate;

beforeAll(async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${S1_FIRESTORE_PORT}`) throw new Error('S1 requires isolated Firestore 28090');
  const rules = process.env.SPARK_S1_RED === '1'
    ? new URL('../spark/deny-all.rules', import.meta.url) : new URL('../../firebase/spark.rules', import.meta.url);
  env = await initializeTestEnvironment({ projectId: S1_PROJECT,
    firestore: { host: '127.0.0.1', port: S1_FIRESTORE_PORT, rules: readFileSync(rules, 'utf8') } });
});
beforeEach(async () => { await env.clearFirestore(); });
afterAll(async () => { if (env) { await env.clearFirestore(); await env.cleanup(); } });

describe('S1 production account helper', () => {
  it.each([
    { length: 121, email: `${'a'.repeat(60)}@${'b'.repeat(52)}.example` },
    { length: 254, email: `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}` },
  ])('initializes a $length-character email without a name while preserving its full email', async ({ length, email }) => {
    expect(email).toHaveLength(length);
    const uid = `long-email-${length}`;
    const db = firestore(env.authenticatedContext(uid, { email }));
    await ensureSparkAccount(db, { uid, email, displayName: null });
    const stored = (await getDoc(doc(db, 'users', uid))).data();
    expect(stored).toMatchObject({ uid, email, role: 'member' });
    expect(validSparkProfile(stored, uid)).toBe(true);
    expect(stored?.displayName.length).toBeGreaterThan(0);
    expect(stored?.displayName.length).toBeLessThanOrEqual(120);
    // A repeated login must keep the accepted profile and the unabridged address.
    await ensureSparkAccount(db, { uid, email, displayName: null });
    expect((await getDoc(doc(db, 'users', uid))).data()).toEqual(stored);
  });
});
