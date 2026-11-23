/* 只看棋盘：放大截取，检查笔势墨痕在真实尺寸下是否读得出来 */
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

const OUT = path.resolve('.qa/legion-stroke');
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://localhost:5273/', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.locator('[data-game="legion"]').click();
await page.waitForFunction(() => !!window.__legion);
await page.evaluate(() => {
  const d = window.__legion;
  d.resetSave();
  d.start('qingfeng');
  d.unlockAll();
  d.give(300, 300);
  d.clearField();
  d.addUnit('shield', 2, 39, 1);
  d.addUnit('blade', 2, 48, 1);
  d.addUnit('bow', 2, 57, 1);
  d.addUnit('bow', 2, 50, 1);
  d.addUnit('spear', 2, 51, 1);
  d.addUnit('blade', 2, 52, 1);
});
await page.waitForTimeout(600);
const clip = { x: 170, y: 108, width: 740, height: 780 };
await page.screenshot({ path: path.join(OUT, 'zoom-board.png'), clip });
await page.evaluate(() => window.__legion.selectCell(51));
await page.waitForTimeout(260);
await page.screenshot({ path: path.join(OUT, 'zoom-board-selected.png'), clip: { x: 170, y: 108, width: 1100, height: 780 } });
await page.evaluate(() => { const d = window.__legion; d.spawnAt('breaker', 11.2); });
await page.waitForTimeout(1300);
await page.screenshot({ path: path.join(OUT, 'zoom-board-cut.png'), clip });
await ctx.close();
await browser.close();
console.log('ok');
