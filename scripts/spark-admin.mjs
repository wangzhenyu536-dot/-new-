import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { bootstrapSparkAdmin } from './bootstrap-spark-admin.mjs';

function requireLoopbackHost(value, name) {
  if (typeof value !== 'string') throw new Error(`${name} is required for local Spark administration.`);
  const match = /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new Error(`${name} must point to a loopback emulator host and port.`);
}
let app;
try {
  const [projectId, email, ...extra] = process.argv.slice(2);
  if (!/^demo-evertrace-spark(?:-[a-z0-9-]+)?$/.test(projectId || '')) throw new Error('Only an explicit demo-evertrace-spark local project is permitted. Cloud administration is not enabled in S1.');
  requireLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST, 'FIRESTORE_EMULATOR_HOST');
  requireLoopbackHost(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'FIREBASE_AUTH_EMULATOR_HOST');
  if (extra.length || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Usage: node scripts/spark-admin.mjs DEMO_SPARK_PROJECT REGISTERED_EMAIL');
  process.env.METADATA_SERVER_DETECTION = 'none';
  app = initializeApp({ projectId });
  const account = await getAuth(app).getUserByEmail(email);
  if (account.disabled) throw new Error('The registered account is disabled.');
  const db = getFirestore(app), profile = await db.doc(`users/${account.uid}`).get();
  if (!profile.exists || profile.get('email') !== account.email) throw new Error('The registered account must have a matching initialized Spark profile.');
  console.log(await bootstrapSparkAdmin(db, account.uid));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (app) await deleteApp(app); }
