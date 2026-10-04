import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { readFirebaseConfig } from '@evertrace/shared';
const settings = readFirebaseConfig(import.meta.env);
const app = initializeApp(settings.config);
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getFirestore(app);
export const functions = getFunctions(app, settings.region);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 8000;
storage.maxOperationRetryTime = 8000;
if (settings.local) {
  connectAuthEmulator(auth, `http://127.0.0.1:${settings.ports.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', settings.ports.firestore);
  connectFunctionsEmulator(functions, '127.0.0.1', settings.ports.functions);
  connectStorageEmulator(storage, '127.0.0.1', settings.ports.storage);
}
export const isLocal = settings.local;
