import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root = process.cwd(), localJava = path.join(root, '.runtime/java');
const env = { ...process.env, FIREBASE_EMULATORS_PATH: path.join(root, '.cache/firebase') };
if (existsSync(path.join(localJava, 'bin/java'))) { env.JAVA_HOME = localJava; env.PATH = path.join(localJava, 'bin') + path.delimiter + env.PATH; }
const mode = process.argv[2] || 'start';
const args = mode === 'exec' ? ['emulators:exec', '--project', 'demo-evertrace', '--only', 'firestore,storage', 'npm test'] : ['emulators:start', '--project', 'demo-evertrace', '--only', 'auth,firestore,storage'];
const child = spawn(path.join(root, 'node_modules/.bin/firebase'), args, { stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
