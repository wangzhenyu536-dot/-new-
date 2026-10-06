// Loaded only by the retained legacy preview. Spark uses Auth and Firestore exclusively.
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { app } from './firebase';
import { settings } from './environment';
if (settings.backend !== 'legacy') throw new Error('Legacy services are unavailable in Spark.');
export const functions = getFunctions(app, settings.region);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 8000;
storage.maxOperationRetryTime = 8000;
if (settings.local) {
  connectFunctionsEmulator(functions, '127.0.0.1', settings.ports.functions);
  connectStorageEmulator(storage, '127.0.0.1', settings.ports.storage);
}
export { auth, db, isLocal } from './firebase';
