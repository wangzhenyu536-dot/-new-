import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloudSettings, serverEnvironment, storageCors } from './cloud-config.mjs';
const [mode, projectId] = process.argv.slice(2);
function run(command, args, options = {}) { const result = spawnSync(command, args, { stdio: 'inherit', ...options }); if (result.error) throw result.error; if (result.status !== 0) throw new Error(`Command failed: ${command} (${result.status})`); }
try {
  if (!['prepare','deploy'].includes(mode)) throw new Error('Usage: npm run cloud:prepare -- PROJECT_ID (or cloud:deploy).');
  if (Object.keys(process.env).some(key => key.endsWith('_EMULATOR_HOST') && process.env[key])) throw new Error('Run cloud commands in a terminal without emulator environment variables.');
  if (!existsSync('.env.cloud.local')) throw new Error('Create .env.cloud.local from cloud.env.example using your Firebase Web app configuration.');
  const settings = cloudSettings(readFileSync('.env.cloud.local', 'utf8'), projectId);
  const serverFile = `functions/.env.${settings.projectId}`;
  const server = serverEnvironment(existsSync(serverFile) ? readFileSync(serverFile, 'utf8') : '', settings);
  run('npm', ['run','build:functions']);
  writeFileSync(serverFile, Object.entries(server).map(([key,value]) => `${key}=${JSON.stringify(value)}`).join('\n')+'\n');
  // Explicit environment overrides prevent local .env settings from leaking into the release.
  run(process.execPath, [resolve('node_modules/vite/bin/vite.js'),'build','--mode','cloud','--outDir','dist-cloud','--manifest'], { cwd: resolve('apps/web'), env: { ...process.env, ...settings.env, NODE_ENV: 'production' } });
  mkdirSync('outputs/release', { recursive: true });
  writeFileSync('outputs/release/storage-cors.json', JSON.stringify(storageCors(settings), null, 2)+'\n');
  writeFileSync('outputs/release/manifest.json', JSON.stringify({ projectId: settings.projectId, region: settings.region, bucket: settings.bucket, origins: settings.origins, builtAt: new Date().toISOString() }, null, 2)+'\n');
  console.log(`Cloud release prepared for ${settings.projectId}. Local preview is unchanged. Storage CORS: outputs/release/storage-cors.json`);
  if (mode === 'deploy') run(resolve('node_modules/.bin/firebase'), ['deploy','--project',settings.projectId,'--config','firebase.cloud.json','--only','firestore,storage,functions,hosting']);
} catch (error) { console.error(error.message); process.exitCode = 1; }
