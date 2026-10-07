import {afterAll,beforeAll,expect,it} from 'vitest';
import {chromium,type Browser} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import {existsSync,mkdtempSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
let directory:string,base:string,server:Server,browser:Browser;
beforeAll(async()=>{directory=mkdtempSync(join(tmpdir(),'spark-cloud-ui-'));execFileSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--mode','spark-cloud','--outDir',directory],{cwd:resolve('apps/web'),env:{...process.env,NODE_ENV:'production',VITE_DATA_BACKEND:'spark',VITE_USE_EMULATORS:'false',VITE_FIREBASE_PROJECT_ID:'evertrace-spark-release-test',VITE_FIREBASE_API_KEY:'synthetic-public-key',VITE_FIREBASE_AUTH_DOMAIN:'evertrace-spark-release-test.firebaseapp.com',VITE_FIREBASE_APP_ID:'1:123:web:synthetic'},stdio:'pipe'});
 server=createServer((req,res)=>{const pathname=new URL(req.url??'/','http://localhost').pathname;const asset=join(directory,pathname);const file=pathname.startsWith('/assets/')&&existsSync(asset)?asset:join(directory,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(file));});await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const address=server.address();if(!address||typeof address==='string')throw Error('server');base=`http://127.0.0.1:${address.port}`;browser=await chromium.launch();mkdirSync('outputs/S5',{recursive:true});},30000);
afterAll(async()=>{await browser?.close();if(server)await new Promise<void>((done,fail)=>server.close(e=>e?fail(e):done()));if(directory)rmSync(directory,{recursive:true,force:true});});
for(const language of ['en','zh-CN'])for(const mobile of [false,true])it(`cloud build ${language} ${mobile?'phone':'desktop'} refreshes routes, reports cloud connection errors and explains real reset email`,async()=>{
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();const requests:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=route.request().url();requests.push(url);if(url.startsWith(base+'/'))return route.continue();if(url.startsWith('https://identitytoolkit.googleapis.com/')&&url.includes('accounts:sendOobCode'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({email:'synthetic-reset@example.test'})});return route.abort();});
 try{
 await page.goto(base+'/login?returnTo=%2Fpacks');if(language==='zh-CN')await page.getByRole('button',{name:'中文',exact:true}).click();
 const email=language==='en'?'Email':'邮箱',password=language==='en'?'Password':'密码';await page.getByLabel(email,{exact:true}).fill('synthetic-reset@example.test');await page.getByLabel(password,{exact:true}).fill('Synthetic-password-2026!');await page.getByRole('button',{name:language==='en'?'Sign in':'登录',exact:true}).click();await page.getByRole('alert').waitFor();
 expect(await page.getByRole('alert').innerText()).not.toMatch(/local services|本地服务/);expect(requests.some(url=>url.startsWith('https://identitytoolkit.googleapis.com/'))).toBe(true);expect(await page.locator('.account-footer').innerText()).not.toMatch(/LOCAL PREVIEW|本地预览/);
 await page.goto(base+'/forgot-password');await page.getByLabel(email,{exact:true}).fill('synthetic-reset@example.test');await page.getByRole('button',{name:language==='en'?'Send reset link':'发送重置链接',exact:true}).click();await page.getByRole('status').waitFor();const status=await page.getByRole('status').innerText();expect(status).not.toMatch(/emulator|模拟器|local preview|本地预览/);expect(status).toMatch(language==='en'?/email|inbox/i:/邮箱|邮件/);
 await page.reload();await page.getByLabel(email,{exact:true}).waitFor();expect(await page.evaluate(()=>document.documentElement.lang)).toBe(language);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`outputs/S5/cloud-account-${language}-${mobile?'mobile':'desktop'}.png`,fullPage:true});await page.goto(base+'/');await page.locator('.signal-boundary').waitFor();expect(await page.locator('.signal-boundary').innerText()).toMatch(language==='en'?/without a physical unit/:/无物理单位/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(requests.filter(url=>/^http:\/\/(localhost|127\.0\.0\.1):(9099|8080|9199|5001|29199|28190|29099|28090)\//.test(url))).toEqual([]);expect(errors).toEqual([]);
 }finally{await context.close();}
},30000);
