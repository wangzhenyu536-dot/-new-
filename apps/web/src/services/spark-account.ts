import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
export type SparkProfile = {uid:string;email:string;displayName:string;role:'member'|'admin'};
export function validSparkProfile(value: unknown, uid: string): value is SparkProfile {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).sort().join(',') === 'displayName,email,role,uid' && data.uid === uid
    && typeof data.email === 'string' && data.email.length > 0 && data.email.length <= 254
    && typeof data.displayName === 'string' && data.displayName.length > 0 && data.displayName.length <= 120
    && ['member','admin'].includes(data.role as string);
}
export async function ensureSparkAccount(db: Firestore, user: Pick<User,'uid'|'email'|'displayName'>, desiredName?: string): Promise<void> {
  if (!user.email) throw new Error('accountProfile');
  const target = doc(db, 'users', user.uid);
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(target);
    if (existing.exists()) {
      if (!validSparkProfile(existing.data(), user.uid)) throw new Error('accountProfile');
      return;
    }
    // Preserve the full email; only bound the optional display-name fallback.
    const fallback = (user.displayName?.trim() || user.email!).slice(0, 120).replace(/[\uD800-\uDBFF]$/u, '');
    const displayName = desiredName?.trim() || fallback;
    const profile: SparkProfile = { uid: user.uid, email: user.email!, displayName, role: 'member' };
    if (!validSparkProfile(profile, user.uid)) throw new Error('accountProfile');
    transaction.set(target, profile);
  });
}
export function canonicalSparkCategory(value: string): {name:string;id:string} {
  const name = value.trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 60 || /[/\\\p{Cc}]/u.test(name) || name === '.' || name === '..') throw new Error('categoryInvalid');
  return {name, id:name.toLowerCase()};
}
export async function createSparkCategory(db: Firestore, uid: string, rawName: string): Promise<{id:string;name:string;created:boolean}> {
  const {name,id} = canonicalSparkCategory(rawName), target = doc(db, 'categories', id);
  return runTransaction(db, async transaction => {
    const existing = await transaction.get(target);
    if (existing.exists()) {
      if (existing.get('status') !== 'active') throw new Error('categoryUnavailable');
      return { id, name: existing.get('name') as string, created: false };
    }
    transaction.set(target, {name, status:'active', createdBy:uid, createdAt:serverTimestamp()});
    return {id,name,created:true};
  });
}
