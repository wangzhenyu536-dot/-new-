import {test,expect} from '@playwright/test';
import {workbook} from '../fixtures/workbooks.mjs';
for (const language of ['en','zh'] as const) test(`confirmed EEG format and unitless raw values are explained on the ${language} homepage`,async({page})=>{
 await page.addInitScript(()=>sessionStorage.setItem('evertraceIntroSeen','1'));
 await page.goto('/');if(language==='zh')await page.getByRole('button',{name:'中文',exact:true}).click();
 await expect(page.locator('.signal-boundary')).toContainText(language==='en'?'device raw values, without a physical unit':'设备原始数值，无物理单位');
 await expect(page.locator('.format-preview')).toContainText(language==='en'?'CONFIRMED FORMAT':'已确认格式');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('mobile upload explains confirmed raw-value format and preserves signed original samples',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/register?returnTo=%2Fpacks%2Fnew');
 await page.getByLabel('Name',{exact:true}).fill('R9 format tester');await page.getByLabel('Email',{exact:true}).fill(`r9-${Date.now()}@example.test`);await page.getByLabel('Password',{exact:true}).fill('Evertrace-test-2026!');await page.getByLabel('Confirm password',{exact:true}).fill('Evertrace-test-2026!');await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Create a skill pack',exact:true})).toBeVisible();
 await expect(page.getByText('timestamp_ms: milliseconds. value: device raw values, without a physical unit. Files upload when you save.',{exact:true})).toBeVisible();
 await page.getByLabel('EEG Excel',{exact:true}).setInputFiles({name:'synthetic-unitless.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook())});
 await expect(page.getByRole('img',{name:'EEG preview'})).toContainText('-3');await expect(page.getByRole('img',{name:'EEG preview'})).toContainText('4');
 await page.getByRole('button',{name:'中文',exact:true}).click();await expect(page.getByText('timestamp_ms 为毫秒；value 为设备原始数值，无物理单位。点击保存时上传文件。',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'outputs/R9/format-mobile.png',fullPage:true});
});
