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
await pg.click('.cab[data-game="legion"]')
await pg.waitForTimeout(1000)
console.log('hook', await pg.evaluate(() => !!window.__legion))

await pg.evaluate(() => {
  const L = window.__legion
  L.start()
  L.god(true)
  L.unlockAll()
  L.give(900, 900)
})
await pg.waitForTimeout(700)

// 十种兵各摆一个，看剪影与徽记
const placed = await pg.evaluate(() => {
  const L = window.__legion
  const spots = L.spots()
  const kinds = ['blade', 'spear', 'bow', 'cavalry', 'mage', 'engineer', 'warlock', 'lance', 'halberd', 'pyro']
  const out = []
  kinds.forEach((k, i) => {
    const c = spots[i * 2]
    if (c === undefined) return
    out.push([k, L.addUnit(k, i % 3 === 0 ? 4 : 2, c)])
  })
  return out
})
console.log('placed', JSON.stringify(placed))
await pg.waitForTimeout(900)
await pg.screenshot({ path: `${OUT}/legion-units.png` })

// 开战 + 九种敌军
await pg.evaluate(() => {
  const L = window.__legion
  L.beginWave()
  const ks = ['raider', 'runner', 'brute', 'gunner', 'bomber', 'splitter', 'hexer', 'champion', 'breaker']
  ks.forEach((k, i) => L.spawnAt(k, 0.12 + i * 0.055, undefined, i % 4 === 0))
})
await pg.waitForTimeout(1600)
await pg.screenshot({ path: `${OUT}/legion-wave.png` })

await pg.evaluate(() => window.__legion.fight(2.5))
await pg.waitForTimeout(500)
await pg.screenshot({ path: `${OUT}/legion-fight.png` })

// Boss
await pg.evaluate(() => { window.__legion.boss('iron'); window.__legion.fight(1.2) })
await pg.waitForTimeout(1400)
await pg.screenshot({ path: `${OUT}/legion-boss.png` })

const st = await pg.evaluate(() => window.__legion.state())
console.log('state', JSON.stringify(st).slice(0, 300))
const perf = await pg.evaluate(() => window.__legion.perf(90))
console.log('perf', JSON.stringify(perf).slice(0, 300))
console.log('errors', errs.length, errs.slice(0, 5))
await b.close()
