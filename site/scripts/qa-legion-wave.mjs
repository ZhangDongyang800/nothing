/* 真实波次中的多单位战斗：不人造塞怪，直接开一波看实际密度与可读性 */
import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = path.resolve('.qa/legion-stroke');
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:5273/', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(900);
await p.locator('[data-game="legion"]').click({ timeout: 60000 });
await p.waitForFunction(() => !!window.__legion);
await p.waitForTimeout(300);
await p.evaluate(() => window.__legion.resetSave());
await p.waitForTimeout(300);
await p.evaluate(() => { const d = window.__legion; d.start('qingfeng'); d.unlockAll(); d.clearField(); });
await p.waitForTimeout(240);
await p.evaluate(() => {
  const d = window.__legion;
  /* 两条横锋 + 一条直锋，做出"三笔成阵"的常规中局 */
  for (let x = 5; x <= 7; x++) d.addUnit('bow', 2, 9 * 2 + x, 0);
  for (let x = 5; x <= 7; x++) d.addUnit('blade', 2, 9 * 5 + x, 0);
  d.addUnit('shield', 2, 39, 0);
  d.addUnit('spear', 2, 48, 0);
  d.addUnit('engineer', 2, 57, 0);
  d.wave(12);
});
await p.waitForTimeout(500);
await p.locator('.lg-start-wave').click();
await p.waitForTimeout(5200);
await p.screenshot({ path: path.join(OUT, '14-real-wave.png') });
await p.waitForTimeout(4000);
await p.screenshot({ path: path.join(OUT, '14b-real-wave.png') });
console.log(JSON.stringify(await p.evaluate(() => ({ wave: window.__legion.state().wave, enemies: window.__legion.enemiesInfo().length, kills: window.__legion.state().kills, strokes: window.__legion.strokesInfo().map((s) => s.key + (s.suppress ? '*' : '')) }))));
await b.close();
