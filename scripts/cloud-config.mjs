import { parseEnv } from 'node:util';
import { readFirebaseConfig, readFunctionsRegion } from '../packages/shared/dist/firebase-config.js';
export function cloudSettings(text, expectedProject) {
  const env = parseEnv(text);
  if (env.VITE_USE_EMULATORS !== 'false') throw new Error('Cloud release requires VITE_USE_EMULATORS=false.');
  const settings = readFirebaseConfig(env);
  if (!expectedProject || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(expectedProject) || expectedProject.startsWith('demo-') || settings.config.projectId !== expectedProject) throw new Error('Explicit project ID must match the cloud configuration.');
  if (!env.FUNCTIONS_REGION || !env.VITE_FUNCTIONS_REGION || readFunctionsRegion(env) !== settings.region) throw new Error('Browser and server Functions regions must match.');
  const bucket = settings.config.storageBucket;
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(bucket)) throw new Error('Copy the exact bucket name from Firebase.');
  const origins = [...new Set([`https://${expectedProject}.web.app`, `https://${expectedProject}.firebaseapp.com`, ...(env.EVERTRACE_SITE_ORIGINS?.split(',').map(value => value.trim()) ?? [])])];
  for (const origin of origins) { const url = new URL(origin); if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || ['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Additional sites must be exact HTTPS origins, without paths or credentials.'); }
  return { env, projectId: expectedProject, region: settings.region, bucket, origins };
}
export function storageCors(settings) { return [{ origin: settings.origins, method: ['GET', 'HEAD'], maxAgeSeconds: 3600 }]; }
export function serverEnvironment(text, settings) {
  const env = parseEnv(text);
  if (env.FUNCTIONS_REGION && env.FUNCTIONS_REGION !== settings.region || env.EVERTRACE_STORAGE_BUCKET && env.EVERTRACE_STORAGE_BUCKET !== settings.bucket) throw new Error('Existing server region or bucket differs. Resolve it before deployment.');
  return { ...env, FUNCTIONS_REGION: settings.region, EVERTRACE_STORAGE_BUCKET: settings.bucket };
}
