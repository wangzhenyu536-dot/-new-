import type { User } from 'firebase/auth';
import { auth, db } from './firebase';
import { isSpark } from './environment';
export { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
export { doc, onSnapshot } from 'firebase/firestore';
export { auth, db };
export async function ensureAccount(user: User, displayName?: string): Promise<void> {
  if (isSpark) {
    const { ensureSparkAccount } = await import('../services/spark-account');
    await ensureSparkAccount(db, user, displayName);
  } else {
    const [{ httpsCallable }, { functions }] = await Promise.all([import('firebase/functions'), import('./legacy-firebase')]);
    await httpsCallable(functions, 'ensureProfile')(displayName === undefined ? {} : { displayName });
  }
}
