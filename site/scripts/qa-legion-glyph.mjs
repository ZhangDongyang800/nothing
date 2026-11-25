/* 活字兵阵视觉验收：逐兵种攻击 / 受击 / 死亡解体 / 合成盖印 / 选中 / Boss / 帧率。
 * 用法：node scripts/qa-legion-glyph.mjs [base]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:5273/';
const OUT = path.resolve('.qa/legion-glyph');
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

/* 字体是否真的加载（否则字形退回系统楷，书风差异看不出来） */
const fonts = await page.evaluate(() => ({
  brush: document.fonts.check('20px "Ma Shan Zheng"'),
  running: document.fonts.check('20px "Zhi Mang Xing"'),
  hand: document.fonts.check('20px "Long Cang"'),
}));
report.steps.push({ step: 'fonts', fonts });

await page.evaluate(() => { const d = window.__legion; d.resetSave(); d.start('qingfeng'); d.unlockAll(); d.give(600, 600); });
await page.waitForTimeout(300);

/* 在页内按当前折线路找贴路布阵格，放一列某兵种并召来敌人，让攻击特效稳定出现 */
async function showcase(kind, lv, name, enemy = 'brute', count = 5) {
  await page.evaluate(({ kind, lv, enemy, count }) => {
    const d = window.__legion;
    const g = d.game;
    d.clearField();
    d.wave(16);
    const pts = g.board.routePts.center;
    const COLS = 9;
    const pathSet = new Set(pts.map((p) => p.y * COLS + p.x));
    const pi = Math.floor(pts.length * 0.45);
    const pc = pts[pi];
    /* 把兵放在敌人行经格的紧邻布阵格——保证所有兵种都在射程内 */
    const spots = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const x = pc.x + dx, y = pc.y + dy;
      if (x < 0 || y < 0 || x >= 9 || y >= 9) continue;
      const i = y * COLS + x;
      if (!pathSet.has(i)) spots.push(i);
    }
    spots.slice(0, 3).forEach((c) => d.addUnit(kind, lv, c, lv >= 3 ? 0 : -1, false));
    const prog = (pi / (pts.length - 1)) * g.board.len();
    for (let k = 0; k < count; k++) d.spawnAt(enemy, Math.max(0.2, prog - 0.5 + k * 0.22));
    /* 强制同步出手：清零冷却，让特效在截图时正在释放 */
    g.battle.units.forEach((u) => { if (u.active) u.cdT = 0; });
  }, { kind, lv, enemy, count });
  await page.waitForTimeout(110);
  await shot(page, name);
  await page.evaluate(() => { window.__legion.game.battle.units.forEach((u) => { if (u.active) u.cdT = 0; }); });
  await page.waitForTimeout(130);
  await shot(page, name + 'b');
  await page.waitForTimeout(240);
  await shot(page, name + 'c');
}

const kinds = [
  ['blade', 5, 'u-blade'], ['spear', 5, 'u-spear'], ['bow', 5, 'u-bow'],
  ['cavalry', 3, 'u-cavalry'], ['mage', 5, 'u-mage'], ['engineer', 3, 'u-engineer'],
  ['warlock', 4, 'u-warlock'], ['lance', 3, 'u-lance'], ['halberd', 5, 'u-halberd'], ['pyro', 5, 'u-pyro'],
];
for (const [kind, lv, name] of kinds) {
  await showcase(kind, lv, name);
  report.steps.push({ step: name, units: await page.evaluate(() => window.__legion.unitsInfo?.() ?? null) });
}

/* 死亡解体：贴路放弓兵，召一批脆皮游骑，抓解体瞬间 */
await page.evaluate(() => {
  const d = window.__legion; const g = d.game;
  d.clearField(); d.wave(8);
  const pts = g.board.routePts.center;
  const pathSet = new Set(pts.map((p) => p.y * 9 + p.x));
  const pi = Math.floor(pts.length * 0.5);
  const pc = pts[pi];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = pc.x + dx, y = pc.y + dy;
    if (x < 0 || y < 0 || x >= 9 || y >= 9) continue;
    const i = y * 9 + x;
    if (!pathSet.has(i)) d.addUnit('bow', 5, i, 0);
  }
  const prog = (pi / (pts.length - 1)) * g.board.len();
  for (let k = 0; k < 12; k++) d.spawnAt('runner', Math.max(0.2, prog - 0.8 + k * 0.2));
  g.battle.units.forEach((u) => { if (u.active) u.cdT = 0; });
});
await page.waitForTimeout(420);
await shot(page, 'death-shatter');
await page.waitForTimeout(150);
await shot(page, 'death-shatterb');
await page.waitForTimeout(150);
await shot(page, 'death-shatterc');
report.steps.push({ step: 'death', enemies: await page.evaluate(() => window.__legion.enemiesInfo()) });

/* 取两个合法布阵格（避开随机路线） */
const twoCells = await page.evaluate(() => {
  const g = window.__legion.game;
  const pts = g.board.routePts.center;
  const pathSet = new Set(pts.map((p) => p.y * 9 + p.x));
  const free = [];
  for (let y = 8; y >= 0; y--) for (let x = 0; x < 9; x++) { const i = y * 9 + x; if (!pathSet.has(i)) free.push(i); }
  return [free[0], free[1]];
});

/* 合成盖印：五级「极」 */
await page.evaluate(([a, b]) => { const d = window.__legion; d.clearField(); d.addUnit('mage', 4, a, 1); d.addUnit('mage', 4, b, 1); }, twoCells);
await page.waitForTimeout(200);
await page.evaluate(([a, b]) => window.__legion.mergeAt(a, b), twoCells);
await page.waitForTimeout(160);
await shot(page, 'merge-lv5-stamp');
report.steps.push({ step: 'merge-lv5', state: await page.evaluate(() => window.__legion.state()) });

/* 异兵融「融」（lv1+lv1→lv2，不触发专精弹窗，印章看得清） */
await page.evaluate(([a, b]) => { const d = window.__legion; d.clearField(); d.addUnit('bow', 1, a, -1); d.addUnit('mage', 1, b, -1); }, twoCells);
await page.waitForTimeout(160);
await page.evaluate(([a, b]) => window.__legion.fuseAt(a, b), twoCells);
await page.waitForTimeout(170);
await shot(page, 'fusion-stamp');

/* 选中：朱砂印框 */
await page.evaluate(([a]) => { const d = window.__legion; d.clearField(); d.addUnit('blade', 3, a, 0); d.selectCell(a); }, twoCells);
await page.waitForTimeout(220);
await shot(page, 'selected-seal');
await page.evaluate(() => window.__legion.selectCell(-1));

/* Boss 入场 + 盖印重击 */
await page.evaluate(() => {
  const d = window.__legion; const g = d.game;
  d.clearField();
  const pts = g.board.routePts.center;
  const pathSet = new Set(pts.map((p) => p.y * 9 + p.x));
  let n = 0;
  for (let y = 7; y >= 2 && n < 4; y--) for (let x = 0; x < 9 && n < 4; x++) {
    const i = y * 9 + x;
    if (!pathSet.has(i)) { d.addUnit('bow', 4, i, 0); n++; }
  }
  d.wave(50); d.boss('qilin');
});
await page.waitForTimeout(900);
await shot(page, 'boss-intro');
await page.evaluate(() => { const b = window.__legion.game.battle.boss; if (b) { b.hp = b.maxHp * 0.3; b.abilT = 0.05; b.phaseT = 0; } });
await page.waitForTimeout(1500);
await shot(page, 'boss-ability');
report.steps.push({ step: 'boss', boss: await page.evaluate(() => window.__legion.state().boss) });

/* 帧率压测：满场敌人 + 多兵种开火 */
await page.evaluate(() => {
  const d = window.__legion; d.clearField(true); d.wave(24);
  const pts = d.game.board.routePts.center;
  pts.forEach((p, i) => { if (i % 2 === 0) { const c = p.y * 9 + Math.min(8, p.x + 1); d.addUnit(i % 4 === 0 ? 'mage' : 'bow', 4, c, 0); } });
  for (let i = 0; i < 130; i++) d.spawnAt(i % 3 === 0 ? 'brute' : 'raider', 1 + (i % 40) * 0.4);
});
await page.waitForTimeout(400);
const fps = await page.evaluate(async () => {
  const t0 = performance.now(); let frames = 0;
  await new Promise((res) => { const tick = () => { frames++; if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const ms = performance.now() - t0;
  return { fps: +(frames / (ms / 1000)).toFixed(1), alive: window.__legion.state().enemies };
});
await shot(page, 'swarm');
report.steps.push({ step: 'fps-swarm', fps });

await ctx.close();
await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ fonts, fps, errors: report.errors }, null, 2));