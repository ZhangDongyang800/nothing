/* 纸上军团 · 玩家体验升级验收：
 * 双层命名 / 数值化提示 / 新手引导 / 部署与合成预览 / 动态建议 / Boss 技能通俗化。
 * 用法：node scripts/qa-legion-ux.mjs [base]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:5273/';
const OUT = path.resolve('.qa/legion-ux');
fs.mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); return name; };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const report = { base: BASE, at: new Date().toISOString(), steps: [], errors: [] };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.locator('[data-game="legion"]').click();
await page.waitForFunction(() => !!window.__legion, null, { timeout: 8000 });
await page.waitForTimeout(400);

/* 1. 首次进入：新手引导教练卡应自动出现 */
await page.evaluate(() => { const d = window.__legion; d.resetSave(); d.start('qingfeng'); });
await page.waitForTimeout(500);
report.steps.push({ step: 'tutorial-auto', coachVisible: await page.evaluate(() => !document.getElementById('lgCoach').hidden) });
await shot(page, '01-tutorial-step1');
await page.locator('[data-act="tutorial-next"]').click();
await page.waitForTimeout(120);
await page.locator('[data-act="tutorial-next"]').click();
await page.waitForTimeout(120);
await shot(page, '02-tutorial-step3');
report.steps.push({ step: 'tutorial-step3', stepTxt: await page.evaluate(() => document.getElementById('lgCoachStep').textContent) });
await page.locator('[data-act="tutorial-skip"]').click();
await page.waitForTimeout(200);
report.steps.push({ step: 'tutorial-skip', coachGone: await page.evaluate(() => document.getElementById('lgCoach').hidden), doneSaved: await page.evaluate(() => window.__legion.game.save.tutorialDone) });

/* 2. 操作区双层命名标签 */
await page.evaluate(() => { const d = window.__legion; d.unlockAll(); d.give(400, 400); });
await page.waitForTimeout(300);
await shot(page, '03-dock-labels');
report.steps.push({ step: 'dock-labels', labels: await page.evaluate(() => Array.from(document.querySelectorAll('.lg-sec-head')).map((e) => e.textContent.trim())) });

/* 3. 部署预览：攻击覆盖绿点 + 预览卡 + 将形成合击绿框 */
await page.evaluate(() => {
  const d = window.__legion, g = d.game;
  d.clearField();
  for (let i = 0; i < 81; i++) g.cells.add(i);
  const pts = g.board.routePts.center, COLS = 9;
  const pathSet = new Set(pts.map((p) => p.y * COLS + p.x));
  const pi = Math.floor(pts.length * 0.45), pc = pts[pi];
  const spots = [];
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 0], [0, 2]]) {
    const x = pc.x + dx, y = pc.y + dy;
    if (x < 0 || y < 0 || x >= 9 || y >= 9) continue;
    const i = y * COLS + x;
    if (!pathSet.has(i)) spots.push(i);
  }
  d.addUnit('spear', 1, spots[0], -1, false);
  d.addUnit('spear', 1, spots[1], -1, false);
  const target = spots[2];
  const c = g.board.center(target);
  g.drag = { fromBench: true, index: 0, fromCell: -1, x: c.x, y: c.y, startX: c.x, startY: c.y, moved: true, target, merge: false, fuse: false, illegal: false, lost: 0, benchTarget: -1, kind: 'spear', lv: 1, veteran: false, hero: '' };
  g.updateDragTarget();
});
await page.waitForTimeout(200);
await shot(page, '04-preview-deploy');
report.steps.push({ step: 'preview-deploy', deployPreview: await page.evaluate(() => window.__legion.game.dragView().preview) });

/* 4. 合成预览：结果等级 / 新能力 / 断阵 */
await page.evaluate(() => {
  const g = window.__legion.game;
  const a = g.battle.units.find((u) => u.active && !u.hero && u.kind === 'spear');
  const b = g.battle.units.find((u) => u.active && !u.hero && u.kind === 'spear' && u.cell !== a.cell);
  const c = g.board.center(b.cell);
  g.drag = { fromBench: false, index: -1, fromCell: a.cell, x: c.x, y: c.y, startX: c.x, startY: c.y, moved: true, target: b.cell, merge: true, fuse: false, illegal: false, lost: g.strokesLostBy(a.cell), benchTarget: -1, kind: 'spear', lv: 1, veteran: false, hero: '' };
});
await page.waitForTimeout(200);
await shot(page, '05-preview-merge');
report.steps.push({ step: 'preview-merge', mergePreview: await page.evaluate(() => window.__legion.game.dragView().preview) });
await page.evaluate(() => { window.__legion.game.drag = null; });

/* 5. 数值化错误提示 */
await page.evaluate(() => { const g = window.__legion.game; g.silver = 3; g.poorSilver(20); });
await page.waitForTimeout(150);
await shot(page, '06-toast-silver');
report.steps.push({ step: 'toast-silver', toastTxt: await page.evaluate(() => Array.from(document.querySelectorAll('.lg-toast')).map((e) => e.textContent)) });

/* 6. 动态建议：覆盖缺口 */
const suggestComputed = await page.evaluate(() => {
  const d = window.__legion, g = d.game;
  d.clearField(); g.phase = 'prep';
  const s = g.computeSuggestion();
  if (s) g.ui.showSuggest(s);
  return s;
});
await page.waitForTimeout(200);
await shot(page, '07-suggest');
report.steps.push({ step: 'suggest', suggestComputed, suggest: await page.evaluate(() => ({ hidden: document.getElementById('lgSuggest').hidden, txt: document.getElementById('lgSuggestTxt').textContent })) });

/* 7. Boss 技能通俗化：墨麒麟抹笔 */
await page.evaluate(() => {
  const d = window.__legion, g = d.game;
  d.clearField(); d.wave(50);
  g.battle.eraseStrokes(6);
  g.notify('抹笔：6 秒内所有合击失效', 'bad');
});
await page.waitForTimeout(300);
await shot(page, '08-boss-erase');

/* 8. 商店 / 永久强化 / 帮助（弹层） */
await page.evaluate(() => window.__legion.game.onAct('shop'));
await page.waitForTimeout(300);
await shot(page, '09-shop');
await page.locator('.lg-overlay [data-close]').first().click();
await page.waitForTimeout(200);
await page.evaluate(() => window.__legion.game.onAct('meta'));
await page.waitForTimeout(300);
await shot(page, '10-meta');
await page.locator('.lg-overlay [data-close]').first().click();
await page.waitForTimeout(200);
await page.evaluate(() => window.__legion.game.onAct('help'));
await page.waitForTimeout(300);
await shot(page, '11-help');
report.steps.push({ step: 'help-replay', hasReplay: await page.evaluate(() => !!document.querySelector('[data-act="tutorial"]')) });

report.steps.push({ step: 'errors', count: report.errors.length, errors: report.errors.slice(0, 10) });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();