import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { settings, isLocal as local } from './environment';
export const app = initializeApp(settings.config);
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getFirestore(app);
if (local) {
  connectAuthEmulator(auth, `http://127.0.0.1:${settings.ports.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', settings.ports.firestore);
}
export const isLocal = local;
