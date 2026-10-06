import { expect, test, type Page } from '@playwright/test';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const projectId='demo-evertrace-spark-test';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:28090'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:29099')throw new Error('Isolated Spark emulators required.');
const admin=initializeApp({projectId},'spark-browser-tests'),database=getFirestore(admin),identity=getAuth(admin);
const password='Evertrace-test-2026!';
const address=()=>`spark-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
test.use({reducedMotion:'reduce'});
async function register(page:Page,email:string,name='Spark researcher'){
 await page.getByLabel('Name',{exact:true}).fill(name);await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();
}
async function seed(name='Spark member',role='member'){
 const email=address(),user=await identity.createUser({email,password});await database.doc(`users/${user.uid}`).set({uid:user.uid,email,displayName:name,role});return {uid:user.uid,email};
}
async function login(page:Page,email:string,path='/packs'){
 await page.goto(path);await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
test('register creates a real member profile, returns to categories and survives reload/login',async({page})=>{
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));const email=address();await page.goto('/categories');await expect(page).toHaveURL(/login\?returnTo=%2Fcategories/);await page.getByRole('link',{name:'Create account',exact:true}).click();await register(page,email);
 await expect(page).toHaveURL(/\/categories$/);await expect(page.getByRole('heading',{name:'Community categories',exact:true})).toBeVisible();
 const user=await identity.getUserByEmail(email);expect((await database.doc(`users/${user.uid}`).get()).data()).toEqual({uid:user.uid,email,displayName:'Spark researcher',role:'member'});
 await page.reload();await expect(page.getByText('Member',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/login/);await login(page,email,'/categories');await expect(page).toHaveURL(/\/categories$/);
 expect(requests.filter(url=>/ensureProfile|createCategory|127\.0\.0\.1:(5001|9199|9099|8080|15001|19199)/.test(url))).toEqual([]);
});
test('default language is English; homepage displays the signed in name and management entry',async({page})=>{
 const user=await seed('Community researcher');await login(page,user.email);await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toBeVisible();await page.goto('/');await expect(page.locator('.nav-actions .account-link')).toHaveText('Community researcher');await page.getByRole('link',{name:'MANAGE PACKS',exact:false}).click();await expect(page).toHaveURL(/\/packs$/);await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto('/');await expect(page.locator('.nav-actions .account-link')).toHaveText('SIGN IN');
});
test('a blank display name falls back to the email without creating extra profile fields',async({page})=>{
 const email=address();await page.goto('/register');await register(page,email,'');await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toBeVisible();const user=await identity.getUserByEmail(email);expect((await database.doc(`users/${user.uid}`).get()).get('displayName')).toBe(email);await page.goto('/');await expect(page.locator('.nav-actions .account-link')).toHaveText(email);
});
test('safe return and member-only admin gating are preserved',async({page})=>{
 const email=address();await page.goto('/register?returnTo=https%3A%2F%2Fevil.example');await register(page,email);await expect(page).toHaveURL(/127\.0\.0\.1:5176\/packs$/);await page.goto('/admin/members');await expect(page.getByRole('heading',{name:'Access denied',exact:true})).toBeVisible();
});
test('password mismatch, duplicate registration and wrong password are handled',async({page})=>{
 const email=address();await page.goto('/register');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill('different');await page.getByRole('button',{name:'Create account',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Passwords do not match');await register(page,email);await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto('/register');await register(page,email);await expect(page.getByRole('alert')).toContainText('already registered');await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('incorrect-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('alert')).toContainText('email and password');
});
test('missing profile is initialized once and existing profile is preserved on login',async({page})=>{
 const email=address(),user=await identity.createUser({email,password});await login(page,email);await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toBeVisible();expect((await database.doc(`users/${user.uid}`).get()).get('role')).toBe('member');await database.doc(`users/${user.uid}`).update({displayName:'Preserved name'});await page.reload();await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toBeVisible();expect((await database.doc(`users/${user.uid}`).get()).get('displayName')).toBe('Preserved name');
});
test('invalid profile blocks entry, then Retry restores the same authenticated account',async({page})=>{
 const user=await seed('Needs repair','invalid');await login(page,user.email);await expect(page.getByRole('heading',{name:'Account unavailable',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toHaveCount(0);await database.doc(`users/${user.uid}`).update({role:'member'});await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toBeVisible();await expect(page.getByText(user.email,{exact:true})).toBeVisible();
});
test('role changes reach the currently signed in UI in real time',async({page})=>{
 const user=await seed();await login(page,user.email);await expect(page.getByText('Member',{exact:true})).toBeVisible();await database.doc(`users/${user.uid}`).update({role:'admin'});await expect(page.getByText('Administrator',{exact:true})).toBeVisible();await database.doc(`users/${user.uid}`).update({role:'member'});await expect(page.getByText('Member',{exact:true})).toBeVisible();
});
test('password reset produces a real emulator reset action',async({page})=>{
 const user=await seed();await page.goto('/forgot-password');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByRole('button',{name:'Send reset link',exact:true}).click();await expect(page.getByRole('status')).toContainText('If an account exists');const response=await page.request.get(`http://127.0.0.1:29099/emulator/v1/projects/${projectId}/oobCodes`);expect((await response.json()).oobCodes.some((code:{email:string;requestType:string})=>code.email===user.email&&code.requestType==='PASSWORD_RESET')).toBe(true);
});
test('member creates a normalized category and repeated names select the existing one',async({page})=>{
 const user=await seed(),name=`Focus ${Date.now()}`;await login(page,user.email,'/categories');await expect(page.getByRole('heading',{name:'Community categories',exact:true})).toBeVisible();await page.getByLabel('New category',{exact:true}).fill(`  ${name.replace(' ','   ')}  `);await page.getByRole('button',{name:'Add category',exact:true}).click();await expect(page.getByRole('status')).toContainText('Category created');await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await page.getByLabel('New category',{exact:true}).fill(name.toUpperCase());await page.getByRole('button',{name:'Add category',exact:true}).click();await expect(page.getByRole('status')).toContainText('already exists');expect((await database.doc(`categories/${name.toLowerCase()}`).get()).get('createdBy')).toBe(user.uid);await page.reload();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
});
test('simultaneous category creation by two accounts leaves one shared record',async({browser})=>{
 const first=await seed(),second=await seed(),a=await browser.newContext(),b=await browser.newContext();try{const p=await a.newPage(),q=await b.newPage();await Promise.all([login(p,first.email,'/categories'),login(q,second.email,'/categories')]);const name=`Concurrent ${Date.now()}`;await Promise.all([p.getByLabel('New category',{exact:true}).fill(name),q.getByLabel('New category',{exact:true}).fill(`  ${name.toUpperCase()} `)]);await Promise.all([p.getByRole('button',{name:'Add category',exact:true}).click(),q.getByRole('button',{name:'Add category',exact:true}).click()]);await expect(p.getByRole('status')).toContainText(/created|already exists/);await expect(q.getByRole('status')).toContainText(/created|already exists/);const found=(await database.collection('categories').get()).docs.filter(d=>d.id===name.toLowerCase());expect(found).toHaveLength(1);await expect(p.locator('.category-list article').filter({hasText:found[0].get('name')})).toHaveCount(1);await expect(q.locator('.category-list article').filter({hasText:found[0].get('name')})).toHaveCount(1);}finally{await a.close();await b.close();}
});
test('invalid category retains input and never creates a record',async({page})=>{
 const user=await seed();await login(page,user.email,'/categories');await page.getByLabel('New category',{exact:true}).fill('invalid/name');await page.getByRole('button',{name:'Add category',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('New category',{exact:true})).toHaveValue('invalid/name');expect((await database.collection('categories').get()).docs.some(d=>d.get('name')==='invalid/name')).toBe(false);
});
test('mobile Chinese workspace and categories fit the screen and remember language',async({page})=>{
 const user=await seed();await page.setViewportSize({width:390,height:844});await login(page,user.email);await expect(page.getByRole('heading',{name:'Community workspace',exact:true})).toBeVisible();await page.getByRole('button',{name:'中文',exact:true}).click();await expect(page.getByRole('heading',{name:'社区工作区',exact:true})).toBeVisible();await page.getByRole('link',{name:'社区分类',exact:true}).click();await expect(page.getByRole('heading',{name:'社区分类',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'社区分类',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'outputs/S1/categories-mobile-zh.png',fullPage:true});await page.getByRole('button',{name:'EN',exact:true}).click();await expect(page.getByRole('heading',{name:'Community categories',exact:true})).toBeVisible();await page.screenshot({path:'outputs/S1/categories-mobile-en.png',fullPage:true});
});
