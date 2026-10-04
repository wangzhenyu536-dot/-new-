import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { emulatorTempDir } from './emulator-environment.mjs';
const root=process.cwd(),temporary=emulatorTempDir(root,'start');
try {
  const response=await fetch('http://127.0.0.1:4400/emulators',{signal:globalThis.AbortSignal.timeout(1500)});
  if(!response.ok)throw new Error('No preview hub');
} catch { process.stdout.write('Preview is not running; snapshot skipped.\n');process.exit(0); }
mkdirSync(temporary,{recursive:true});
const saved=path.join(root,'.runtime','preview-backup');
const result=spawnSync(process.execPath,['node_modules/firebase-tools/lib/bin/firebase.js','emulators:export',saved,'--project','demo-evertrace','--force'],{stdio:'inherit',env:{...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary,METADATA_SERVER_DETECTION:'none'}});
process.exitCode=result.status??1;
