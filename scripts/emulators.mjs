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
mkdirSync('outputs/R8', { recursive: true });
const testMode = mode !== 'start';
const savedData = path.join(root, '.runtime/emulator-data');
const importData = testMode ? undefined : latestPreviewExport(root);
const args = testMode
  ? ['emulators:exec', '--config', 'firebase.test.json', '--project', 'demo-evertrace-test', '--only', 'auth,firestore,storage,functions', mode === 'e2e' ? 'npx playwright test' : mode === 'community-red' ? 'npx playwright test tests/e2e/accounts.spec.ts --grep="trusted first admin" --timeout=12000' : mode === 'community-check' ? 'npx playwright test tests/e2e/accounts.spec.ts tests/e2e/members.spec.ts tests/e2e/home.spec.ts tests/e2e/language.spec.ts tests/e2e/home-management.spec.ts' : mode === 'r8-red' ? 'npx vitest run tests/integration/members.test.ts' : mode === 'r8-browser' ? 'npx playwright test tests/e2e/members.spec.ts' : mode === 'r7-cleanup-red' ? 'npx vitest run tests/integration/management.test.ts --testNamePattern="committed|replaying"' : mode === 'r7-red' ? 'npx vitest run tests/integration/management.test.ts' : mode === 'r7-browser-red' ? 'npx playwright test tests/e2e/management.spec.ts --timeout=12000' : mode === 'r7-browser' ? 'npx playwright test tests/e2e/management.spec.ts' : mode === 'home-entry-red' ? 'npx playwright test tests/e2e/home-management.spec.ts --timeout=8000' : mode === 'home-entry' ? 'npx playwright test tests/e2e/home-management.spec.ts tests/e2e/home.spec.ts tests/e2e/accounts.spec.ts tests/e2e/language.spec.ts' : mode === 'r6-time-red' ? 'npx playwright test tests/e2e/downloads.spec.ts --grep="tiny time"' : mode === 'r6-browser' ? 'npx playwright test tests/e2e/downloads.spec.ts' : mode === 'r6-browser-red' ? 'npx playwright test tests/e2e/downloads.spec.ts --timeout=12000' : mode === 'r5-return-red' ? 'npx playwright test tests/e2e/query-packs.spec.ts --grep="sign-out and sign-in redirect"' : mode === 'r5-red' ? 'npx vitest run tests/integration/query-packs.test.ts tests/unit/query-indexes.test.ts' : mode === 'r5-browser-red' ? 'npx playwright test tests/e2e/query-packs.spec.ts --timeout=12000 --grep-invert="network failure"' : mode === 'r4-red' ? 'npx vitest run tests/integration/edit-packs.test.ts' : mode === 'r4-browser-red' ? 'npx playwright test tests/e2e/edit-packs.spec.ts --timeout=12000' : mode === 'r3-return-red' ? 'npx playwright test tests/e2e/packs.spec.ts --grep="signed-out detail"' : mode === 'r3-red' ? 'npx playwright test tests/e2e/packs.spec.ts --timeout=12000' : mode === 'r2-red' ? 'npx playwright test tests/e2e/create.spec.ts --timeout=10000' : mode === 'header-red' ? 'npx playwright test tests/e2e/accounts.spec.ts --grep="homepage account label" --timeout=10000' : mode === 'red' ? 'npx playwright test tests/e2e/accounts.spec.ts --timeout=5000' : 'npm test']
  : ['emulators:start', '--project', 'demo-evertrace', '--only', 'auth,firestore,storage,functions', '--export-on-exit', savedData, ...(importData ? ['--import', importData] : [])];
const child = spawn(path.join(root, 'node_modules/.bin/firebase'), args, { stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
