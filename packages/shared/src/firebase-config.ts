export const DEFAULT_FUNCTIONS_REGION = 'us-central1';
function region(value: string | undefined) { const selected = value || DEFAULT_FUNCTIONS_REGION; if (!/^[a-z]+-[a-z]+\d+$/.test(selected)) throw new Error('region'); return selected; }
export function readFunctionsRegion(env: Record<string, string | undefined>) { return region(env.FUNCTIONS_REGION); }
export function readFirebaseConfig(env: Record<string, string | undefined>) {
  const backend = env.VITE_DATA_BACKEND || 'legacy';
  if (!['legacy', 'spark'].includes(backend)) throw new Error('backend');
  if (env.VITE_USE_EMULATORS !== undefined && !['true', 'false'].includes(env.VITE_USE_EMULATORS)) throw new Error('environment');
  const local = env.VITE_USE_EMULATORS !== 'false', projectId = env.VITE_FIREBASE_PROJECT_ID || (backend === 'spark' ? 'demo-evertrace-spark' : 'demo-evertrace');
  if (local && !projectId.startsWith('demo-')) throw new Error('localProject');
  if (!local && (projectId.startsWith('demo-') || ['VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_APP_ID', ...(backend === 'legacy' ? ['VITE_FIREBASE_STORAGE_BUCKET'] : [])].some(key => !env[key]?.trim()))) throw new Error('cloudConfig');
  const port = (key: string, fallback: number) => { const n = Number(env[key] || fallback); if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('port'); return n; };
  return { backend: backend as 'legacy' | 'spark', local, config: { projectId, apiKey: env.VITE_FIREBASE_API_KEY || 'local-emulator-key', authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`, storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`, appId: env.VITE_FIREBASE_APP_ID || 'local-preview-app' }, region: region(env.VITE_FUNCTIONS_REGION), ports: { auth: port('VITE_AUTH_EMULATOR_PORT', backend === 'spark' ? 29199 : 9099), firestore: port('VITE_FIRESTORE_EMULATOR_PORT', backend === 'spark' ? 28190 : 8080), storage: port('VITE_STORAGE_EMULATOR_PORT', 9199), functions: port('VITE_FUNCTIONS_EMULATOR_PORT', 5001) } };
}
