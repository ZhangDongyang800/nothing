import { chromium } from 'playwright-core'
import fs from 'node:fs'
const OUT = '.qa/audit-1127'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const errors = []
const out = []
async function mk(w, h, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('http://localhost:5273/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  return { ctx, page }
}
// 桌面：游戏区对齐 + zone-note
{
  const { ctx, page } = await mk(1440, 900, false)
  await page.evaluate(() => document.querySelector('#games').scrollIntoView())
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/fix-games-1440.png` })
  out.push(await page.evaluate(() => ({
    note: document.querySelector('.games .zone-note').textContent.trim(),
    names: [...document.querySelectorAll('.cab')].map(c => {
      const t = c.querySelector('.cab-top').getBoundingClientRect()
      const n = c.querySelector('.cab-name').getBoundingClientRect()
      return { g: c.dataset.game, leftGap: Math.round(n.left - t.left) }
    })
  })))
  await ctx.close()
}
// 手机：军团顶栏不再折行
{
  const { ctx, page } = await mk(390, 844, true)
  await page.tap('.cab[data-game="legion"]')
  await page.waitForTimeout(900)
  const bar = await page.evaluate(() => {
    const n = document.querySelector('.m-name'), t = document.querySelector('.m-tag')
    const nr = n.getBoundingClientRect(), tr = t.getBoundingClientRect()
    return { nameH: Math.round(nr.height), nameLines: Math.round(nr.height / parseFloat(getComputedStyle(n).fontSize) / 1.4), tagH: Math.round(tr.height), barH: Math.round(document.querySelector('.machine-top').getBoundingClientRect().height), tagText: t.textContent }
  })
  out.push({ legionBar390: bar })
  await page.screenshot({ path: `${OUT}/fix-legion-top-390.png` })
  // 关掉重开砖块，确认顶栏与台面正常
  await page.tap('.m-close'); await page.waitForTimeout(350)
  await page.tap('.cab[data-game="brick"]'); await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/fix-brick-390.png` })
  out.push({ overflow390: await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth) })
  await ctx.close()
}
// 手机首页：卡片标题对齐
{
  const { ctx, page } = await mk(390, 844, true)
  await page.evaluate(() => document.querySelector('#games').scrollIntoView())
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/fix-games-390.png` })
  await ctx.close()
}
out.push({ errors })
fs.writeFileSync(`${OUT}/verify.json`, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
await browser.close()
