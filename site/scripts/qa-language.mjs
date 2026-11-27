/* 语言验收探针：逐台检查玩家可见文案是否符合 docs/game-terminology-glossary.md。
 * 用法：先 `npm run dev`（5273），再 `node scripts/qa-language.mjs`。
 * 截图与报告落在 site/.qa/（7 天保留期，不入库）。 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:5273/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = path.resolve('.qa');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  if (!ok) console.log('FAIL', name, detail);
}
const text = (sel) => page.locator(sel).first().textContent().then((t) => (t || '').trim()).catch(() => '');
const shot = (name) => page.screenshot({ path: path.join(OUT, `lang-${name}.png`) });
const wait = (ms) => page.waitForTimeout(ms);

async function openCab(game) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.click(`[data-game="${game}"]`);
  await wait(500);
}
async function closeCab() {
  await page.click('.machine-top [data-close]');
  await wait(300);
}

await page.goto(BASE, { waitUntil: 'networkidle' });

/* ---------- 稿纸 ---------- */
await openCab('paper');
check('paper/初始状态', (await text('#state')).includes('点纸就写'));
await page.click('#paper .col');
await page.keyboard.type('山高水长');
await page.keyboard.press('Enter');
await page.click('#mSeal');
await wait(400);
check('paper/盖章状态', (await text('#state')).includes('盖章'), await text('#state'));
check('paper/落印title', (await page.getAttribute('#mSeal', 'title') || '').includes('完成本页'));
await shot('paper');
await closeCab();

/* ---------- 抽词 ---------- */
await openCab('word');
check('word/看一眼成本', (await text('#pairPeek')).includes('耗 2 步'));
await page.click('#pairGo');
await wait(1600);
const hintW = await text('#mHint');
check('word/档位提示无黑话', !hintW.includes('预展') && !hintW.includes('近形'), hintW);
await shot('word');
await closeCab();

/* ---------- 砖块 ---------- */
await openCab('brick');
check('brick/计步单位', (await text('.brk-hud')).includes('步'));
const piece = page.locator('#brkTray .bpiece:not(.is-used)').first();
if (await piece.count()) {
  await piece.click();
  await page.click('#brkBoard .bcell:nth-child(28)');
  await wait(300);
}
check('brick/落子计步', /^\d+$/.test(await text('#brkHand')), await text('#brkHand'));
await shot('brick');
await closeCab();

/* ---------- 叠山 ---------- */
await openCab('merge');
check('merge/最大标签', (await text('.merge-hud')).includes('最大'));
check('merge/提示含目标', (await text('#mHint')).includes('天'));
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowDown');
await wait(300);
await shot('merge');
await closeCab();

/* ---------- 敲印 ---------- */
await openCab('tap');
const tapTips = await page.locator('#tapStart .g-start-tip').allTextContents();
check('tap/开局第二行', tapTips.some((t) => t.includes('漏掉好印也扣命')), tapTips.join('|'));
await page.click('#tapGo');
await wait(1200);
check('tap/关卡单位', (await text('.tap-hud')).includes('关'));
check('tap/开局后提示切换', !(await text('#mHint')).includes('按开始'), await text('#mHint'));
await shot('tap');
await closeCab();

/* ---------- 走墨 ---------- */
await openCab('run');
const runTips = await page.locator('#runStart .g-start-tip').allTextContents();
check('run/开局第二行', runTips.some((t) => t.includes('红顶高墙')), runTips.join('|'));
await page.click('#runGo');
await wait(800);
await page.keyboard.press('Space');
await wait(600);
check('run/提示无术语', !(await text('#mHint')).includes('二段跳补'));
check('run/开局后提示切换', !(await text('#mHint')).includes('按开始'), await text('#mHint'));
await shot('run');
await closeCab();

/* ---------- 垒塔 ---------- */
await openCab('stack');
const stackTips = await page.locator('#stackStart .g-start-tip').allTextContents();
check('stack/开局第二行', stackTips.some((t) => t.includes('完全没搭上下层')), stackTips.join('|'));
await page.click('#stackGo');
await wait(500);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await wait(650); }
check('stack/开局后提示切换', !(await text('#mHint')).includes('按开始'), await text('#mHint'));
await shot('stack');
await closeCab();

/* ---------- 破砖 ---------- */
await openCab('break');
const ballTitle = await page.locator('#bkLife').locator('xpath=..').getAttribute('title');
check('break/球title', (ballTitle || '').includes('备用球'), ballTitle || '');
const box = await page.locator('#bkCanvas').boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
  await wait(1500);
  await page.mouse.move(box.x + box.width / 3, box.y + box.height - 30);
  await wait(1500);
}
await shot('break');
await closeCab();

/* ---------- 纸上军团 ---------- */
await openCab('legion');
await wait(600);
await page.click('.lg-start [data-act="help"]');
await wait(300);
const help = await text('.lg-help-body');
check('legion/帮助成阵规则', help.includes('相邻连成一线'), help.slice(0, 80));
check('legion/帮助断笔者', help.includes('暂停该线合击'));
check('legion/帮助货币', help.includes('金币') && !help.includes('金铢'));
await shot('legion-help');
await page.click('.lg-help [data-close]');
await wait(200);
await page.evaluate(() => { window.__legion.start('qingfeng'); window.__legion.give(300, 300); });
await wait(400);
await page.evaluate(() => {
  const d = window.__legion;
  d.unlockAll(); d.clearField();
  d.addUnit('blade', 1, 39); d.addUnit('blade', 1, 48); d.addUnit('bow', 1, 57);
});
await wait(300);
await page.click('.lg-tools [data-act="pause"]');
await wait(300);
const pause = await text('.lg-pause');
check('legion/暂停按钮', pause.includes('继续守卫') && pause.includes('返回游戏厅'), pause.slice(0, 120));
await shot('legion-pause');
await page.click('.lg-pause [data-act="meta"]');
await wait(300);
const meta = await text('.lg-meta');
check('legion/局外金币', meta.includes('金币') && !meta.includes('金铢') && !meta.includes('兵书'));
check('legion/永久强化页签', meta.includes('永久强化'));
await shot('legion-meta');
await page.click('.lg-meta [data-close]');
await wait(200);
await page.click('.lg-pause [data-act="resume-run"]').catch(() => {});
await closeCab();

/* ---------- 墨潮 ---------- */
await openCab('rogue');
await wait(600);
check('rogue/开始按钮', (await text('.rg-go[data-act="start"]')).includes('开始游戏'));
await page.click('.rg-go[data-act="start"]');
await wait(1500);
check('rogue/货币图标', (await text('.rg-stat[title*="铜钱"] i')) === '钱');
await page.keyboard.press('p');
await wait(300);
const rPause = await text('.rg-overlay');
check('rogue/暂停标题', rPause.includes('暂停') && rPause.includes('放弃本局'));
await shot('rogue-pause');

/* ---------- 汇总 ---------- */
const failed = checks.filter((c) => !c.ok);
const report = { base: BASE, at: new Date().toISOString(), checks, errors, failed: failed.length };
fs.writeFileSync(path.join(OUT, 'report-language.json'), JSON.stringify(report, null, 2));
console.log(`checks ${checks.length}, failed ${failed.length}, console errors ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10));
await browser.close();
process.exit(failed.length || errors.length ? 1 : 0);