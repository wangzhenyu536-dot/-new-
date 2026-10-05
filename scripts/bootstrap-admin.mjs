import { FieldValue } from 'firebase-admin/firestore';
// Server-only operation. Not exported as a callable and never bundled into the browser.
export async function bootstrapAdmin(db, uid) {
  if (!uid || uid.includes('/')) throw new Error('A registered account UID is required.');
  const user = db.doc(`users/${uid}`), team = db.doc('system/team');
  return db.runTransaction(async tx => {
    const [profile, metadata] = await Promise.all([tx.get(user), tx.get(team)]);
    if (!profile.exists) throw new Error('Register and initialize the account before choosing the first administrator.');
    const administrators = await tx.get(db.collection('users').where('role', '==', 'admin'));
    if (profile.get('role') === 'admin') { tx.set(team, { adminCount: administrators.size, schemaVersion: 1 }, { merge: true }); return { uid, role: 'admin', changed: false }; }
    if (profile.get('role') !== 'member') throw new Error('Invalid member role.');
    if (administrators.size !== 0 || (metadata.get('adminCount') ?? 0) !== 0) throw new Error('A first administrator already exists. Use member management for subsequent role changes.');
    tx.update(user, { role: 'admin', updatedAt: FieldValue.serverTimestamp() });
    tx.set(team, { adminCount: 1, schemaVersion: 1 }, { merge: true });
    return { uid, role: 'admin', changed: true };
  });
}
