/* 「纸上军团」笔势机制验收：真实开一局，布阵 → 成阵 → 合击 → 拆阵 → Boss 抹笔 → 结算。
 * 用法：node scripts/qa-legion.mjs [base]
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.argv[2] || 'http://localhost:5273/';
const OUT = path.resolve('.qa/legion-stroke');
fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  return name;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const report = { base: BASE, at: new Date().toISOString(), steps: [], errors: [] };

async function boot(width, height, mobile = false) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, ignoreHTTPSErrors: true,
    hasTouch: mobile, isMobile: mobile,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-game="legion"]').click();
  await page.waitForFunction(() => !!window.__legion, null, { timeout: 8000 });
  await page.waitForTimeout(350);
  return { ctx, page };
}

const state = (page) => page.evaluate(() => window.__legion.state());

/* ---------- 桌面：核心循环 ---------- */
{
  const { ctx, page } = await boot(1440, 900);
  await page.evaluate(() => window.__legion.resetSave());
  await page.waitForTimeout(300);
  await shot(page, '01-start');

  report.steps.push({ step: 'start-screen', state: await state(page) });

  await page.evaluate(() => { window.__legion.start('qingfeng'); window.__legion.give(260, 260); });
  await page.waitForTimeout(220);
  await shot(page, '02-prep-recruit');
  report.steps.push({ step: 'prep', cards: await page.evaluate(() => window.__legion.cards()) });

  /* 清场后手工布两条笔势：第 3 列竖三、第 5 行横三 */
  await page.evaluate(() => {
    const d = window.__legion;
    d.unlockAll();
    d.clearField();
    d.addUnit('shield', 1, 39);   // col3 row4
    d.addUnit('blade', 1, 48);    // col3 row5
    d.addUnit('bow', 1, 57);      // col3 row6
    d.addUnit('bow', 1, 50);      // row5 x5
    d.addUnit('spear', 1, 51);    // row5 x6
    d.addUnit('blade', 1, 52);    // row5 x7
  });
  await page.waitForTimeout(500);
  await shot(page, '03-strokes-formed');
  const strokes = await page.evaluate(() => window.__legion.strokesInfo());
  report.steps.push({ step: 'strokes', strokes, state: await state(page) });

  /* 选中棋子：看选中面板如何说明笔势 */
  await page.evaluate(() => window.__legion.selectCell(51));
  await page.waitForTimeout(200);
  await shot(page, '03b-inspect');
  await page.evaluate(() => window.__legion.selectCell(-1));

  /* 召来敌人，让笔势真的打出去；行 5 对应 prog 12 */
  await page.evaluate(() => {
    const d = window.__legion;
    [12.0, 11.9, 12.14, 11.78, 12.3].forEach((p) => d.spawnAt('raider', p));
  });
  await page.waitForTimeout(180);
  await page.evaluate(() => window.__legion.fireStrokes());
  await page.waitForTimeout(90);
  await shot(page, '04-stroke-fire');
  await page.waitForTimeout(400);
  const afterFire = await page.evaluate(() => ({ enemies: window.__legion.enemiesInfo(), dmg: window.__legion.state().damage }));
  report.steps.push({ step: 'stroke-fire', afterFire });

  /* 合成取舍：拖住一个同名棋子叠到旁边，看「拆阵」预警 */
  await page.evaluate(() => {
    const d = window.__legion;
    d.clearField();
    d.addUnit('shield', 1, 59);
    d.addUnit('shield', 1, 60);
    d.addUnit('shield', 1, 61);
  });
  await page.waitForTimeout(420);
  const ptA = await page.evaluate(() => window.__legion.cellPoint(60));
  const ptB = await page.evaluate(() => window.__legion.cellPoint(61));
  await page.mouse.move(ptA.x, ptA.y);
  await page.mouse.down();
  await page.mouse.move(ptB.x, ptB.y, { steps: 8 });
  await page.waitForTimeout(420);
  await shot(page, '05-merge-warning');
  report.steps.push({ step: 'merge-preview', drag: await page.evaluate(() => window.__legion.dragInfo()), strokes: await page.evaluate(() => window.__legion.strokesInfo()) });
  await page.mouse.up();
  await page.waitForTimeout(420);
  await shot(page, '06-after-merge');
  report.steps.push({ step: 'after-merge', strokes: await page.evaluate(() => window.__legion.strokesInfo()), state: await state(page) });

  /* 五级合成：反馈分级 */
  await page.evaluate(() => {
    const d = window.__legion;
    d.clearField();
    d.addUnit('mage', 4, 48, 1);
    d.addUnit('mage', 4, 57, 1);
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__legion.mergeAt(48, 57));
  await page.waitForTimeout(160);
  await shot(page, '07-merge-lv5');
  report.steps.push({ step: 'merge-lv5', state: await state(page), units: await page.evaluate(() => window.__legion.unitsInfo()) });

  /* Boss 战：墨麒麟第三段抹笔 */
  await page.evaluate(() => {
    const d = window.__legion;
    d.clearField();
    for (let x = 5; x <= 7; x++) d.addUnit('bow', 3, 9 * 6 + x, 0);
    d.wave(50);
    d.boss('qilin');
  });
  await page.waitForTimeout(900);
  await shot(page, '08-boss-intro');
  const bossShot = await page.evaluate(() => window.__legion.state().boss);
  report.steps.push({ step: 'boss-intro', boss: bossShot });

  await page.evaluate(() => {
    const g = window.__legion.game;
    const b = g.battle.boss;
    if (b) { b.hp = b.maxHp * 0.28; b.abilT = 0.05; b.phaseT = 0; }
    g.battle.spawnEnemy('breaker', false, 7.5);
  });
  await page.waitForTimeout(1400);
  await shot(page, '09-boss-erase');
  report.steps.push({ step: 'boss-erase', strokes: await page.evaluate(() => window.__legion.strokesInfo()), enemies: await page.evaluate(() => window.__legion.enemiesInfo()) });

  /* 断笔者贴阵：笔势应被压制，墨线变「断」 */
  await page.evaluate(() => {
    const d = window.__legion;
    d.clearField();
    for (let x = 5; x <= 7; x++) d.addUnit('bow', 2, 9 * 5 + x, 0);
    d.spawnAt('breaker', 11.0);
  });
  await page.waitForTimeout(1200);
  await shot(page, '10-breaker');
  report.steps.push({
    step: 'breaker',
    strokes: await page.evaluate(() => window.__legion.strokesInfo()),
    hud: await page.evaluate(() => document.getElementById('lgStrokeNum')?.textContent),
    css: await page.evaluate(() => window.__legion.game?.ui?.root?.className ?? 'n/a'),
    enemies: await page.evaluate(() => window.__legion.enemiesInfo()),
  });

  /* 动态反击：带两条笔势进 12 波之后，按「开战」按钮应看到断笔者被追加进敌情 */
  await page.evaluate(() => {
    const d = window.__legion;
    d.end();
    d.startScreen();
    d.start('qingfeng');
    d.unlockAll();
    d.clearField();
    for (let x = 5; x <= 7; x++) d.addUnit('bow', 2, 9 * 5 + x, 0);
    for (let x = 5; x <= 7; x++) d.addUnit('blade', 2, 9 * 2 + x, 0);
    d.wave(18);
  });
  await page.waitForTimeout(260);
  await shot(page, '10c-counter');
  await page.locator('.lg-start-wave').click();
  await page.waitForTimeout(400);
  await shot(page, '10d-counter-wave');
  report.steps.push({
    step: 'dynamic-counter',
    phase: await page.evaluate(() => window.__legion.state().phase),
    strokes: await page.evaluate(() => window.__legion.strokesInfo()),
    queue: await page.evaluate(() => {
      const g = window.__legion.game;
      return { wave: g.wave, total: g.queue.length, kinds: [...new Set(g.queue.map((r) => r.kind))], breakers: g.queue.filter((r) => r.kind === 'breaker').length };
    }),
  });

  /* 压测：满场敌人时的真实帧率（不是只测 battle.update） */
  await page.evaluate(() => {
    const d = window.__legion;
    d.clearField(true);
    d.wave(24);
    for (let i = 0; i < 130; i++) d.spawnAt(i % 3 === 0 ? 'brute' : 'raider', 1 + (i % 40) * 0.4);
  });
  await page.waitForTimeout(300);
  const fps = await page.evaluate(async () => {
    const t0 = performance.now();
    let frames = 0;
    await new Promise((res) => {
      const tick = () => { frames++; if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    const ms = performance.now() - t0;
    return { frames, ms: Math.round(ms), fps: +(frames / (ms / 1000)).toFixed(1), alive: window.__legion.state().enemies };
  });
  await shot(page, '10b-swarm');
  report.steps.push({ step: 'fps-swarm', fps, upd: await page.evaluate(() => window.__legion.perf(160)) });

  /* 长局稳定性：机器人自跑 12 分钟游戏内时间 */
  await page.evaluate(() => window.__legion.resetSave());
  await page.evaluate(() => { window.__legion.start('qingfeng'); window.__legion.speed(2); });
  const sim = await page.evaluate(() => window.__legion.simulate(720, true));
  await shot(page, '11-sim');
  report.steps.push({ step: 'simulate-720', state: sim });

  const perf = await page.evaluate(() => window.__legion.perf(140));
  report.steps.push({ step: 'perf', perf });

  /* 强化三选一 */
  await page.evaluate(() => window.__legion.openDraft());
  await page.waitForTimeout(320);
  await shot(page, '11b-draft');
  await page.evaluate(() => window.__legion.closeOverlay());

  /* 结算界面 */
  await page.evaluate(() => { window.__legion.end(); });
  await page.waitForTimeout(400);
  await shot(page, '12-results');
  report.steps.push({ step: 'results', state: await state(page) });

  await ctx.close();
}

/* ---------- 手机竖屏 ---------- */
{
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: UA, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push(`m-pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('[data-game="legion"]').click();
  await page.waitForFunction(() => !!window.__legion, null, { timeout: 8000 });
  await page.waitForTimeout(300);
  await shot(page, 'm01-start');
  await page.evaluate(() => {
    const d = window.__legion;
    d.start('qingfeng');
    d.unlockAll();
    d.give(200, 200);
    d.clearField();
    for (let x = 5; x <= 7; x++) d.addUnit('bow', 2, 9 * 5 + x, 0);
    d.addUnit('shield', 1, 39);
    d.addUnit('blade', 1, 48);
    d.addUnit('spear', 1, 57);
  });
  await page.waitForTimeout(700);
  await shot(page, 'm02-strokes');
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    strokes: window.__legion.strokesInfo(),
    layout: window.__legion.layout(),
  }));
  report.steps.push({ step: 'mobile', m });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
