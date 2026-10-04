import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { writeFileSync, mkdirSync } from 'node:fs';
import { bootstrapAdmin } from './bootstrap-admin.mjs';
const projectId = 'demo-evertrace';
process.env.METADATA_SERVER_DETECTION = 'none';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const trusted = initializeAdmin({ projectId }), service = getAdminAuth(trusted);
const accounts = [{ email: 'member@evertrace.test', role: 'member' }, { email: 'admin@evertrace.test', role: 'admin' }, { email: 'viewer@evertrace.test', role: 'member' }];
const password = 'EvertraceDemo2026!';
try {
  for (const account of accounts) {
    let user;
    try { user = await service.getUserByEmail(account.email); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; user = await service.createUser({ email: account.email, password }); }
    const app = initializeApp({ projectId, apiKey: 'local-emulator-key' }, account.role);
    try {
      const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      const functions = getFunctions(app, 'us-central1'); connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      await signInWithEmailAndPassword(auth, account.email, password);
      await httpsCallable(functions, 'ensureProfile')({ displayName: 'Preview ' + account.role });
      if (account.role === 'admin') await bootstrapAdmin(getFirestore(trusted), user.uid);
    } finally { await deleteApp(app); }
  }
  mkdirSync('outputs/R1', { recursive: true });
  writeFileSync('outputs/R1/preview-accounts.json', JSON.stringify({ projectId, accounts, password }, null, 2));
  console.log('Local synthetic preview accounts prepared. Details: outputs/R1/preview-accounts.json');
} finally { await deleteAdmin(trusted); }
