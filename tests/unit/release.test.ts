import {expect,test} from 'vitest';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {chromium} from '@playwright/test';
const fixture=`VITE_USE_EMULATORS=false
VITE_FIREBASE_PROJECT_ID=evertrace-release-test
VITE_FIREBASE_API_KEY=public-test-key
VITE_FIREBASE_AUTH_DOMAIN=evertrace-release-test.firebaseapp.com
VITE_FIREBASE_STORAGE_BUCKET=evertrace-release-test.firebasestorage.app
VITE_FIREBASE_APP_ID=1:123:web:abc
VITE_FUNCTIONS_REGION=us-central1
FUNCTIONS_REGION=us-central1
`;
async function module(){const path='../../scripts/cloud-config.mjs';return import(path);}
test('cloud release requires explicit cloud config and exact non-demo deployment target',async()=>{const {cloudSettings}=await module();const s=cloudSettings(fixture,'evertrace-release-test');expect(s).toMatchObject({projectId:'evertrace-release-test',region:'us-central1',bucket:'evertrace-release-test.firebasestorage.app'});for(const [env,target] of [[fixture.replace('false','true'),'evertrace-release-test'],[fixture.replace('VITE_USE_EMULATORS=false',''),'evertrace-release-test'],[fixture,'other-project'],[fixture.replaceAll('evertrace-release-test','demo-evertrace'),'demo-evertrace'],[fixture.replace('FUNCTIONS_REGION=us-central1\n','FUNCTIONS_REGION=asia-east1\n'),'evertrace-release-test']])expect(()=>cloudSettings(env,target)).toThrow();});
test('browser download CORS uses explicit HTTPS site origins and rejects wildcard or local origin',async()=>{const {cloudSettings,storageCors}=await module(),s=cloudSettings(fixture,'evertrace-release-test'),cors=storageCors(s);expect(cors[0].origin).toEqual(['https://evertrace-release-test.web.app','https://evertrace-release-test.firebaseapp.com']);expect(cors[0].method).toContain('GET');expect(cors[0].origin).not.toContain('*');for(const origin of ['*','http://localhost:5173','https://example.com/path','https://user:password@example.com'])expect(()=>cloudSettings(fixture+'EVERTRACE_SITE_ORIGINS='+origin,'evertrace-release-test')).toThrow();});
test('server configuration shares region and bucket and never overwrites unrelated settings',async()=>{const {cloudSettings,serverEnvironment}=await module(),s=cloudSettings(fixture,'evertrace-release-test');expect(serverEnvironment('EXISTING_VALUE=kept',s)).toMatchObject({EXISTING_VALUE:'kept',FUNCTIONS_REGION:'us-central1',EVERTRACE_STORAGE_BUCKET:s.bucket});expect(()=>serverEnvironment('FUNCTIONS_REGION=asia-east1',s)).toThrow();expect(()=>serverEnvironment('EVERTRACE_STORAGE_BUCKET=other-bucket',s)).toThrow();});
test('Hosting release serves the real app with SPA refresh and current security rules',()=>{const config=JSON.parse(readFileSync('firebase.cloud.json','utf8'));expect(config.hosting.public).toBe('apps/web/dist-cloud');expect(config.hosting.rewrites).toContainEqual({source:'**',destination:'/index.html'});expect(config.firestore).toEqual({rules:'firebase/firestore.rules',indexes:'firebase/firestore.indexes.json'});expect(config.storage.rules).toBe('firebase/storage.rules');expect(config.functions[0].runtime).toBe('nodejs22');});
test('homepage initial JavaScript stays below 500 KiB and upload/download screens load on demand',()=>{
 const dir=mkdtempSync(join(tmpdir(),'evertrace-bundle-'));execFileSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--manifest','--outDir',dir],{cwd:resolve('apps/web'),env:{...process.env,NODE_ENV:'production',VITE_USE_EMULATORS:'true',VITE_FIREBASE_PROJECT_ID:'demo-evertrace'},stdio:'pipe'});
 const manifest=JSON.parse(readFileSync(join(dir,'.vite/manifest.json'),'utf8')) as Record<string,{file:string;imports?:string[];isEntry?:boolean;dynamicImports?:string[]}>;
 const seen=new Set<string>();function visit(key:string){if(seen.has(key))return;seen.add(key);for(const dependency of manifest[key].imports??[])visit(dependency);}const entry=Object.keys(manifest).find(key=>manifest[key].isEntry)!;visit(entry);
 const bytes=[...seen].reduce((n,key)=>n+readFileSync(join(dir,manifest[key].file)).length,0);mkdirSync('outputs/R9',{recursive:true});writeFileSync('outputs/R9/bundle.json',JSON.stringify({production:true,initialJavaScriptBytes:bytes,entry:manifest[entry].file,dynamicPages:manifest[entry].dynamicImports},null,2));rmSync(dir,{recursive:true,force:true});expect(bytes).toBeLessThanOrEqual(500*1024);expect((manifest[entry].dynamicImports??[]).length).toBeGreaterThanOrEqual(4);
},20000);

test('release command refuses missing or mismatched project configuration before building or deploying',()=>{
 const dir=mkdtempSync(join(tmpdir(),'evertrace-preflight-')),script=resolve('scripts/cloud-release.mjs'),env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.endsWith('_EMULATOR_HOST')));
 try { const emulator=spawnSync(process.execPath,[script,'prepare','evertrace-release-test'],{cwd:dir,encoding:'utf8',env:{...env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:18080'}});expect(emulator.status).toBe(1);expect(emulator.stderr).toContain('without emulator');const missing=spawnSync(process.execPath,[script,'prepare','evertrace-release-test'],{cwd:dir,encoding:'utf8',env});expect(missing.status).toBe(1);expect(missing.stderr).toContain('Create .env.cloud.local');
 writeFileSync(join(dir,'.env.cloud.local'),fixture);const mismatch=spawnSync(process.execPath,[script,'deploy','other-project'],{cwd:dir,encoding:'utf8',env});expect(mismatch.status).toBe(1);expect(mismatch.stderr).toContain('must match');expect(existsSync(join(dir,'apps'))).toBe(false);expect(existsSync(join(dir,'outputs'))).toBe(false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('actual cloud build refreshes login, hides local diagnostics and uses official cloud Auth instead of emulator',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'evertrace-cloud-'));const env=Object.fromEntries(fixture.trim().split('\n').map(line=>line.split('=')));
 execFileSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--mode','cloud','--outDir',dir],{cwd:resolve('apps/web'),env:{...process.env,...env,NODE_ENV:'production'},stdio:'pipe'});
 const server=createServer((request,response)=>{const pathname=new URL(request.url??'/', 'http://localhost').pathname,asset=join(dir,pathname),file=pathname.startsWith('/assets/')&&existsSync(asset)?asset:join(dir,'index.html');response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');response.end(readFileSync(file));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('server');const base=`http://127.0.0.1:${address.port}`,browser=await chromium.launch(),page=await browser.newPage();const requests:string[]=[];
 try {await page.route('**/*',route=>{const url=route.request().url();requests.push(url);return url.startsWith(base+'/')?route.continue():route.abort();});await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill('cloud-check@example.test');await page.getByLabel('Password',{exact:true}).fill('Synthetic-password-2026!');expect(await page.locator('.account-footer').innerText()).not.toMatch(/local|emulator/i);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('alert').waitFor();expect(requests.some(url=>url.startsWith('https://identitytoolkit.googleapis.com/'))).toBe(true);expect(requests.some(url=>/^http:\/\/(localhost|127\.0\.0\.1):(9099|8080|9199|5001|10099|18080|19199|15001)\//.test(url))).toBe(false);await page.reload();await page.getByLabel('Email',{exact:true}).waitFor();}
 finally {await browser.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));rmSync(dir,{recursive:true,force:true});}
},30000);
