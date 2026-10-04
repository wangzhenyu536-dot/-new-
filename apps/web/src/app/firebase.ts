import { initializeApp } from 'firebase/app';
import { browserSessionPersistence, connectAuthEmulator, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-evertrace';
const local = import.meta.env.VITE_USE_EMULATORS !== 'false';
if (local && !projectId.startsWith('demo-')) throw new Error('Local mode requires a demo project.');
const app = initializeApp({ projectId, apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'local-emulator-key', authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com` });
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
export const db = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');
if (local) {
  connectAuthEmulator(auth, `http://127.0.0.1:${import.meta.env.VITE_AUTH_EMULATOR_PORT || '9099'}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080));
  connectFunctionsEmulator(functions, '127.0.0.1', Number(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT || 5001));
}
export const isLocal = local;
