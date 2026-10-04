import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { bootstrapAdmin } from './bootstrap-admin.mjs';
// R1 only authorizes local initialization; production administration is not configured.
const projectId = 'demo-evertrace';
process.env.METADATA_SERVER_DETECTION = 'none';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const email = process.argv[2];
if (!email) { console.error('Usage: npm run admin:init -- registered-email'); process.exit(1); }
const app = initializeApp({ projectId });
try { const account = await getAuth(app).getUserByEmail(email); console.log(await bootstrapAdmin(getFirestore(app), account.uid)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await deleteApp(app); }
