import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = 'http://localhost:5273/'
const OUT = 'D:/Projects/TxxT-Play/site/.qa/r3'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fs.mkdirSync(OUT, { recursive: true })

const b = await chromium.launch({ executablePath: CHROME, headless: true })
const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errs = []
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message))

await pg.goto(BASE, { waitUntil: 'networkidle' })
await pg.click('.cab[data-game="rogue"]')
await pg.waitForTimeout(900)

const has = await pg.evaluate(() => !!window.__rogue)
console.log('hook', has)

await pg.evaluate(() => { window.__rogue.start('moke'); window.__rogue.god(true) })
await pg.waitForTimeout(600)

// 敌人图鉴：每种放几只，围成一圈看清楚轮廓
const kinds = ['mote', 'streak', 'caster', 'heavy', 'bomber', 'splitter', 'weaver', 'warder', 'phantom', 'chanter', 'shard']
await pg.evaluate((ks) => {
  const g = window.__rogue
  for (const k of ks) g.spawn(3, k)
}, kinds)
await pg.waitForTimeout(1400)
await pg.screenshot({ path: `${OUT}/rogue-kinds.png` })

// 战斗：推进时间 + 给武器，看弹体与命中
await pg.evaluate(() => {
  const g = window.__rogue
  g.warp(150)
  g.give('bi', 5); g.give('zhen', 4); g.give('shan', 3)
  g.spawn(40)
})
await pg.waitForTimeout(2200)
await pg.screenshot({ path: `${OUT}/rogue-combat.png` })

// 升级面板会挡住画面，探针一律直选第一项
async function settle() {
  for (let i = 0; i < 8; i++) {
    const ph = await pg.evaluate(() => window.__rogue.state().phase)
    if (ph !== 'levelup') return
    await pg.keyboard.press('Digit1')
    await pg.waitForTimeout(320)
  }
}
await settle()

// 死亡潮：一次清场，看分类死亡特效。
// 清场会立刻触发落笔面板，探针临时把面板藏起来只看画布层（截完还原）。
await settle()
await pg.evaluate(() => window.__rogue.spawn(26))
await pg.waitForTimeout(500)
await pg.evaluate(() => {
  window.__rogue.killAll()
  const o = document.getElementById('rgOverlay')
  if (o) { o.dataset.qaHide = '1'; o.style.visibility = 'hidden' }
})
await pg.waitForTimeout(130)
await pg.screenshot({ path: `${OUT}/rogue-death.png` })
await pg.evaluate(() => {
  const o = document.getElementById('rgOverlay')
  if (o && o.dataset.qaHide) { o.style.visibility = ''; delete o.dataset.qaHide }
})
await settle()

// Boss
await pg.evaluate(() => { window.__rogue.boss(); window.__rogue.spawn(14) })
await pg.waitForTimeout(2000)
await settle()
await pg.waitForTimeout(1200)
await pg.screenshot({ path: `${OUT}/rogue-boss.png` })

const st = await pg.evaluate(() => window.__rogue.state())
console.log('state', JSON.stringify(st).slice(0, 400))
console.log('errors', errs.length, errs.slice(0, 5))
await b.close()
