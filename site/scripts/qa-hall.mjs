import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'http://localhost:5274/';
const OUT = path.resolve('.qa');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const report = { base: BASE, generatedAt: new Date().toISOString(), cases: [] };

async function openPage(width, height, userAgent, isMobile = false) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, userAgent, isMobile, hasTouch: isMobile, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  return { context, page, errors };
}

async function probeDownload(page, href) {
  const url = new URL(href, BASE).href;
  try {
    const raw = execFileSync('curl.exe', ['-sS', '-I', '-L', '--max-time', '30', url], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const blocks = raw.split(/\r?\n\r?\n/).filter((b) => b.trim());
    const last = blocks[blocks.length - 1] || '';
    const status = Number((/HTTP\/[\d.]+ (\d+)/.exec(last) || [])[1] || 0);
    const type = (/content-type:\s*([^\r\n]+)/i.exec(last) || [])[1]?.trim() || '';
    const length = (/content-length:\s*(\d+)/i.exec(last) || [])[1] || '';
    return { href, status, type, length };
  } catch {
    return { href, status: 0, type: '', length: '' };
  }
}

{
  const { context, page, errors } = await openPage(1440, 900);
  const base = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('.zone-title')?.textContent.replace(/\s+/g, ' ').trim(),
    appsTitle: document.querySelector('.apps-head h2')?.textContent.trim(),
    copy: document.body.innerText.replace(/\s+/g, ' ').trim(),
    zones: {
      download: !!document.querySelector('#download'),
      games: !!document.querySelector('#games'),
      gamesFirst: document.querySelector('#games')?.getBoundingClientRect().top < document.querySelector('#download')?.getBoundingClientRect().top,
      nav: Array.from(document.querySelectorAll('.bar-nav a')).map((a) => a.textContent.replace(/\s+/g, ' ').trim()),
    },
    cards: document.querySelectorAll('[data-game]').length,
    cardOrder: Array.from(document.querySelectorAll('[data-game]')).map((c) => c.querySelector('.cab-name')?.textContent.trim()),
    apps: document.querySelectorAll('.app-card').length,
    downloads: Array.from(document.querySelectorAll('.app-dl')).map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent.replace(/\s+/g, ' ').trim(),
    })),
    toolbox: {
      name: document.querySelector('.app-toolbox .app-name')?.textContent.trim(),
      note: document.querySelector('.app-toolbox .app-facts')?.textContent.replace(/\s+/g, ' ').trim(),
    },
    docWidth: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));

  const downloadChecks = [];
  for (const d of base.downloads) {
    const dl = await probeDownload(page, d.href);
    downloadChecks.push({ href: d.href, text: d.text, status: dl.status, type: dl.type, length: dl.length });
  }

  await page.screenshot({ path: path.join(OUT, 'hall-desktop.png') });
  await page.evaluate(() => document.querySelector('#games')?.scrollIntoView());
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, 'hall-games.png') });
  await page.evaluate(() => document.querySelector('#download')?.scrollIntoView());
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, 'hall-app.png') });

  const opened = [];
  const cards = page.locator('[data-game]');
  for (let i = 0; i < await cards.count(); i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(160);
    const state = await page.evaluate(() => ({
      modal: document.querySelector('#modal')?.classList.contains('is-on'),
      name: document.querySelector('#mName')?.textContent.trim(),
      no: document.querySelector('#mNo')?.textContent.trim(),
      body: getComputedStyle(document.body).overflow,
      rot: (() => { const b = document.querySelector('#mRot')?.getBoundingClientRect(); return !!b && b.width > 0 && b.height > 0; })(),
    }));
    opened.push(state);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }

  await page.locator('[data-game]').nth(0).click();
  await page.waitForTimeout(160);
  await page.screenshot({ path: path.join(OUT, 'hall-machine.png') });
  await page.keyboard.press('Escape');

  report.cases.push({ viewport: 'desktop', base, downloads: downloadChecks, opened, errors });
  await context.close();
}

{
  const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const { context, page, errors } = await openPage(390, 844, ANDROID_UA, true);
  const mobile = await page.evaluate(() => ({
    inner: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    cards: document.querySelectorAll('[data-game]').length,
    note: document.querySelector('.hero-copy')?.textContent.replace(/\s+/g, ' ').trim(),
    zoneNote: document.querySelector('.zone-note')?.textContent.replace(/\s+/g, ' ').trim(),
    foot: document.querySelector('.foot-actions')?.getBoundingClientRect().width,
    apps: document.querySelectorAll('.app-card').length,
    downloads: Array.from(document.querySelectorAll('.app-dl')).map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent.replace(/\s+/g, ' ').trim(),
      visible: a.getBoundingClientRect().width > 0 && a.getBoundingClientRect().height > 0,
    })),
  }));
  const downloadChecks = [];
  for (const d of mobile.downloads) {
    const mres = await probeDownload(page, d.href);
    downloadChecks.push({ ...d, status: mres.status, type: mres.type, length: mres.length });
  }
  await page.screenshot({ path: path.join(OUT, 'hall-mobile.png') });
  await page.evaluate(() => document.querySelector('#download')?.scrollIntoView());
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, 'hall-mobile-app.png') });
  await page.evaluate(() => { document.body.scrollTop = document.body.scrollHeight; });
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, 'hall-mobile-bottom.png') });
  await page.evaluate(() => { document.body.scrollTop = 0; });
  await page.locator('[data-game="run"]').click();
  await page.waitForTimeout(180);
  const runRot = await page.evaluate(() => {
    const b = document.querySelector('#mRot');
    const r = b?.getBoundingClientRect();
    return { visible: !!r && r.width > 0, label: b?.textContent.replace(/\s+/g, ' ').trim() };
  });
  await page.screenshot({ path: path.join(OUT, 'hall-run-mobile.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.locator('[data-game="paper"]').click();
  await page.waitForTimeout(160);
  const paperRot = await page.evaluate(() => {
    const r = document.querySelector('#mRot')?.getBoundingClientRect();
    return !!r && r.width > 0;
  });
  await page.screenshot({ path: path.join(OUT, 'hall-machine-mobile.png') });
  report.cases.push({ viewport: 'mobile', mobile, runRot, paperRot, downloads: downloadChecks, errors });
  await context.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'report-hall.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const isRemote = !BASE.includes('localhost');
const desktop = report.cases.find((c) => c.viewport === 'desktop');
const mobile = report.cases.find((c) => c.viewport === 'mobile');
const bothKinds = (list) => list.some((d) => d.href.endsWith('.exe')) && list.some((d) => d.href.endsWith('.apk'));
const toolboxLinks = (list) => list.filter((d) => /Toolbox-Setup-0\.\d+\.\d+\.exe/i.test(d.href));
const expectedOrder = ['墨潮', '走墨', '破砖', '砖块', '垒塔', '叠山', '稿纸', '抽词', '敲印'];
const bad = report.cases.flatMap((c) => c.errors).length
  || (isRemote && [...desktop.downloads, ...mobile.downloads].some((d) => d.status !== 200))
  || !bothKinds(desktop.downloads)
  || !bothKinds(mobile.mobile.downloads)
  || toolboxLinks(desktop.downloads).length !== 1
  || toolboxLinks(mobile.mobile.downloads).length !== 1
  || desktop.downloads.length !== 3
  || mobile.mobile.downloads.length !== 3
  || mobile.mobile.downloads.some((d) => !d.visible)
  || desktop.base.apps !== 2
  || mobile.mobile.apps !== 2
  || desktop.base.copy.includes('写作之外')
  || desktop.base.copy.includes('十二台小机器')
  || mobile.mobile.zoneNote?.includes('写作之外')
  || mobile.runRot?.visible
  || mobile.paperRot
  || desktop.opened.some((o) => o.rot)
  || !desktop.base.zones.download
  || !desktop.base.zones.games
  || !desktop.base.zones.gamesFirst
  || desktop.base.cardOrder.join('|') !== expectedOrder.join('|')
  || desktop.base.toolbox.name !== '工具箱'
  || !desktop.base.toolbox.note?.includes('双击')
  || mobile.mobile.doc > mobile.mobile.inner
  || desktop.opened.filter((o) => o.modal).length !== 9;
if (bad) process.exit(1);

