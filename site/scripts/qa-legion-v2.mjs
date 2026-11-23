import { chromium } from 'playwright-core'
import fs from 'node:fs'

const BASE = process.argv[2] || 'http://localhost:5273/'
const DIR = '.qa/v2'
fs.mkdirSync(DIR, { recursive: true })
const report = { when: new Date().toISOString(), base: BASE, steps: [] }

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

async function boot(browser, w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, ignoreHTTPSErrors: true, ...opts })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => report.steps.push({ step: 'pageerror', msg: e.message }))
  page.on('console', (m) => { if (m.type() === 'error') report.steps.push({ step: 'console-error', msg: m.text() }) })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
  await page.locator('[data-game="legion"]').click({ timeout: 60000 })
  await page.waitForFunction(() => !!window.__legion)
  await page.waitForTimeout(260)
  return { ctx, page }
}

const shot = async (page, name) => { await page.screenshot({ path: `${DIR}/${name}.png` }) }
const state = (page) => page.evaluate(() => window.__legion.state())

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/* ---------------- 桌面 1440×900 ---------------- */
{
  const { ctx, page } = await boot(browser, 1440, 900)
  await page.evaluate(() => window.__legion.resetSave())
  await page.waitForTimeout(300)
  await shot(page, '01-start-screen')

  await page.evaluate(() => { window.__legion.start('qingfeng'); window.__legion.unlockAll(); window.__legion.give(400, 400) })
  await page.waitForTimeout(400)
  const geo = await page.evaluate(() => ({
    route: window.__legion.route(),
    spots: window.__legion.spots().slice(0, 14),
    routePts: window.__legion.game.board.routePts.center.map((p) => [Math.round(p.x), Math.round(p.y)]),
    len: +window.__legion.game.board.routeLen.center.toFixed(2),
    seg: +(window.__legion.game.board.routePts.center.length > 1
      ? window.__legion.game.board.routeLen.center / (window.__legion.game.board.routePts.center.length - 1) : 0).toFixed(2),
  }))
  report.steps.push({ step: 'route-geometry', geo })
  await shot(page, '02-route-prep')

  /* 布局：沿路左右交错摆一排兵，验证贴路布阵可行 */
  const placed = await page.evaluate(() => {
    const d = window.__legion
    const spots = d.spots()
    const kinds = ['blade', 'spear', 'spear', 'bow', 'cavalry', 'mage', 'halberd', 'blade']
    const used = []
    for (let i = 0; i < kinds.length; i++) {
      const cell = spots[i * 2]
      if (cell === undefined) break
      d.addUnit(kinds[i], 2, cell, 0)
      used.push(cell)
    }
    return { used, units: d.unitsInfo().length }
  })
  await page.waitForTimeout(400)
  const onPath = await page.evaluate(() => {
    const d = window.__legion
    const path = new Set(d.route())
    return d.unitsInfo().filter((u) => path.has(u.cell)).map((u) => ({ kind: u.kind, cell: u.cell }))
  })
  report.steps.push({ step: 'deploy-along-route', placed, unitsOnPath: onPath })
  await shot(page, '03-deployed')

  /* 敌人可读性：尺寸跟着格子、满血也有血条、排队不叠在一起 */
  const enemyVis = await page.evaluate(() => {
    const d = window.__legion
    const g = d.game
    const b = g.board
    d.clearField()
    const seg = b.segLen()
    d.spawnAt('raider', 4)
    d.spawnAt('raider', 4 + seg * 1.2)
    d.spawnAt('raider', 4 + seg * 2.4)
    d.fight(0.5)
    const info = d.enemiesInfo()
    let minGap = 1e9
    for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
      minGap = Math.min(minGap, Math.round(Math.hypot(info[i].x - info[j].x, info[i].y - info[j].y)))
    }
    const e = info[0]
    return {
      cell: b.cell, rad: info.map((x) => x.rad), radRatio: +(info[0].rad / b.cell).toFixed(3),
      minGap, hpBar: 'always-on（见 15-enemy-scale.png）', sampleX: e.x,
    }
  })
  report.steps.push({ step: 'enemy-visibility', ...enemyVis })
  await shot(page, '15-enemy-scale')

  /* UI 路径：整备期真的点得到「开战」，点完进入战斗波次
     （按钮本身有前置条件：棋盘上至少有一个兵，否则只弹提示） */
  await page.evaluate(() => {
    const d = window.__legion
    if (!d.unitsInfo().some((u) => u.kind !== 'hero')) d.addUnit('blade', 2, d.spots()[0], 0)
    d.prepHold(90)
  })
  await page.waitForTimeout(200)
  await page.locator('.lg-start-wave').click({ timeout: 10000 })
  await page.waitForTimeout(500)
  report.steps.push({ step: 'start-wave-click', st: await page.evaluate(() => {
    const g = window.__legion.game
    return { phase: g.phase, queue: g.queue.length, enemies: window.__legion.state().enemies }
  }) })
  await page.evaluate(() => window.__legion.prepHold(90))
  await page.waitForTimeout(150)

  /* 拐角后的敌人：几何在射程内、进度差很远，弓兵也得开火并打中 */
  const cornerShot = await page.evaluate(() => {
    const d = window.__legion
    const g = d.game
    const b = g.board
    const seq = d.route()
    const n = seq.length
    const path = new Set(seq)
    const spots = d.spots()
    const xy = (i) => [i % 9, Math.floor(i / 9)]
    const progOf = (k) => (k / (n - 1)) * b.routeLen.center
    let pick = null
    for (let i = 1; i < n - 1 && !pick; i++) {
      const [ax, ay] = xy(seq[i])
      for (let k = 5; k <= 8 && !pick; k++) {
        const j = i + k
        if (j >= n) continue
        const ep = b.laneWorld('center', progOf(j))
        for (let dy = -1; dy <= 1 && !pick; dy++) for (let dx = -1; dx <= 1 && !pick; dx++) {
          const cell = (ay + dy) * 9 + (ax + dx)
          if (cell < 0 || path.has(cell) || !spots.includes(cell)) continue
          const c = b.center(cell)
          const geo = Math.hypot(ep.x - c.x, ep.y - c.y) / b.cell
          if (geo > 3.6) continue
          pick = { cell, geo: +geo.toFixed(2), prog: +progOf(j).toFixed(2), progGap: k }
        }
      }
    }
    if (!pick) return { found: false }
    d.clearField()
    d.addUnit('bow', 2, pick.cell, 0)
    d.spawnAt('raider', pick.prog)
    d.fight(0.3)
    const before = d.enemiesInfo()[0]
    d.fight(3)
    const after = d.enemiesInfo()[0]
    return { found: true, pick, hpBefore: before && before.hp, hpAfter: after ? after.hp : 'dead' }
  })
  report.steps.push({ step: 'corner-engage', ...cornerShot })
  await shot(page, '16-corner-shot')

  /* 软追踪：目标一直在走，箭要追上去 */
  const homing = await page.evaluate(() => {
    const d = window.__legion
    const g = d.game
    const b = g.board
    const seq = d.route()
    const n = seq.length
    const path = new Set(seq)
    const spots = d.spots()
    const xy = (i) => [i % 9, Math.floor(i / 9)]
    let setup = null
    for (let i = 2; i < n - 6 && !setup; i++) {
      const [ax, ay] = xy(seq[i])
      for (let dy = -1; dy <= 1 && !setup; dy++) for (let dx = -1; dx <= 1 && !setup; dx++) {
        const cell = (ay + dy) * 9 + (ax + dx)
        if (cell < 0 || path.has(cell) || !spots.includes(cell)) continue
        setup = { cell, prog: +((i / (n - 1)) * b.routeLen.center).toFixed(2) }
      }
    }
    if (!setup) return { found: false }
    d.clearField()
    d.addUnit('bow', 2, setup.cell, 0)
    d.spawnAt('raider', setup.prog)
    d.fight(0.2)
    const trail = []
    let dead = false
    for (let t = 0; t < 12; t++) {
      d.fight(0.5)
      const e = d.enemiesInfo()[0]
      trail.push(e ? e.hp : 'dead')
      if (!e) { dead = true; break }
    }
    return { found: true, setup, trail: trail.slice(0, 6), dead }
  })
  report.steps.push({ step: 'homing-shot', ...homing })

  /* 笔势：按本局地形找“横三”或“竖三”，不再写死格号 */
  const triple = await page.evaluate(() => {
    const d = window.__legion
    const g = d.game
    const seq = d.route()
    const path = new Set(seq)
    const nearRoute = (i) => {
      const x = i % 9, y = Math.floor(i / 9)
      for (const c of seq) {
        if (Math.max(Math.abs((c % 9) - x), Math.abs(Math.floor(c / 9) - y)) <= 1) return c
      }
      return -1
    }
    const free = (i) => !path.has(i) && !g.battle.unitAt(i)
    let best = null
    /* 横三：整条贴在路上，敌人走过就会被扫到 */
    for (let y = 1; y <= 7; y++) {
      for (let x = 0; x <= 6; x++) {
        const cells = [y * 9 + x, y * 9 + x + 1, y * 9 + x + 2]
        if (!cells.every(free)) continue
        const anchor = cells.map(nearRoute).find((c) => c >= 0)
        if (anchor === undefined) continue
        best = { kind: 'row', row: y, cells, anchor, prog: seq.indexOf(anchor) / (seq.length - 1) }
      }
      if (best) break
    }
    if (!best) {
      for (let x = 0; x <= 8; x++) {
        for (let y = 0; y <= 6; y++) {
          const cells = [y * 9 + x, (y + 1) * 9 + x, (y + 2) * 9 + x]
          if (!cells.every(free)) continue
          const anchor = cells.map(nearRoute).find((c) => c >= 0)
          if (anchor === undefined) continue
          best = { kind: 'col', col: x, cells, anchor, prog: seq.indexOf(anchor) / (seq.length - 1) }
        }
        if (best) break
      }
    }
    return best
  })
  report.steps.push({ step: 'stroke-triple', triple })
  if (triple) {
    await page.evaluate((t) => {
      const d = window.__legion
      d.clearField()
      const kinds = ['blade', 'spear', 'bow']
      t.cells.forEach((c, k) => d.addUnit(kinds[k], 2, c, 0))
    }, triple)
    await page.waitForTimeout(500)
    const strokes = await page.evaluate(() => window.__legion.strokesInfo())
    report.steps.push({ step: 'stroke-formed', strokes })
    await shot(page, '04-stroke-formed')

    /* 在对应的行/列放敌人，然后把笔势打出去 */
    const fired = await page.evaluate((t) => {
      const d = window.__legion
      d.wave(9)
      d.prepHold(90)
      for (let k = 0; k < 5; k++) d.spawnAt('raider', Math.max(0.02, t.prog - k * 0.008))
      return { prog: +t.prog.toFixed(3) }
    }, triple)
    await page.waitForTimeout(320)
    const before = await page.evaluate(() => window.__legion.state().damage)
    await page.evaluate(() => window.__legion.fireStrokes())
    await page.waitForTimeout(80)
    await shot(page, '05-stroke-fire')
    await page.waitForTimeout(500)
    report.steps.push({ step: 'stroke-fire', fired, before, after: await page.evaluate(() => window.__legion.state().damage) })
  }

  /* 近战：只摆在“斜邻格”上，确认够得着、看得见挥击 */
  /* 先重开一局：前面的笔势测试把兵都撤了，波次还在跑，营地可能已经被打空，
     后续 addUnit / 开战 会静默失败（脚本就误报"没有挥击"）。 */
  await page.evaluate(() => {
    const d = window.__legion
    d.end()
    d.startScreen()
    d.start('qingfeng')
    d.unlockAll()
    d.give(800, 400)
  })
  await page.waitForTimeout(200)
  const meleeSetup = await page.evaluate(() => {
    const d = window.__legion
    const g = d.game
    const route = g.board.routePts.center
    const spots = new Set(d.spots())
    const diag = []
    for (const q of route.slice(1, 9)) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = q.x + dx, y = q.y + dy
        if (x < 0 || y < 0 || x > 8 || y > 8) continue
        const i = y * 9 + x
        if (!spots.has(i) || diag.includes(i)) continue
        diag.push(i)
      }
    }
    d.clearField()
    const added = []
    diag.slice(0, 6).forEach((c, k) => {
      const r = d.addUnit(['blade', 'spear', 'spear', 'cavalry', 'blade', 'spear'][k], 4, c, 0)
      if (r >= 0) added.push(r)
    })
    d.wave(6)
    d.prepHold(90)
    ;[0.3, 0.36, 0.42, 0.48, 0.54].forEach((v) => d.spawnAt('brute', v, 0, true))
    window.__diagCells = diag.slice(0, 6)
    window.__probe = { maxSlash: 0, frames: 0, lum: 0 }
    const fx = g.fx
    const tick = () => {
      const n = fx.slashes.filter((s) => s.active).length
      window.__probe.frames++
      if (n > window.__probe.maxSlash) window.__probe.maxSlash = n
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return { diag: diag.slice(0, 6), added, units: d.unitsInfo().length, phase: g.phase }
  })
  report.steps.push({ step: 'melee-setup', ...meleeSetup })
  await page.evaluate(() => window.__legion.beginWave())
  await page.waitForTimeout(150)
  let meleeShots = 0
  for (let k = 0; k < 90 && meleeShots < 3; k++) {
    const n = await page.evaluate(() => window.__legion.game.fx.slashes.filter((s) => s.active).length)
    if (n > 0) { meleeShots++; await shot(page, `06-melee-${String(meleeShots).padStart(2, '0')}`) }
    await page.waitForTimeout(30)
  }
  report.steps.push({
    step: 'melee',
    diagCells: await page.evaluate(() => window.__diagCells),
    probe: await page.evaluate(() => window.__probe),
    kills: (await state(page)).kills,
    units: await page.evaluate(() => window.__legion.unitsInfo().slice(0, 6).map((u) => ({ kind: u.kind, cell: u.cell, hp: u.hp }))),
  })

  /* 点将台拖拽合兵 */
  await page.evaluate(() => { const d = window.__legion; d.clearField(); d.give(2400, 300) })
  let pair = null
  for (let k = 0; k < 40 && !pair; k++) {
    pair = await page.evaluate((k) => {
      const g = window.__legion.game
      for (let i = 0; i < 8; i++) {
        const a = g.bench[i]
        if (!a) continue
        for (let j = i + 1; j < 8; j++) {
          const b = g.bench[j]
          if (b && a.kind === b.kind && a.lv === b.lv && a.lv < 5) return { i, j, kind: a.kind, lv: a.lv }
        }
      }
      window.__legion.recruit(k % 3)
      return null
    }, k)
    await page.waitForTimeout(120)
  }
  if (!pair) { console.log('NO BENCH PAIR') } else {
    const bench0 = await page.evaluate(() => window.__legion.game.bench.map((b) => (b ? `${b.kind}${b.lv}` : '-')))
    const b0 = await page.locator(`.lg-slot[data-slot="${pair.i}"]`).boundingBox()
    const b1 = await page.locator(`.lg-slot[data-slot="${pair.j}"]`).boundingBox()
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2)
    await page.mouse.down()
    await page.mouse.move(b0.x + b0.width / 2 - 40, b0.y + 20, { steps: 6 })
    await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2, { steps: 10 })
    await page.waitForTimeout(120)
    const midDrag = await page.evaluate(() => ({
      hover: document.querySelector('.lg-slot.is-hover')?.getAttribute('data-slot') || null,
      mark: document.querySelector('.lg-slot-hover')?.textContent || null,
      hint: document.querySelector('.lg-bench-tip')?.textContent || null,
      drag: window.__legion.dragInfo(),
    }))
    await shot(page, '07-bench-drag-hover')
    await page.mouse.up()
    await page.waitForTimeout(320)
    await shot(page, '08-bench-drag-after')
    report.steps.push({
      step: 'bench-drag-merge',
      pair, benchBefore: bench0, midDrag,
      benchAfter: await page.evaluate(() => window.__legion.game.bench.map((b) => (b ? `${b.kind}${b.lv}` : '-'))),
    })
  }

  /* Boss 抹笔 + 断笔者 */
  await page.evaluate(() => {
    const d = window.__legion
    d.clearField()
    const t = d.spots()
    t.slice(0, 3).forEach((c) => d.addUnit('bow', 3, c, 0))
    t.slice(3, 6).forEach((c) => d.addUnit('blade', 3, c, 0))
    d.wave(24)
    d.boss('qilin')
  })
  await page.waitForTimeout(900)
  await page.evaluate(() => {
    const b = window.__legion.game.battle.boss
    if (b) { b.hp = b.maxHp * 0.28; b.abilT = 0.05; b.phaseT = 0 }
  })
  await page.waitForTimeout(1200)
  await shot(page, '09-boss-erase')
  report.steps.push({ step: 'boss-erase', strokes: await page.evaluate(() => window.__legion.strokesInfo()), boss: (await state(page)).boss })

  /* 动态反击：带两条笔势进 12 波后点「开战」，敌情追加断笔者 */
  const setupCounter = () => page.evaluate(() => {
    const d = window.__legion
    const g = d.game
    d.clearField()
    g.battle['eraseT'] = 0
    const path = new Set(d.route())
    const free = (i) => !path.has(i) && !g.battle.unitAt(i)
    const rows = []
    for (let y = 1; y <= 7 && rows.length < 2; y++) {
      for (let x = 0; x <= 6; x++) {
        const cells = [y * 9 + x, y * 9 + x + 1, y * 9 + x + 2]
        if (cells.every(free)) { rows.push({ y, cells }); break }
      }
    }
    const kinds = ['bow', 'blade', 'spear']
    rows.forEach((r) => r.cells.forEach((c, k) => d.addUnit(kinds[k], 2, c, 0)))
    d.wave(18)
    d.prepHold(90)
    window.__rows = rows.map((r) => r.y)
    return { rows: rows.length, units: d.unitsInfo().length, strokes: d.strokesInfo().length }
  })
  /* 上一段 Boss 场景可能把关卡打崩（结算/分支页会让开战按钮点不动）。
     这里直接重开一局再摆阵，断言本身只看"两条笔势时是否追加断笔者"。 */
  await page.evaluate(() => {
    const d = window.__legion
    d.end()
    d.startScreen()
    d.start('qingfeng')
    d.unlockAll()
    d.give(800, 400)
  })
  await page.waitForTimeout(200)
  const counterSetup = await setupCounter()
  await page.waitForTimeout(300)
  const q0 = await page.evaluate(() => ({ queue: window.__legion.game.queue.length, strokes: window.__legion.strokesInfo() }))
  report.steps.push({ step: 'pre-counter-state', setup: counterSetup, st: await page.evaluate(() => {
    const g = window.__legion.game
    return { phase: g.phase, wave: g.wave, camp: g.camp, overlay: document.getElementById('lgOverlay')?.className }
  }) })
  await page.evaluate(() => window.__legion.beginWave())
  await page.waitForTimeout(380)
  await shot(page, '10-counter-wave')
  report.steps.push({
    step: 'dynamic-counter',
    queueBefore: q0.queue,
    strokesBefore: q0.strokes,
    queueAfter: await page.evaluate(() => window.__legion.game.queue.length),
    breakers: await page.evaluate(() => window.__legion.game.queue.filter((r) => r.kind === 'breaker').length),
    strokes: await page.evaluate(() => window.__legion.strokesInfo()),
  })

  /* 沿折线行军：拐角处不能卡住、也不能跳格 */
  await page.evaluate(() => {
    const d = window.__legion
    d.end()
    d.startScreen()
    d.start('qingfeng')
    d.unlockAll()
    d.give(600, 400)
    d.clearField(true)
    d.wave(9)
    d.prepHold(90)
    d.spawnAt('raider', 0)
    d.nextWave()
    d.speed(2)
  })
  const walk = []
  for (let k = 0; k < 18; k++) {
    walk.push(await page.evaluate(() => {
      const e = window.__legion.enemiesInfo().find((x) => x.kind === 'raider')
      const b = window.__legion.game.board
      if (!e) return null
      const cell = b.cell
      const pts = b.routePts.center.map((p) => ({ x: b.ox + (p.x + 0.5) * cell, y: b.oy + (p.y + 0.5) * cell }))
      /* 到折线的最短垂距（格）：路径是折线，敌人应该一直贴着它走 */
      let dev = 1e9
      for (let i = 0; i + 1 < pts.length; i++) {
        const ax = pts[i].x, ay = pts[i].y, bx = pts[i + 1].x, by = pts[i + 1].y
        const dx = bx - ax, dy = by - ay
        const l2 = dx * dx + dy * dy || 1
        let t = ((e.x - ax) * dx + (e.y - ay) * dy) / l2
        t = Math.max(0, Math.min(1, t))
        dev = Math.min(dev, Math.hypot(e.x - (ax + dx * t), e.y - (ay + dy * t)))
      }
      return { p: e.prog, x: e.x, y: e.y, dev: +(dev / cell).toFixed(2) }
    }))
    if (k === 4) await shot(page, '13-walk-01')
    if (k === 12) await shot(page, '13-walk-02')
    await page.waitForTimeout(150)
  }
  const pts = walk.filter(Boolean)
  let maxJump = 0, maxDev = 0, back = 0
  for (let i = 1; i < pts.length; i++) {
    maxJump = Math.max(maxJump, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
    if (pts[i].p < pts[i - 1].p - 0.05) back++
  }
  for (const p of pts) maxDev = Math.max(maxDev, p.dev)
  report.steps.push({
    step: 'route-walk',
    samples: pts.length, first: pts[0] || null, last: pts[pts.length - 1] || null,
    maxJumpPx: Math.round(maxJump), movedBackSteps: back, maxDevCells: maxDev,
  })
  await page.evaluate(() => window.__legion.speed(1))
  await shot(page, '13-walk-03')

  /* 压测帧率 */
  await page.evaluate(() => {
    const d = window.__legion
    d.end()
    d.startScreen()
    d.start('qingfeng')
    d.unlockAll()
    d.clearField(true)
    d.wave(26)
    for (let i = 0; i < 130; i++) d.spawnAt(i % 3 === 0 ? 'brute' : 'raider', 1 + (i % 40) * 0.4)
  })
  await page.waitForTimeout(300)
  const fps = await page.evaluate(async () => {
    const t0 = performance.now()
    let frames = 0
    await new Promise((res) => {
      const tick = () => { frames++; if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else res() }
      requestAnimationFrame(tick)
    })
    const ms = performance.now() - t0
    return { frames, ms: Math.round(ms), fps: +(frames / (ms / 1000)).toFixed(1), alive: window.__legion.state().enemies }
  })
  await shot(page, '11-swarm')
  report.steps.push({ step: 'fps', fps, perf: await page.evaluate(() => window.__legion.perf(160)) })

  /* 存档续守：路线要能复原 */
  const save1 = await page.evaluate(() => { const d = window.__legion; const s = d.saveInfo?.(); return s })
  report.steps.push({ step: 'save', save: save1 })
  await ctx.close()
}

/* ---------------- 手机竖屏：一屏装下（390×844 / 360×640 / 430×932） ---------------- */
{
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  const sizes = [[390, 844], [360, 640], [430, 932]]
  for (const [mw, mh] of sizes) {
    const { ctx, page } = await boot(browser, mw, mh, { hasTouch: true, isMobile: true, userAgent: UA })
    await page.evaluate(() => window.__legion.resetSave())
    await page.waitForTimeout(260)
    await page.evaluate(() => { const d = window.__legion; d.start('qingfeng'); d.unlockAll(); d.give(300, 300) })
    await page.waitForTimeout(300)
    await page.evaluate(() => { const d = window.__legion; d.spots().slice(0, 5).forEach((c, k) => d.addUnit(['blade', 'spear', 'bow', 'spear', 'cavalry'][k], 2, c, 0)) })
    await page.waitForTimeout(300)

    const geo = await page.evaluate(() => {
      const rect = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) } }
      const lg = document.querySelector('.lg')
      const top = document.querySelector('.lg-top')
      const dock = document.querySelector('.lg-dock')
      const layout = window.__legion.layout()
      const dockR = rect(dock)
      const lgR = rect(lg)
      const outside = []
      dock.querySelectorAll('*').forEach((e) => {
        const b = e.getBoundingClientRect()
        if (b.height > 0 && (b.bottom > dockR.bottom + 0.6 || b.top < dockR.y - 0.6)) outside.push(e.className)
      })
      const cards = Array.from(document.querySelectorAll('.lg-card')).map((e) => Math.round(e.getBoundingClientRect().height))
      const slots = Array.from(document.querySelectorAll('.lg-slot')).map((e) => Math.round(e.getBoundingClientRect().height))
      const rounds = Array.from(document.querySelectorAll('.lg-round')).map((e) => Math.round(e.getBoundingClientRect().height))
      return {
        innerW: innerWidth, innerH: innerHeight,
        pageScrollH: document.documentElement.scrollHeight, pageScrollW: document.documentElement.scrollWidth,
        lgH: lg.clientHeight, lgScrollH: lg.scrollHeight,
        top: rect(top), dock: dockR,
        dockScrollH: dock.scrollHeight, dockClientH: dock.clientHeight,
        outside, cards, slots, rounds, layout,
        boardBottom: +(lgR.y + layout.oy + layout.h).toFixed(1),
      }
    })
    await shot(page, `m01-mobile-${mw}x${mh}`)

    /* 点将台点两张合兵：触屏上必须真的能点 */
    await page.evaluate(() => { const d = window.__legion; d.benchAdd('blade', 1); d.benchAdd('blade', 1) })
    await page.waitForTimeout(200)
    const before = await page.evaluate(() => window.__legion.state())
    const slotRects = await page.evaluate(() => Array.from(document.querySelectorAll('.lg-slot')).slice(0, 2).map((e) => {
      const b = e.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }))
    for (const p of slotRects) { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(120) }
    const after = await page.evaluate(() => window.__legion.state())

    /* 真·触屏：点第一张招贤卡，粮必须真的扣掉 */
    const cardPt = await page.evaluate(() => {
      const e = document.querySelector('.lg-card:not(.is-poor)')
      if (!e) return null
      const b = e.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, cost: Number((window.__legion.state().cards[0] || '').split('@')[1] || 9) }
    })
    let touchOk = 'no-card'
    if (cardPt) {
      const g0 = (await page.evaluate(() => window.__legion.state())).grain
      await page.touchscreen.tap(cardPt.x, cardPt.y)
      await page.waitForTimeout(220)
      const g1 = (await page.evaluate(() => window.__legion.state())).grain
      touchOk = g0 - g1 > 0 ? `grain ${g0}->${g1}` : `no-spend ${g0}->${g1}`
    }

    const fails = []
    if (geo.pageScrollH > geo.innerH + 1) fails.push(`page 纵向滚动 ${geo.pageScrollH}>${geo.innerH}`)
    if (geo.pageScrollW > geo.innerW + 1) fails.push(`page 横向滚动 ${geo.pageScrollW}>${geo.innerW}`)
    if (geo.lgScrollH > geo.lgH + 1) fails.push(`.lg 内部滚动 ${geo.lgScrollH}>${geo.lgH}`)
    if (geo.dockScrollH > geo.dockClientH + 1) fails.push(`操作台内部滚动 ${geo.dockScrollH}>${geo.dockClientH}`)
    if (geo.outside.length) fails.push(`操作台有元素溢出 ${geo.outside.slice(0, 4).join(',')}`)
    if (geo.top.h > 84) fails.push(`顶栏过高 ${geo.top.h}`)
    if (geo.dock.h > 222 && mh > 700) fails.push(`操作台过高 ${geo.dock.h}`)
    if (geo.layout.cell < 33) fails.push(`格子太小 ${geo.layout.cell}`)
    if (geo.layout.w < geo.innerW * 0.88) fails.push(`棋盘只占 ${(geo.layout.w / geo.innerW * 100).toFixed(0)}% 宽`)
    if (geo.boardBottom > geo.dock.y) fails.push(`棋盘点底 ${geo.boardBottom} 压住操作台 ${geo.dock.y}`)
    if (Math.min(...geo.cards) < 70) fails.push(`卡片过矮 ${Math.min(...geo.cards)}`)
    if (geo.slots.length && Math.min(...geo.slots) < 32) fails.push(`台位过矮 ${Math.min(...geo.slots)}`)
    if (geo.rounds.length && Math.min(...geo.rounds) < 24) fails.push(`小圆键过小 ${Math.min(...geo.rounds)}`)
    if (!(after.merges > before.merges)) fails.push(`点将台点两张没合成 merges ${before.merges}->${after.merges}`)
    if (touchOk !== 'no-card' && !touchOk.startsWith('grain')) fails.push(`触屏点卡没扣粮 ${touchOk}`)
    const cardOk = touchOk === 'no-card' ? 'no-card' : touchOk

    report.steps.push({
      step: 'mobile-one-screen',
      size: `${mw}x${mh}`,
      ok: fails.length === 0,
      fails,
      cell: geo.layout.cell,
      boardW: geo.layout.w,
      boardPct: +(geo.layout.w / geo.innerW * 100).toFixed(0),
      topH: geo.top.h,
      dockH: geo.dock.h,
      dockScroll: `${geo.dockScrollH}/${geo.dockClientH}`,
      cards: geo.cards, slots: geo.slots, rounds: geo.rounds,
      merge: `${before.merges}->${after.merges}`,
      touchCard: cardOk,
      lgScroll: `${geo.lgScrollH}/${geo.lgH}`,
      page: `${geo.pageScrollH}/${geo.innerH}`,
      outside: geo.outside.slice(0, 4),
    })
    await ctx.close()
  }
}

/* ---------------- 手机开场页一屏 ---------------- */
{
  const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  const { ctx, page } = await boot(browser, 390, 844, { hasTouch: true, isMobile: true, userAgent: UA })
  await page.evaluate(() => window.__legion.resetSave())
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__legion.startScreen?.())
  await page.waitForTimeout(400)
  await shot(page, 'm02-mobile-start')
  const info = await page.evaluate(() => {
    const panel = document.querySelector('.lg-start')
    const r = panel.getBoundingClientRect()
    return {
      panelH: Math.round(r.height), panelTop: Math.round(r.y), panelBottom: Math.round(r.bottom),
      innerH: innerHeight, scrollH: document.documentElement.scrollHeight,
      pageScrollH: document.querySelector('.lg')?.scrollHeight,
      hasStart: !!document.querySelector('.lg-go'),
    }
  })
  report.steps.push({
    step: 'mobile-start',
    ok: info.panelBottom <= info.innerH && info.scrollH <= info.innerH + 1 && info.hasStart,
    ...info,
  })
  await ctx.close()
}

/* ---------------- 网页端/宽屏短窗口：右栏永不滚动、卡片不被裁 ---------------- */
{
  const sizes = [[1276, 661], [1366, 768], [1440, 900], [1600, 900], [1920, 1080], [1276, 560], [1024, 640], [900, 600], [768, 1024], [701, 800]]
  for (const [w, h] of sizes) {
    const { ctx, page } = await boot(browser, w, h)
    await page.evaluate(() => window.__legion.resetSave())
    await page.waitForTimeout(200)
    await page.evaluate(() => {
      const d = window.__legion
      d.start('qingfeng'); d.unlockAll()
      for (let i = 0; i < 4; i++) d.benchAdd(['blade', 'bow', 'spear', 'spear'][i], 1)
      d.addUnit('blade', 2, 4, 4)
    })
    await page.waitForTimeout(420)

    const geo = await page.evaluate(() => {
      const dock = document.querySelector('.lg-dock')
      const lg = document.querySelector('.lg')
      const dr = dock.getBoundingClientRect()
      const lgR = lg.getBoundingClientRect()
      const layout = window.__legion.layout()
      const outside = []
      dock.querySelectorAll('.lg-card, .lg-slot, .lg-item, .lg-trash, .lg-rec-title, .lg-dock-brand, .lg-rail-brand, .lg-bench-head, .lg-items-head').forEach((e) => {
        const b = e.getBoundingClientRect()
        if (b.height <= 0) return
        if (b.top < dr.top - 0.6 || b.bottom > dr.bottom + 0.6 || b.left < dr.left - 0.6 || b.right > dr.right + 0.6) outside.push((e.className || '').split(' ')[0])
      })
      const cards = Array.from(document.querySelectorAll('.lg-cards .lg-card'))
      const card = cards[0]
      const cr = card.getBoundingClientRect()
      const rar = card.querySelector('.lg-card-rar')?.getBoundingClientRect()
      const foot = card.querySelector('.lg-card-foot')?.getBoundingClientRect()
      return {
        innerW: innerWidth, innerH: innerHeight,
        pageScrollH: document.documentElement.scrollHeight, pageScrollW: document.documentElement.scrollWidth,
        dockRect: { x: +dr.x.toFixed(1), y: +dr.y.toFixed(1), w: +dr.width.toFixed(1), h: +dr.height.toFixed(1) },
        dockScrollH: dock.scrollHeight, dockClientH: dock.clientHeight,
        dockScrollW: dock.scrollWidth, dockClientW: dock.clientWidth,
        outside,
        cards: cards.map((e) => Math.round(e.getBoundingClientRect().height)),
        cardRarTop: rar ? +(rar.top - cr.top).toFixed(1) : null,
        cardFootSlack: foot ? +(cr.bottom - foot.bottom).toFixed(1) : null,
        layout,
        boardBottom: +(layout.oy + layout.h).toFixed(1),
        lgH: lg.clientHeight, lgScrollH: lg.scrollHeight,
        lgBottom: +lgR.bottom.toFixed(1),
      }
    })
    if (w === 1276 && h === 661) await shot(page, 'w01-wide-short-1276x661')
    if (w === 1440 && h === 900) await shot(page, 'w02-wide-1440x900')

    const fails = []
    if (geo.pageScrollH > geo.innerH + 1) fails.push(`page 纵向滚动 ${geo.pageScrollH}>${geo.innerH}`)
    if (geo.pageScrollW > geo.innerW + 1) fails.push(`page 横向滚动 ${geo.pageScrollW}>${geo.innerW}`)
    if (geo.lgScrollH > geo.lgH + 1) fails.push(`.lg 内部滚动 ${geo.lgScrollH}>${geo.lgH}`)
    if (geo.dockScrollH > geo.dockClientH + 1) fails.push(`右栏纵向滚动 ${geo.dockScrollH}>${geo.dockClientH}`)
    if (geo.dockScrollW > geo.dockClientW + 1) fails.push(`右栏横向滚动 ${geo.dockScrollW}>${geo.dockClientW}`)
    if (geo.outside.length) fails.push(`右栏内容被裁 ${geo.outside.slice(0, 4).join(',')}`)
    if (geo.cardRarTop !== null && geo.cardRarTop < -0.6) fails.push(`卡顶稀有度条被切 ${geo.cardRarTop}`)
    if (geo.cardFootSlack !== null && geo.cardFootSlack < -0.6) fails.push(`卡底溢出 ${geo.cardFootSlack}`)
    if (Math.min(...geo.cards) < 60) fails.push(`卡片过矮 ${Math.min(...geo.cards)}`)
    if (geo.layout.cell < 36) fails.push(`格子太小 ${geo.layout.cell}`)
    if (geo.boardBottom > geo.lgBottom + 1) fails.push(`棋盘出界 ${geo.boardBottom}>${geo.lgBottom}`)

    report.steps.push({
      step: 'wide-no-scroll',
      size: `${w}x${h}`,
      ok: fails.length === 0,
      fails,
      cell: geo.layout.cell,
      boardW: geo.layout.w,
      dock: `${Math.round(geo.dockRect.w)}x${Math.round(geo.dockRect.h)}`,
      dockScroll: `${geo.dockScrollW}:${geo.dockClientW} / ${geo.dockScrollH}:${geo.dockClientH}`,
      cards: geo.cards,
      rarTop: geo.cardRarTop,
      footSlack: geo.cardFootSlack,
      page: `${geo.pageScrollH}/${geo.innerH}`,
      outside: geo.outside.slice(0, 4),
    })
    await ctx.close()
  }
}

/* ---------------- 读档复原路线 ---------------- */
{
  const { ctx, page } = await boot(browser, 1440, 900)
  await page.evaluate(() => window.__legion.resetSave())
  await page.waitForTimeout(240)
  await page.evaluate(() => { const d = window.__legion; d.start('qingfeng'); d.unlockAll(); d.give(300, 300) })
  const routeA = await page.evaluate(() => window.__legion.route())
  await page.evaluate(() => { const d = window.__legion; d.spots().slice(0, 4).forEach((c, k) => d.addUnit(['blade', 'spear', 'bow', 'spear'][k], 2, c, 0)); d.wave(4) })
  await page.waitForTimeout(500)
  const saved = await page.evaluate(() => {
    const g = window.__legion.game
    g['persistCheckpoint']()
    return { cp: !!g.save.checkpoint, route: g.save.checkpoint?.route || null }
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(800)
  await page.locator('[data-game="legion"]').click({ timeout: 60000 })
  await page.waitForFunction(() => !!window.__legion)
  await page.waitForTimeout(260)
  await page.evaluate(() => window.__legion.resume?.())
  await page.waitForTimeout(600)
  const routeB = await page.evaluate(() => window.__legion.route())
  await shot(page, '12-resume')
  report.steps.push({ step: 'resume-route', saved: saved.cp, same: routeA.length === routeB.length && routeA.every((v, i) => v === routeB[i]), lenA: routeA.length, lenB: routeB.length })
  await ctx.close()
}

fs.writeFileSync(`${DIR}/report.json`, JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report.steps.filter((s) => s.step !== 'save'), null, 1))
await browser.close()

