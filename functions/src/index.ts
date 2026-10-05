import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { normalizeCategory, readFunctionsRegion } from '@evertrace/shared';
const region = readFunctionsRegion(process.env);
initializeApp();
export const ensureProfile = onCall({ region }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to initialize your profile.');
  const data = request.data as Record<string, unknown> | null;
  const name = data?.displayName;
  if (name !== undefined && (typeof name !== 'string' || name.trim().length > 80)) throw new HttpsError('invalid-argument', 'Name must be at most 80 characters.');
  // Identity and role come from trusted services, never the request payload.
  const user = await getAuth().getUser(request.auth.uid);
  if (!user.email || user.disabled) throw new HttpsError('permission-denied', 'This account is unavailable.');
  const db = getFirestore(), profile = db.doc(`users/${user.uid}`);
  await db.runTransaction(async tx => {
    const saved = await tx.get(profile);
    if (saved.exists) {
      if (!['member', 'admin'].includes(saved.get('role'))) throw new HttpsError('failed-precondition', 'Profile role is invalid.');
      const updates: Record<string, unknown> = {};
      if (saved.get('email') !== user.email) updates.email = user.email;
      if (typeof name === 'string' && saved.get('displayName') !== name.trim()) updates.displayName = name.trim();
      if (Object.keys(updates).length) tx.update(profile, { ...updates, updatedAt: FieldValue.serverTimestamp() });
    } else {
      tx.create(profile, { uid: user.uid, email: user.email, displayName: typeof name === 'string' ? name.trim() : (user.displayName ?? ''), role: 'member', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
  });
  return { uid: user.uid };
});

export const createCategory = onCall({ region }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to create a category.');
  const data = request.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || 'parentId' in data || 'categoryIds' in data) throw new HttpsError('invalid-argument', 'Categories have one level and one name.');
  let normalized: { name: string; normalizedName: string };
  try { normalized = normalizeCategory(data.name); } catch { throw new HttpsError('invalid-argument', 'Invalid category name.'); }
  const account = await getAuth().getUser(request.auth.uid);
  if (account.disabled) throw new HttpsError('permission-denied', 'Account unavailable.');
  const db = getFirestore(), member = db.doc(`users/${request.auth.uid}`);
  const key = createHash('sha256').update(normalized.normalizedName).digest('hex');
  const index = db.doc(`categoryNames/${key}`), category = db.collection('categories').doc();
  return db.runTransaction(async tx => {
    const [profile, existing] = await Promise.all([tx.get(member), tx.get(index)]);
    if (!profile.exists || !['member', 'admin'].includes(profile.get('role'))) throw new HttpsError('permission-denied', 'A member profile is required.');
    if (existing.exists) {
      const saved = await tx.get(db.doc(`categories/${existing.get('categoryId')}`));
      if (!saved.exists || saved.get('status') !== 'active') throw new HttpsError('failed-precondition', 'Category is temporarily unavailable.');
      return { id: saved.id, name: saved.get('name') as string, created: false };
    }
    tx.create(category, { ...normalized, status: 'active', createdBy: account.uid, packCount: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.create(index, { categoryId: category.id, normalizedName: normalized.normalizedName });
    return { id: category.id, name: normalized.name, created: true };
  });
});

export { beginUpload, savePack, cancelUpload, cleanupUploads } from './uploads.js';

export { deletePack, deleteCategory, renameCategory, retryCleanup } from './management.js';
