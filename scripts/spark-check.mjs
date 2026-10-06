import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url)), mode=process.argv[2];
let failed=false;
if(!['e2e','transitions'].includes(mode)){const result=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run','--config',path.join(root,'vitest.spark-s1.config.ts')],{cwd:root,env:process.env,stdio:'inherit'}); failed ||= result.status!==0;}
if(['verify','e2e','red','transitions'].includes(mode)){const result=spawnSync(process.execPath,[path.join(root,'node_modules/@playwright/test/cli.js'),'test','--config',path.join(root,'playwright.spark.config.ts'),...(mode==='transitions'?['tests/e2e-spark/account-context.spec.ts','tests/e2e-spark/account-loading.spec.ts']:[])],{cwd:root,env:process.env,stdio:'inherit'});failed ||= result.status!==0;}
process.exitCode=failed?1:0;
