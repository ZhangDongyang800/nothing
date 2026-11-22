// 下载入口硬证据：点一下必须触发浏览器「下载」，而不是把页面导航到别的域。
// 之前三个按钮直链 GitHub Release，跨域 <a download> 会被忽略 —— 点击后整页
// 跳到 github.com 的仓库页，国内还常断流。这里逐个点，验 download 事件与落点。
//
//   $env:QA_BASE='https://115.159.51.233/'; node .qa\probe-download.mjs
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.QA_BASE || 'http://localhost:5274/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();

const navs = [];
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) navs.push(f.url());
});

await page.goto(BASE, { waitUntil: 'networkidle' });

const links = await page.$$eval('.app-dl', (as) =>
  as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim(), dl: a.hasAttribute('download') })),
);

const origin = new URL(BASE).origin;
const results = [];
for (let i = 0; i < links.length; i++) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const waitDl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.locator('.app-dl').nth(i).click();
  const dl = await waitDl;
  const info = dl ? { gotDownload: true, suggested: dl.suggestedFilename(), fromUrl: dl.url() } : { gotDownload: false };
  if (dl) {
    try {
      await dl.cancel();
    } catch {}
  }
  await page.waitForTimeout(500);
  const current = page.url();
  results.push({
    label: links[i].text,
    href: links[i].href,
    sameOrigin: links[i].href.startsWith('/'),
    ...info,
    landedOnGithub: /github(\.com|usercontent\.com)/.test(current),
    pageStillOnSite: current.startsWith(origin),
    currentUrl: current,
  });
}

const bad = results.filter((r) => !r.gotDownload || r.landedOnGithub || !r.sameOrigin || !r.pageStillOnSite);
console.log(JSON.stringify({ base: BASE, results, mainNavs: navs, bad: bad.length }, null, 2));
await browser.close();
process.exit(bad.length ? 1 : 0);
