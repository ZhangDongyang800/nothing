/* 第四轮验收：作者提的六点。
 * 墨潮 —— 构筑条不再压战场、敌弹朱红。
 * 军团 —— 候选卡不再被灰块盖住、等级刻度、精锐朱印、异兵融印与演出。
 * 跑法：先 npm run dev（5273），再 node site/scripts/probe-r4-visual.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = 'http://localhost:5273/'
const OUT = 'D:/Projects/TxxT-Play/site/.qa/r4'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
fs.mkdirSync(OUT, { recursive: true })

const b = await chromium.launch({ executablePath: CHROME, headless: true })
const pg = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errs = []
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message))


/* 升级面板会一直冒出来把画面压暗；截图时临时藏掉，截完还原。 */
const hideOverlay = () => pg.evaluate(() => { const o = document.getElementById('rgOverlay'); if (o) o.style.visibility = 'hidden' })
const showOverlay = () => pg.evaluate(() => { const o = document.getElementById('rgOverlay'); if (o) o.style.visibility = '' })
const shoot = async (name, clip) => {
  await hideOverlay()
  await pg.waitForTimeout(80)
  await pg.screenshot(clip ? { path: `${OUT}/${name}.png`, clip } : { path: `${OUT}/${name}.png` })
  await showOverlay()
}
/* ---------------- 墨潮 ---------------- */
await pg.goto(BASE, { waitUntil: 'networkidle' })
await pg.click('.cab[data-game="rogue"]')
await pg.waitForTimeout(900)
console.log('rogue hook', await pg.evaluate(() => !!window.__rogue))

// 复刻作者截图的局面：Lv22 左右，六武器 + 十被动
await pg.evaluate(() => {
  const R = window.__rogue
  R.start()
  R.god(true)
  R.warp(200)
  for (const id of ['feibai', 'thunder', 'ember', 'orbit', 'seek', 'laser']) R.give(id, 5)
  for (const id of ['damage', 'attackSpeed', 'crit', 'critMul', 'move', 'hp', 'regen', 'armor', 'xp', 'area']) R.passive(id, 4)
})
await pg.waitForTimeout(900)

// warp 会连着弹好几次升级面板，先按 1 逐个选掉，否则画面被面板压暗
for (let i = 0; i < 16; i++) {
  const card = await pg.$('.rg-offers > *')
  if (!card) break
  await card.click()
  await pg.waitForTimeout(260)
}
await pg.waitForTimeout(400)

const build = await pg.evaluate(() => {
  const el = document.querySelector('.rg-build')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cv = document.querySelector('.rg canvas')
  const cr = cv ? cv.getBoundingClientRect() : null
  return {
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    chips: document.querySelectorAll('.rg-build .rg-chip').length,
    canvasH: cr ? Math.round(cr.height) : 0,
    coverPct: cr ? +(r.height / cr.height * 100).toFixed(1) : 0,
  }
})
console.log('build', JSON.stringify(build))
await shoot('rogue-build')

// 悬停一个 chip，验名字浮标没有被裁掉
const tip = await pg.evaluate(() => {
  const c = document.querySelector('.rg-build .rg-chip')
  if (!c) return null
  const r = c.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: c.getAttribute('data-name') }
})
if (tip) {
  await pg.mouse.move(tip.x, tip.y)
  await pg.waitForTimeout(350)
  await shoot('rogue-chip-hover', { x: 0, y: 0, width: 760, height: 200 })
  console.log('hover chip', tip.name)
}

// 敌弹：放一批会射击的敌人，等弹幕铺开
await pg.evaluate(() => {
  const R = window.__rogue
  R.killAll()
  for (const k of ['caster', 'chanter', 'warder']) R.spawn(14, k)
})
await pg.waitForTimeout(3000)
for (let i = 0; i < 16; i++) {
  const card = await pg.$('.rg-offers > *')
  if (!card) break
  await card.click()
  await pg.waitForTimeout(260)
}
await pg.waitForTimeout(1200)
const shots = await pg.evaluate(() => {
  const g = window.__rogue.state ? window.__rogue.state() : null
  return g && g.eshots !== undefined ? g.eshots : 'n/a'
})
console.log('eshots', JSON.stringify(shots).slice(0, 120))
await shoot('rogue-eshots')

/* ---------------- 军团 ---------------- */
await pg.goto(BASE, { waitUntil: 'networkidle' })
await pg.click('.cab[data-game="legion"]')
await pg.waitForTimeout(1000)
console.log('legion hook', await pg.evaluate(() => !!window.__legion))

await pg.evaluate(() => {
  const L = window.__legion
  L.start(); L.god(true); L.unlockAll(); L.give(900, 900)
})
await pg.waitForTimeout(700)

// 等级阶梯 1→5 同兵种一排 + 精锐 + 融合兵
const ladder = await pg.evaluate(() => {
  const L = window.__legion
  const spots = L.spots()
  const out = []
  for (let lv = 1; lv <= 5; lv++) out.push(['blade', lv, L.addUnit('blade', lv, spots[(lv - 1) * 2], lv >= 3 ? 0 : -1)])
  out.push(['spear', 3, L.addUnit('spear', 3, spots[10], 0, true)])
  out.push(['bow', 4, L.addUnit('bow', 4, spots[12], 1, true)])
  out.push(['lance', 3, L.addUnit('lance', 3, spots[14])])
  out.push(['halberd', 4, L.addUnit('halberd', 4, spots[16], 0, true)])
  out.push(['pyro', 2, L.addUnit('pyro', 2, spots[18])])
  return out
})
console.log('ladder', JSON.stringify(ladder))
await pg.waitForTimeout(900)
await pg.screenshot({ path: `${OUT}/legion-ladder.png` })
await pg.screenshot({ path: `${OUT}/legion-ladder-zoom.png`, clip: { x: 250, y: 120, width: 420, height: 430 } })

// 候选区：普通 / 精锐 / 融合兵各来一张，量角标尺寸确认灰块没了
await pg.evaluate(() => {
  const L = window.__legion
  L.benchAdd('cavalry', 2)
  L.benchAdd('cavalry', 2)
  L.benchAdd('bow', 2, true)
  L.benchAdd('halberd', 3, true)
})
await pg.waitForTimeout(500)
const bench = await pg.evaluate(() => {
  return [...document.querySelectorAll('#lgBench .lg-slot')].map(n => {
    const r = n.getBoundingClientRect()
    const lv = n.querySelector('.lg-slot-lv')
    const em = n.querySelector('em')
    const lr = lv ? lv.getBoundingClientRect() : null
    const er = em ? em.getBoundingClientRect() : null
    return {
      slot: `${Math.round(r.width)}x${Math.round(r.height)}`,
      lv: lr ? `${Math.round(lr.width)}x${Math.round(lr.height)}` : '-',
      em: er ? `${Math.round(er.width)}x${Math.round(er.height)}` : '-',
      vet: !!em,
    }
  })
})
console.log('bench', JSON.stringify(bench))
await pg.screenshot({ path: `${OUT}/legion-bench.png` })

// 候选区合成：点两张同级同种，抓落定动画
const combined = await pg.evaluate(() => {
  const L = window.__legion
  return { ok: L.benchCombine(0, 1) }
})
console.log('benchCombine', JSON.stringify(combined))
await pg.waitForTimeout(120)
await pg.screenshot({ path: `${OUT}/legion-bench-pop.png` })

// 战场异兵融：spear + cavalry → lance，抓交叉双锋演出
const fused = await pg.evaluate(() => {
  const L = window.__legion
  const spots = L.spots()
  const a = L.addUnit('spear', 4)
  const c = L.addUnit('cavalry', 4)
  return { a, c, ok: L.fuseAt(a, c) }
})
console.log('fuseAt', JSON.stringify(fused))
await pg.waitForTimeout(140)
await pg.screenshot({ path: `${OUT}/legion-fuse-fx.png` })
await pg.waitForTimeout(700)
await pg.screenshot({ path: `${OUT}/legion-fuse-unit.png` })

console.log('perf', JSON.stringify(await pg.evaluate(() => window.__legion.perf(60))).slice(0, 200))
console.log('errors', errs.length, errs.slice(0, 6))
await b.close()