import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { emulatorTempDir, latestPreviewExport } from './emulator-environment.mjs';
const root = process.cwd(), localJava = path.join(root, '.runtime/java');
const mode = process.argv[2] || 'start';
const temporary = emulatorTempDir(root, mode);
mkdirSync(temporary, { recursive: true });
const env = { ...process.env, PATH: path.join(root, 'node_modules/.bin') + path.delimiter + process.env.PATH, TMPDIR: temporary, TMP: temporary, TEMP: temporary, METADATA_SERVER_DETECTION: 'none', FIREBASE_EMULATORS_PATH: path.join(root, '.cache/firebase') };
if (existsSync(path.join(localJava, 'bin/java'))) { env.JAVA_HOME = localJava; env.PATH = path.join(localJava, 'bin') + path.delimiter + env.PATH; }
const build = spawnSync('npm', ['run', 'build:functions'], { stdio: 'inherit', env });
if (build.status !== 0) process.exit(build.status ?? 1);
mkdirSync('outputs/R4', { recursive: true });
const testMode = mode !== 'start';
const savedData = path.join(root, '.runtime/emulator-data');
const importData = testMode ? undefined : latestPreviewExport(root);
const args = testMode
  ? ['emulators:exec', '--config', 'firebase.test.json', '--project', 'demo-evertrace-test', '--only', 'auth,firestore,storage,functions', mode === 'e2e' ? 'npx playwright test' : mode === 'r4-red' ? 'npx vitest run tests/integration/edit-packs.test.ts' : mode === 'r4-browser-red' ? 'npx playwright test tests/e2e/edit-packs.spec.ts --timeout=12000' : mode === 'r3-return-red' ? 'npx playwright test tests/e2e/packs.spec.ts --grep="signed-out detail"' : mode === 'r3-red' ? 'npx playwright test tests/e2e/packs.spec.ts --timeout=12000' : mode === 'r2-red' ? 'npx playwright test tests/e2e/create.spec.ts --timeout=10000' : mode === 'header-red' ? 'npx playwright test tests/e2e/accounts.spec.ts --grep="homepage account label" --timeout=10000' : mode === 'red' ? 'npx playwright test tests/e2e/accounts.spec.ts --timeout=5000' : 'npm test']
  : ['emulators:start', '--project', 'demo-evertrace', '--only', 'auth,firestore,storage,functions', '--export-on-exit', savedData, ...(importData ? ['--import', importData] : [])];
const child = spawn(path.join(root, 'node_modules/.bin/firebase'), args, { stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
