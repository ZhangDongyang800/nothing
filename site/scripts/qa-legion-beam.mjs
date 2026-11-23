/* 抓「笔势合击」那一帧：横锋横扫 / 直锋汇击，用来做交付截图 */
import { chromium } from 'playwright-core';
import path from 'node:path';

const OUT = path.resolve('.qa/legion-stroke');
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:5273/', { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(1000);
await p.locator('[data-game="legion"]').click({ timeout: 60000 });
await p.waitForFunction(() => !!window.__legion);
await p.waitForTimeout(400);

await p.evaluate(() => window.__legion.resetSave());
await p.waitForTimeout(300);
await p.evaluate(() => {
  const d = window.__legion;
  d.start('qingfeng');
  d.unlockAll();
  d.clearField();
});
await p.waitForTimeout(240);
await p.evaluate(() => {
  const d = window.__legion;
  for (let x = 5; x <= 7; x++) d.addUnit('bow', 3, 9 * 5 + x, 0);
  d.addUnit('shield', 3, 39, 0);
  d.addUnit('blade', 3, 48, 0);
  d.addUnit('spear', 3, 57, 0);
});
await p.waitForTimeout(600);

await p.evaluate(() => {
  const d = window.__legion;
  [11.0, 11.4, 11.9, 12.3, 12.6, 13.0].forEach((v) => d.spawnAt('raider', v));
  d.spawnAt('brute', 14.4);
});
await p.waitForTimeout(260);
await p.screenshot({ path: path.join(OUT, '13-before-fire.png') });

await p.evaluate(() => window.__legion.fireStrokes());
await p.waitForTimeout(40);
await p.screenshot({ path: path.join(OUT, '13-stroke-beam.png') });
await p.waitForTimeout(90);
await p.screenshot({ path: path.join(OUT, '13b-stroke-beam2.png') });
await p.waitForTimeout(500);
console.log(JSON.stringify(await p.evaluate(() => ({ info: window.__legion.strokesInfo(), dmg: window.__legion.state().damage, dead: window.__legion.state().kills }))));
await b.close();
