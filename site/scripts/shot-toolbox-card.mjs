import { chromium } from 'playwright-core'
import fs from 'node:fs'
const OUT = '.qa'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const cases = [
  { name: 'desktop', width: 1600, height: 900, mobile: false },
  { name: 'laptop', width: 1280, height: 800, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true }
]
const report = []
for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: c.mobile, hasTouch: c.mobile })
  const page = await ctx.newPage()
  await page.goto('http://localhost:5274/', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  const info = await page.evaluate(() => {
    const card = document.querySelector('.app-toolbox')
    const line = card.querySelector('.app-line')
    const dl = card.querySelector('.app-dl')
    const r = card.getBoundingClientRect()
    return {
      card: { w: Math.round(r.width), h: Math.round(r.height) },
      line: line.textContent.trim(),
      lineH: Math.round(line.getBoundingClientRect().height),
      dlText: dl.querySelector('b')?.textContent.trim(),
      dlHref: dl.getAttribute('href'),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }
  })
  await page.locator('.app-toolbox').screenshot({ path: `${OUT}/toolbox-card-${c.name}.png` })
  await page.screenshot({ path: `${OUT}/hall-${c.name}.png` })
  report.push({ case: c.name, ...info })
  await ctx.close()
}
fs.writeFileSync(`${OUT}/toolbox-card.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await browser.close()