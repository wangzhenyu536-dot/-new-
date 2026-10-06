import { randomUUID } from 'node:crypto';
import { doc, getDoc, runTransaction, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';

export const S1_PROJECT = 'demo-evertrace-spark-test';
export const S1_FIRESTORE_PORT = 28090;
export type Role = 'member' | 'admin';
export const profile = (uid: string, role: Role = 'member') => ({ uid, email: `${uid}@example.test`, displayName: `Spark ${uid}`, role });

export async function seedS1(db: Firestore, administrators = 1): Promise<void> {
  const batch = writeBatch(db);
  for (const uid of ['member', 'viewer', 'admin', 'admin2']) batch.set(doc(db, 'users', uid),
    profile(uid, uid === 'admin' || (uid === 'admin2' && administrators === 2) ? 'admin' : 'member'));
  batch.set(doc(db, 'system', 'roles'), { adminCount: administrators, revision: 0,
    changedUid: '', fromRole: 'member', toRole: 'member', operationId: '' });
  await batch.commit();
}

// These builders exercise the real SDK and rules. They are test fixtures, not the app's future data adapter.
export async function initializeOwnMember(db: Firestore, uid: string, displayName = `Spark ${uid}`) {
  const target = doc(db, 'users', uid);
  return runTransaction(db, async transaction => {
    const existing = await transaction.get(target);
    if (existing.exists()) return existing.data();
    const data = { ...profile(uid), displayName };
    transaction.set(target, data); return data;
  });
}
export function canonicalCategory(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}
export async function createCategoryTransaction(db: Firestore, uid: string, raw: string) {
  const name = canonicalCategory(raw), id = name.toLowerCase(), target = doc(db, 'categories', id);
  return runTransaction(db, async transaction => {
    const existing = await transaction.get(target);
    if (existing.exists()) {
      if (existing.get('status') !== 'active') throw new Error('Category unavailable');
      return { id, name: existing.get('name') as string, created: false };
    }
    transaction.set(target, { name, status: 'active', createdBy: uid, createdAt: serverTimestamp() });
    return { id, name, created: true };
  });
}

export async function roleTransaction(db: Firestore, actorId: string, uid: string, toRole: Role,
  operationId: string = randomUUID()) {
  return runTransaction(db, async transaction => {
    const rolesRef = doc(db, 'system', 'roles'), targetRef = doc(db, 'users', uid), receiptRef = doc(db, 'roleOps', operationId);
    const [roles, user, receipt] = await Promise.all([
      transaction.get(rolesRef), transaction.get(targetRef), transaction.get(receiptRef),
    ]);
    if (receipt.exists()) return receipt.data();
    const fromRole = user.get('role') as Role;
    const adminCount = (roles.get('adminCount') as number) + (toRole === 'admin' ? 1 : -1);
    const revision = (roles.get('revision') as number) + 1;
    const result = { uid, actorId, fromRole, toRole, revision };
    transaction.update(targetRef, { role: toRole });
    transaction.set(rolesRef, { adminCount, revision, changedUid: uid, fromRole, toRole, operationId });
    transaction.set(receiptRef, result); return result;
  });
}
export async function readRole(db: Firestore, uid: string): Promise<Role> {
  return (await getDoc(doc(db, 'users', uid))).get('role') as Role;
}
