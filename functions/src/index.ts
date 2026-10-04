import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
initializeApp();
export const ensureProfile = onCall({ region: 'us-central1' }, async request => {
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
