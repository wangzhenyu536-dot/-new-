import {expect,test,type Page} from '@playwright/test';
interface Backend {projectId:string;authPort:number;workspaceTitle:string;}
const password='Evertrace-regression-2026!';
const address=()=>`context-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
async function fillRegistration(page:Page,email:string){
 await page.getByLabel('Name',{exact:true}).fill('Context regression');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.getByRole('button',{name:'Create account',exact:true}).click();
}
// A delayed route compiled after a dev update can resolve its hook from a newer
// module revision than the already-mounted provider. Preserve this real browser
// import graph mismatch; do not mock React, authentication, or the hook result.
async function newerHookRevision(page:Page,module:string){
 let rewritten=0;
 await page.route(`**/src/${module}*`,async route=>{
  const response=await route.fetch(),source=await response.text();
  const body=source.replace(/from (['"])(\/src\/app\/(?:AuthProvider\.tsx|useAuth\.ts))(?:\?[^'"]*)?\1/g,(_match,quote,path)=>`from ${quote}${path}?account-context-revision=updated${quote}`);
  expect(body).not.toBe(source);rewritten++;await route.fulfill({response,body});
 });
 return ()=>expect(rewritten).toBeGreaterThan(0);
}
export function accountContextCases(backend:Backend){
 test.use({reducedMotion:'reduce'});
 test('register reaches the workspace when a cold member component uses a newer hook module',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const assertRewritten=await newerHookRevision(page,'components/MemberBar.tsx');await page.goto('/register');await fillRegistration(page,address());await expect(page.getByRole('heading',{name:backend.workspaceTitle,exact:true})).toBeVisible();assertRewritten();expect(errors).toEqual([]);
 });
 test('login reaches the workspace when a delayed component resolves a newer hook module',async({page})=>{
  const email=address(),created=await page.request.post(`http://127.0.0.1:${backend.authPort}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-key`,{data:{email,password,returnSecureToken:true}});expect(created.ok()).toBe(true);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const assertRewritten=await newerHookRevision(page,'components/MemberBar.tsx');await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:backend.workspaceTitle,exact:true})).toBeVisible();assertRewritten();expect(errors).toEqual([]);
 });
 test('logout opens a cold login page compiled against a newer hook and can sign in again',async({page})=>{
  const email=address();await page.goto('/register');await fillRegistration(page,email);await expect(page.getByRole('heading',{name:backend.workspaceTitle,exact:true})).toBeVisible();
  // Reload here intentionally establishes an existing session with no AccountPage
  // module in the new realm, matching the user's recovered starting condition.
  await page.reload();await expect(page.getByRole('heading',{name:backend.workspaceTitle,exact:true})).toBeVisible();
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const assertRewritten=await newerHookRevision(page,'pages/AccountPage.tsx');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();assertRewritten();
  await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:backend.workspaceTitle,exact:true})).toBeVisible();expect(errors).toEqual([]);
 });
}
