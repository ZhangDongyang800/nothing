/* 主控：状态机、经济、招募、拖拽合成、波次、Boss、存档、结算。
 *
 * 这一层是唯一同时知道"玩家手在做什么"和"战场上发生了什么"的地方：
 *   · 战斗层通过 BattleHost 回调把击杀/漏怪/基地伤害交回来；
 *   · 界面层通过 UiHost 把点击和拖拽交回来；
 *   · 存档只存"能重建的局面"，不存敌人和弹道。
 *
 * 性能口径：rAF 单循环 + dt clamp；HUD 每 80ms 才写一次 DOM；棋盘地形离屏缓存；
 * 暂停/结算/离开机台立刻停循环，避免后台空转。
 */
import type { BossId, Enemy, EnemyKind, HeroId, ItemId, ItemSlot, RecruitCard, RunUnitSave, Unit, UnitKind } from './types'
import { LegionUI, type BenchView, type CardView, type EventView, type ItemView, type MetaView, type ShopView, type StartView, type ResultView, type InspectView } from './ui'
import { Board, COLS, ROWS, initialCells, laneAtCell, isPathCell, cellX, cellY, unlockCost, setRoute, routeCoords, type LaneId } from './board'
import { makeRoute, routeFromCells } from './route'
import { Battle, type BattleHost, type UnitMods } from './battle'
import { Effects } from './fx'
import { Scene, type DragView, type DragPreview, type DragPreviewLine, type MergeGhost } from './draw'
import { LegionAudio } from './audio'
import { loadSave, writeSave, fmtTime, fmtNum, type SaveData } from './save'
import { UNIT_BY_ID, START_UNLOCKED, UNIT_UNLOCK_COST, fusionOf, fusionLevel, isFusion } from './data/units'
import { HERO_BY_ID, HERO_UNLOCK } from './data/heroes'
import { pickRarity, pickKind, veteranChance, RARITY_LABEL, RARITY_COLOR } from './data/rarity'
import { isBossWave, bossForWave, wavePlan, spawnPool, ENEMY_BY_ID, type SpawnRow } from './data/enemies'
import { BOSS_BY_ID } from './data/bosses'
import { ITEM_DEFS, ITEM_BY_ID, INGAME_UPS, INGAME_UP_BY_ID, META_UPS, META_BY_ID, MILESTONES, ACHIEVEMENTS, ACH_BY_ID, stageName } from './data/items'
import { BRANCHES, branchOf as branchDefOf, RUN_CARDS, RUN_BY_ID, type RunCardDef } from './data/strategy'
import { findStrokes, strokeTags, strokeSummary, strokeName, type Stroke } from './formation'

const BENCH_BASE = 4
const PREP_TIME = 14
const HERO_CD: Record<HeroId, number> = { qingfeng: 38, chiyuan: 42, bailu: 38, taxue: 34 }

type Phase = 'idle' | 'start' | 'prep' | 'wave' | 'paused' | 'event' | 'shop' | 'over' | 'meta' | 'branch' | 'draft'
type Overlay = '' | 'start' | 'meta' | 'results' | 'event' | 'pause' | 'settings' | 'shop' | 'help' | 'branch' | 'draft'

interface BenchUnit { kind: UnitKind; lv: number; veteran: boolean }

interface DragState {
  fromBench: boolean
  index: number
  fromCell: number
  x: number
  y: number
  startX: number
  startY: number
  moved: boolean
  target: number
  merge: boolean
  fuse: boolean
  illegal: boolean
  /** 这次叠合会拆掉几条笔势（只在棋盘内叠合时不为 0） */
  lost: number
  /** 拖点将台里的卡时，指针正压在哪个台位上（≥0 表示要台上合兵） */
  benchTarget: number
  kind: UnitKind
  lv: number
  veteran: boolean
  hero: HeroId | ''
}

interface PendingBoost { budget: number; elite: number; silver: number; label: string }

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s += 0x6D2B79F5
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class LegionGame implements BattleHost, UiHostLike {
  board = new Board()
  fx = new Effects()
  audio = new LegionAudio()
  battle: Battle
  scene = new Scene()
  ui: LegionUI
  save: SaveData

  /* BattleHost 的字段 */
  baseHp = 1000
  baseMax = 1000
  baseArmor = 0
  furyT = 0
  freezeT = 0
  armorT = 0
  dmgNumbers = true
  shakeOn = true
  wave = 1

  private hostEl: HTMLElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private raf = 0
  private lastTs = 0
  private time = 0
  private view = { w: 0, h: 0 }
  private dpr = 1
  private compact = false
  private hudT = 0
  private saveT = 0
  private layT = 0.4
  private metricsKey = ''

  phase: Phase = 'idle'
  private overlay: Overlay = ''
  private returnOverlay: Overlay = 'start'
  private resumePhase: 'prep' | 'wave' = 'prep'
  private metaTab = 'up'

  prepT = PREP_TIME
  /** 本波整备时长：前两波短一些，别让新人开局就干等 */
  prepMax = PREP_TIME
  grain = 0
  silver = 0
  cells = new Set<number>()
  bench: BenchUnit[] = []
  benchSlots = BENCH_BASE
  hero: HeroId = 'qingfeng'
  heroDead = false
  heroSkillT = 0
  cards: RecruitCard[] = []
  items: ItemSlot[] = []
  armed: ItemId | null = null
  ups: Record<string, number> = {}

  /* 构筑与阵型 */
  runMods: Record<string, number> = {}
  private runCards: string[] = []
  private draftOptions: string[] = []
  private branchUnit: Unit | null = null
  links: { a: number; b: number; kind: string }[] = []
  /** 当前笔势（横锋 / 直锋），布阵变化时重算 */
  strokes: Stroke[] = []
  private strokeSeen: Record<string, boolean> = {}
  private strokeNoteT = 0
  /** 本局已首次说明过的敌人 / Boss（避免重复打扰） */
  private seenEnemies = new Set<string>()
  private seenBosses = new Set<string>()
  /** 新手引导当前步（-1 = 未在进行） */
  private tutorialStep = -1
  /** 动态建议：限频，避免刷屏 */
  private suggestT = 0
  private suggestCd = 0
  private lastSuggest = ''
  private branchReturnPhase: 'prep' | 'wave' = 'prep'

  kills = 0
  damage = 0
  income = 0
  bestLv = 0
  merges = 0
  mergeGhosts: MergeGhost[] = []
  skillCasts = 0
  bossKills = 0
  runTime = 0
  private recruits = new Set<UnitKind>()
  private newAchs: string[] = []
  private queue: SpawnRow[] = []
  private spawnT = 0
  private spawnInt = 0.8
  private pending: PendingBoost | null = null
  private pendingReward = 0
  private waveTotal = 1

  speed = 1
  private shakeAmp = 0
  private shakeX = 0
  private shakeY = 0
  private bossIntroT = 0
  private bossIntroName = ''
  private hover = -1
  private selected = -1
  private benchPicked = -1
  /** 刚合出来的那一格，给一次性的落定动画；渲染后立刻清掉 */
  private benchPop = -1
  private benchPopT = -9
  private freeRerolls = 3
  private drag: DragState | null = null
  private cellHint: number[] = []
  private autoSim = false
  private godMode = false
  private muted = false
  private rng: () => number = Math.random
  private eventKind = ''
  /* 残阵遗址：展示时抽好的三选项，结算时复用，保证「看到的」就是「生效的」 */
  private eventBuffPicks: typeof INGAME_UPS = []

  constructor(hostEl: HTMLElement) {
    this.hostEl = hostEl
    this.save = loadSave()
    this.hero = this.save.lastHero
    this.dmgNumbers = this.save.settings.dmgNumbers
    this.shakeOn = this.save.settings.shake
    this.scene.setQuality(this.save.settings.quality)
    this.fx.setReduced(this.save.settings.quality === 'low')

    this.ui = new LegionUI(hostEl, {
      onAct: (act, arg) => this.onAct(act, arg),
      onBenchDown: (i, ev) => this.beginBenchDrag(i, ev),
      onOverlayClose: () => this.closeOverlay(),
    })
    this.canvas = this.ui.canvas
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    this.ctx = ctx
    this.battle = new Battle(this)

    this.bindPointer()
    this.bindKeys()
    this.applySettings()
    const ro = new ResizeObserver(() => this.layout())
    ro.observe(hostEl)
    window.addEventListener('resize', this.onResize)
    this.layout()
    this.draw()
  }

  private onResize = (): void => { this.layout() }

  /* ================= 生命周期 ================= */

  open(): void {
    this.audio.unlock(this.save.settings.sfx, this.save.settings.bgm)
    this.showStart()
    this.startLoop()
    this.layout()
  }

  close(): void {
    this.persistCheckpoint()
    writeSave(this.save)
    this.stopLoop()
    this.audio.stopBgm()
    this.audio.suspend()
    this.ui.hideOverlay()
    this.overlay = ''
  }

  destroy(): void {
    this.stopLoop()
    this.audio.stopBgm()
    this.saveProgress()
    this.ui.destroy()
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    document.removeEventListener('keydown', this.onKey, true)
  }

  private startLoop(): void {
    if (this.raf) return
    this.lastTs = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private frame = (ts: number): void => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, Math.max(0, (ts - this.lastTs) / 1000))
    this.lastTs = ts
    if (!this.autoSim && (this.phase === 'prep' || this.phase === 'wave')) this.tick(dt)
    this.time += dt
    this.draw()
    this.hudT -= dt
    if (this.hudT <= 0) {
      this.hudT = 0.08
      this.syncHud()
    }
    this.saveT -= dt
    if (this.saveT <= 0) {
      this.saveT = 6
      if (this.phase === 'prep' || this.phase === 'wave') this.persistCheckpoint()
    }
    this.layT -= dt
    if (this.layT <= 0) {
      this.layT = 0.6
      this.checkLayoutDrift()
    }
    this.suggestT -= dt
    if (this.suggestT <= 0) {
      this.suggestT = 2.5
      this.updateSuggestion()
    }
  }

  /** 顶栏 / 底部手牌高度会因为文案变长而变，量到的 top 一改，棋盘要跟着让位，
      否则手机竖屏第一行会被压在顶栏下面 */
  private checkLayoutDrift(): void {
    const m = this.ui.metrics()
    const key = `${Math.max(46, m.top)}:${m.dockH}:${m.dockW}:${m.railW}`
    if (key === this.metricsKey) return
    this.metricsKey = key
    if (this.hostEl.clientWidth >= 320) this.layout()
  }

  private layout(): void {
    const w = Math.max(320, this.hostEl.clientWidth)
    const h = Math.max(320, this.hostEl.clientHeight)
    const q = this.save.settings.quality
    this.dpr = q === 'low' ? 1 : Math.min(1.5, window.devicePixelRatio || 1)
    this.view = { w, h }
    if (this.canvas.width !== Math.round(w * this.dpr) || this.canvas.height !== Math.round(h * this.dpr)) {
      this.canvas.width = Math.round(w * this.dpr)
      this.canvas.height = Math.round(h * this.dpr)
    }
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.compact = w < 940
    const m = this.ui.metrics()
    const top = Math.max(46, m.top)
    /* 顶栏在窄一点/矮一点的窗口会折成两行，高度不再等于 --lg-top；
       把量到的真实下沿写进变量，右栏贴住顶栏，别钻到它下面去。 */
    this.hostEl.style.setProperty('--lg-dock-top', `${top}px`)
    /* 操作区可能在下（手机竖屏）也可能在右（桌面 / 手机横屏）：
       按实际量到的宽高判断，而不是死认 compact。 */
    const dockRight = m.dockW > 0 && m.dockW < w * 0.7
    const dockW = dockRight ? m.dockW : 0
    const dockH = dockRight ? 0 : m.dockH
    const railW = this.compact ? 0 : m.railW
    const freeW = Math.max(200, w - dockW - railW - 8)
    const freeH = Math.max(200, h - top - dockH - 10)
    this.board.place(railW + 4, top + 4, freeW - 8, freeH - 8, 6)
    this.computeCellHints()
  }

  /** 每格到山道的最短距离（格），布阵和自动挂机都用它挑位置 */
  private computeCellHints(): void {
    this.cellHint = []
    for (let i = 0; i < COLS * ROWS; i++) {
      const c = this.board.center(i)
      let best = 99
      const lane = laneAtCell(i) || 'center'
      const pts = this.board.routePts[lane]
      for (let p = 0; p < pts.length; p++) {
        const q = this.board.lanePoint(lane, p)
        best = Math.min(best, Math.hypot(q.x - c.x, q.y - c.y) / this.board.cell)
      }
      this.cellHint[i] = best
    }
  }

  private draw(): void {
    if (!this.view.w) return
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.view.w, this.view.h)
    ctx.fillStyle = '#efe4cc'
    ctx.fillRect(0, 0, this.view.w, this.view.h)
    const drag = this.drag ? this.dragView() : null
    this.scene.draw({
      ctx, w: this.view.w, h: this.view.h, board: this.board, battle: this.battle,
      unlocked: this.cells, time: this.time, baseHp: this.baseHp, baseMax: this.baseMax,
      drag, merges: this.mergeGhosts, hover: this.hover, selected: this.selected,
      shakeX: this.shakeX, shakeY: this.shakeY, frozen: this.freezeT > 0,
      fx: this.fx, bossIntroT: this.bossIntroT, bossIntroName: this.bossIntroName,
      links: this.links, strokes: this.strokes,
    })
  }

  private dragView(): DragView {
    const d = this.drag as DragState
    const extra = this.dragPreview(d)
    return {
      from: d.fromBench ? -1 : d.fromCell,
      x: d.x, y: d.y, target: d.target, kind: d.kind, lv: d.lv, veteran: d.veteran,
      merge: d.merge, fuse: d.fuse, illegal: d.illegal, lost: d.lost, hero: d.hero,
      cover: extra.cover, preview: extra.preview, formCells: extra.formCells,
    }
  }

  /** 拖拽预览：攻击覆盖 / 将形成的合击 / 合成收益与代价，全部按真实局面算 */
  private dragPreview(d: DragState): { cover: { x: number; y: number }[]; preview: DragPreview | null; formCells: number[] } {
    const empty = { cover: [] as { x: number; y: number }[], preview: null as DragPreview | null, formCells: [] as number[] }
    if (d.hero || d.target < 0) return empty
    const def = UNIT_BY_ID[d.kind]
    if (d.illegal) {
      const u = this.battle.unitAt(d.target)
      const reason = !this.cells.has(d.target)
        ? '未解锁格：先花银币扩大阵地'
        : u ? this.combineFailReason(d.kind, d.lv, u.kind, u.lv) : '这个位置不能放置'
      return { ...empty, preview: { title: '无法放置', lines: [{ t: reason, tone: 'bad' }] } }
    }
    /* 模拟放下后的占位，算出新增 / 拆掉的合击 */
    const occupied = new Set<number>()
    for (const u of this.battle.units) {
      if (!u.active || u.hero) continue
      if (!d.fromBench && u.cell === d.fromCell) continue
      occupied.add(u.cell)
    }
    occupied.add(d.target)
    const beforeKeys = new Set(this.strokes.map((s) => s.key))
    const after = findStrokes(occupied)
    const fresh = after.filter((s) => !beforeKeys.has(s.key))
    const formCells = Array.from(new Set(fresh.flatMap((s) => s.cells)))
    const target = this.battle.unitAt(d.target)
    if (d.merge || d.fuse) {
      const outKind = d.fuse ? (fusionOf(d.kind, target?.kind || d.kind) || d.kind) : d.kind
      const outLv = d.fuse ? fusionLevel(d.lv, target?.lv || d.lv) : Math.min(5, d.lv + 1)
      const od = UNIT_BY_ID[outKind]
      const lines: DragPreviewLine[] = []
      const step = od.levels[outLv - 1]
      if (step && step.text) lines.push({ t: `新能力：${step.text}`, tone: 'good' })
      if (d.veteran || target?.veteran) lines.push({ t: '保留精锐强化（属性 +25%）', tone: 'good' })
      lines.push({ t: '士兵数量 -1', tone: 'info' })
      if (d.lost > 0) lines.push({ t: `会拆掉 ${d.lost} 条现有合击`, tone: 'bad' })
      if (fresh.length) lines.push({ t: `新形成 ${fresh.length} 条合击`, tone: 'good' })
      return { cover: [], formCells, preview: { title: `${d.fuse ? '融合' : '合成'} → Lv${outLv} ${od.name}`, lines } }
    }
    /* 空位部署 / 移动：点出攻击覆盖的道路 */
    const cover: { x: number; y: number }[] = []
    const c = this.board.center(d.target)
    const reach = def.range * this.board.cell
    const total = this.board.len()
    const stepLen = Math.max(0.2, total / 48)
    for (let p = 0; p <= total; p += stepLen) {
      const w = this.board.laneWorld('center', p)
      if (Math.hypot(w.x - c.x, w.y - c.y) <= reach) cover.push(w)
    }
    const lines: DragPreviewLine[] = [{ t: `攻击覆盖：约 ${def.range} 格内的道路`, tone: 'info' }]
    if (fresh.length) lines.push({ t: `将形成 ${fresh.length} 条合击（绿框）`, tone: 'good' })
    if (d.lost > 0) lines.push({ t: `会拆掉 ${d.lost} 条现有合击`, tone: 'bad' })
    return { cover, formCells, preview: { title: `${def.name} · 部署预览`, lines } }
  }

  /* ================= 对局开始 ================= */

  private showStart(): void {
    this.phase = 'start'
    this.overlay = 'start'
    this.audio.stopBgm()
    const heroes = (Object.keys(HERO_BY_ID) as HeroId[]).map((id) => ({
      id, unlocked: this.save.heroes.includes(id),
      frag: this.save.frag,
      need: HERO_UNLOCK[id],
    }))
    const view: StartView = {
      bestWave: this.save.records.bestWave,
      bestTime: this.save.records.bestTime,
      runs: this.save.records.runs,
      gold: this.save.gold,
      heroes,
      lastHero: this.hero,
      checkpointWave: this.save.checkpoint ? this.save.checkpoint.wave : 0,
      heroFrag: this.save.frag,
    }
    this.ui.showStart(view)
    this.ui.setPhase('start')
  }

  startRun(hero?: HeroId, resume = false): void {
    this.audio.unlock(this.save.settings.sfx, this.save.settings.bgm)
    this.audio.startBgm()
    this.hero = hero || this.hero
    this.save.lastHero = this.hero
    this.rng = seeded(Date.now() % 2147483647)
    this.hideOverlay()
    this.speed = 1
    this.godMode = false
    const meta = this.save.meta
    const cp = resume ? this.save.checkpoint : null
    /* 阵图：新局随机生成一条折线土路；读档沿用存档里的那条（没有就退回中路） */
    if (cp && cp.route && cp.route.length) setRoute(routeFromCells(cp.route))
    else if (!cp) setRoute(makeRoute(this.rng))
    this.board.syncRoute()
    this.baseMax = Math.round(1000 * (1 + 0.06 * (meta.baseHp || 0)))
    this.baseHp = this.baseMax
    this.baseArmor = 0
    this.furyT = 0
    this.freezeT = 0
    this.armorT = 0
    this.kills = 0
    this.damage = 0
    this.income = 0
    this.bestLv = 0
    this.merges = 0
    this.skillCasts = 0
    this.bossKills = 0
    this.runTime = 0
    this.recruits.clear()
    this.seenEnemies.clear()
    this.seenBosses.clear()
    this.newAchs = []
    this.queue = []
    this.pending = null
    this.heroDead = false
    this.heroSkillT = 0
    this.armed = null
    this.selected = -1
    this.benchPicked = -1
    this.freeRerolls = 3
    this.bench = []
    this.items = []
    this.ups = {}
    this.runMods = {}
    this.runCards = []
    this.branchUnit = null
    this.links = []
    this.cells = new Set(initialCells(8 + (meta.cells || 0)))
    this.benchSlots = BENCH_BASE + (meta.bench || 0)
    this.grain = 30 + (meta.grainStart || 0)
    this.silver = 6
    this.wave = 1
    this.beginPrep()
    this.battle.reset()
    this.fx.clear()
    this.shakeAmp = 0
    this.bossIntroT = 0

    if (cp) {
      this.wave = cp.wave
      this.baseMax = cp.baseMax
      this.baseHp = cp.baseHp
      this.grain = cp.grain
      this.silver = cp.silver
      this.cells = new Set(initialCells(cp.cells))
      this.benchSlots = cp.benchSlots
      this.hero = cp.hero || this.hero
      this.heroDead = cp.heroDead
      this.kills = cp.kills
      this.damage = cp.dmg
      this.income = cp.income
      this.bestLv = cp.bestLv
      this.freeRerolls = typeof cp.freeRerolls === 'number' ? cp.freeRerolls : 3
      this.ups = { ...cp.ups }
      this.items = cp.items.map((i) => ({ ...i }))
      this.bench = cp.bench.map((b) => ({ kind: b.kind, lv: b.lv, veteran: b.veteran }))
      this.runMods = { ...(cp.runMods || {}) }
      this.runCards = [...(cp.runCards || [])]
      for (const u of cp.units) this.addSavedUnit(u)
      this.cards = cp.cards.length ? cp.cards.map((c) => ({ ...c })) : this.rollCards(false)
      this.beginPrep()
    } else {
      this.cards = this.rollCards(false)
      this.items = [{ id: 'draft', charges: 1 }, { id: 'salve', charges: 1 }]
      this.addHero(false)
    }
    if (!this.battle.units.some((u) => u.hero) && !this.heroDead) this.addHero(true)
    if (!this.cards.length) this.cards = this.rollCards(false)
    this.baseArmor = Math.min(0.65, 0.05 * (this.ups.baseArmor || 0))
    this.phase = 'prep'
    this.ui.setPhase('prep')
    this.syncAll()
    this.persistCheckpoint()
    this.ui.banner(`第 ${this.wave} 波`, '布阵 · 招兵 · 守住营寨', 'wave')
    this.audio.sfx('wave')
    if (!resume && !this.save.tutorialDone) this.startTutorial()
    writeSave(this.save)
  }

  private addSavedUnit(u: RunUnitSave): void {
    if (u.hero) {
      this.battle.addUnit('blade', 1, false, u.cell, u.hero)
      return
    }
    const unit = this.battle.addUnit(u.kind, u.lv, u.veteran, u.cell)
    if (!unit) return
    if (typeof u.path === 'number') unit.path = u.path
    this.applySynergy(unit)
    this.bestLv = Math.max(this.bestLv, u.lv)
  }

  private addHero(revive: boolean): void {
    if (this.battle.units.some((u) => u.hero)) return
    const cell = this.pickHeroCell()
    if (cell < 0) return
    const u = this.battle.addUnit('blade', 1, false, cell, this.hero)
    if (!u) return
    if (revive) u.hp = Math.round(u.maxHp * 0.6)
    this.heroDead = false
  }

  private pickHeroCell(): number {
    let best = -1
    let bs = 99
    for (const c of this.cells) {
      if (this.battle.unitAt(c)) continue
      const h = this.cellHint[c] ?? 99
      if (h < bs) { bs = h; best = c }
    }
    if (best >= 0) return best
    for (const c of this.cells) if (!this.battle.unitAt(c)) return c
    return -1
  }

  /* ================= 主循环 ================= */

  tick(dt: number): void {
    if (this.phase !== 'prep' && this.phase !== 'wave') return
    const sdt = dt * (this.phase === 'wave' ? this.speed : 1)
    this.time += sdt
    this.runTime += sdt
    this.furyT = Math.max(0, this.furyT - sdt)
    this.freezeT = Math.max(0, this.freezeT - sdt)
    this.armorT = Math.max(0, this.armorT - sdt)
    this.heroSkillT = Math.max(0, this.heroSkillT - sdt)
    this.bossIntroT = Math.max(0, this.bossIntroT - sdt)
    this.shakeAmp *= Math.pow(0.02, sdt)
    const amp = this.shakeAmp
    this.shakeX = amp ? (Math.random() - 0.5) * amp : 0
    this.shakeY = amp ? (Math.random() - 0.5) * amp : 0

    this.battle.tickFog(sdt)
    if (this.phase === 'prep') {
      this.prepT -= sdt
      /* 整备期也让工程师产粮、单位回血，但不刷怪 */
      this.battle.update(sdt)
      if (this.prepT <= 0) this.startWave()
    } else {
      this.battle.update(sdt)
      this.updateSpawn(sdt)
      this.checkWaveEnd()
    }
    this.fx.update(sdt)
    this.checkLiveAchievements()
  }

  private updateSpawn(dt: number): void {
    if (!this.queue.length) return
    if (this.battle.alive > 110) return
    /* 单路 9 格战场同时只容纳一条清楚的队列；后面的敌人排队等待入场。
       这样不会在入口堆成黑压压一片，也让每一只敌人的字都读得出来。 */
    let onLane = 0
    for (const e of this.battle.enemies) if (e.active && !e.boss) onLane++
    if (onLane >= 20) return
    /* 入口闸门：门口一个"格"内还有人就不放新的（间距跟着本局路点密度走）。
       生成比队列走得快时，新兵会被挤成负进度、折在入口同一像素上。 */
    let head = Infinity
    for (const e of this.battle.enemies) if (e.active && !e.dead && !e.boss) head = Math.min(head, e.prog)
    const gate = Math.max(0.95, this.board.segLen() * 1.0)
    if (head < gate) { this.spawnT = 0.15; return }
    this.spawnT -= dt
    if (this.spawnT > 0) return
    const row = this.queue.shift()
    if (!row) return
    this.battle.spawnEnemy(row.kind, row.elite, 0)
    this.spawnT = this.spawnInt * (0.7 + Math.random() * 0.7)
  }

  private checkWaveEnd(): void {
    if (this.queue.length) return
    if (this.battle.boss && this.battle.boss.active && !this.battle.boss.dead) return
    for (const e of this.battle.enemies) if (e.active) return
    this.finishWave()
  }

  /** 进入整备：前两波给 10 秒够看清局势，之后回到常规节奏 */
  private beginPrep(): void {
    this.prepMax = this.wave <= 2 ? 10 : PREP_TIME
    this.prepT = this.prepMax
  }

  private startWave(): void {
    this.phase = 'wave'
    this.ui.setPhase('wave')
    this.queue = []
    this.spawnT = 0.35
    let plan = wavePlan(this.wave, this.rng)
    /* 随机挑战/入侵：改变这一波的预算与精英率 */
    if (this.pending) {
      const extra = Math.max(1, Math.round(plan.rows.length * this.pending.budget))
      const pool = spawnPool(this.wave)
      for (let i = 0; i < extra; i++) {
        const d = pool[Math.floor(this.rng() * pool.length)]
        plan.rows.push({ kind: d.id, elite: this.rng() < 0.18, gap: 0 })
      }
      if (this.pending.elite > 0) {
        for (const row of plan.rows) if (this.rng() < this.pending.elite) row.elite = true
      }
      this.pendingReward = this.pending.silver
      this.pending = null
    }
    this.spawnInt = plan.interval
    /* 动态反击：你越是用笔势成阵，就越容易招来专门压阵的断笔者。
       不是单纯加血，而是逼你在开战前想好要不要拆一条阵、把火力挪过去先点掉它。
       只按"真正生效的笔势"计数：阵已经被压住时不会再继续加码。 */
    /* 整备期不跑战斗更新，压制标记可能是上一波留下的：开战前先按当前局势重算一次 */
    this.battle.syncStrokes()
    const liveStrokes = this.strokes.filter((s) => !s.suppress).length
    if (this.wave >= 12 && liveStrokes >= 2 && !plan.boss && plan.rows.length < 64) {
      const n = Math.min(3, 1 + Math.floor(liveStrokes / 2))
      for (let i = 0; i < n; i++) plan.rows.push({ kind: 'breaker', elite: false, gap: 0 })
      this.ui.toast(`${n} 名断笔者来了 · 贴近阵线会暂停合击，优先击败`, 'warn')
    }
    this.queue = plan.rows
    this.explainNewEnemies(plan.rows, plan.boss)
    this.waveTotal = plan.rows.length + (plan.boss ? 1 : 0)
    this.audio.setIntensity(this.wave >= 60 ? 4 : this.wave >= 30 ? 3 : this.wave >= 15 ? 2 : this.wave >= 5 ? 1 : 0)
    if (plan.boss) {
      const b = BOSS_BY_ID[plan.boss]
      this.battle.spawnBoss(plan.boss, this.wave)
      this.bossIntroT = 2.4
      this.bossIntroName = `${b.name} · ${b.title}`
      this.audio.sfx('boss')
      this.shake(10)
      this.ui.banner(b.name, b.title, 'boss')
    } else {
      this.ui.banner(`第 ${this.wave} 波`, stageName(this.wave), 'wave')
      this.audio.sfx('wave')
    }
    this.ui.toast(`第 ${this.wave} 波 · ${this.queue.length} 股敌军来犯`, 'warn')
  }

  /* ================= 新手引导 ================= */

  private static readonly TUTORIAL: { title: string; body: string }[] = [
    { title: '第一步 · 招募与部署', body: '点下方招募卡花军粮招兵，士兵会先进预备兵营。再把兵营里的兵拖到阵地的空格上，就能开始攻击。' },
    { title: '第二步 · 排成阵型', body: '3 名以上士兵连成横排或竖列，会发动「合击」造成额外集体攻击。拖动时绿框会预览将形成的合击，绿点标出能打到的道路。' },
    { title: '第三步 · 合成升级', body: '把同名同级的兵叠在一起可升一级，解锁更强能力。注意：合成会少一名兵，可能拆掉合击——拖动时会预览收益与代价。' },
    { title: '第四步 · 两种资源', body: '军粮用来招募（遣散会返还）；银币用来扩大阵地、商店强化和高级招募。靠营寨左上角的粮 / 银随时查看。' },
    { title: '第五步 · 成长与技能', body: '士兵 3 级可选强化路线；特定两种兵可融合成新兵；每 2 波选一张战术牌；按 Q 放英雄技能。首次出现的敌人和 Boss 都会有说明。' },
  ]

  private startTutorial(): void {
    this.tutorialStep = 0
    this.showTutorialStep()
  }

  private showTutorialStep(): void {
    const steps = LegionGame.TUTORIAL
    const i = this.tutorialStep
    if (i < 0 || i >= steps.length) { this.ui.hideCoach(); return }
    this.ui.showCoach({ step: i + 1, total: steps.length, title: steps[i].title, body: steps[i].body, last: i === steps.length - 1 })
  }

  private tutorialNext(): void {
    if (this.tutorialStep < 0) return
    this.tutorialStep++
    if (this.tutorialStep >= LegionGame.TUTORIAL.length) { this.finishTutorial(); return }
    this.showTutorialStep()
  }

  private finishTutorial(): void {
    this.tutorialStep = -1
    this.ui.hideCoach()
    if (!this.save.tutorialDone) {
      this.save.tutorialDone = true
      writeSave(this.save)
    }
  }

  /* ================= 动态策略建议 ================= */

  private updateSuggestion(): void {
    if (this.phase !== 'prep' && this.phase !== 'wave') { this.ui.hideSuggest(); this.lastSuggest = ''; return }
    if (this.ui.overlayOn || this.tutorialStep >= 0) return
    if (this.suggestCd > 0) { this.suggestCd -= 2.5; return }
    const s = this.computeSuggestion()
    if (!s) { this.ui.hideSuggest(); this.lastSuggest = ''; return }
    if (s === this.lastSuggest) return
    this.lastSuggest = s
    this.ui.showSuggest(s)
    this.suggestCd = 12
  }

  /** 全部基于真实局面计算，不用固定文案冒充智能 */
  private computeSuggestion(): string | null {
    if (this.strokes.some((s) => s.suppress)) return '合击正被断笔者压制：优先击杀靠近阵型的断笔者即可恢复'
    if (this.phase === 'prep') {
      if (this.coverageGap()) return '靠近营寨的道路缺少攻击覆盖，敌人可能直接穿过防线'
      if (this.synergyTip()) return '工程师与相邻士兵形成「军械」联动：把它放到刀兵 / 枪兵旁可加攻击与攻速'
      if (this.grain >= this.recruitCost() * 2 && this.bench.length < this.benchSlots) return '军粮充足：可招募补兵，或留作合成升阶'
    }
    return null
  }

  /** 末段（靠近营寨）道路是否存在无人覆盖的缺口 */
  private coverageGap(): boolean {
    const total = this.board.len()
    if (total <= 0) return false
    const covers: { x: number; y: number; reach: number }[] = []
    for (const u of this.battle.units) {
      if (!u.active || u.hero) continue
      const c = this.board.center(u.cell)
      covers.push({ x: c.x, y: c.y, reach: (UNIT_BY_ID[u.kind].range + this.unitRangeBonus(u)) * this.board.cell })
    }
    if (!covers.length) return true
    let uncovered = 0
    const step = Math.max(0.2, total / 40)
    for (let p = total * 0.68; p <= total; p += step) {
      const w = this.board.laneWorld('center', p)
      const hit = covers.some((c) => Math.hypot(w.x - c.x, w.y - c.y) <= c.reach)
      uncovered = hit ? 0 : uncovered + 1
      if (uncovered >= 3) return true
    }
    return false
  }

  /** 有工程师、有近战兵，但工程师还没形成军械联动 → 提示相邻部署 */
  private synergyTip(): boolean {
    const eng = this.battle.units.filter((u) => u.active && !u.hero && u.kind === 'engineer')
    if (!eng.length) return false
    const hasMelee = this.battle.units.some((u) => u.active && !u.hero && (u.kind === 'blade' || u.kind === 'spear'))
    if (!hasMelee) return false
    return eng.every((u) => !u.syn.includes('军械'))
  }

  /** 首次出现的敌人 / Boss 给一句通俗说明（每局每种只说一次，不打断操作） */
  private explainNewEnemies(rows: SpawnRow[], boss: BossId | ''): void {
    const tips: Record<string, string> = {
      raider: '普通近战，沿路推进',
      runner: '移动很快，小心漏过防线',
      brute: '血厚甲高，需要集中火力',
      gunner: '远程攻击，射程约 2.8 格',
      bomber: '靠近营寨会自爆，优先拦截',
      splitter: '死亡时分裂成 2 只小虫',
      hexer: '辅助单位，给附近敌人加速',
      champion: '精英重装，血量和护甲极高',
      breaker: '靠近阵型会压制合击，优先击杀',
    }
    for (const r of rows) {
      if (this.seenEnemies.has(r.kind)) continue
      this.seenEnemies.add(r.kind)
      const d = ENEMY_BY_ID[r.kind]
      this.ui.toast(`新敌人 · ${d.name}：${tips[r.kind] || d.role}`, 'warn')
    }
    if (boss && !this.seenBosses.has(boss)) {
      this.seenBosses.add(boss)
      const bt: Record<string, string> = {
        shanxiao: '砸地造成范围伤害，注意分散站位',
        iron: '先打破铁盾，才能造成有效伤害',
        spider: '铺网降低我军攻速，并不断产卵',
        drum: '鼓声让敌人加速，并给自己回血',
        qilin: '起雾收缩射程；抹笔会暂停所有合击 6 秒',
      }
      this.ui.toast(`${BOSS_BY_ID[boss].name}：${bt[boss] || ''}`, 'warn')
    }
  }

  private finishWave(): void {
    this.phase = 'prep'
    const grainGain = Math.round((9 + this.wave * 2.4) * this.grainMulS())
    const silverGain = Math.round((6 + this.wave * 1.9) * this.silverMul())
    this.grain += grainGain
    this.silver += silverGain
    this.income += grainGain + silverGain
    if (this.pendingReward > 0) {
      this.silver += this.pendingReward
      this.income += this.pendingReward
      this.ui.toast(`挑战奖励：银 +${this.pendingReward}`, 'gold')
      this.pendingReward = 0
    }
    if (this.wave === 1) this.grantAch('first')
    this.audio.sfx('clear')
    this.ui.toast(`波次清空 · 粮 +${grainGain} 银 +${silverGain}`, 'good')
    this.checkMilestones()
    const ms = MILESTONES.find((m) => m.wave === this.wave)
    if (ms) this.ui.banner(`第 ${this.wave} 波`, `${ms.name} · 里程碑达成`, 'good')
    this.wave++
    this.beginPrep()
    this.freeRerolls = Math.min(3, this.freeRerolls + 1)
    if (this.heroDead) this.addHero(true)
    this.heroSkillT = Math.max(0, this.heroSkillT - 3)

    const nextBoss = isBossWave(this.wave)
    this.ui.banner(`第 ${this.wave} 波`, nextBoss ? 'Boss 将至' : '整备中', nextBoss ? 'boss' : '')
    this.syncAll()
    this.persistCheckpoint()
    writeSave(this.save)

    /* 每两波来一次三选一构筑；若与事件撞车，先构筑再进整备 */
    if (this.wave >= 3 && this.wave % 2 === 1) { this.openDraft(); return }
    if (this.wave > 3 && this.wave % 6 === 0 && !nextBoss) this.openEvent()
    else this.phase = 'prep'
  }

  private checkMilestones(): void {
    const ms = MILESTONES.find((m) => m.wave === this.wave)
    if (!ms) return
    this.grain += ms.grain
    this.silver += ms.silver
    this.save.gold += ms.gold
    this.income += ms.grain + ms.silver
    this.ui.toast(`里程碑 ${ms.name}：金 +${ms.gold} 粮 +${ms.grain} 银 +${ms.silver}`, 'good')
    this.audio.sfx('achievement')
  }

  /* ================= BattleHost ================= */

  private grainMulS(): number { return 1 + 0.08 * (this.ups.grain || 0) + 0.05 * (this.save.meta.grain || 0) }

  addGrain(n: number): void {
    if (n <= 0) return
    const v = n * this.grainMulS()
    this.grain += v
    this.income += v
  }

  addSilver(n: number): void {
    if (n <= 0) return
    const v = n * this.silverMul()
    this.silver += v
    this.income += v
  }

  private silverMul(): number { return 1 + 0.06 * (this.ups.silver || 0) + 0.05 * (this.save.meta.silver || 0) }

  hurtBase(n: number): void {
    if (this.godMode) return
    const real = n * (1 - Math.min(0.65, this.baseArmor))
    this.baseHp -= real
    this.shake(6)
    if (this.baseHp <= 0) {
      this.baseHp = 0
      this.endRun()
    }
  }

  healBase(n: number): void {
    this.baseHp = Math.min(this.baseMax, this.baseHp + n)
  }

  onEnemyKill(e: Enemy): void {
    this.kills++
    this.addGrain(e.grain)
    this.addSilver(e.silver)
    this.checkLiveAchievements()
  }

  onEnemyLeak(e: Enemy): void {
    this.ui.toast(`${e.name} 撞上营寨`, 'bad')
  }

  onBossKill(e: Enemy): void {
    this.bossKills++
    const id = e.bossId
    if (id && !this.save.bossKilled.includes(id)) this.save.bossKilled.push(id)
    const b = BOSS_BY_ID[id as BossId]
    const grain = (b ? b.rewardGrain : 40) + this.wave
    const silver = (b ? b.rewardSilver : 30) + this.wave * 2
    this.addGrain(grain)
    this.addSilver(silver)
    this.ui.banner(`${e.name} 已斩`, `粮 +${Math.round(grain)} 银 +${Math.round(silver)}`, 'good')
    this.audio.sfx('record')
    if (id === 'shanxiao') this.grantAch('boss1')
    if (this.save.bossKilled.length >= 5) this.grantAch('boss5')
    if (this.items.length < 6) {
      const it = ITEM_DEFS[Math.floor(this.rng() * ITEM_DEFS.length)]
      this.items.push({ id: it.id, charges: 1 })
      this.ui.toast(`战利品：${it.name}`, 'good')
    }
    const tier = Math.floor(this.wave / 50)
    if (tier > 0) this.ui.toast(`Boss 第 ${tier} 轮 · 生命与护甲更强`, 'warn')
    this.checkLiveAchievements()
    this.syncAll()
    this.persistCheckpoint()
  }

  onUnitKill(_u: Unit): void { /* 单位阵亡不额外计数，位置空出来即可 */ }

  onHeroKill(_u: Unit): void {
    this.heroDead = true
    this.ui.toast('英雄阵亡 · 下一波以 60% 生命归队', 'bad')
    this.shake(6)
  }

  onDamage(n: number): void {
    this.damage += n
    if (this.damage >= 100000) this.grantAch('dmg100k')
  }

  unitMods(): UnitMods {
    const ups = this.ups
    return {
      atk: 1 + 0.07 * (ups.atk || 0) + 0.04 * (this.save.meta.atk || 0),
      spd: 1 + 0.06 * (ups.spd || 0) + 0.03 * (this.save.meta.spd || 0),
      crit: 0.06 + 0.04 * (ups.crit || 0),
      critDmg: 1.9 + 0.05 * (ups.crit || 0),
      regen: 0.006 * (ups.regen || 0),
    }
  }

  heroPassive(kind: 'armor' | 'burn' | 'crit' | 'charge' | 'block'): number {
    if (this.heroDead) return 0
    if (!this.battle.units.some((u) => u.hero)) return 0
    if (kind === 'armor') return this.hero === 'qingfeng' ? 0.12 : 0
    if (kind === 'block') return this.hero === 'qingfeng' ? 1 : 0
    if (kind === 'burn') return this.hero === 'chiyuan' ? 0.06 : 0
    if (kind === 'crit') return this.hero === 'bailu' ? 0.1 : 0
    return this.hero === 'taxue' ? 0.35 : 0
  }

  spawnExtra(prog: number, kind: EnemyKind, elite: boolean): Enemy | null {
    return this.battle.spawnEnemy(kind, elite, prog)
  }

  /* ================= 方格战场 / 阵型 / 构筑 ================= */

  pathLane(): 'center' {
    return 'center'
  }

  runMod(key: string): number {
    return this.runMods[key] || 0
  }

  branchOf(u: Unit): number {
    return u.path
  }

  unitRangeBonus(u: Unit): number {
    let v = 0
    if (u.kind === 'bow') v += this.runMod('bowRange')
    if (u.kind === 'engineer' && this.runMod('gearRange') > 0) v += 1
    if (u.syn.includes('齐射')) v += 0.3
    return v
  }

  unitAtkBonus(u: Unit): number {
    /* 兵不会被攻击，原来的纸甲改成"落锋"：直接加攻 */
    let v = this.runMod('steel')
    if (u.kind === 'mage' || u.kind === 'warlock') v += this.runMod('flameDmg')
    if (u.syn.includes('齐射')) v += 0.18
    if (u.syn.includes('军械')) v += 0.1
    if (u.kind === 'engineer' && u.path === 1) v += 0.15
    if (u.kind === 'blade' && u.lv >= 4) v += 0.12
    return v
  }

  unitRateBonus(u: Unit): number {
    let v = 0
    if (u.kind === 'bow' && u.path === 0 && u.lv >= 3) v += 0.35
    if (u.kind === 'engineer' && u.path === 0) v += 0.15
    if (u.kind === 'blade' && u.path === 0) v += 0.15
    if (u.syn.includes('刀枪')) v += 0.12
    if (u.syn.includes('军械')) v += 0.08
    if (this.runMod('mergeHaste') > 0 && u.hitT > 0.98) v += this.runMod('mergeHaste')
    return v
  }

  unitArmorBonus(_u: Unit): number {
    let v = this.runMod('paperArmor')
    return v
  }

  unitBlockBonus(_u: Unit): number {
    /* 兵不再被攻击，站位拥挤度只影响表现 */
    return 0
  }


  /** BattleHost 读笔势用；对象由本层持有，战斗层只写 suppress 标记 */
  strokeList(): Stroke[] {
    return this.strokes
  }

  /** 布阵变化后重算：方格相邻联动、可见连线、单位标签、横竖连笔 */
  private recomputeFormations(): void {
    this.links = []
    const units = this.battle.units.filter((u) => u.active && !u.hero)
    for (const u of this.battle.units) {
      u.terrain = ''
      u.syn = []
      if (!u.hero) {
        u.block = 0
      }
    }
    const c = (u: Unit): { x: number; y: number } => this.board.center(u.cell)
    /* 同列 3 名以上弓兵 → 同列齐射 */
    for (let x = 0; x < COLS; x++) {
      const bows = units.filter((u) => u.kind === 'bow' && cellX(u.cell) === x)
      if (bows.length >= 3) {
        for (const b of bows) b.syn.push('齐射')
        for (let i = 0; i < bows.length - 1; i++) this.links.push({ a: bows[i].cell, b: bows[i + 1].cell, kind: 'volley' })
      }
    }
        /* 刀枪相邻 → 合击：刀贴住，枪穿线，两边都打得更快 */
    for (const sp of units.filter((u) => u.kind === 'spear')) {
      for (const bl of units.filter((u) => u.kind === 'blade')) {
        const a = c(sp)
        const b = c(bl)
        if (Math.hypot(a.x - b.x, a.y - b.y) <= this.board.cell * 1.5) {
          sp.syn.push('刀枪')
          bl.syn.push('刀枪')
          this.links.push({ a: bl.cell, b: sp.cell, kind: 'line' })
        }
      }
    }
    /* 工程师给相邻友军上械 */
    for (const en of units.filter((u) => u.kind === 'engineer')) {
      const a = c(en)
      for (const u of units) {
        if (u === en) continue
        const b = c(u)
        if (Math.hypot(a.x - b.x, a.y - b.y) <= this.board.cell * 1.5) {
          u.syn.push('军械')
          this.links.push({ a: en.cell, b: u.cell, kind: 'gear' })
        }
      }
    }
    /* 笔势：三名以上连成一横 / 一竖。合击与横扫都在战斗层结算，
       这里只负责找出线条、给棋子打标签、并在成阵瞬间给一次反馈。 */
    const occupied = new Set<number>()
    for (const u of units) occupied.add(u.cell)
    const next = findStrokes(occupied)
    const tags = strokeTags(next)
    for (const u of units) {
      const t = tags.get(u.cell)
      if (!t) continue
      for (const k of t) u.syn.push(strokeName(k))
    }
    this.strokes = next
    this.noteNewStrokes()
  }

  /** 新成一条笔势时给一次短促反馈：墨线扫过 + 一声笔触，不打断操作 */
  private noteNewStrokes(): void {
    const now = this.time
    const nextSeen: Record<string, boolean> = {}
    for (const s of this.strokes) {
      nextSeen[s.key] = true
      if (this.strokeSeen[s.key]) continue
      if (now - this.strokeNoteT < 0.7) continue
      if (this.drag) continue
      this.strokeNoteT = now
      const a = this.board.center(s.cells[0])
      const b = this.board.center(s.cells[s.cells.length - 1])
      const mx = (a.x + b.x) / 2
      /* 贴顶的直锋会把字顶进顶栏，夹回棋盘内 */
      const my = Math.max(this.board.oy + this.board.cell * 0.8, (a.y + b.y) / 2 - this.board.cell * 0.3)
      this.fx.shock(mx, (a.y + b.y) / 2, this.board.cell * 0.3, this.board.cell * Math.max(1.2, s.len * 0.5), '#3a332a', 0.45, 2)
      this.fx.text(mx, my, `${s.kind === 'row' ? '横排合击' : '竖列集火'}成形`, '#3a332a', 13)
      this.audio.sfx('stroke', 0.55)
    }
    this.strokeSeen = nextSeen
  }

  private syncFormations(): void {
    this.recomputeFormations()
    const sel = this.selected >= 0 ? this.battle.unitAt(this.selected) : null
    this.ui.inspect(sel ? this.inspectView(sel) : null)
    const chips = this.runCards.map((id) => {
      const def = RUN_BY_ID[id]
      return { id, name: def.name, glyph: def.glyph, lv: this.runCardLevel(id), desc: def.desc }
    })
    this.ui.tactics(chips)
  }

  private runCardLevel(id: string): number {
    const def = RUN_BY_ID[id]
    if (!def) return 0
    const key = Object.keys(def.mod)[0]
    return Math.max(1, Math.round((this.runMods[key] || 0) / def.mod[key]))
  }

  private inspectView(u: Unit): InspectView {
    const def = UNIT_BY_ID[u.kind]
    const br = branchDefOf(u.kind, u.path)
    return {
      glyph: u.hero ? HERO_BY_ID[u.hero].glyph : def.glyph,
      name: u.hero ? HERO_BY_ID[u.hero].name : def.name,
      rarity: u.hero ? '统帅' : RARITY_LABEL[def.rarity],
      color: u.hero ? HERO_BY_ID[u.hero].color : RARITY_COLOR[def.rarity],
      lv: u.lv,
      branch: br ? `${br.name} · ${br.desc}` : u.lv >= 3 ? '强化路线：待选择' : '3 级时选强化路线',
      hp: `${Math.ceil(u.hp)}/${Math.round(u.maxHp)}`,
      atk: String(Math.round(u.atk * (1 + this.unitAtkBonus(u)))),
      atkSpeed: `${(1 / Math.max(0.1, u.cd / Math.max(0.2, 1 + this.unitRateBonus(u)))).toFixed(1)} /秒`,
      range: (u.range + this.unitRangeBonus(u)).toFixed(1),
      lane: `第 ${cellY(u.cell) + 1} 行 · 第 ${cellX(u.cell) + 1} 列`,
      syn: [...u.syn],
      note: br ? br.effect : def.role,
      strokeNote: (() => {
        for (const s of this.strokes) if (s.cells.includes(u.cell)) {
          return `${s.kind === 'row' ? '横排合击' : '竖列集火'} · ${s.len} 人 · ${s.suppress ? '被敌人压制，暂不生效' : (s.kind === 'row' ? '横扫这一行道路' : '集火最前面的敌人')}`
        }
        return ''
      })(),
    }
  }

  shake(amp: number): void {
    if (!this.shakeOn) return
    this.shakeAmp = Math.max(this.shakeAmp, amp * this.dpr * 0.7)
  }

  notify(text: string, tone?: string): void {
    this.ui.toast(text, tone || '')
  }

  /* ================= 资源 / 招募 ================= */

  private recruitCost(): number { return 8 + Math.floor(this.wave * 1.15) }
  private rerollCost(): number { return 4 + Math.floor(this.wave * 0.35) }
  private premiumCost(): number { return 12 + Math.floor(this.wave * 0.95) }
  private luck(): number { return 2 + 4 * (this.ups.luck || 0) + 3 * (this.save.meta.luck || 0) }

  private pickAvailableKind(luck: number, premium: boolean): { kind: UnitKind; rarity: keyof typeof RARITY_COLOR } {
    for (let attempt = 0; attempt < 7; attempt++) {
      const rarity = pickRarity(luck, premium, this.rng)
      let kind = pickKind(rarity, this.rng)
      if (!this.save.units.includes(kind)) {
        const pool = (Object.keys(UNIT_BY_ID) as UnitKind[]).filter((k) => UNIT_BY_ID[k].rarity === rarity && this.save.units.includes(k))
        if (!pool.length) {
          const any = (Object.keys(UNIT_BY_ID) as UnitKind[]).filter((k) => this.save.units.includes(k) && UNIT_BY_ID[k].rarity === 'common')
          kind = any[Math.floor(this.rng() * any.length)]
          return { kind, rarity: UNIT_BY_ID[kind].rarity }
        }
        kind = pool[Math.floor(this.rng() * pool.length)]
      }
      return { kind, rarity: UNIT_BY_ID[kind].rarity }
    }
    return { kind: 'blade', rarity: 'common' }
  }

  rollCards(premium: boolean): RecruitCard[] {
    const cards: RecruitCard[] = []
    for (let i = 0; i < 3; i++) {
      const r = this.pickAvailableKind(this.luck(), premium)
      cards.push({
        kind: r.kind,
        veteran: this.rng() < veteranChance(this.luck()),
        cost: this.recruitCost(),
        key: `${r.kind}-${i}-${Math.floor(this.rng() * 1e9)}`,
      })
    }
    if (premium && !cards.some((c) => UNIT_BY_ID[c.kind].rarity !== 'common' && UNIT_BY_ID[c.kind].rarity !== 'fine')) {
      const r = this.pickAvailableKind(this.luck() + 18, true)
      cards[0] = { kind: r.kind, veteran: true, cost: this.recruitCost(), key: `p-${Math.floor(this.rng() * 1e9)}` }
    }
    return cards
  }

  private recruitCard(index: number): boolean {
    const card = this.cards[index]
    if (!card) return false
    if (this.bench.length >= this.benchSlots) {
      this.toastBenchFull()
      return false
    }
    if (this.grain < card.cost) {
      this.ui.toast(`军粮不足：需要 ${card.cost}，现有 ${Math.floor(this.grain)}`, 'bad')
      this.audio.sfx('error')
      return false
    }
    this.grain -= card.cost
    this.bench.push({ kind: card.kind, lv: 1, veteran: card.veteran })
    this.recruits.add(card.kind)
    const def = UNIT_BY_ID[card.kind]
    this.audio.sfx(def.rarity === 'rare' || def.rarity === 'epic' || def.rarity === 'legend' ? 'rare' : 'recruit')
    if (def.rarity !== 'common') this.ui.toast(`${RARITY_LABEL[def.rarity]} · ${def.name}`, def.rarity === 'legend' ? 'gold' : 'good')
    const n = this.pickAvailableKind(this.luck(), false)
    this.cards[index] = { kind: n.kind, veteran: this.rng() < veteranChance(this.luck()), cost: this.recruitCost(), key: `${n.kind}-${Math.floor(this.rng() * 1e9)}` }
    if (this.recruits.size >= 8) this.grantAch('alltypes')
    this.syncAll()
    return true
  }

  private toastBenchFull(): void {
    this.ui.toast(`预备兵营已满（${this.bench.length}/${this.benchSlots}）：先部署或遣散`, 'bad')
    this.audio.sfx('error')
  }

  /** 银币不足：说清需要多少、现有多少 */
  private poorSilver(cost: number): void {
    this.ui.toast(`银币不足：需要 ${cost}，现有 ${Math.floor(this.silver)}`, 'bad')
    this.audio.sfx('error')
  }

  /** 不能合成/融合时说明原因 */
  private combineFailReason(ak: string, al: number, bk: string, bl: number): string {
    if (ak === bk && al !== bl) return '同名但等级不同：需同级才能合成'
    return '这两种兵既不同名、也不可融合'
  }

  private rerollCards(itemFree = false): void {
    const cost = this.rerollCost()
    if (!itemFree) {
      if (this.freeRerolls > 0) this.freeRerolls--
      else if (this.silver >= cost) this.silver -= cost
      else { this.poorSilver(cost); return }
    }
    this.cards = this.rollCards(false)
    this.audio.sfx('ui')
    this.syncAll()
  }

  private premiumRoll(): void {
    const cost = this.premiumCost()
    if (this.silver < cost) { this.poorSilver(cost); return }
    this.silver -= cost
    this.cards = this.rollCards(true)
    this.audio.sfx('rare')
    this.ui.toast('高级招募：更易出稀有 / 史诗 / 传说', 'good')
    this.syncAll()
  }

  private bulkRecruit(): void {
    let n = 0
    let guard = 0
    while (guard++ < 20 && this.bench.length < this.benchSlots) {
      const idx2 = this.cards.findIndex((c) => c.cost <= this.grain)
      if (idx2 < 0) break
      if (!this.recruitCard(idx2)) break
      n++
    }
    if (n) this.ui.toast(`一键招募 ${n} 人`, 'good')
    else this.ui.toast('军粮不足或兵营已满，无法招募', 'bad')
  }

  /* ================= 拖拽 ================= */

  private beginBenchDrag(index: number, ev: PointerEvent): void {
    if (this.phase !== 'prep' && this.phase !== 'wave') return
    if (this.overlay) return
    const b = this.bench[index]
    if (!b) return
    ev.preventDefault()
    const p = this.toCanvas(ev.clientX, ev.clientY)
    this.drag = {
      fromBench: true, index, fromCell: -1, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: false,
      target: -1, merge: false, fuse: false, illegal: false, lost: 0, benchTarget: -1,
      kind: b.kind, lv: b.lv, veteran: b.veteran, hero: '',
    }
    this.ui.root.classList.add('is-dragging')
    this.ui.benchSource(index)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
  }

  private beginCellDrag(cell: number, ev: PointerEvent): void {
    const u = this.battle.unitAt(cell)
    if (!u) return
    ev.preventDefault()
    const p = this.toCanvas(ev.clientX, ev.clientY)
    this.drag = {
      fromBench: false, index: -1, fromCell: cell, x: p.x, y: p.y, startX: p.x, startY: p.y, moved: false,
      target: -1, merge: false, fuse: false, illegal: false, lost: 0, benchTarget: -1,
      kind: u.kind, lv: u.hero ? 1 : u.lv, veteran: u.veteran, hero: u.hero,
    }
    this.selected = cell
    this.syncFormations()
    this.ui.root.classList.add('is-dragging')
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
  }

  private toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }

  /** 两个单位能不能叠：同名同级升一级；不同兵种命中配方时融合。 */
  private combineMode(aKind: UnitKind, aLv: number, bKind: UnitKind, bLv: number): 'merge' | 'fuse' | '' {
    if (aKind === bKind) return aLv === bLv && aLv < 5 ? 'merge' : ''
    return fusionOf(aKind, bKind) ? 'fuse' : ''
  }

  private onPointerMove = (ev: PointerEvent): void => {
    const p = this.toCanvas(ev.clientX, ev.clientY)
    this.hover = this.board.hit(p.x, p.y)
    if (!this.drag) return
    this.drag.x = p.x
    this.drag.y = p.y
    if (Math.hypot(p.x - this.drag.startX, p.y - this.drag.startY) > 6) this.drag.moved = true
    this.updateDragTarget()
  }

  private updateDragTarget(): void {
    const d = this.drag
    if (!d) return
    const cell = this.board.hit(d.x, d.y)
    d.target = cell
    d.merge = false
    d.fuse = false
    d.illegal = false
    d.lost = 0
    /* 拖点将台里的卡：先看指针是不是压在另一个台位上（台上合兵） */
    d.benchTarget = -1
    if (d.fromBench && cell < 0) {
      const over = this.benchSlotAt(d.x, d.y)
      if (over >= 0 && over !== d.index && this.bench[over]) {
        d.benchTarget = over
        const mode = this.combineMode(d.kind, d.lv, this.bench[over].kind, this.bench[over].lv)
        this.ui.benchHover(over, mode)
        return
      }
      this.ui.benchHover(-1, '')
    }
    if (cell < 0) return
    if (!this.cells.has(cell)) { d.illegal = true; return }
    if (d.fromBench) {
      const u = this.battle.unitAt(cell)
      if (!u) return
      const mode = u.hero ? '' : this.combineMode(d.kind, d.lv, u.kind, u.lv)
      if (mode === 'merge') d.merge = true
      else if (mode === 'fuse') d.fuse = true
      else d.illegal = true
      /* 从点将台叠到棋盘不抽走棋子，笔势不变 */
      return
    }
    if (cell === d.fromCell) return
    const u = this.battle.unitAt(cell)
    if (!u) { d.lost = this.strokesLostBy(d.fromCell, cell); return }
    const mode = u.hero || d.hero ? '' : this.combineMode(d.kind, d.lv, u.kind, u.lv)
    if (mode === 'merge') d.merge = true
    else if (mode === 'fuse') d.fuse = true
    else d.illegal = true
    if (mode) d.lost = this.strokesLostBy(d.fromCell)
  }

  /** 把某格棋子挪走（可选落到另一格）后，会断掉几条笔势。 */
  private strokesLostBy(remove: number, add = -1): number {
    const before = new Set(this.strokes.map((s) => s.key))
    const occupied = new Set<number>()
    for (const u of this.battle.units) {
      if (!u.active || u.hero) continue
      if (u.cell === remove) continue
      occupied.add(u.cell)
    }
    if (add >= 0) occupied.add(add)
    const after = new Set(findStrokes(occupied).map((s) => s.key))
    let lost = 0
    for (const k of before) if (!after.has(k)) lost++
    return lost
  }

  /** 指针下面是不是某个点将台台位（拖到台上合兵要用） */
  private benchSlotAt(x: number, y: number): number {
    if (typeof document === 'undefined') return -1
    const cr = this.canvasRect()
    const el = document.elementFromPoint(cr.left + x, cr.top + y) as HTMLElement | null
    const slot = el ? el.closest('.lg-slot') : null
    if (!slot) return -1
    const i = Number(slot.getAttribute('data-slot'))
    return Number.isFinite(i) ? i : -1
  }

  private onPointerUp = (_ev: PointerEvent): void => {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    this.ui.root.classList.remove('is-dragging')
    const d = this.drag
    this.drag = null
    this.ui.benchSource(-1)
    if (!d) return
    /* 台上拖拽合成：松手在另一个台位上就直接合，跟棋盘上叠卡是同一套手势 */
    if (d.benchTarget >= 0) {
      this.ui.benchHover(-1, '')
      const b = this.bench[d.benchTarget]
      const mode = b ? this.combineMode(d.kind, d.lv, b.kind, b.lv) : ''
      if (!mode) {
        this.ui.toast('这两张无法合成或融合', 'bad')
        this.audio.sfx('error')
      } else {
        this.combineBench(d.index, d.benchTarget, mode)
      }
      return
    }
    this.ui.benchHover(-1, '')
    if (d.fromBench && !d.moved) {
      this.tapBench(d.index)
      return
    }
    const cell = this.board.hit(d.x, d.y)
    const cr = this.canvasRect()
    const trash = this.ui.metrics().trash
    const inTrash = !!trash &&
      d.x + cr.left >= trash.left && d.x + cr.left <= trash.right &&
      d.y + cr.top >= trash.top && d.y + cr.top <= trash.bottom
    if (inTrash) {
      this.sellDrag(d)
      return
    }
    if (cell < 0) return
    if (!this.cells.has(cell)) {
      if (this.phase === 'prep' || this.phase === 'wave') this.tryUnlock(cell)
      return
    }
    if (d.fromBench) this.dropFromBench(d.index, cell)
    else this.dropFromCell(d.fromCell, cell)
    this.syncAll()
  }

  private canvasRect(): DOMRect { return this.canvas.getBoundingClientRect() }

  private tapBench(index: number): void {
    const b = this.bench[index]
    if (!b) return
    if (this.benchPicked === index) {
      this.benchPicked = -1
      this.syncBench()
      return
    }
    if (this.benchPicked < 0) {
      this.benchPicked = index
      this.audio.sfx('ui', 0.8)
      this.syncBench()
      return
    }
    const picked = this.benchPicked
    const a = this.bench[picked]
    if (!a) { this.benchPicked = -1; this.syncBench(); return }
    const mode = this.combineMode(a.kind, a.lv, b.kind, b.lv)
    if (!mode) {
      this.ui.toast('这两张无法合成或融合', 'bad')
      this.audio.sfx('error')
      this.benchPicked = index
      this.syncBench()
      return
    }
    this.combineBench(picked, index, mode)
  }

  /** 点将台内合成：不经过棋盘，点两张就能出结果。 */
  private combineBench(i: number, j: number, mode: 'merge' | 'fuse', quiet = false): void {
    const a = this.bench[i]
    const b = this.bench[j]
    if (!a || !b) return
    const outKind = mode === 'fuse' ? fusionOf(a.kind, b.kind) : a.kind
    if (!outKind) return
    const outLv = mode === 'fuse' ? fusionLevel(a.lv, b.lv) : a.lv + 1
    const outVet = a.veteran || b.veteran
    const lo = Math.min(i, j)
    const hi = Math.max(i, j)
    this.bench.splice(hi, 1)
    this.bench.splice(lo, 1, { kind: outKind, lv: outLv, veteran: outVet })
    this.benchPicked = -1
    this.benchPop = lo
    this.benchPopT = this.time
    this.merges++
    this.bestLv = Math.max(this.bestLv, outLv)
    this.audio.sfx(mode === 'fuse' ? 'merge5' : 'merge')
    if (!quiet) this.ui.toast(mode === 'fuse' ? `合兵 · ${UNIT_BY_ID[outKind].glyph}` : `${UNIT_BY_ID[outKind].name} Lv.${outLv}`, 'good')
    this.syncAll()
  }

  /** 一键把点将台里同名同级的兵先合掉；异兵融合留给玩家点两张确认。 */
  private benchMergeAll(): void {
    let made = 0
    for (let guard = 0; guard < 16; guard++) {
      let found = false
      for (let i = 0; i < this.bench.length && !found; i++) {
        for (let j = i + 1; j < this.bench.length; j++) {
          const a = this.bench[i]
          const b = this.bench[j]
          if (!a || !b) continue
          if (this.combineMode(a.kind, a.lv, b.kind, b.lv) === 'merge') {
            this.combineBench(i, j, 'merge', true)
            made++
            found = true
            break
          }
        }
      }
      if (!found) break
    }
    if (made > 0) {
      this.audio.sfx('merge')
      this.ui.toast(`合兵 ×${made}`, 'good')
    } else {
      this.ui.toast('没有可合成的同名兵', 'bad')
      this.audio.sfx('error')
    }
    this.syncAll()
  }

  private dropFromBench(index: number, cell: number): void {
    const b = this.bench[index]
    if (!b) return
    const occupant = this.battle.unitAt(cell)
    if (!occupant) {
      const u = this.battle.addUnit(b.kind, b.lv, b.veteran, cell)
      if (!u) return
      this.applySynergy(u)
      this.bench.splice(index, 1)
      this.benchPicked = -1
      this.bestLv = Math.max(this.bestLv, b.lv)
      /* 落子：一滴墨在纸上晕开 */
      const cc = this.board.center(cell)
      this.fx.bloom(cc.x, cc.y, this.board.cell * 0.15, this.board.cell * 0.6, UNIT_BY_ID[b.kind].color, 0.4)
      this.fx.burst(cc.x, cc.y, UNIT_BY_ID[b.kind].color, 6, 120)
      this.audio.sfx('sell', 0.8)
      if (b.lv >= 3 && u.path < 0) this.promptBranch(u)
      return
    }
    const mode = occupant.hero ? '' : this.combineMode(b.kind, b.lv, occupant.kind, occupant.lv)
    if (!mode) {
      this.ui.toast(this.combineFailReason(b.kind, b.lv, occupant.kind, occupant.lv), 'bad')
      this.audio.sfx('error')
      return
    }
    const outKind = mode === 'fuse' ? fusionOf(b.kind, occupant.kind) : b.kind
    if (!outKind) return
    const outLv = mode === 'fuse' ? fusionLevel(b.lv, occupant.lv) : b.lv + 1
    this.bench.splice(index, 1)
    this.benchPicked = -1
    this.mergeUnits(occupant.cell, b.kind, b.lv, b.veteran || occupant.veteran, occupant, undefined, outKind, outLv)
  }

  private dropFromCell(from: number, to: number): void {
    if (from === to) return
    const src = this.battle.unitAt(from)
    if (!src) return
    const before = new Set(this.strokes.map((s) => s.key))
    const dst = this.battle.unitAt(to)
    if (!dst) {
      src.cell = to
      this.selected = to
      this.fx.burst(this.board.center(to).x, this.board.center(to).y, '#6b6255', 8, 120)
      this.audio.sfx('ui')
      this.reportStrokes(before)
      return
    }
    const mode = src.hero || dst.hero ? '' : this.combineMode(src.kind, src.lv, dst.kind, dst.lv)
    if (!mode) {
      this.ui.toast(this.combineFailReason(src.kind, src.lv, dst.kind, dst.lv), 'bad')
      this.audio.sfx('error')
      return
    }
    const outKind = mode === 'fuse' ? fusionOf(src.kind, dst.kind) : src.kind
    if (!outKind) return
    const outLv = mode === 'fuse' ? fusionLevel(src.lv, dst.lv) : src.lv + 1
    this.battle.removeUnit(src, true)
    this.mergeUnits(to, src.kind, src.lv, src.veteran || dst.veteran, dst, from, outKind, outLv)
    this.reportStrokes(before)
  }

  /** 布阵变化前后对比笔势：断了要明说，新成的已经在成阵时给过反馈 */
  private reportStrokes(before: Set<string>): void {
    const after = new Set(this.strokes.map((s) => s.key))
    let lost = 0
    for (const k of before) if (!after.has(k)) lost++
    if (!lost) return
    this.ui.toast(`合击被拆：少了 ${lost} 条合击`, 'warn')
    this.audio.sfx('cut', 0.9)
  }

  private mergeUnits(
    cell: number, kind: UnitKind, lv: number, veteran: boolean, other: Unit, fromCell?: number,
    outKind: UnitKind = kind, outLv: number = lv + 1,
  ): void {
    const fused = outKind !== kind
    const c = this.board.center(cell)
    const oldC = this.board.center(other.cell)
    const resultDef = UNIT_BY_ID[outKind]
    this.mergeGhosts = this.mergeGhosts.filter((g) => this.time - g.t0 < 0.5)
    this.mergeGhosts.push({
      a: fromCell ?? cell, b: cell, cell, kind: outKind, glyph: resultDef.glyph,
      color: resultDef.color, lv: outLv, t0: this.time,
    })
    this.fx.converge(c.x, c.y, oldC.x, oldC.y, resultDef.color)
    this.battle.removeUnit(other, true)
    const unit = this.battle.addUnit(outKind, outLv, veteran, cell)
    if (!unit) return
    const newLv = outLv
    this.bestLv = Math.max(this.bestLv, newLv)
    this.merges++
    const refund = Math.round((5 + lv * 4) * (1 + 0.3 * (this.ups.merge || 0) + 0.06 * (this.save.meta.mergeGain || 0)))
    this.addGrain(refund)
    if (this.runMod('mergeGrain') > 0) this.addGrain(this.runMod('mergeGrain'))
    /* 合成演出分三档，不再共用一套冲击环。
       异兵融是"两个兵种交笔"，用交叉双锋 + 双色环；五级是"封顶"，用金；
       普通升级只给一档轻量反馈，免得每合一次都全屏炸。 */
    const R = this.board.cell
    if (fused) {
      const d = R * 0.78
      this.fx.slash(c.x - d, c.y - d, c.x + d, c.y + d, '#3f6b5a', 0.3, R * 0.13, 0.26, '#8fd6b4', 1)
      this.fx.slash(c.x + d, c.y - d, c.x - d, c.y + d, '#b8860b', 0.34, R * 0.11, -0.26, '#ffe9b0', 1)
      this.fx.shock(c.x, c.y, R * 0.18, R * 1.7, '#3f6b5a', 0.52, 3.5)
      this.fx.shock(c.x, c.y, R * 0.1, R * 1.15, '#b8860b', 0.38, 2)
      this.fx.burst(c.x, c.y, '#8fd6b4', 16, 260, 'spark')
      this.fx.shards(c.x, c.y, '#e0b64a', 18, 250)
    } else if (newLv >= 5) {
      this.fx.shock(c.x, c.y, R * 0.2, R * 1.9, '#b8860b', 0.5, 4)
      this.fx.shock(c.x, c.y, R * 0.12, R * 1.25, '#ffe9b0', 0.34, 2)
      this.fx.shards(c.x, c.y, '#b8860b', 24, 220)
      this.fx.burst(c.x, c.y, '#ffd166', 14, 200, 'spark')
    } else {
      this.fx.shock(c.x, c.y, R * 0.2, R * 1.2, resultDef.color, 0.5, 2)
      this.fx.shards(c.x, c.y, '#c9b98f', 10, 220)
      /* 一道向上的短锋：等级是"往上走"，方向感比光圈更直白 */
      this.fx.slash(c.x, c.y + R * 0.34, c.x, c.y - R * 0.42, resultDef.color, 0.22, R * 0.075, 0.1, '', 0.6)
    }
    unit.flash = 0.34
    /* 印章语言：融合「融」、五级「极」、普通升级「升」——升级是盖印，不是光圈 */
    if (fused) this.fx.stamp(c.x, c.y, '融', R * 0.6, '#2f5548', 0.8)
    else if (newLv >= 5) this.fx.stamp(c.x, c.y, '极', R * 0.6, '#b8860b', 0.85)
    else this.fx.stamp(c.x, c.y, '升', R * 0.46, resultDef.color, 0.6)
    const label = fused ? `融 · ${resultDef.glyph}` : `${'ⅠⅡⅢⅣⅤ'[newLv - 1]} 级`
    this.fx.text(c.x, c.y - R * 0.36, label, fused ? '#2f5548' : newLv >= 5 ? '#b8860b' : '#3f6b3a', fused ? 22 : newLv >= 5 ? 22 : 16)
    this.audio.sfx(fused ? 'merge5' : newLv >= 5 ? 'merge5' : 'merge')
    this.shake(fused || newLv >= 5 ? 6 : 2)
    if (fused) this.ui.banner('融合成功', `${resultDef.name}`, 'gold')
    if (newLv >= 5) this.ui.banner('五级 · 不动如山', `${resultDef.levels[4].name}`, 'gold')
    if (newLv >= 4) this.grantAch('lv4')
    if (newLv >= 5) this.grantAch('lv5')
    if (this.merges >= 20) this.grantAch('merge20')
    if ((this.ups.merge || 0) > 0) this.fx.text(c.x, c.y + this.board.cell * 0.45, `+${refund} 粮`, '#3f6b3a', 11)
    this.applySynergy(unit)
    this.syncAll()
    if (newLv === 3) this.promptBranch(unit)
  }

  /* ---- 三级专精 ---- */

  private promptBranch(u: Unit): void {
    if (!u.active || u.hero || u.path >= 0) return
    const pair = BRANCHES[u.kind]
    if (!pair) return
    this.branchUnit = u
    this.branchReturnPhase = this.phase === 'wave' ? 'wave' : 'prep'
    this.phase = 'branch'
    this.overlay = 'branch'
    this.ui.showBranch(UNIT_BY_ID[u.kind].name, UNIT_BY_ID[u.kind].glyph, UNIT_BY_ID[u.kind].color, [pair.a, pair.b])
    this.audio.sfx('lvup')
  }

  chooseBranch(id: string): void {
    const u = this.branchUnit
    if (!u || !u.active) { this.closeBranch(); return }
    u.path = id === 'b' ? 1 : 0
    const br = branchDefOf(u.kind, u.path)
    const c = this.board.center(u.cell)
    this.fx.shock(c.x, c.y, this.board.cell * 0.2, this.board.cell * 1.4, br ? '#b8860b' : '#6b6255', 0.55, 3)
    this.fx.shards(c.x, c.y, '#b8860b', 18, 240)
    this.fx.text(c.x, c.y - this.board.cell * 0.42, br ? br.name : '专精', '#b8860b', 18)
    this.ui.toast(`${UNIT_BY_ID[u.kind].name} → ${br ? br.name : '专精'}`, 'gold')
    this.branchUnit = null
    this.hideOverlay()
    this.phase = this.branchReturnPhase
    this.ui.setPhase(this.phase)
    this.syncAll()
  }

  private closeBranch(): void {
    this.branchUnit = null
    this.hideOverlay()
    this.phase = this.branchReturnPhase
    this.ui.setPhase(this.phase)
    this.syncAll()
  }

  /* ---- Roguelike 三选一 ---- */

  private openDraft(): void {
    const pool = RUN_CARDS.filter((c) => this.runCardLevel(c.id) < c.max)
    const picks: RunCardDef[] = []
    const local = [...pool]
    while (picks.length < 3 && local.length) {
      const i = Math.floor(this.rng() * local.length)
      picks.push(local.splice(i, 1)[0])
    }
    if (!picks.length) { this.phase = 'prep'; return }
    this.draftOptions = picks.map((p) => p.id)
    this.phase = 'draft'
    this.overlay = 'draft'
    this.ui.showDraft(picks)
    this.audio.sfx('lvup')
  }

  chooseDraft(index: number): void {
    const id = this.draftOptions[index]
    const def = id ? RUN_BY_ID[id] : null
    if (def) {
      if (!this.runCards.includes(id)) this.runCards.push(id)
      for (const [k, val] of Object.entries(def.mod)) this.runMods[k] = (this.runMods[k] || 0) + val
      this.ui.banner(def.name, def.desc, 'gold')
      this.audio.sfx('record')
    }
    this.draftOptions = []
    this.hideOverlay()
    this.phase = 'prep'
    this.ui.setPhase('prep')
    this.syncAll()
  }

  /* ---- 阵型与联动 ---- */

  private applySynergy(u: Unit): void {
    if (u.hero) return
    const h = HERO_BY_ID[this.hero]
    if (!h || h.synergy !== u.kind) return
    u.atk = Math.round(u.atk * 1.2)
    u.cd *= 0.85
  }

  private sellDrag(d: DragState): void {
    if (d.fromBench) {
      const b = this.bench[d.index]
      if (!b) return
      this.bench.splice(d.index, 1)
      this.addGrain(this.sellValue(b.lv, b.veteran))
      this.audio.sfx('sell')
      this.ui.toast(`遣散 ${UNIT_BY_ID[b.kind].name}`, '')
      this.syncAll()
      return
    }
    const u = this.battle.unitAt(d.fromCell)
    if (!u) return
    if (u.hero) { this.ui.toast('英雄不能遣散', 'bad'); return }
    this.battle.removeUnit(u, true)
    this.addGrain(this.sellValue(u.lv, u.veteran))
    this.audio.sfx('sell')
    this.ui.toast(`遣散 ${UNIT_BY_ID[u.kind].name}`, '')
    this.syncAll()
  }

  private sellValue(lv: number, veteran: boolean): number {
    return Math.round((6 + Math.pow(3, lv - 1) * 4) * (veteran ? 1.35 : 1))
  }

  private tryUnlock(cell: number): void {
    const cost = unlockCost(this.cells.size)
    if (this.silver < cost) {
      this.poorSilver(cost)
      return
    }
    this.silver -= cost
    this.cells.add(cell)
    this.audio.sfx('levelup')
    this.fx.burst(this.board.center(cell).x, this.board.center(cell).y, '#6d5236', 14, 200)
    this.ui.toast(`开出一格 · 已用 ${this.cells.size} 格`, 'good')
    this.syncAll()
  }

  /* ================= 道具 ================= */

  private useItem(id: ItemId): void {
    const slot = this.items.find((i) => i.id === id)
    if (!slot) return
    const def = ITEM_BY_ID[id]
    if (def.target) {
      if (this.armed === id) { this.armed = null; this.ui.itemHint('点道具再用'); this.syncItems(); return }
      this.armed = id
      this.ui.itemHint(id === 'levelup' ? '点一个单位升级' : '点山道砸下去')
      this.syncItems()
      this.audio.sfx('ui')
      return
    }
    this.consumeItem(slot)
    switch (id) {
      case 'draft': {
        if (this.bench.length >= this.benchSlots) { this.ui.toast(`预备兵营已满（${this.bench.length}/${this.benchSlots}）`, 'bad'); return }
        const n = this.pickAvailableKind(this.luck() + 10, false)
        this.bench.push({ kind: n.kind, lv: 1, veteran: false })
        this.audio.sfx('recruit')
        this.ui.toast(`征兵令 · ${UNIT_BY_ID[n.kind].name}`, 'good')
        break
      }
      case 'reroll':
        this.cards = this.rollCards(false)
        this.audio.sfx('ui')
        break
      case 'salve':
        this.healBase(this.baseMax * 0.25)
        this.audio.sfx('heal')
        const bp = this.board.basePoint()
        this.fx.text(bp.x, bp.y - 30, '+25%', '#3f6b3a', 16)
        this.ui.toast('治疗药 · 营寨回血', 'good')
        break
      case 'fury':
        this.furyT = 12
        this.audio.sfx('skill')
        this.ui.toast('狂战令 · 全军攻速 +80%', 'good')
        break
      case 'freeze':
        this.freezeT = 3
        this.battle.freezeAll(3)
        this.ui.toast('定身符 · 全场定住 3 秒', 'good')
        break
      case 'spade': {
        const locked = this.lockedCells()
        if (!locked.length) { this.ui.toast('格子已开满', 'bad'); return }
        const pick = locked[Math.floor(this.rng() * locked.length)]
        this.cells.add(pick)
        this.audio.sfx('levelup')
        this.ui.toast('扩地铲 · 开出一格', 'good')
        break
      }
      default:
        break
    }
    this.syncAll()
  }

  private lockedCells(): number[] {
    const out: number[] = []
    for (let i = 0; i < COLS * ROWS; i++) {
      if (this.cells.has(i)) continue
      if (isPathCell(i)) continue
      out.push(i)
    }
    return out
  }

  private consumeItem(slot: ItemSlot): void {
    slot.charges--
    if (slot.charges <= 0) this.items = this.items.filter((i) => i !== slot)
  }

  private useArmedAt(cell: number): boolean {
    const id = this.armed
    if (!id) return false
    const slot = this.items.find((i) => i.id === id)
    if (!slot) { this.armed = null; return false }
    if (id === 'levelup') {
      const u = this.battle.unitAt(cell)
      if (!u || u.hero) { this.ui.toast('这里没有可升级的单位', 'bad'); return true }
      if (u.lv >= 5) { this.ui.toast('已是最高等级（5 级）', 'bad'); this.armed = null; return true }
      const oldRatio = u.hp / Math.max(1, u.maxHp)
      this.battle.removeUnit(u, true)
      const nu = this.battle.addUnit(u.kind, u.lv + 1, u.veteran, cell)
      if (nu) {
        nu.hp = Math.round(nu.maxHp * Math.max(0.35, oldRatio))
        this.bestLv = Math.max(this.bestLv, nu.lv)
        this.applySynergy(nu)
        const cc = this.board.center(cell)
        /* 道具升级也是盖印 */
        this.fx.stamp(cc.x, cc.y, nu.lv >= 5 ? '极' : '升', this.board.cell * (nu.lv >= 5 ? 0.6 : 0.5), nu.lv >= 5 ? '#b8860b' : '#6b4a8f', 0.8)
        this.fx.shards(cc.x, cc.y, '#c9b98f', 8, 200)
        this.audio.sfx('levelup')
        if (nu.lv >= 4) this.grantAch('lv4')
        if (nu.lv >= 5) this.grantAch('lv5')
      }
    } else if (id === 'cannon') {
      const c = this.board.center(cell)
      this.battle.cannonAt(c.x, c.y, 320 + this.wave * 6)
    }
    this.consumeItem(slot)
    this.armed = null
    this.ui.itemHint('点道具再用')
    this.syncAll()
    return true
  }

  /* ================= 面板动作 ================= */

  onAct(act: string, arg: string): void {
    if (act.startsWith('vol-')) {
      const v = Number(arg)
      if (act === 'vol-sfx') this.save.settings.sfx = v
      else this.save.settings.bgm = v
      this.applySettings()
      writeSave(this.save)
      return
    }
    this.audio.unlock(this.save.settings.sfx, this.save.settings.bgm)
    switch (act) {
      case 'start': this.startRun(this.hero, false); break
      case 'resume': this.startRun(this.hero, true); break
      case 'hero': this.hero = arg as HeroId; this.save.lastHero = this.hero; this.showStart(); this.ui.toast(`${HERO_BY_ID[this.hero].name} 出战`, 'good'); break
      case 'hero-unlock': this.unlockHero(arg as HeroId); break
      case 'meta': this.openMeta(); break
      case 'help': this.openHelp(); break
      case 'tutorial': this.hideOverlay(); this.startTutorial(); break
      case 'tutorial-next': this.tutorialNext(); break
      case 'tutorial-skip': this.finishTutorial(); break
      case 'suggest-dismiss': this.ui.hideSuggest(); this.lastSuggest = ''; this.suggestCd = 20; break
      case 'settings': this.openSettings(); break
      case 'again': this.startRun(this.hero, false); break
      case 'quit': this.close(); this.ui.toast('已返回游戏厅', ''); return
      case 'resume-run': this.resumeFromOverlay(); break
      case 'pause': this.togglePause(); break
      case 'start-wave':
        if (this.phase !== 'prep') break
        if (!this.battle.units.some((u) => u.active && !u.hero)) {
          this.ui.toast('棋盘上还没有兵，先招人', 'bad')
          this.audio.sfx('error')
          break
        }
        this.prepT = 0
        this.audio.sfx('ui')
        break
      case 'speed': this.speed = this.speed === 1 ? 2 : 1; this.syncHud(); this.ui.toast(`倍速 ×${this.speed}`, ''); break
      case 'skill': this.castHeroSkill(); break
      case 'shop': this.openShop(); break
      case 'reroll': this.rerollCards(false); break
      case 'premium': this.premiumRoll(); break
      case 'bulk': this.bulkRecruit(); break
      case 'benchMerge': this.benchMergeAll(); break
      case 'recruit': this.recruitCard(Number(arg)); break
      case 'item': this.useItem(arg as ItemId); break
      case 'buyup': this.buyUp(arg); break
      case 'buyitem': this.buyShopItem(arg as ItemId); break
      case 'tab': this.metaTab = arg; this.openMeta(); break
      case 'metaup': this.buyMeta(arg); break
      case 'unlock-unit': this.unlockUnit(arg as UnitKind); break
      case 'unlock-hero': this.unlockHero(arg as HeroId); break
      case 'quality': this.save.settings.quality = this.save.settings.quality === 'high' ? 'low' : 'high'; this.applySettings(); this.openSettings(); break
      case 'dmg': this.save.settings.dmgNumbers = !this.save.settings.dmgNumbers; this.applySettings(); this.openSettings(); break
      case 'shake': this.save.settings.shake = !this.save.settings.shake; this.applySettings(); this.openSettings(); break
      case 'mute': this.muted = !this.muted; this.applySettings(); this.openSettings(); break
      case 'wipe': this.wipeSave(); break
      case 'event': this.resolveEvent(arg); break
      case 'branch-pick': this.chooseBranch(arg); return
      case 'draft-pick': this.chooseDraft(Number(arg)); return
      default: break
    }
    if (act !== 'vol-sfx' && act !== 'vol-bgm') this.syncAll()
  }

  onBenchDown(index: number, ev: PointerEvent): void {
    this.beginBenchDrag(index, ev)
  }

  onOverlayClose(): void {
    this.closeOverlay()
  }

  private closeOverlay(): void {
    switch (this.overlay) {
      case 'settings':
      case 'help': {
        const back = this.returnOverlay
        this.ui.hideOverlay()
        this.overlay = ''
        if (back === 'pause') this.openPause()
        else if (back === 'meta') this.openMeta()
        else if (back === 'start' || this.phase === 'start' || this.phase === 'over') this.showStart()
        else {
          this.phase = this.resumePhase
          this.ui.setPhase(this.phase)
        }
        break
      }
      case 'shop':
        this.ui.hideOverlay()
        this.overlay = ''
        this.phase = this.resumePhase
        this.ui.setPhase(this.phase)
        break
      case 'pause':
        this.resumeFromOverlay()
        break
      case 'results':
      case 'meta':
        this.showStart()
        break
      case 'start':
      case 'event':
        break
      default:
        break
    }
  }

  private hideOverlay(): void {
    this.overlay = ''
    this.ui.hideOverlay()
  }

  /** 打开设置/说明这类"看完就回去"的弹层：先把战场停在当前阶段 */
  private softPause(): void {
    if (this.phase === 'prep' || this.phase === 'wave') {
      this.resumePhase = this.phase
      this.phase = 'paused'
      this.ui.setPhase('paused')
    }
  }

  private openHelp(): void {
    this.returnOverlay = this.overlay
    this.softPause()
    this.overlay = 'help'
    this.ui.showHelp()
  }

  private openSettings(): void {
    const back = this.overlay
    if (back !== 'settings') this.returnOverlay = back || 'start'
    this.softPause()
    this.overlay = 'settings'
    this.ui.showSettings(this.save, this.muted)
  }

  private applySettings(): void {
    const s = this.save.settings
    this.audio.setVolumes(this.muted ? 0 : s.sfx, this.muted ? 0 : s.bgm)
    this.dmgNumbers = s.dmgNumbers
    this.shakeOn = s.shake
    this.scene.setQuality(s.quality)
    this.fx.setReduced(s.quality === 'low')
    writeSave(this.save)
  }

  togglePause(): void {
    if (this.overlay === 'pause') { this.resumeFromOverlay(); return }
    if (this.phase !== 'prep' && this.phase !== 'wave') return
    this.resumePhase = this.phase
    this.phase = 'paused'
    this.openPause()
    this.audio.suspend()
  }

  private openPause(): void {
    this.overlay = 'pause'
    this.phase = 'paused'
    this.ui.showPause({ wave: this.wave, time: fmtTime(this.runTime), kills: this.kills })
    this.ui.setPhase('paused')
  }

  private resumeFromOverlay(): void {
    this.ui.hideOverlay()
    this.overlay = ''
    if (this.phase === 'paused' || this.phase === 'shop') this.phase = this.resumePhase
    this.ui.setPhase(this.phase)
    this.audio.resume()
    this.lastTs = performance.now()
  }

  private castHeroSkill(): void {
    if (this.heroSkillT > 0) { this.ui.toast(`技能冷却 ${Math.ceil(this.heroSkillT)} 秒`, 'bad'); return }
    if (this.heroDead) { this.ui.toast('英雄已阵亡 · 下一波归队', 'bad'); return }
    this.battle.heroSkill(this.hero)
    this.heroSkillT = HERO_CD[this.hero]
    this.skillCasts++
    if (this.skillCasts >= 20) this.grantAch('skill20')
    this.syncAll()
  }

  private buyUp(id: string): void {
    const def = INGAME_UP_BY_ID[id]
    if (!def) return
    const lv = this.ups[id] || 0
    if (lv >= def.max) return
    const price = Math.round(def.price(lv, this.wave))
    if (this.silver < price) { this.poorSilver(price); return }
    this.silver -= price
    this.ups[id] = lv + 1
    if (id === 'baseHp') {
      const add = Math.round(this.baseMax * 0.06)
      this.baseMax += add
      this.baseHp += add
    }
    if (id === 'baseArmor') this.baseArmor = Math.min(0.65, this.baseArmor + 0.05)
    this.audio.sfx('levelup')
    this.ui.toast(`${def.name} 提升`, 'good')
    this.syncAll()
    if (this.overlay === 'shop') this.openShop()
  }

  private buyShopItem(id: ItemId): void {
    const def = ITEM_BY_ID[id]
    if (!def) return
    const price = Math.round(def.price * (1 + this.wave * 0.03))
    if (this.silver < price) { this.poorSilver(price); return }
    if (this.items.length >= 6) { this.ui.toast('道具栏已满（6/6）', 'bad'); return }
    this.silver -= price
    const slot = this.items.find((i) => i.id === id)
    if (slot) slot.charges++
    else this.items.push({ id, charges: 1 })
    this.audio.sfx('ui')
    this.ui.toast(`购入 ${def.name}`, 'good')
    this.syncAll()
    if (this.overlay === 'shop') this.openShop()
  }

  private openShop(): void {
    if (this.phase === 'over' || this.phase === 'start') return
    if (this.phase === 'prep' || this.phase === 'wave') {
      this.resumePhase = this.phase
      this.phase = 'shop'
      this.ui.setPhase('paused')
    }
    this.overlay = 'shop'
    const ups = INGAME_UPS.map((u) => {
      const lv = this.ups[u.id] || 0
      const price = Math.round(u.price(lv, this.wave))
      return { id: u.id, name: u.name, sub: u.sub, glyph: u.glyph, desc: u.desc, lv, max: u.max, price, afford: this.silver >= price }
    })
    const items = ITEM_DEFS.map((i) => {
      const price = Math.round(i.price * (1 + this.wave * 0.03))
      return { id: i.id, name: i.name, glyph: i.glyph, desc: i.desc, price, afford: this.silver >= price, rarity: i.rarity }
    })
    this.ui.showShop({ silver: this.silver, ups, items } as ShopView)
  }

  /* ================= 波次事件 ================= */

  private openEvent(): void {
    this.phase = 'event'
    this.overlay = 'event'
    const kinds = ['chest', 'merchant', 'rare', 'challenge', 'buff', 'intruder']
    this.eventKind = kinds[Math.floor(this.rng() * kinds.length)]
    const view = this.buildEvent(this.eventKind)
    this.ui.showEvent(view)
  }

  private buildEvent(kind: string): EventView {
    const scale = 1 + this.wave * 0.1
    if (kind === 'chest') {
      return {
        title: '林间木箱',
        desc: '散兵丢下的箱子，锁扣很松。只拿得了一样。',
        choices: [
          { id: 'a', label: '撬开粮袋', desc: `军粮 +${Math.round(60 * scale)}`, cost: '免费', tone: 'good' },
          { id: 'b', label: '翻出银匣', desc: `银币 +${Math.round(35 * scale)}`, cost: '免费', tone: '' },
          { id: 'c', label: '摸到一件军械', desc: '获得随机道具', cost: '免费', tone: 'gold' },
        ],
      }
    }
    if (kind === 'merchant') {
      return {
        title: '过路行商',
        desc: '他不问战事，只问你要不要。',
        choices: [
          { id: 'a', label: '买一件道具', desc: '随机道具，价钱好说', cost: `${Math.round(30 * scale)} 银`, tone: '' },
          { id: 'b', label: '买一个兵', desc: '随机强力兵种进预备兵营', cost: `${Math.round(40 * scale)} 银`, tone: 'good' },
          { id: 'c', label: '请他离开', desc: '军粮 +20', cost: '免费', tone: '' },
        ],
      }
    }
    if (kind === 'rare') {
      return {
        title: '榜下有异人',
        desc: '一个披着旧袍的人站在营外，说他能打。',
        choices: [
          { id: 'a', label: '请他入帐', desc: '随机强力兵种（免费）', cost: '免费', tone: 'good' },
          { id: 'b', label: '重礼聘将', desc: '强力兵种进预备兵营（骑兵或法师）', cost: `${Math.round(45 * scale)} 银`, tone: 'gold' },
          { id: 'c', label: '婉拒', desc: '军粮 +25', cost: '免费', tone: '' },
        ],
      }
    }
    if (kind === 'challenge') {
      return {
        title: '山道鼓声',
        desc: '下一波会更多人来。敢不敢让他们来。',
        choices: [
          { id: 'a', label: '擂鼓迎战', desc: `下波敌人 +40%，清空后银 +${Math.round(90 * scale)}`, cost: '有风险', tone: 'bad' },
          { id: 'b', label: '闭门不出', desc: '军粮 +20', cost: '免费', tone: '' },
        ],
      }
    }
    if (kind === 'buff') {
      const picks = INGAME_UPS.slice().sort(() => this.rng() - 0.5).slice(0, 3)
      this.eventBuffPicks = picks
      return {
        title: '残阵遗址',
        desc: '前人留下的阵图，照着摆能省不少事。选一项，直接 +2 级。',
        choices: picks.map((u, i) => ({
          id: String(i), label: u.name, desc: u.desc, cost: `${u.glyph} +2`, tone: '',
        })),
      }
    }
    return {
      title: '林中有东西',
      desc: '不是流寇。它在等天黑。',
      choices: [
        { id: 'a', label: '主动迎击', desc: '下波精英率 +25%，清空后银 +150', cost: '有风险', tone: 'bad' },
        { id: 'b', label: '加固营寨', desc: '营寨恢复 15% 生命', cost: `${Math.round(25 * scale)} 银`, tone: 'good' },
        { id: 'c', label: '按兵不动', desc: '军粮 +20', cost: '免费', tone: '' },
      ],
    }
  }

  private resolveEvent(id: string): void {
    const kind = this.eventKind
    const scale = 1 + this.wave * 0.1
    if (kind === 'chest') {
      if (id === 'a') this.addGrain(60 * scale)
      else if (id === 'b') this.addSilver(35 * scale)
      else this.giveRandomItem()
      this.audio.sfx('levelup')
    } else if (kind === 'merchant') {
      if (id === 'a') {
        const cost = Math.round(30 * scale)
        if (this.silver < cost) { this.ui.toast('银币不够，商人走了', 'bad'); return }
        this.silver -= cost
        this.giveRandomItem()
      } else if (id === 'b') {
        const cost = Math.round(40 * scale)
        if (this.silver < cost) { this.ui.toast('银币不够，商人走了', 'bad'); return }
        this.silver -= cost
        this.giveUnitToBench(this.rareKind())
      } else this.addGrain(20)
    } else if (kind === 'rare') {
      if (id === 'a') this.giveUnitToBench(this.rareKind())
      else if (id === 'b') {
        const cost = Math.round(45 * scale)
        if (this.silver < cost) { this.ui.toast('银币不够，异人走了', 'bad'); return }
        this.silver -= cost
        this.giveUnitToBench(this.save.units.includes('cavalry') ? 'cavalry' : 'mage')
      } else this.addGrain(25)
    } else if (kind === 'challenge') {
      if (id === 'a') {
        this.pending = { budget: 0.4, elite: 0.1, silver: Math.round(90 * scale), label: '擂鼓迎战' }
        this.ui.toast('鼓声已起 · 下一波更凶', 'warn')
      } else this.addGrain(20)
    } else if (kind === 'buff') {
      /* 复用展示时抽好的选项，避免「选的是 A，生效的是 B」 */
      const pick = this.eventBuffPicks[Number(id)] || this.eventBuffPicks[0]
      if (pick) {
        const cur = this.ups[pick.id] || 0
        const add = Math.min(pick.max - cur, 2)
        this.ups[pick.id] = cur + add
        if (pick.id === 'baseHp') {
          const addHp = Math.round(this.baseMax * 0.06 * add)
          this.baseMax += addHp
          this.baseHp += addHp
        }
        if (pick.id === 'baseArmor') this.baseArmor = Math.min(0.65, this.baseArmor + 0.05 * add)
        this.ui.toast(`${pick.name} +${add} 级`, 'good')
      }
    } else {
      if (id === 'a') {
        this.pending = { budget: 0.25, elite: 0.25, silver: 150, label: '迎击' }
        this.ui.toast('迎击生效 · 下波精英更多，清空奖励银币', 'warn')
      } else if (id === 'b') {
        const cost = Math.round(25 * scale)
        if (this.silver < cost) { this.ui.toast('银币不够', 'bad'); return }
        this.silver -= cost
        this.healBase(this.baseMax * 0.15)
        this.audio.sfx('heal')
      } else this.addGrain(20)
    }
    this.ui.hideOverlay()
    this.overlay = ''
    this.phase = 'prep'
    this.persistCheckpoint()
    this.syncAll()
  }

  private rareKind(): UnitKind {
    const rare = (Object.keys(UNIT_BY_ID) as UnitKind[]).filter((k) => this.save.units.includes(k) && ['rare', 'epic', 'legend'].includes(UNIT_BY_ID[k].rarity))
    if (!rare.length) return 'spear'
    return rare[Math.floor(this.rng() * rare.length)]
  }

  private giveUnitToBench(kind: UnitKind): void {
    if (this.bench.length >= this.benchSlots) { this.ui.toast(`预备兵营已满（${this.bench.length}/${this.benchSlots}）`, 'bad'); return }
    this.bench.push({ kind, lv: 1, veteran: false })
    this.recruits.add(kind)
    this.ui.toast(`入帐：${UNIT_BY_ID[kind].name}`, 'good')
  }

  private giveRandomItem(): void {
    if (this.items.length >= 6) { this.ui.toast('道具栏已满（6/6）', 'bad'); return }
    const it = ITEM_DEFS[Math.floor(this.rng() * ITEM_DEFS.length)]
    const slot = this.items.find((i) => i.id === it.id)
    if (slot) slot.charges++
    else this.items.push({ id: it.id, charges: 1 })
    this.ui.toast(`得到 ${it.name}`, 'good')
  }

  /* ================= 局外成长 ================= */

  private openMeta(): void {
    this.returnOverlay = this.overlay
    this.overlay = 'meta'
    if (this.phase !== 'over' && this.phase !== 'start') this.phase = 'paused'
    const view: MetaView = {
      gold: this.save.gold,
      mat: this.save.mat,
      frag: this.save.frag,
      bestWave: this.save.records.bestWave,
      bestTime: this.save.records.bestTime,
      runs: this.save.records.runs,
      units: (Object.keys(UNIT_BY_ID) as UnitKind[]).filter((k) => !isFusion(k)).map((k) => ({
        id: k, name: UNIT_BY_ID[k].name, glyph: UNIT_BY_ID[k].glyph,
        rarity: RARITY_LABEL[UNIT_BY_ID[k].rarity], rar: RARITY_COLOR[UNIT_BY_ID[k].rarity], color: UNIT_BY_ID[k].color,
        unlocked: this.save.units.includes(k), cost: UNIT_UNLOCK_COST[k] || 0,
      })),
      heroes: (Object.keys(HERO_BY_ID) as HeroId[]).map((h) => ({
        id: h, name: HERO_BY_ID[h].name, title: HERO_BY_ID[h].title, glyph: HERO_BY_ID[h].glyph,
        color: HERO_BY_ID[h].color, desc: HERO_BY_ID[h].passiveText,
        unlocked: this.save.heroes.includes(h), cost: HERO_UNLOCK[h],
      })),
      ups: META_UPS.map((u) => {
        const lv = this.save.meta[u.id] || 0
        const gold = u.gold(lv)
        const mat = u.mat(lv)
        return {
          id: u.id, name: u.name, sub: u.sub, glyph: u.glyph, desc: u.desc(lv), lv, max: u.max,
          gold, mat, afford: this.save.gold >= gold && this.save.mat >= mat, maxed: lv >= u.max,
        }
      }),
      achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc, got: !!this.save.achievements[a.id], gold: a.gold })),
      bossKilled: this.save.bossKilled.slice(),
      tab: this.metaTab,
    }
    this.ui.showMeta(view)
    this.ui.setPhase('meta')
  }

  private buyMeta(id: string): void {
    const def = META_BY_ID[id]
    if (!def) return
    const lv = this.save.meta[id] || 0
    if (lv >= def.max) return
    const gold = def.gold(lv)
    const mat = def.mat(lv)
    if (this.save.gold < gold || this.save.mat < mat) { this.ui.toast(`资源不足：需 ${gold} 金币 / ${mat} 材料，现有 ${this.save.gold} 金币 / ${this.save.mat} 材料`, 'bad'); return }
    this.save.gold -= gold
    this.save.mat -= mat
    this.save.meta[id] = lv + 1
    this.audio.sfx('levelup')
    this.ui.toast(`${def.name} 永久提升`, 'good')
    writeSave(this.save)
    this.openMeta()
  }

  private unlockUnit(kind: UnitKind): void {
    if (isFusion(kind)) return
    if (this.save.units.includes(kind)) return
    const cost = UNIT_UNLOCK_COST[kind] || 999
    if (this.save.mat < cost) { this.ui.toast(`需要 ${cost} 材料`, 'bad'); return }
    this.save.mat -= cost
    this.save.units.push(kind)
    this.audio.sfx('achievement')
    this.ui.toast(`解锁 ${UNIT_BY_ID[kind].name}`, 'gold')
    writeSave(this.save)
    this.openMeta()
  }

  private unlockHero(id: HeroId): void {
    if (this.save.heroes.includes(id)) { this.hero = id; this.save.lastHero = id; this.showStart(); return }
    const need = HERO_UNLOCK[id]
    if (this.save.frag < need) { this.ui.toast(`需要 ${need} 英雄碎片`, 'bad'); return }
    this.save.frag -= need
    this.save.heroes.push(id)
    this.save.lastHero = id
    this.hero = id
    this.audio.sfx('achievement')
    this.ui.toast(`${HERO_BY_ID[id].name} 入列`, 'gold')
    writeSave(this.save)
    this.openMeta()
  }

  private wipeSave(): void {
    this.save = loadSave()
    this.save.gold = 0
    this.save.mat = 0
    this.save.frag = 0
    this.save.units = START_UNLOCKED.slice()
    this.save.heroes = ['qingfeng']
    this.save.lastHero = 'qingfeng'
    this.save.meta = {}
    this.save.records = { bestWave: 0, bestTime: 0, bestKills: 0, bestDamage: 0, bestIncome: 0, bestLv: 0, runs: 0, totalKills: 0 }
    this.save.achievements = {}
    this.save.bossKilled = []
    this.save.checkpoint = null
    this.hero = 'qingfeng'
    writeSave(this.save)
    this.ui.toast('进度已清空', 'warn')
    this.showStart()
  }

  /* ================= 成就 ================= */

  private grantAch(id: string): void {
    if (!ACH_BY_ID[id] || this.save.achievements[id]) return
    this.save.achievements[id] = 1
    this.newAchs.push(ACH_BY_ID[id].name)
    this.save.gold += ACH_BY_ID[id].gold
    this.ui.toast(`成就 · ${ACH_BY_ID[id].name}`, 'gold')
    this.audio.sfx('achievement')
    writeSave(this.save)
  }

  private checkLiveAchievements(): void {
    if (this.wave >= 5) this.grantAch('w5')
    if (this.wave >= 10) this.grantAch('w10')
    if (this.wave >= 20) this.grantAch('w20')
    if (this.wave >= 50) this.grantAch('w50')
    if (this.wave >= 100) this.grantAch('w100')
    if (this.kills >= 300) this.grantAch('k300')
    if (this.kills >= 1500) this.grantAch('k1500')
    if (this.income >= 1200) this.grantAch('rich')
    if (this.activeUnits() >= 18) this.grantAch('many')
    if (this.runTime >= 1200) this.grantAch('long')
  }

  private activeUnits(): number {
    let n = 0
    for (const u of this.battle.units) if (u.active) n++
    return n
  }

  /* ================= 结算 ================= */

  private endRun(): void {
    if (this.phase === 'over') return
    this.phase = 'over'
    this.audio.stopBgm()
    this.audio.sfx('end')
    this.shake(14)
    const bp = this.board.basePoint()
    this.fx.shock(bp.x, bp.y, 10, this.board.cell * 5, '#a8352a', 0.9, 6)
    this.ui.setPhase('over')
    const rec = this.save.records
    const newRecord = this.wave > rec.bestWave
    const goldBase = Math.round(this.wave * 2.6 + this.kills * 0.03 + this.bossKills * 25)
    const mat = Math.round(this.wave * 1.1 + this.bossKills * 3)
    const frag = Math.floor(this.wave / 8) + this.bossKills * 2
    this.save.gold += goldBase
    this.save.mat += mat
    this.save.frag += frag
    rec.bestWave = Math.max(rec.bestWave, this.wave)
    rec.bestTime = Math.max(rec.bestTime, Math.round(this.runTime))
    rec.bestKills = Math.max(rec.bestKills, this.kills)
    rec.bestDamage = Math.max(rec.bestDamage, Math.round(this.damage))
    rec.bestIncome = Math.max(rec.bestIncome, Math.round(this.income))
    rec.bestLv = Math.max(rec.bestLv, this.bestLv)
    rec.runs += 1
    rec.totalKills += this.kills
    this.save.checkpoint = null
    writeSave(this.save)
    if (newRecord) this.audio.sfx('record')
    this.openResults(newRecord, goldBase, mat, frag)
  }

  private openResults(newRecord: boolean, gold: number, mat: number, frag: number): void {
    this.overlay = 'results'
    const rec = this.save.records
    const formation = this.battle.units
      .filter((u) => u.active && !u.hero)
      .sort((a, b) => b.lv - a.lv)
      .slice(0, 12)
      .map((u) => ({ kind: u.kind, lv: u.lv, veteran: u.veteran }))
    const rows = [
      { name: '最高波次', value: String(rec.bestWave), best: newRecord },
      { name: '最长生存', value: fmtTime(rec.bestTime), best: this.runTime >= rec.bestTime },
      { name: '单局击杀', value: fmtNum(rec.bestKills), best: this.kills >= rec.bestKills },
      { name: '单局伤害', value: fmtNum(rec.bestDamage), best: Math.round(this.damage) >= rec.bestDamage },
      { name: '单局收益', value: fmtNum(rec.bestIncome), best: Math.round(this.income) >= rec.bestIncome },
    ]
    const view: ResultView = {
      wave: this.wave, bestWave: rec.bestWave, newRecord, time: this.runTime,
      kills: this.kills, damage: Math.round(this.damage), income: Math.round(this.income),
      bestLv: this.bestLv, formation, gold, mat, frag, records: rows, achievements: this.newAchs.slice(0, 6),
    }
    this.ui.showResults(view)
    this.ui.setPhase('over')
  }

  /* ================= 存档 ================= */

  private persistCheckpoint(): void {
    /* 只在"整备期"落断点：本局敌人、波内刷怪队列没有一起存，
       如果波打到一半存盘，续守时会变成"波数对、敌人没了"的假局。
       宁可少存这几秒，也不能恢复出一个坏局面。 */
    if (this.phase !== 'prep') return
    const units: RunUnitSave[] = []
    for (const u of this.battle.units) {
      if (!u.active) continue
      units.push({ kind: u.hero ? 'blade' : u.kind, lv: u.hero ? 1 : u.lv, veteran: u.veteran, cell: u.cell, hero: u.hero, path: u.path })
    }
    this.save.checkpoint = {
      at: Date.now(),
      wave: this.wave,
      elapsed: Math.round(this.runTime),
      baseHp: Math.round(this.baseHp),
      baseMax: Math.round(this.baseMax),
      grain: Math.round(this.grain),
      silver: Math.round(this.silver),
      cells: this.cells.size,
      benchSlots: this.benchSlots,
      hero: this.hero,
      heroDead: this.heroDead,
      units,
      bench: this.bench.map((b) => ({ kind: b.kind, lv: b.lv, veteran: b.veteran, cell: -1, hero: '' })),
      ups: { ...this.ups },
      items: this.items.map((i) => ({ ...i })),
      cards: this.cards.map((c) => ({ ...c })),
      kills: this.kills,
      dmg: Math.round(this.damage),
      income: Math.round(this.income),
      bestLv: this.bestLv,
      freeRerolls: this.freeRerolls,
      route: routeCoords().map((p) => p.y * COLS + p.x),
      runMods: { ...this.runMods },
      runCards: [...this.runCards],
    }
    writeSave(this.save)
  }

  private saveProgress(): void {
    this.persistCheckpoint()
    writeSave(this.save)
  }

  /* ================= 界面同步 ================= */

  private syncAll(): void {
    this.recomputeFormations()
    this.syncHud()
    this.syncCards()
    this.syncBench()
    this.syncItems()
    this.syncFormations()
  }

  private syncCards(): void {
    const canForm = this.canCompleteStroke()
    const views: CardView[] = this.cards.map((card) => ({
      card,
      affordable: this.grain >= card.cost,
      hint: this.cardHint(card.kind, 1, canForm),
    }))
    this.ui.cards(views)
    this.ui.setCost(this.recruitCost(), this.rerollCost(), this.premiumCost(), this.freeRerolls)
  }

  /** 这张牌下阵后能干什么：先看融合，再看同名合级，最后看能不能补成一笔。 */
  private cardHint(kind: UnitKind, lv: number, canForm: boolean): string {
    const units = this.battle.units.filter((u) => u.active && !u.hero)
    for (const u of units) {
      const out = fusionOf(kind, u.kind)
      if (out) return `可融·${UNIT_BY_ID[out].name}`
    }
    if (lv < 5 && units.some((u) => u.kind === kind && u.lv === lv)) return `可合·Lv${lv + 1}`
    if (canForm) return '补位成合击'
    return ''
  }

  /** 场上是否有一个空格，补上就能连成新的一笔（给招募卡与布阵提示用） */
  private canCompleteStroke(): boolean {
    const now = new Set(this.strokes.map((s) => s.key))
    const occ = new Set<number>()
    for (const u of this.battle.units) if (u.active && !u.hero) occ.add(u.cell)
    for (const c of this.cells) {
      if (this.battle.unitAt(c)) continue
      occ.add(c)
      const hit = findStrokes(occ).some((s) => !now.has(s.key))
      occ.delete(c)
      if (hit) return true
    }
    return false
  }

  private syncBench(): void {
    if (this.benchPicked >= this.bench.length) this.benchPicked = -1
    const views: (BenchView | null)[] = []
    for (let i = 0; i < this.benchSlots; i++) {
      const b = this.bench[i]
      views.push(b ? { kind: b.kind, lv: b.lv, veteran: b.veteran } : null)
    }
    this.ui.renderBench(views, this.benchSlots, this.benchPicked, this.time - this.benchPopT < 0.5 ? this.benchPop : -1)
  }

  private syncItems(): void {
    const views: ItemView[] = this.items.map((i) => ({ id: i.id, charges: i.charges, armed: this.armed === i.id }))
    this.ui.items(views)
  }

  private syncHud(): void {
    if (this.phase === 'idle') return
    const boss = this.battle.boss
    const bossOn = !!boss && boss.active && !boss.dead
    const waveTotal = Math.max(1, this.waveTotal)
    const remaining = this.queue.length + this.battle.alive
    const progress = this.phase === 'prep'
      ? Math.max(0, Math.min(1, 1 - this.prepT / this.prepMax))
      : Math.max(0, Math.min(1, 1 - remaining / waveTotal))
    const summary = strokeSummary(this.strokes)
    this.ui.hud({
      wave: this.wave,
      stage: stageName(this.wave),
      phase: this.phase === 'prep' ? 'prep' : 'wave',
      prep: this.prepT,
      baseHp: this.baseHp,
      baseMax: this.baseMax,
      grain: Math.round(this.grain),
      silver: Math.round(this.silver),
      enemies: this.battle.alive,
      kills: this.kills,
      progress,
      hero: this.hero,
      skill: 1 - this.heroSkillT / Math.max(1, HERO_CD[this.hero]),
      skillReady: this.heroSkillT <= 0 && !this.heroDead,
      fury: this.furyT,
      speed: this.speed,
      record: this.save.records.bestWave,
      boss: bossOn,
      strokeText: summary.text,
      strokeOn: summary.rows + summary.cols > 0,
      strokeDead: summary.dead > 0,
    })
    if (bossOn && boss) {
      this.ui.bossBar(
        boss.name,
        boss.hp,
        boss.maxHp,
        `第 ${boss.phase} 段 · ${BOSS_BY_ID[boss.bossId as BossId]?.phases[boss.phase - 1]?.name || ''}`,
        boss.shield,
      )
    }
  }

  /* ================= 键盘 ================= */

  private bindKeys(): void {
    /* 用捕获阶段接管键盘：机台厅的 Esc 在 document 冒泡阶段才跑，
       两边都处理 Esc 会"暂停 → 立刻恢复"，看起来像 Esc 失灵。 */
    document.addEventListener('keydown', this.onKey, true)
  }

  private onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      if (this.escape()) { ev.preventDefault(); ev.stopPropagation() }
      return
    }
    if (this.overlay) return
    if (this.phase !== 'prep' && this.phase !== 'wave') return
    if (ev.key === 'q' || ev.key === 'Q') { this.castHeroSkill(); ev.preventDefault() }
    if (ev.key === ' ') { this.togglePause(); ev.preventDefault() }
    if (ev.key === '1' || ev.key === '2' || ev.key === '3') {
      this.recruitCard(Number(ev.key) - 1)
      ev.preventDefault()
    }
    if (ev.key === 'r' || ev.key === 'R') { this.rerollCards(false); ev.preventDefault() }
  }

  escape(): boolean {
    /* 大厅（start / over 背后那张开始页）本身就是这张覆盖层：在这里按 Esc，
       以前走的是"关掉覆盖层"，结果什么都没变，玩家以为 Esc 失灵。
       大厅里的 Esc 交还给机台厅去关弹层。 */
    if (this.overlay && this.overlay !== 'start') { this.closeOverlay(); return true }
    if (this.phase === 'start') return false
    if (this.phase === 'prep' || this.phase === 'wave') { this.togglePause(); return true }
    return false
  }

  private bindPointer(): void {
    this.canvas.addEventListener('pointerdown', (ev) => {
      if (this.overlay) return
      if (this.phase !== 'prep' && this.phase !== 'wave') return
      const p = this.toCanvas(ev.clientX, ev.clientY)
      const cell = this.board.hit(p.x, p.y)
      if (cell < 0) { this.selected = -1; this.syncFormations(); return }
      if (this.armed && this.useArmedAt(cell)) return
      if (!this.cells.has(cell)) { this.tryUnlock(cell); return }
      const u = this.battle.unitAt(cell)
      if (u) { this.beginCellDrag(cell, ev); return }
      this.selected = cell
      this.syncFormations()
    })
    this.canvas.addEventListener('pointermove', (ev) => {
      if (this.drag) return
      const p = this.toCanvas(ev.clientX, ev.clientY)
      this.hover = this.board.hit(p.x, p.y)
    })
    this.canvas.addEventListener('pointerleave', () => { this.hover = -1 })
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault())
  }

  /* ================= 调试接口（供自动化实测） ================= */

  debugState(): Record<string, unknown> {
    const waveTotal = Math.max(1, this.waveTotal)
    const remaining = this.queue.length + this.battle.alive
    const progress = this.phase === 'prep' ? 1 - this.prepT / this.prepMax : 1 - remaining / waveTotal
    return {
      phase: this.phase,
      wave: this.wave,
      baseHp: Math.round(this.baseHp),
      baseMax: Math.round(this.baseMax),
      grain: Math.round(this.grain),
      silver: Math.round(this.silver),
      units: this.battle.units.filter((u) => u.active).map((u) => ({ kind: u.hero ? 'hero' : u.kind, hero: u.hero, lv: u.lv, cell: u.cell, hp: Math.round(u.hp) })),
      enemies: this.battle.enemies.filter((e) => e.active && !e.dead).length,
      boss: this.battle.boss ? { name: this.battle.boss.name, hp: Math.round(this.battle.boss.hp), phase: this.battle.boss.phase, prog: +this.battle.boss.prog.toFixed(2), x: Math.round(this.battle.boss.x), y: Math.round(this.battle.boss.y) } : null,
      bench: this.bench.map((b) => `${b.kind}${b.lv}${b.veteran ? 'v' : ''}`),
      benchPicked: this.benchPicked,
      freeRerolls: this.freeRerolls,
      cards: this.cards.map((c) => `${c.kind}${c.veteran ? 'v' : ''}@${c.cost}`),
      items: this.items.map((i) => `${i.id}x${i.charges}`),
      cells: this.cells.size,
      kills: this.kills,
      damage: Math.round(this.damage),
      income: Math.round(this.income),
      bestLv: this.bestLv,
      merges: this.merges,
      hero: this.hero,
      heroDead: this.heroDead,
      skillCd: Math.round(this.heroSkillT),
      skillCasts: this.skillCasts,
      ups: { ...this.ups },
      benchSlots: this.benchSlots,
      eventKind: this.eventKind,
      pending: this.pending ? { ...this.pending } : null,
      runTime: Math.round(this.runTime),
      checkpoint: this.save.checkpoint ? this.save.checkpoint.wave : 0,
      runCards: [...this.runCards],
      runMods: { ...this.runMods },
      progress,
      branches: this.battle.units.filter((u) => u.active && !u.hero).map((u) => `${u.kind}:${u.path}:${u.cell}`),
      strokes: this.strokes.map((s) => `${s.key}:${s.len}${s.suppress ? '!' : ''}`),
    }
  }

  debug = {
    start: (hero?: HeroId): void => this.startRun(hero || this.hero, false),
    resume: (): void => this.startRun(this.hero, true),
    wave: (n: number): void => { this.wave = Math.max(1, n) },
    nextWave: (): void => { if (this.phase === 'prep') this.prepT = 0.01 },
    /* 自动化用：重开一局后 UI 的「开战」按钮处于重建状态，直接调战斗流程更稳 */
    beginWave: (): void => { if (this.phase === 'prep') this.startWave() },
    /* 自动化用：强行回到整备期并给足时间，方便稳定复现"开战前"的界面 */
    prepHold: (sec = 90): void => {
      this.phase = 'prep'
      this.prepMax = sec
      this.prepT = sec
      this.queue = []
      this.ui.setPhase('prep')
      this.syncAll()
    },
    spawn: (kind: EnemyKind, n = 1, elite = false): void => { for (let i = 0; i < n; i++) this.battle.spawnEnemy(kind, elite, 0) },
    chooseBranch: (which = 'a'): void => { if (this.phase === 'branch') this.chooseBranch(which) },
    openDraft: (): void => { this.openDraft() },
    chooseDraft: (i = 0): void => { if (this.phase === 'draft') this.chooseDraft(i) },
    takeCard: (id: string): void => {
      const def = RUN_BY_ID[id]
      if (!def) return
      if (!this.runCards.includes(id)) this.runCards.push(id)
      for (const [k, val] of Object.entries(def.mod)) this.runMods[k] = (this.runMods[k] || 0) + val
      this.syncAll()
    },
    runMod: (key: string): number => this.runMod(key),
    boss: (id?: BossId): void => {
      const bid = id || bossForWave(this.wave)
      this.battle.spawnBoss(bid, this.wave)
      this.bossIntroT = 2
      this.bossIntroName = BOSS_BY_ID[bid].name
    },
    give: (g = 100, s = 100): void => { this.grain += g; this.silver += s },
    giveItem: (id: ItemId, n = 1): void => {
      const it = this.items.find((i) => i.id === id)
      if (it) it.charges += n
      else this.items.push({ id, charges: n })
      this.syncAll()
    },
    addUnit: (kind: UnitKind, lv = 1, cell = -1, path = -1, veteran = false): number => {
      const target = cell >= 0 ? cell : this.firstFreeCell()
      if (target < 0) return -1
      const u = this.battle.addUnit(kind, lv, veteran, target)
      if (!u) return -1
      if (path >= 0) u.path = path
      this.bestLv = Math.max(this.bestLv, lv)
      this.syncAll()
      return target
    },
    benchAdd: (kind: UnitKind, lv = 1, veteran = false): void => { this.bench.push({ kind, lv, veteran }); this.syncAll() },
    mergeAt: (a: number, b: number): boolean => {
      const ua = this.battle.unitAt(a)
      const ub = this.battle.unitAt(b)
      if (!ua || !ub || ua.kind !== ub.kind || ua.lv !== ub.lv || ua.lv >= 5) return false
      this.battle.removeUnit(ua, true)
      this.mergeUnits(b, ub.kind, ub.lv, ub.veteran, ub, a)
      return true
    },
    fuseAt: (a: number, b: number): boolean => {
      const ua = this.battle.unitAt(a)
      const ub = this.battle.unitAt(b)
      if (!ua || !ub || ua.hero || ub.hero) return false
      const out = fusionOf(ua.kind, ub.kind)
      if (!out) return false
      this.battle.removeUnit(ua, true)
      this.mergeUnits(b, ub.kind, ub.lv, ub.veteran || ua.veteran, ub, a, out, fusionLevel(ua.lv, ub.lv))
      return true
    },
    benchCombine: (a: number, b: number): boolean => {
      const ua = this.bench[a]
      const ub = this.bench[b]
      if (!ua || !ub) return false
      const mode = this.combineMode(ua.kind, ua.lv, ub.kind, ub.lv)
      if (!mode) return false
      this.combineBench(a, b, mode)
      return true
    },
    benchMergeAll: (): void => { this.benchMergeAll() },
    freeRerolls: (): number => this.freeRerolls,
    hurt: (n: number): void => { this.baseHp = Math.max(1, this.baseHp - n); this.syncHud() },
    god: (on = true): void => { this.godMode = on },
    speed: (n: number): void => { this.speed = Math.max(1, Math.min(3, n)) },
    unlockAll: (): void => { for (let i = 0; i < COLS * ROWS; i++) this.cells.add(i); this.syncAll() },
    cards: (): string[] => this.cards.map((c) => c.kind),
    recruit: (i: number): boolean => this.recruitCard(i),
    benchToCell: (index: number, cell: number): void => { this.dropFromBench(index, cell); this.syncAll() },
    cellToCell: (from: number, to: number): void => { this.dropFromCell(from, to); this.syncAll() },
    useItem: (id: ItemId, cell = -1): void => {
      if (cell >= 0) { this.armed = id; this.useArmedAt(cell); return }
      this.useItem(id)
    },
    eventChoice: (id: string): void => { if (this.phase === 'event') this.resolveEvent(id) },
    openEvent: (): void => { this.openEvent() },
    end: (): void => { this.endRun() },
    startScreen: (): void => { this.showStart() },
    meta: (): void => { this.openMeta() },
    closeOverlay: (): void => { this.closeOverlay() },
    saveInfo: (): Record<string, unknown> => ({
      gold: this.save.gold, mat: this.save.mat, frag: this.save.frag,
      units: this.save.units, heroes: this.save.heroes, meta: this.save.meta,
      records: this.save.records, achievements: Object.keys(this.save.achievements),
      checkpoint: !!this.save.checkpoint, bossKilled: this.save.bossKilled,
    }),
    resetSave: (): void => { localStorage.removeItem('txxt.legion.v1'); this.save = loadSave(); this.showStart() },
    simulate: (seconds: number, auto = true): Record<string, unknown> => this.simulate(seconds, auto),
    /** 定向战斗步进：不跑招募/挂机，只推进战场，供 A/B 路线实测 */
    fight: (seconds = 4): Record<string, unknown> => {
      const dt = 1 / 60
      for (let t = 0; t < seconds; t += dt) {
        this.battle.update(dt)
        this.fx.update(dt)
      }
      this.syncAll()
      return this.debugState()
    },
    spawnAt: (kind: EnemyKind, prog = 0, _lane?: LaneId, elite = false): void => {
      this.battle.spawnEnemy(kind, elite, prog)
      this.syncAll()
    },
    /** 清场：定向 A/B 测试时排除已有单位与敌人的干扰 */
    clearField: (keepHero = false): void => {
      for (const u of [...this.battle.units]) if (u.active && (!u.hero || !keepHero)) this.battle.removeUnit(u, true)
      for (const e of this.battle.enemies) { e.dead = true; e.active = false }
      this.battle.boss = null
      this.fx.clear()
      this.mergeGhosts = []
      this.syncAll()
    },
    selectCell: (cell: number): void => { this.selected = cell; this.syncAll() },
    dragInfo: (): Record<string, unknown> | null => (this.drag ? {
      target: this.drag.target, merge: this.drag.merge, fuse: this.drag.fuse,
      lost: this.drag.lost, moved: this.drag.moved, x: Math.round(this.drag.x), y: Math.round(this.drag.y),
    } : null),
    layout: (): Record<string, number> => ({
      cell: this.board.cell, ox: this.board.ox, oy: this.board.oy,
      w: this.board.w, h: this.board.h, top: this.ui.metrics().top, dockW: this.ui.metrics().dockW,
    }),
    /* 本局路线 + 沿路可布阵的格子（自动化测试用；路线每局随机，不能再写死格号） */
    route: (): number[] => routeCoords().map((p) => p.y * COLS + p.x),
    spots: (): number[] => {
      const path = new Set(routeCoords().map((p) => p.y * COLS + p.x))
      const out: number[] = []
      const seq = routeCoords()
      for (let k = 1; k < seq.length - 1; k++) {
        const q = seq[k]
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const x = q.x + dx, y = q.y + dy
          if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue
          const i = y * COLS + x
          if (path.has(i) || out.includes(i)) continue
          out.push(i)
        }
      }
      return out
    },
    unitsInfo: (): Record<string, unknown>[] => this.battle.units.filter((u) => u.active).map((u) => ({
      kind: u.hero ? 'hero' : u.kind, lv: u.lv, path: u.path, cell: u.cell, lane: u.terrain,
      hp: Math.round(u.hp), atk: Math.round(u.atk), range: +(u.range + this.unitRangeBonus(u)).toFixed(2),
      syn: u.syn || '',
    })),
    enemiesInfo: (): Record<string, unknown>[] => this.battle.enemies.filter((e) => e.active && !e.dead).map((e) => ({
      id: e.id, kind: e.kind, lane: e.lane, prog: +e.prog.toFixed(2), hp: Math.round(e.hp),
      x: Math.round(e.x), y: Math.round(e.y), rad: Math.round(e.r), off: +e.off.toFixed(2),
    })),
    strokesInfo: (): Record<string, unknown>[] => this.strokes.map((s) => ({
      key: s.key, kind: s.kind, row: s.row, col: s.col, len: s.len, suppress: !!s.suppress,
      cells: s.cells.join(','),
    })),
    fireStrokes: (): number => this.battle.triggerStroke(),
    eraseStrokes: (sec = 5): void => this.battle.eraseStrokes(sec),
    killAll: (): void => {
      for (const e of this.battle.enemies) if (e.active && !e.dead) this.battle.hitEnemy(e, e.hp + 1, { silent: true, noFloat: true })
    },
    perf: (n = 120): Record<string, unknown> => this.perfProbe(n),
    /* 给自动化用的坐标换算：格子中心 → 屏幕坐标（拖拽实测要真按在格子上） */
    cellPoint: (cell: number): { x: number; y: number } => {
      const c = this.board.center(cell)
      const r = this.canvas.getBoundingClientRect()
      return { x: r.left + c.x, y: r.top + c.y }
    },
  }

  private firstFreeCell(): number {
    for (const c of this.cells) if (!this.battle.unitAt(c)) return c
    for (let i = 0; i < COLS * ROWS; i++) if (!this.battle.unitAt(i) && !this.isPathOrBase(i)) return i
    return -1
  }

  private isPathOrBase(i: number): boolean {
    return isPathCell(i) || COLS * ROWS <= 0
  }

  /** 自动挂机：贪心招兵 → 同名同级合成 → 优先贴山道布阵 → 银币买强化 → 技能好了就放 */
  simulate(seconds: number, auto = true): Record<string, unknown> {
    this.autoSim = true
    let steps = 0
    let acc = 0
    const step = 1 / 45
    while (this.runTime < seconds || steps === 0) {
      if (this.phase === 'over') break
      if (this.phase === 'event') {
        this.resolveEvent('a')
        if (this.phase === 'event') {
          this.ui.hideOverlay()
          this.overlay = ''
          this.phase = 'prep'
        }
        continue
      }
      if (this.phase === 'draft') { this.chooseDraft(0); continue }
      if (this.phase === 'branch') { this.chooseBranch('a'); continue }
      if (this.phase !== 'prep' && this.phase !== 'wave') break
      this.tick(step)
      acc += step
      if (auto && acc >= 0.8) { acc = 0; this.botThink() }
      steps++
      if (steps > 45 * 60 * 40) break
    }
    this.autoSim = false
    this.lastTs = performance.now()
    this.syncAll()
    return this.debugState()
  }

  private botThink(): void {
    /* 1. 技能：场上敌人多就放 */
    if (this.heroSkillT <= 0 && this.battle.alive >= 4 && !this.heroDead) this.castHeroSkill()
    /* 2. 先合成：点将台里与场上同名的叠上去 */
    for (let i = this.bench.length - 1; i >= 0; i--) {
      const b = this.bench[i]
      if (b.lv >= 5) continue
      let target = -1
      for (const u of this.battle.units) {
        if (!u.active || u.hero) continue
        if (u.kind === b.kind && u.lv === b.lv) { target = u.cell; break }
      }
      if (target >= 0) this.dropFromBench(i, target)
    }
    /* 3. 剩下的下阵：优先贴山道，刀/枪放前排，弓/法放后排 */
    for (let i = this.bench.length - 1; i >= 0; i--) {
      const b = this.bench[i]
      const cell = this.bestDeployCell(b.kind)
      if (cell >= 0) this.dropFromBench(i, cell)
    }
    /* 4. 招兵：留 1 个空位给合成 */
    let guard = 0
    while (guard++ < 3 && this.bench.length < this.benchSlots - 1) {
      const i = this.cards.findIndex((c) => c.cost <= this.grain)
      if (i < 0) break
      this.recruitCard(i)
    }
    /* 5. 强化 */
    if (this.silver >= 90) {
      const order = ['atk', 'spd', 'baseHp', 'grain', 'crit']
      for (const id of order) {
        const def = INGAME_UP_BY_ID[id]
        const lv = this.ups[id] || 0
        if (!def || lv >= def.max) continue
        const price = def.price(lv, this.wave)
        if (this.silver >= price) { this.buyUp(id); break }
      }
    }
    /* 6. 开格：银币多了就开 */
    const unlockAt = unlockCost(this.cells.size)
    if (this.silver >= unlockAt + 40) {
      const locked = this.lockedCells()
      if (locked.length) {
        const best = locked.sort((a, b) => (this.cellHint[a] ?? 99) - (this.cellHint[b] ?? 99))[0]
        this.silver -= unlockAt
        this.cells.add(best)
        this.syncAll()
      }
    }
    this.syncAll()
  }

  private bestDeployCell(kind: UnitKind): number {
    const def = UNIT_BY_ID[kind]
    let best = -1
    let bs = Infinity
    for (const c of this.cells) {
      if (this.battle.unitAt(c)) continue
      const h = this.cellHint[c] ?? 99
      /* 近战要贴路，远程要退一格；两者都不能离路太远 */
      const want = def.melee ? 0.9 : 2.2
      const s = Math.abs(h - want)
      if (s < bs) { bs = s; best = c }
    }
    return best
  }

  private perfProbe(n: number): Record<string, unknown> {
    this.debug.god(true)
    for (let i = 0; i < n; i++) {
      const kinds: EnemyKind[] = ['raider', 'runner', 'brute', 'gunner', 'bomber', 'splitter', 'hexer', 'champion']
      this.battle.spawnEnemy(kinds[i % kinds.length], i % 9 === 0, i * 0.03)
    }
    const t0 = performance.now()
    let frames = 0
    for (let i = 0; i < 240; i++) { this.battle.update(1 / 60); this.fx.update(1 / 60); frames++ }
    const ms = performance.now() - t0
    return { spawned: n, alive: this.battle.alive, frames, msPerFrame: +(ms / frames).toFixed(3), fpsBudget: Math.round(1000 / (ms / frames)) }
  }
}

/* 结构上只用到 ui 的三个回调，不需要把整个 UiHost 导来导去 */
interface UiHostLike {
  onAct(act: string, arg: string): void
  onBenchDown(index: number, ev: PointerEvent): void
  onOverlayClose(): void
}



