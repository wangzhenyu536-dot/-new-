import { describe, expect, it } from 'vitest';
import { readFirebaseConfig } from '../../packages/shared/src/firebase-config';
describe('central Firebase backend selection', () => {
 it('preserves the existing preview by default',()=>expect(readFirebaseConfig({})).toMatchObject({backend:'legacy',local:true,config:{projectId:'demo-evertrace'}}));
 it('Spark local defaults are isolated from the original preview',()=>expect(readFirebaseConfig({VITE_DATA_BACKEND:'spark'})).toMatchObject({config:{projectId:'demo-evertrace-spark'},ports:{auth:29199,firestore:28190}}));
 it('selects Spark and its explicitly configured isolated ports',()=>expect(readFirebaseConfig({VITE_DATA_BACKEND:'spark',VITE_FIREBASE_PROJECT_ID:'demo-evertrace-spark-test',VITE_AUTH_EMULATOR_PORT:'29099',VITE_FIRESTORE_EMULATOR_PORT:'28090'})).toMatchObject({backend:'spark',ports:{auth:29099,firestore:28090}}));
 it('rejects an unknown backend instead of silently selecting legacy',()=>expect(()=>readFirebaseConfig({VITE_DATA_BACKEND:'typo'})).toThrow('backend'));
 it('Spark cloud config does not require Storage',()=>expect(()=>readFirebaseConfig({VITE_DATA_BACKEND:'spark',VITE_USE_EMULATORS:'false',VITE_FIREBASE_PROJECT_ID:'example-cloud',VITE_FIREBASE_API_KEY:'example-key',VITE_FIREBASE_AUTH_DOMAIN:'example-cloud.firebaseapp.com',VITE_FIREBASE_APP_ID:'example-app'})).not.toThrow());
 it('keeps required cloud credentials and rejects real projects in emulator mode',()=>{expect(()=>readFirebaseConfig({VITE_DATA_BACKEND:'spark',VITE_USE_EMULATORS:'false'})).toThrow();expect(()=>readFirebaseConfig({VITE_DATA_BACKEND:'spark',VITE_FIREBASE_PROJECT_ID:'example-cloud'})).toThrow('localProject');});
});
