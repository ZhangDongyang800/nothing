/* 存档兼容：开一局 → 放在整备期 → 关掉页面 → 重开 → 续守 */
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5273/', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.locator('[data-game="legion"]').click();
await page.waitForFunction(() => !!window.__legion);
const first = await page.evaluate(() => {
  const d = window.__legion;
  d.resetSave(); d.start('qingfeng');
  d.unlockAll(); d.give(200, 200);
  d.addUnit('shield', 2, 39, 1); d.addUnit('bow', 2, 50, 1); d.addUnit('spear', 2, 51, 1); d.addUnit('blade', 2, 52, 1);
  d.nextWave();
  d.fight(3);
  return { state: d.saveInfo(), strokes: d.strokesInfo() };
});
/* 关掉机台（会存档），刷新页面再续守 */
await page.locator('[data-close]').first().click().catch(() => {});
await page.reload({ waitUntil: 'networkidle' });
await page.locator('[data-game="legion"]').click();
await page.waitForFunction(() => !!window.__legion);
const second = await page.evaluate(() => {
  const d = window.__legion;
  return { checkpoint: d.state().checkpoint, save: d.saveInfo() };
});
const resumed = await page.evaluate(() => {
  const d = window.__legion;
  d.resume();
  return { state: d.state(), strokes: d.strokesInfo(), cards: d.cards() };
});
console.log(JSON.stringify({ first, second, resumed: { phase: resumed.state.phase, wave: resumed.state.wave, units: resumed.state.units.length, strokes: resumed.strokes, cards: resumed.cards }, errs }, null, 1));
await browser.close();
