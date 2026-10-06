const profileFields = ['uid', 'email', 'displayName', 'role'];
const roleFields = ['adminCount', 'revision', 'changedUid', 'fromRole', 'toRole', 'operationId'];
const memberRole = value => value === 'member' || value === 'admin';
const boundedString = (value, maximum) => typeof value === 'string' && value.length >= 1 && value.length <= maximum;
const exactFields = (value, fields) => value && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
function validProfile(value, uid) {
  return exactFields(value, profileFields) && value.uid === uid && boundedString(value.uid, 128) && boundedString(value.email, 254) && boundedString(value.displayName, 120) && memberRole(value.role);
}
function validRoles(value) {
  return exactFields(value, roleFields) && Number.isSafeInteger(value.adminCount) && value.adminCount >= 0 && Number.isSafeInteger(value.revision) && value.revision >= 0 && typeof value.changedUid === 'string' && value.changedUid.length <= 128 && memberRole(value.fromRole) && memberRole(value.toRole) && typeof value.operationId === 'string' && value.operationId.length <= 128;
}
// Trusted operator-only transaction: never import this module into the browser.
// Existing role metadata is checked and preserved; this is not a repair or migration tool.
export async function bootstrapSparkAdmin(db, uid) {
  if (!boundedString(uid, 128) || uid.trim() !== uid || uid.length === 0 || uid.includes('/') || uid === '.' || uid === '..') throw new Error('A valid registered account UID is required.');
  const user = db.doc(`users/${uid}`), roles = db.doc('system/roles');
  return db.runTransaction(async transaction => {
    const [profile, metadata] = await Promise.all([transaction.get(user), transaction.get(roles)]);
    if (!profile.exists) throw new Error('Register and initialize the account before choosing the first administrator.');
    if (!validProfile(profile.data(), uid)) throw new Error('The registered member profile does not match the Spark schema. No fields were changed.');
    const administrators = await transaction.get(db.collection('users').where('role', '==', 'admin'));
    if (administrators.docs.some(document => !validProfile(document.data(), document.id))) throw new Error('An administrator profile is inconsistent with the Spark schema.');
    if (metadata.exists) {
      const state = metadata.data();
      if (!validRoles(state)) throw new Error('The existing role state metadata is invalid. Explicit investigation is required.');
      if (state.adminCount !== administrators.size) throw new Error('The administrator count is inconsistent with existing profiles. Explicit investigation is required.');
      if (profile.get('role') === 'admin') return { uid, role: 'admin', changed: false, adminCount: state.adminCount };
      throw new Error('The Spark role state is already initialized. Use member management for subsequent role changes.');
    }
    if (administrators.size !== 0) throw new Error('An administrator already exists, but role state metadata is missing. Explicit investigation is required.');
    transaction.update(user, { role: 'admin' });
    transaction.create(roles, { adminCount: 1, revision: 0, changedUid: '', fromRole: 'member', toRole: 'member', operationId: '' });
    return { uid, role: 'admin', changed: true, adminCount: 1 };
  });
}
