import { chromium } from 'playwright-core'

const BASE = 'http://localhost:5273/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const b = await chromium.launch({ executablePath: CHROME, headless: true })
const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errs = []
pg.on('pageerror', e => errs.push(e.message))
await pg.goto(BASE, { waitUntil: 'networkidle' })
await pg.click('.cab[data-game="rogue"]')
await pg.waitForTimeout(900)
await pg.evaluate(() => { const g = window.__rogue; g.start('moke'); g.god(true); g.warp(240); g.give('bi', 6); g.give('zhen', 5); g.give('shan', 4) })
await pg.waitForTimeout(600)
for (let i = 0; i < 6; i++) {
  const ph = await pg.evaluate(() => window.__rogue.state().phase)
  if (ph !== 'levelup') break
  await pg.keyboard.press('Digit1'); await pg.waitForTimeout(300)
}
await pg.evaluate(() => window.__rogue.spawn(220))
await pg.waitForTimeout(1200)

const perf = await pg.evaluate(() => new Promise(res => {
  const ts = []
  let last = performance.now(), n = 0
  function tick() {
    const now = performance.now()
    ts.push(now - last); last = now; n++
    if (n < 150) requestAnimationFrame(tick)
    else {
      ts.sort((a, b) => a - b)
      res({
        frames: ts.length,
        median: +ts[Math.floor(ts.length / 2)].toFixed(2),
        p95: +ts[Math.floor(ts.length * 0.95)].toFixed(2),
        max: +ts[ts.length - 1].toFixed(2),
        enemies: window.__rogue.state().enemies,
      })
    }
  }
  requestAnimationFrame(tick)
}))
console.log('ROGUE_PERF', JSON.stringify(perf))
console.log('errors', errs.length, errs.slice(0, 3))
await b.close()
