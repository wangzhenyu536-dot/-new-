/* global sessionStorage, document, getComputedStyle */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1', '--directory', 'frontend'], { stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:8766'); if (r.ok) break; } catch { /* Wait for local static server. */ } await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch(); await mkdir('outputs/R0/baseline', { recursive: true });
  const geometry = {};
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.addInitScript(() => sessionStorage.setItem('evertraceIntroSeen', '1'));
    await page.goto('http://127.0.0.1:8766', { waitUntil: 'networkidle' }); await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `outputs/R0/baseline/home-${viewport.width}.png`, fullPage: true });
    geometry[viewport.width] = await page.evaluate(() => Object.fromEntries(['.portrait-stage', '.hero-title-wrap h1', '.statement', '.materials', '.finale'].map(selector => { const el = document.querySelector(selector), rect = el.getBoundingClientRect(); return [selector, { x: rect.x, width: rect.width, height: rect.height, font: getComputedStyle(el).fontFamily }]; })));
    await page.close();
  }
  await writeFile('outputs/R0/baseline/geometry.json', JSON.stringify(geometry, null, 2));
  await writeFile('outputs/R0/baseline/source-head.txt', execFileSync('git', ['rev-parse', 'HEAD']));
} finally { await browser?.close(); server.kill(); }
