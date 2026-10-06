import { readFileSync } from 'node:fs';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { cloudSettings } from './cloud-config.mjs';
import { bootstrapAdmin } from './bootstrap-admin.mjs';
const [projectId, email] = process.argv.slice(2);
let app;
try {
  if (!email || !email.includes('@')) throw new Error('Usage: npm run cloud:admin -- PROJECT_ID REGISTERED_EMAIL');
  if (Object.keys(process.env).some(key => key.endsWith('_EMULATOR_HOST') && process.env[key])) throw new Error('Cloud administration cannot run with emulator variables.');
  cloudSettings(readFileSync('.env.cloud.local', 'utf8'), projectId);
  app = initializeApp({ projectId, credential: applicationDefault() });
  const account = await getAuth(app).getUserByEmail(email);
  if (account.disabled) throw new Error('Account is disabled.');
  console.log(await bootstrapAdmin(getFirestore(app), account.uid));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (app) await deleteApp(app); }
