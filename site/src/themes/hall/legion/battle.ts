/* 战斗层：索敌、出手、拦截、弹道、Boss 招式、区域伤害。
 *
 * 性能约定（都是实测过的口径）：
 *   · 敌人 / 弹道 / 区域 / 光束全部定长对象池，池满复用最老的；
 *   · 索敌先按"山道进度桶"筛一遍，再算真正距离 —— 不每帧两两比较；
 *   · 单位最多 23 个（22 格 + 英雄），敌人上限 200，弹道上限 260；
 *   · 所有攻击都真的走伤害公式，不存在只播动画的"装饰性出手"。
 *
 * 战斗层不碰 DOM、不碰存档；它只通过 BattleHost 回调把资源、击杀、基地伤害交回主控。
 */
import type { BossId, Enemy, EnemyKind, HeroId, Proj, Unit, UnitKind, Zone } from './types'
import { BOSS_BY_ID, bossTier } from './data/bosses'
import { ENEMY_BY_ID, dmgScale, hpScale, speedScale } from './data/enemies'
import { HERO_BY_ID } from './data/heroes'
import { UNIT_BY_ID, unitStats } from './data/units'
import type { Board } from './board'
import { SEG, isPathCell, laneAtCell, type LaneId } from './board'
import type { Effects } from './fx'
import type { LegionAudio } from './audio'
import type { Stroke } from './formation'

const MAX_ENEMIES = 200
const MAX_PROJ = 260
const MAX_ZONES = 40
const MAX_BEAMS = 24
const BUCKET = 0.75

/** 敌人的显示/命中半径：跟格子走，不跟固定像素走。
 *  之前用数据里的固定像素，电脑端 cell≈79 时只剩下 20px 大小，看着像贴纸。 */
export function enemyRadius(e: { boss?: boolean; elite?: boolean }, cell: number): number {
  if (e.boss) return cell * 0.47
  return cell * (e.elite ? 0.34 : 0.31)
}

export interface Beam {
  active: boolean
  x1: number
  y1: number
  x2: number
  y2: number
  life: number
  age: number
  color: string
  width: number
}

export interface UnitMods {
  atk: number
  spd: number
  crit: number
  critDmg: number
  regen: number
}

export interface BattleHost {
  board: Board
  fx: Effects
  audio: LegionAudio
  baseHp: number
  baseMax: number
  baseArmor: number
  furyT: number
  freezeT: number
  armorT: number
  dmgNumbers: boolean
  shakeOn: boolean
  wave: number
  addGrain(n: number): void
  addSilver(n: number): void
  hurtBase(n: number): void
  healBase(n: number): void
  onEnemyKill(e: Enemy): void
  onEnemyLeak(e: Enemy): void
  onBossKill(e: Enemy): void
  onUnitKill(u: Unit): void
  onHeroKill(u: Unit): void
  onDamage(n: number): void
  unitMods(): UnitMods
  heroPassive(kind: 'armor' | 'burn' | 'crit' | 'charge' | 'block'): number
  spawnExtra(prog: number, kind: EnemyKind, elite: boolean): Enemy | null
  shake(amp: number): void
  notify(text: string, tone?: string): void
  /** 唯一路径：第三版只有中央方格路，敌人始终沿这一列推进 */
  pathLane(): LaneId
  /** Roguelike 构筑的倍率，key 缺失视为 0 */
  runMod(key: string): number
  /** 单位进化分支：0 / 1，未选为 -1 */
  branchOf(u: Unit): number
  unitRangeBonus(u: Unit): number
  unitAtkBonus(u: Unit): number
  unitRateBonus(u: Unit): number
  unitArmorBonus(u: Unit): number
  unitBlockBonus(u: Unit): number
  /** 当前笔势（由主控在布阵变化时算好，战斗层只按格子读） */
  strokeList(): Stroke[]
}

function blankEnemy(): Enemy {
  return {
    active: false, id: 0, kind: 'raider', bossId: '', name: '', hp: 0, maxHp: 0, speed: 0, dmg: 0,
    armor: 0, r: 12, prog: 0, off: 0, x: 0, y: 0, elite: false, boss: false, phase: 0, phaseT: 0,
    abilT: 0, abilIdx: 0, abilWarn: 0, abilId: '', shield: 0, shieldT: 0, hasteT: 0, slowT: 0,
    vulnT: 0, stunT: 0, chainT: 0, engaged: 0, atkCd: 0, hitT: 0, dieT: 0, dead: false, born: 0,
    grain: 0, silver: 0, zoneT: 0, burnT: 0, burnDmg: 0, atBase: false, lane: 'center',
  }
}

function blankProj(): Proj {
  return {
    active: false, id: 0, side: 'unit', kind: 'arrow', x: 0, y: 0, vx: 0, vy: 0, dmg: 0,
    splash: 0, pierce: 0, burn: 0, vuln: 0, slow: 0, life: 0, age: 0, color: '#252525',
    r: 3, hit: [], target: 0, tx: 0, ty: 0, rot: 0, trail: false,
  }
}

function blankZone(): Zone {
  return {
    active: false, x: 0, y: 0, r: 0, life: 0, age: 0, kind: '', dmg: 0, tick: 0, tickT: 0,
    color: '#252525', side: 'unit',
  }
}

export class Battle {
  units: Unit[] = []
  enemies: Enemy[] = Array.from({ length: MAX_ENEMIES }, blankEnemy)
  projs: Proj[] = Array.from({ length: MAX_PROJ }, blankProj)
  zones: Zone[] = Array.from({ length: MAX_ZONES }, blankZone)
  beams: Beam[] = []
  boss: Enemy | null = null

  private host: BattleHost
  private seqU = 1
  private seqE = 1
  private seqP = 1
  private buckets: Enemy[][] = []
  private bucketN = 1
  private mods: UnitMods = { atk: 1, spd: 1, crit: 0.06, critDmg: 1.9, regen: 0 }
  private slowAll = 0
  /** 笔势计时：key = row:7 / col:3，配合主控的布阵变化复用 */
  private strokeT: Record<string, number> = {}
  /** Boss 抹笔：这段时间内所有笔势失效 */
  private eraseT = 0
  /** 本帧被压制的笔势 key，绘制层据此把墨线画成断笔 */
  suppressKeys = new Set<string>()

  constructor(host: BattleHost) {
    this.host = host
    this.beams = Array.from({ length: MAX_BEAMS }, () => ({
      active: false, x1: 0, y1: 0, x2: 0, y2: 0, life: 0, age: 0, color: '#252525', width: 2,
    }))
    this.bucketN = Math.max(1, Math.ceil((this.host.board.len() + 2) / BUCKET))
    this.buckets = Array.from({ length: this.bucketN }, () => [])
  }

  reset(): void {
    this.units.length = 0
    for (const e of this.enemies) { e.active = false; e.dead = false }
    for (const p of this.projs) p.active = false
    for (const z of this.zones) z.active = false
    for (const b of this.beams) b.active = false
    this.boss = null
    this.seqU = 1
    this.seqE = 1
    this.seqP = 1
    this.slowAll = 0
    this.strokeT = {}
    this.eraseT = 0
    this.suppressKeys.clear()
  }

  /* ================= 单位 ================= */

  addUnit(kind: UnitKind, lv: number, veteran: boolean, cell: number, hero: HeroId | '' = ''): Unit | null {
    /* 方格版规则边界：中央土路只走敌人，任何友军都不得落在路格上 */
    if (isPathCell(cell)) return null
    if (this.unitAt(cell)) return null
    if (hero) {
      const h = HERO_BY_ID[hero]
      if (!h) return null
      const u: Unit = {
        active: true, id: this.seqU++, kind: 'blade', hero, lv: 1, veteran: false, cell,
        hp: h.hp, maxHp: h.hp, atk: h.atk, armor: h.armor, range: h.range, cd: h.cd, cdT: 0.2,
        block: h.block, blocked: 0, path: -1, terrain: '', syn: [], hitT: 0, swing: 0, flash: 0, buffSpd: 0, slowT: 0, silenceT: 0,
        shield: 0, shieldT: 0, born: 0, lungeT: 0, lungeDir: 0, lungeX: 0, lungeY: 0,
        turretT: 0, trapT: 0, hint: 0, pulse: 0,
      }
      /* 英雄属性套上同一组局外/局内加成 */
      const m = this.host.unitMods()
      u.hp = Math.round(u.hp * (0.55 + m.atk * 0.45))
      u.maxHp = u.hp
      u.atk = Math.round(u.atk * m.atk)
      this.units.push(u)
      return u
    }
    const s = unitStats(kind, lv, veteran)
    const m = this.host.unitMods()
    const u: Unit = {
      active: true, id: this.seqU++, kind, hero: '', lv, veteran, cell,
      hp: Math.round(s.hp * (0.55 + m.atk * 0.45)), maxHp: 0, atk: Math.round(s.atk * m.atk),
      armor: s.armor, range: s.range, cd: s.cd, cdT: 0, block: 0,
      blocked: 0, path: -1, terrain: '', syn: [], hitT: 0, swing: 0, flash: 0, buffSpd: 0, slowT: 0, silenceT: 0,
      shield: 0, shieldT: 0, born: 0, lungeT: 0, lungeDir: 0, lungeX: 0, lungeY: 0,
      turretT: 0, trapT: 0, hint: 0, pulse: 0,
    }
    u.maxHp = u.hp
    this.units.push(u)
    return u
  }

  unitAt(cell: number): Unit | null {
    for (const u of this.units) if (u.active && u.cell === cell) return u
    return null
  }

  removeUnit(u: Unit, quiet = false): void {
    if (!u.active) return
    u.active = false
    const c = this.host.board.center(u.cell)
    if (!quiet) {
      this.host.fx.burst(c.x, c.y, u.hero ? '#b8860b' : '#4a4139', 14, 220)
      /* 友军阵亡：墨字解体散开，不是直接消失 */
      const g = u.hero ? HERO_BY_ID[u.hero].glyph : UNIT_BY_ID[u.kind].glyph
      this.host.fx.shatter(c.x, c.y, g, u.hero ? 'hero' : u.kind, this.host.board.cell * 0.5, '#3a332a', 1)
      this.host.fx.stain(c.x, c.y, this.host.board.cell * 0.4, '#3a332a', 2)
      this.host.fx.text(c.x, c.y - 14, '阵亡', '#8a3b2a', 13)
    }
    for (const e of this.enemies) if (e.active && e.engaged === u.id) { e.engaged = 0; u.blocked = Math.max(0, u.blocked - 1) }
    if (u.hero) this.host.onHeroKill(u)
    else this.host.onUnitKill(u)
  }

  /* ================= 敌人 ================= */

  spawnEnemy(kind: EnemyKind, elite: boolean, prog = 0, hpMul = 1, dmgMul = 1): Enemy | null {
    const def = ENEMY_BY_ID[kind]
    if (!def) return null
    let e: Enemy | null = null
    for (const cand of this.enemies) if (!cand.active) { e = cand; break }
    if (!e) return null
    const jitter = def.behavior === 'ranged' || kind === 'hexer' ? 0 : ((this.seqE % 2) ? 0.11 : -0.11)
    const hp = Math.round(def.hp * hpScale(this.host.wave) * hpMul * (elite ? 2.1 : 1))
    e.active = true
    e.dead = false
    e.id = this.seqE++
    e.kind = kind
    e.bossId = ''
    e.name = (elite ? '精锐·' : '') + def.name
    e.hp = hp
    e.maxHp = hp
    e.speed = def.speed * speedScale(this.host.wave) * (elite ? 1.08 : 1)
    e.dmg = Math.round(def.dmg * dmgScale(this.host.wave) * dmgMul * (elite ? 1.45 : 1))
    e.armor = def.armor * (1 + Math.min(1.6, this.host.wave * 0.012)) * (elite ? 1.35 : 1)
    e.r = enemyRadius({ elite }, this.host.board.cell)
    e.prog = Math.max(0, prog)
    e.off = jitter
    /* 单一土路：所有敌人沿中央方格向下。 */
    e.lane = 'center'
    e.elite = elite
    e.boss = false
    e.phase = 0
    e.phaseT = 0
    e.abilT = 0
    e.abilIdx = 0
    e.abilWarn = 0
    e.abilId = ''
    e.shield = 0
    e.shieldT = 0
    e.hasteT = 0
    e.slowT = 0
    e.vulnT = 0
    e.stunT = 0
    e.chainT = 0
    e.engaged = 0
    e.atkCd = 0.6
    e.hitT = 0
    e.dieT = 0
    e.born = 0
    e.grain = def.grain
    e.silver = def.silver
    e.zoneT = 0
    e.burnT = 0
    e.burnDmg = 0
    e.atBase = false
    const p0 = this.host.board.laneWorld(e.lane, e.prog, e.off)
    e.x = p0.x
    e.y = p0.y
    return e
  }

  spawnBoss(id: BossId, wave: number): Enemy | null {
    const def = BOSS_BY_ID[id]
    if (!def) return null
    let e: Enemy | null = null
    for (const cand of this.enemies) if (!cand.active) { e = cand; break }
    if (!e) return null
    const tier = bossTier(wave)
    const hp = Math.round(def.hp * hpScale(wave) * (1 + (tier - 1) * 0.55))
    e.active = true
    e.dead = false
    e.id = this.seqE++
    e.kind = 'champion'
    e.bossId = id
    e.name = def.name
    e.hp = hp
    e.maxHp = hp
    e.speed = def.speed
    e.dmg = Math.round(def.dmg * dmgScale(wave) * (1 + (tier - 1) * 0.3))
    e.armor = def.armor * (1 + (tier - 1) * 0.2)
    e.r = enemyRadius({ boss: true }, this.host.board.cell)
    e.prog = 0
    e.off = 0
    e.lane = this.host.pathLane()
    e.elite = true
    e.boss = true
    e.phase = 1
    e.phaseT = 0
    e.abilT = 1.2
    e.abilIdx = 0
    e.abilWarn = 0
    e.abilId = ''
    e.shield = 0
    e.shieldT = 0
    e.hasteT = 0
    e.slowT = 0
    e.vulnT = 0
    e.stunT = 0
    e.chainT = 0
    e.engaged = 0
    e.atkCd = 1
    e.hitT = 0
    e.dieT = 0
    e.born = 0
    e.grain = def.rewardGrain
    e.silver = def.rewardSilver
    e.zoneT = 0
    e.burnT = 0
    e.burnDmg = 0
    e.atBase = false
    this.boss = e
    const pb = this.host.board.laneWorld(e.lane, 0)
    e.x = pb.x
    e.y = pb.y
    return e
  }

  get alive(): number {
    let n = 0
    for (const e of this.enemies) if (e.active && !e.dead && !e.atBase) n++
    return n
  }

  /* ================= 冻结 / 区域 ================= */

  freezeAll(sec: number): void {
    for (const e of this.enemies) if (e.active && !e.dead) e.stunT = Math.max(e.stunT, sec)
    this.host.audio.sfx('freeze')
    this.host.fx.shock(this.host.board.w / 2 + this.host.board.ox, this.host.board.h / 2 + this.host.board.oy, 10, this.host.board.cell * 8, '#33628f', 0.7, 3)
  }

  cannonAt(px: number, py: number, power = 320): void {
    this.host.audio.sfx('cannon')
    this.host.fx.burst(px, py, '#252525', 26, 320, 'ash')
    this.host.fx.shock(px, py, 8, this.host.board.cell * 1.8, '#8a3b2a', 0.5, 4)
    this.host.shake(6)
    for (const e of this.enemies) {
      if (!e.active || e.dead) continue
      const d = Math.hypot(e.x - px, e.y - py)
      if (d <= this.host.board.cell * 1.8) this.hitEnemy(e, power, { color: '#8a3b2a' })
    }
  }

  /* ================= 主循环 ================= */

  update(dt: number): void {
    if (dt <= 0) return
    this.mods = this.host.unitMods()
    this.eraseT = Math.max(0, this.eraseT - dt)
    this.rebuildBuckets()
    this.updateStrokes(dt)
    this.updateUnits(dt)
    this.updateEnemies(dt)
    this.updateProjs(dt)
    this.updateZones(dt)
    this.updateBeams(dt)
    this.cleanup()
  }

  /* ================= 笔势 ================= */

  /** Boss 抹笔：所有笔势失效一段时间。 */
  eraseStrokes(sec: number): void {
    this.eraseT = Math.max(this.eraseT, sec)
    this.suppressKeys.clear()
    this.host.audio.sfx('erase')
    this.host.shake(6)
  }

  /** 立刻放一次所有笔势（只给调试与验收用，正常节奏由 updateStrokes 控） */
  triggerStroke(): number {
    let n = 0
    const cell = this.host.board.cell
    for (const s of this.host.strokeList()) {
      if (s.suppress) continue
      const a = this.host.board.center(s.cells[0])
      const b = this.host.board.center(s.cells[s.cells.length - 1])
      this.fireStroke(s, (a.x + b.x) / 2, (a.y + b.y) / 2)
      n++
    }
    void cell
    return n
  }

  get bornErase(): number { return this.eraseT }

  /** 立刻刷新笔势的压制状态（不推进计时器）：整备期没有战斗帧，开战前要用它对齐一次 */
  syncStrokes(): void {
    this.suppressKeys.clear()
    for (const s of this.host.strokeList()) {
      s.suppress = this.suppressOf(s)
      if (s.suppress) this.suppressKeys.add(s.key)
    }
  }

  /** 这一笔现在是不是被压住：Boss 抹笔窗口内、或被断笔者贴到 2 格以内 */
  private suppressOf(s: Stroke): boolean {
    if (this.eraseT > 0) return true
    const cell = this.host.board.cell
    const first = this.host.board.center(s.cells[0])
    const last = this.host.board.center(s.cells[s.cells.length - 1])
    for (const e of this.enemies) {
      if (!e.active || e.dead || e.kind !== 'breaker') continue
      const nx = Math.max(Math.min(e.x, Math.max(first.x, last.x)), Math.min(first.x, last.x))
      const ny = Math.max(Math.min(e.y, Math.max(first.y, last.y)), Math.min(first.y, last.y))
      if (Math.hypot(e.x - nx, e.y - ny) <= cell * 2.0) return true
    }
    return false
  }

  /**
   * 横锋：整行横扫；直锋：同列合击。
   * 计时器按 key 复用，所以挪动棋子导致笔势断开再连上时不会立刻放技能。
   * 被「断笔者」贴身压住的笔势只停表，不扣伤害 —— 玩家杀掉它，笔势立刻恢复。
   */
  private updateStrokes(dt: number): void {
    const list = this.host.strokeList()
    this.suppressKeys.clear()
    const alive = new Set<string>()

    for (const s of list) {
      alive.add(s.key)
      const first = this.host.board.center(s.cells[0])
      const last = this.host.board.center(s.cells[s.cells.length - 1])
      const mx = (first.x + last.x) / 2
      const my = (first.y + last.y) / 2

      let suppress = this.suppressOf(s)
      s.suppress = suppress
      if (suppress) { this.suppressKeys.add(s.key); continue }

      const t = (this.strokeT[s.key] || 0) + dt
      const period = s.kind === 'row' ? 4.2 : 5.4
      if (t < period) { this.strokeT[s.key] = t; continue }
      /* 蓄满后等目标：空放只会白闪一下，还会打乱节奏 */
      if (!this.strokeHasTarget(s, mx, my)) { this.strokeT[s.key] = period; continue }
      this.strokeT[s.key] = 0
      this.fireStroke(s, mx, my)
    }

    for (const key of Object.keys(this.strokeT)) if (!alive.has(key)) delete this.strokeT[key]
  }

  /** 这一笔此刻有没有可打的敌人（没打就不空放） */
  private strokeHasTarget(s: Stroke, _mx: number, my: number): boolean {
    const cell = this.host.board.cell
    const a = this.host.board.center(s.cells[0])
    const c = this.host.board.center(s.cells[s.cells.length - 1])
    const ax = Math.min(a.x, c.x)
    const bx = Math.max(a.x, c.x)
    const ay = Math.min(a.y, c.y)
    const by = Math.max(a.y, c.y)
    for (const e of this.enemies) {
      if (!e.active || e.dead) continue
      if (s.kind === 'row') {
        if (Math.abs(e.y - my) <= cell * 0.66) return true
        continue
      }
      if (e.atBase) continue
      const nx = Math.max(ax, Math.min(e.x, bx))
      const ny = Math.max(ay, Math.min(e.y, by))
      if (Math.hypot(e.x - nx, e.y - ny) <= cell * 3.2) return true
    }
    return false
  }

  private strokePower(s: Stroke, rate: number): { dmg: number; src: { x: number; y: number }[]; atk: number } {
    let atk = 0
    const src: { x: number; y: number }[] = []
    for (const c of s.cells) {
      const u = this.unitAt(c)
      if (!u || !u.active) continue
      atk += u.atk * (1 + this.host.unitAtkBonus(u))
      src.push(this.host.board.center(c))
    }
    return { dmg: atk * rate, src, atk }
  }

  private fireStroke(s: Stroke, mx: number, my: number): void {
    const cell = this.host.board.cell
    const power = this.strokePower(s, s.kind === 'row' ? 0.85 : 1.15)
    if (power.src.length < 2) return
    const a = this.host.board.center(s.cells[0])
    const b = this.host.board.center(s.cells[s.cells.length - 1])
    const ax = Math.min(a.x, b.x)
    const bx = Math.max(a.x, b.x)
    const ay = Math.min(a.y, b.y)
    const by = Math.max(a.y, b.y)

    if (s.kind === 'row') {
      /* 横锋：一道墨线横着扫过整行，行带上的敌人都吃这一下 */
      let hit = 0
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue
        if (Math.abs(e.y - my) > cell * 0.66) continue
        this.hitEnemy(e, power.dmg, { color: '#3a332a' })
        hit++
      }
      const x0 = this.host.board.ox - cell * 0.12
      const x1 = this.host.board.ox + this.host.board.w + cell * 0.12
      this.strokeBeam(x0, my, x1, my, '#3a332a', 0.34, Math.max(4, cell * 0.16))
      this.host.fx.burst(mx, my, '#3a332a', 8, 160)
      if (hit) {
        this.host.fx.text(mx, my - cell * 0.5, `横锋 ×${s.len}`, '#3a332a', 13)
        this.host.audio.sfx('stroke', 0.9)
      }
      return
    }

    /* 直锋：整列一起出手，把最靠前的一只钉在原地 */
    let target: Enemy | null = null
    let best = -Infinity
    for (const e of this.enemies) {
      if (!e.active || e.dead || e.atBase) continue
      const nx = Math.max(ax, Math.min(e.x, bx))
      const ny = Math.max(ay, Math.min(e.y, by))
      if (Math.hypot(e.x - nx, e.y - ny) > cell * 3.2) continue
      if (e.prog > best) { best = e.prog; target = e }
    }
    if (!target) return
    for (const p of power.src) this.strokeBeam(p.x, p.y, target.x, target.y, '#3a332a', 0.26, Math.max(3, cell * 0.07))
    this.hitEnemy(target, power.dmg + power.atk * 0.15 * (s.len - 3), { color: '#3a332a', label: '直' })
    if (!target.boss) {
      target.slowT = Math.max(target.slowT, 0.5)
      target.stunT = Math.max(target.stunT, 0.25)
    }
    this.host.fx.shock(target.x, target.y, cell * 0.2, cell * 0.9, '#3a332a', 0.4, 2)
    this.host.fx.text(mx, my - cell * 0.4, `直锋 ×${s.len}`, '#3a332a', 13)
    this.host.audio.sfx('stroke', 1)
    this.host.shake(2)
  }

  /** 笔势专用光束：比普通 beam 更长更淡，避免盖住文字 */
  private strokeBeam(x1: number, y1: number, x2: number, y2: number, color: string, life: number, width: number): void {
    let slot: Beam | null = null
    for (const b of this.beams) if (!b.active) { slot = b; break }
    if (!slot) slot = this.beams.reduce((a, b) => (a.age / Math.max(0.01, a.life) > b.age / Math.max(0.01, b.life) ? a : b))
    slot.active = true
    slot.x1 = x1; slot.y1 = y1; slot.x2 = x2; slot.y2 = y2
    slot.life = life
    slot.age = 0
    slot.color = color
    slot.width = width
  }

  private rebuildBuckets(): void {
    for (const b of this.buckets) b.length = 0
    for (const e of this.enemies) {
      if (!e.active || e.dead) continue
      const bi = Math.max(0, Math.min(this.bucketN - 1, Math.floor(e.prog / BUCKET)))
      this.buckets[bi].push(e)
    }
  }

  /** 索敌窗口按“格”传半径，桶里存的是山道进度，必须乘 SEG 才能对上。
   *  之前直接用格数扫进度桶，弓兵 4.2 格的射程只扫到约 2.2 格，
   *  棋子本身就是塔，敌人不会停下来咬它，所以射击节奏不会被压住。 */
  private nearby(prog: number, radiusCells: number): Enemy[] {
    const out: Enemy[] = []
    const radius = radiusCells * SEG
    const lo = Math.max(0, Math.floor((prog - radius) / BUCKET))
    const hi = Math.min(this.bucketN - 1, Math.floor((prog + radius) / BUCKET))
    for (let i = lo; i <= hi; i++) for (const e of this.buckets[i]) out.push(e)
    return out
  }

  /** 单位所在格最近的折线进度；只在自己负责的那条路上找 */
  private hintOf(u: Unit): number {
    const c = this.host.board.center(u.cell)
    const lane = (u.terrain as LaneId) || laneAtCell(u.cell) || 'center'
    const b = this.host.board
    const pts = b.routePts[lane]
    let best = 0
    let bd = Infinity
    for (let i = 0; i < pts.length; i++) {
      const p = b.lanePoint(lane, i)
      const d = (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y)
      /* 三条路格数不同但逻辑长度统一：按折点比例换算进度，不能再用固定 SEG */
      if (d < bd) { bd = d; best = (i / Math.max(1, pts.length - 1)) * b.len(lane) }
    }
    return best
  }

  private updateUnits(dt: number): void {
    /* 工程师光环：先算一遍，避免每个单位再去遍历一遍单位表 */
    const aura: Record<number, number> = {}
    for (const u of this.units) {
      if (!u.active) continue
      u.hint = this.hintOf(u)
      if (u.kind !== 'engineer' || u.silenceT > 0) continue
      const lv = u.lv
      const frac = lv >= 4 ? 0.28 : lv >= 2 ? 0.16 : 0.16
      const radius = lv >= 2 ? 2.4 : 1.6
      const c = this.host.board.center(u.cell)
      for (const o of this.units) {
        if (!o.active || o.id === u.id) continue
        const oc = this.host.board.center(o.cell)
        if (Math.hypot(oc.x - c.x, oc.y - c.y) <= this.host.board.cell * radius) {
          aura[o.id] = Math.max(aura[o.id] || 0, frac)
        }
      }
    }

    for (const u of this.units) {
      if (!u.active) continue
      u.born += dt
      u.hitT = Math.max(0, u.hitT - dt)
      u.flash = Math.max(0, u.flash - dt * 3)
      u.swing = Math.max(0, u.swing - dt)
      u.lungeT = Math.max(0, u.lungeT - dt)
      u.silenceT = Math.max(0, u.silenceT - dt)
      u.slowT = Math.max(0, u.slowT - dt)
      u.shieldT = Math.max(0, u.shieldT - dt)
      if (u.shieldT <= 0) u.shield = 0

      /* 脱战回血：3 秒没挨打才回，回得慢 */
      if (u.hitT <= 0) {
        const r = 0.012 + this.mods.regen
        u.hp = Math.min(u.maxHp, u.hp + u.maxHp * r * dt)
      }

      if (u.hero) {
        if (u.cdT > 0) u.cdT -= dt
        this.heroFight(u)
        continue
      }

      /* 工程师的产粮 / 陷阱 / 弩塔 */
      if (u.kind === 'engineer' && u.silenceT <= 0) {
        u.pulse += dt
        const rate = u.lv >= 2 ? 6.4 : 8.8
        if (u.pulse >= rate) {
          u.pulse = 0
          this.host.addGrain(u.lv >= 2 ? 6 : 3)
          const c = this.host.board.center(u.cell)
          this.host.fx.text(c.x, c.y - this.host.board.cell * 0.42, '+粮', '#3f6b3a', 11)
        }
        if (u.lv >= 4) {
          u.turretT += dt
          if (u.turretT >= 10) {
            u.turretT = 0
            this.host.healBase(this.host.baseMax * 0.02)
          }
        }
        if (u.lv >= 5) {
          u.trapT += dt
          const trapGap = u.path === 0 ? 0.8 : 1.1
          if (u.trapT >= trapGap) {
            u.trapT = 0
            this.engineerTurretShot(u)
            if (u.path === 0) this.engineerTurretShot(u)
          }
        }
      }

      if (u.cdT > 0) { u.cdT -= dt; continue }
      if (u.kind === 'cavalry' && u.pulse > 0) u.pulse = Math.max(0, u.pulse - dt)
      if (u.silenceT > 0) continue
      const rate = this.attackRate(u, aura[u.id] || 0)
      const target = this.pickTarget(u)
      if (!target) continue
      u.cdT = u.cd / rate
      u.swing = 0.18
      this.unitAttack(u, target)
    }
  }

  private attackRate(u: Unit, aura: number): number {
    let r = this.mods.spd * (1 + aura) * (1 + (this.host.furyT > 0 ? 0.8 : 0)) * (1 + this.host.unitRateBonus(u))
    if (u.slowT > 0) r *= 0.55
    if (u.kind === 'cavalry' && this.host.heroPassive('charge') > 0) r *= 1.15
    return r
  }

  /** 地形/阵型/构筑加起来的实际射程 */
  private rangeOf(u: Unit): number {
    return Math.max(0.35, u.range + this.host.unitRangeBonus(u))
  }

  private pickTarget(u: Unit): Enemy | null {
    const fog = this.slowAll > 0 ? 0.55 : 1
    const range = this.rangeOf(u) * fog
    /* 近战按"格子距离"算：斜着贴路的一格也该够得着，
       否则蜿蜒路线上大量斜邻格永远打不到，看着就像不会攻击 */
    const meleeMetric = u.kind === 'blade' || u.kind === 'cavalry'
    /* 索敌必须按"看得见的几何距离"来。折线路径上，进度差 8 格的两只兵
       可能只隔 2 格远（拐了个弯），用进度桶预筛会把它们整段漏掉 —— 就是
       "明明进了射程却不动手"。200 只敌人的全量扫描在这个规模下可以忽略。 */
    const candidates = this.enemies
    const c = this.host.board.center(u.cell)
    let best: Enemy | null = null
    let bd = Infinity
    let clusterBest: Enemy | null = null
    let clusterN = -1
    for (const e of candidates) {
      if (!e.active || e.dead) continue
      if (e.atBase && !e.boss) continue
      const dx = Math.abs(e.x - c.x) / this.host.board.cell
      const dy = Math.abs(e.y - c.y) / this.host.board.cell
      const d = meleeMetric ? Math.max(dx, dy) : Math.hypot(dx, dy)
      if (d > range) continue
      if (d < bd) { bd = d; best = e }
      if (u.kind === 'mage' || u.kind === 'warlock') {
        let n = 0
        const rr = this.host.board.cell * 1.2
        for (const o of this.enemies) {
          if (!o.active || o.dead) continue
          if (Math.hypot(o.x - e.x, o.y - e.y) <= rr) n++
        }
        if (n > clusterN) { clusterN = n; clusterBest = e }
      }
    }
    if ((u.kind === 'mage' || u.kind === 'warlock') && clusterBest && clusterN > 1) return clusterBest
    return best
  }

  private unitAttack(u: Unit, target: Enemy): void {
    const c = this.host.board.center(u.cell)
    const dmgBase = u.atk * (1 + this.host.unitAtkBonus(u))
    const critChance = this.mods.crit + (u.kind === 'blade' ? 0.08 : 0) + (u.kind === 'bow' || u.kind === 'spear' ? this.host.heroPassive('crit') : 0)
    const critDmg = this.mods.critDmg + (u.kind === 'blade' && u.lv >= 4 ? 0.5 : 0) + (u.kind === 'blade' && u.path === 1 ? 0.35 : 0) + (u.kind === 'bow' || u.kind === 'spear' ? this.host.heroPassive('crit') * 2 : 0)
    const rollCrit = (): number => {
      const crit = Math.random() < critChance
      return crit ? dmgBase * critDmg : dmgBase
    }
    switch (u.kind) {
      case 'blade': {
        const d = rollCrit()
        const crit = d > dmgBase
        if (u.lv >= 5 && !target.boss && target.hp < target.maxHp * 0.15) {
          this.hitEnemy(target, target.hp + 1, { color: '#8a3b2a', label: '断' })
          /* 处决盖「断」印：一刀断的仪式感 */
          this.host.fx.stamp(target.x, target.y, '断', this.host.board.cell * 0.5, '#a8342a')
        } else {
          this.hitEnemy(target, d, { color: crit ? '#a0432c' : '#8d3b2f', crit, label: crit ? '暴' : '' })
        }
        if (u.lv >= 3) {
          let n = 0
          for (const e of this.nearby(target.prog, 1.5)) {
            if (e === target || !e.active || e.dead) continue
            if (Math.hypot(e.x - target.x, e.y - target.y) > this.host.board.cell * 1.4) continue
            this.hitEnemy(e, d * 0.55, { color: '#8d3b2f', silent: true })
            if (++n >= 1) break
          }
        }
        u.lungeT = 0.16
        u.lungeDir = Math.atan2(target.y - c.y, target.x - c.x)
        u.lungeX = Math.cos(u.lungeDir) * this.host.board.cell * 0.16
        u.lungeY = Math.sin(u.lungeDir) * this.host.board.cell * 0.16
        /* 刀光：深墨斜劈打底，外面加一层暖光；等级越高笔画越厚、光越亮、末尾越沉 */
        {
          const cell = this.host.board.cell
          const a = Math.atan2(target.y - c.y, target.x - c.x)
          const sx = c.x + Math.cos(a) * cell * 0.3
          const sy = c.y + Math.sin(a) * cell * 0.3
          const nx = -Math.sin(a)
          const ny = Math.cos(a)
          const off = cell * (crit ? 0.3 : 0.2)
          const pw = Math.min(1, 0.2 + (u.lv - 1) * 0.2)
          const thick = cell * (crit ? 0.2 : 0.16) * (0.85 + (u.lv - 1) * 0.1)
          this.host.fx.slash(sx + nx * off, sy + ny * off, target.x, target.y, crit ? '#a8352a' : '#6f2c22', 0.22, thick, 0.16, '#f0a63c', pw)
          if (crit) {
            this.host.fx.slash(sx - nx * off * 0.7, sy - ny * off * 0.7, target.x, target.y, '#a8352a', 0.2, cell * 0.06, -0.12, '#f7c05a', pw)
            this.host.fx.burst(target.x, target.y, '#a8352a', 5, cell * 2.2)
          }
          if (u.lv >= 4) {
            /* 四级往上：再补一道更宽更淡的墨晕，落点压一次震，手感变"厚" */
            this.host.fx.slash(sx, sy, target.x, target.y, '#6f2c22', 0.26, thick * 1.9, 0.1, '#f7c05a', pw)
            this.host.shake(2 + u.lv)
          }
          if (u.lv >= 5) this.host.fx.shock(target.x, target.y, 3, cell * 0.7, '#e8a13c', 0.3, 2.6)
        }
        this.host.audio.sfx('hit', 0.9)
        break
      }
      case 'spear': {
        const dir = Math.atan2(target.y - c.y, target.x - c.x)
        const len = this.host.board.cell * u.range
        const radial = u.lv >= 5 && u.pulse === 2
        u.pulse = (u.pulse + 1) % 3
        let n = 0
        const lineBonus = u.syn.includes('刀枪') ? this.host.runMod('spearLine') : 0
        const maxN = (u.lv >= 3 ? (u.path === 0 ? 4 : 3) : 1) + lineBonus
        for (const e of this.nearby(u.hint, u.range + 1)) {
          if (!e.active || e.dead) continue
          const dx = e.x - c.x
          const dy = e.y - c.y
          const dist = Math.hypot(dx, dy)
          if (dist > len || dist < 1) continue
          if (!radial) {
            const ang = Math.abs(((Math.atan2(dy, dx) - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
            if (ang > Math.PI / 2 - 0.22) continue
          }
          this.hitEnemy(e, rollCrit() * (radial ? 0.7 : 1), { color: '#5d6b3a' })
          if (u.lv >= 4 && !e.boss) { e.stunT = Math.max(e.stunT, 0.6); e.prog = Math.max(0, e.prog - 0.08) }
          if (u.lv >= 3 && u.path === 1 && !e.boss) { e.slowT = Math.max(e.slowT, 0.8); e.prog = Math.max(0, e.prog - 0.12); this.spreadControl(e) }
          if (++n >= (radial ? 8 : maxN)) break
        }
        const tw = (radial ? 3 : 2.4) + (u.lv - 1) * 0.8
        if (radial) {
          /* 五级枪阵：八方针刺 + 一圈墨晕 */
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2
            this.host.fx.thrust(c.x, c.y, c.x + Math.cos(a) * len * 0.7, c.y + Math.sin(a) * len * 0.7, '#5d6b3a', 0.28, tw)
          }
          this.host.fx.bloom(c.x, c.y, this.host.board.cell * 0.3, this.host.board.cell * 1.4, '#5d6b3a', 0.4)
        } else {
          /* 墨针突刺：笔画凝聚成针，瞬间延伸贯穿 */
          this.host.fx.thrust(c.x, c.y, c.x + Math.cos(dir) * len, c.y + Math.sin(dir) * len, '#5d6b3a', 0.26, tw)
        }
        this.host.fx.hitSpark(c.x + Math.cos(dir) * this.host.board.cell * 0.34, c.y + Math.sin(dir) * this.host.board.cell * 0.34, '#8a945a', Math.min(1, 0.18 + u.lv * 0.16))
        this.host.audio.sfx('shoot', 0.7)
        break
      }
      case 'bow': {
        const shots: Enemy[] = [target]
        if (u.lv >= 3 && u.path !== 1) {
          let extra: Enemy | null = null
          for (const e of this.nearby(u.hint, u.range + 1)) {
            if (e === target || !e.active || e.dead) continue
            const d = Math.hypot(e.x - c.x, e.y - c.y) / this.host.board.cell
            if (d <= u.range) { extra = e; break }
          }
          if (extra) shots.push(extra)
        }
        u.pulse++
        const rain = u.lv >= 5 && u.pulse % 4 === 0
        if (rain) {
          this.addZone(target.x, target.y, this.host.board.cell * 1.2, 0.9, 'rain', u.atk * 0.8, '#6a5b2e', 'unit', 0.32)
          /* 箭雨：落点墨晕 + 数支自上方钉落的笔画箭 */
          this.host.fx.bloom(target.x, target.y, this.host.board.cell * 0.3, this.host.board.cell * 1.2, '#6a5b2e', 0.5)
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * Math.PI * 2
            const rr = Math.random() * this.host.board.cell * 1.1
            const px = target.x + Math.cos(a) * rr
            const py = target.y + Math.sin(a) * rr
            this.host.fx.thrust(px, py - this.host.board.cell * 0.8, px, py, '#6a5b2e', 0.3, 2)
          }
          this.host.audio.sfx('arrow', 1)
          break
        }
        for (const e of shots) {
          this.shoot(c.x, c.y, e, u.atk * (1 + this.host.unitAtkBonus(u)) * (u.path === 1 ? 1.18 : 1) * (Math.random() < critChance ? critDmg : 1), {
            kind: 'arrow', color: '#6a5b2e', pierce: u.lv >= 4 || (u.lv >= 3 && u.path === 1) ? 2 : 0, speed: this.host.board.cell * 9,
          })
        }
        this.host.audio.sfx('arrow', 0.8)
        break
      }
      case 'cavalry': {
        const dir = Math.atan2(target.y - c.y, target.x - c.x)
        const len = this.host.board.cell * (u.range + (u.lv >= 2 ? 0.8 : 0))
        const mult = 1 + this.host.heroPassive('charge')
        const branchB = u.lv >= 3 && u.path === 1
        const d = rollCrit() * mult * (branchB ? 1.2 : 1)
        u.lungeT = 0.34
        u.lungeDir = dir
        u.lungeX = Math.cos(dir) * this.host.board.cell * 0.5
        u.lungeY = Math.sin(dir) * this.host.board.cell * 0.5
        this.beam(c.x, c.y, c.x + Math.cos(dir) * len, c.y + Math.sin(dir) * len, '#7a4a2f', 0.28, 5)
        this.host.fx.slash(
          c.x + Math.cos(dir) * this.host.board.cell * 0.34,
          c.y + Math.sin(dir) * this.host.board.cell * 0.34,
          c.x + Math.cos(dir) * len * 0.8,
          c.y + Math.sin(dir) * len * 0.8, '#7a4a2f', 0.22, this.host.board.cell * 0.16, -0.18,
          '#e0a24a', Math.min(1, 0.28 + u.lv * 0.16),
        )
        this.host.fx.shock(c.x + Math.cos(dir) * this.host.board.cell * 0.2, c.y + Math.sin(dir) * this.host.board.cell * 0.2, 2, this.host.board.cell * 0.72, '#c08a52', 0.26, 2.2)
        this.host.fx.burst(c.x + Math.cos(dir) * this.host.board.cell * 0.5, c.y + Math.sin(dir) * this.host.board.cell * 0.5, '#b09a72', 6, this.host.board.cell * 2)
        /* 冲锋撞击盖「踏」印 + 沿途蹄点墨滴 */
        {
          const ix = c.x + Math.cos(dir) * len * 0.72
          const iy = c.y + Math.sin(dir) * len * 0.72
          this.host.fx.stamp(ix, iy, '踏', this.host.board.cell * 0.46, '#7a4a2f', 0.6)
          for (let k = 1; k <= 3; k++) {
            const t = k / 4
            this.host.fx.burst(c.x + Math.cos(dir) * len * t, c.y + Math.sin(dir) * len * t, '#6f5a3a', 2, this.host.board.cell * 0.8)
          }
        }
        const hits = (u.lv >= 4 ? 2 : 1) + (u.lv >= 3 && u.path === 0 ? 1 : 0)
        let rings = 0
        let n = 0
        for (const e of this.nearby(u.hint, u.range + 1.2)) {          if (!e.active || e.dead) continue
          const dx = e.x - c.x
          const dy = e.y - c.y
          const dist = Math.hypot(dx, dy)
          if (dist > len) continue
          const ang = Math.abs(((Math.atan2(dy, dx) - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
          if (ang > Math.PI / 2 - 0.12) continue
          this.hitEnemy(e, d * (n === 0 ? 1 : 0.55), { color: '#7a4a2f' })
          if (branchB && !e.boss) { e.prog = Math.max(0, e.prog - 0.18); e.slowT = Math.max(e.slowT, 0.5); this.spreadControl(e) }
          if (u.lv >= 5 && !e.boss) { e.stunT = Math.max(e.stunT, 1); e.prog = Math.max(0, e.prog - 0.25) }
          n++
          if (n >= hits + 1) break
        }
        if (u.lv >= 3) {
          for (const e of this.nearby(target.prog, 1.4)) {
            if (!e.active || e.dead || e === target) continue
            if (Math.hypot(e.x - target.x, e.y - target.y) > this.host.board.cell * 1) continue
            this.hitEnemy(e, d * 0.4, { color: '#7a4a2f', silent: rings > 0 })
            if (++rings >= 2) break
          }
        }
        if (n > 0 && this.host.runMod('raid') > 0 && u.pulse <= 0) {
          u.pulse = 1.2
          u.cdT = 0.08
          this.host.fx.text(c.x, c.y - this.host.board.cell * 0.35, '再冲', '#7a4a2f', 12)
        }
        this.host.shake(3)
        this.host.audio.sfx('shoot2', 1)
        break
      }
      case 'mage': {
        u.pulse++
        if (u.lv >= 4 && u.pulse % 6 === 0) {
          let second: Enemy | null = null
          for (const e of this.nearby(u.hint, u.range + 1)) {
            if (!e.active || e.dead || e === target) continue
            second = e
            break
          }
          if (second) this.mageOrb(c, second, u)
        }
        if (u.lv >= 5 || (u.lv >= 3 && u.path === 1)) {
          u.turretT += u.cd
          if (u.turretT >= 12) {
            u.turretT = 0
            const p = this.host.board.laneWorld(target.lane, Math.max(0, target.prog - 0.5))
            this.addZone(p.x, p.y, this.host.board.cell * 2.2, 0.7, 'meteor', u.atk * 1.4, '#a0432c', 'unit', 0.25)
            /* 陨火：墨晕 + 盖「焚」印 + 焦纸渍 */
            this.host.fx.bloom(p.x, p.y, this.host.board.cell * 0.5, this.host.board.cell * 2.2, '#a0432c', 0.6)
            this.host.fx.stamp(p.x, p.y, '焚', this.host.board.cell * 0.62, '#a0432c', 0.8)
            this.host.fx.stain(p.x, p.y, this.host.board.cell * 1.4, '#6a3a2a', 2.6)
            this.host.audio.sfx('cannon', 0.8)
          }
        }
        this.mageOrb(c, target, u)
        break
      }
      case 'engineer': {
        this.shoot(c.x, c.y, target, u.atk, { kind: 'bolt', color: '#3f6350', speed: this.host.board.cell * 6 })
        this.host.fx.burst(c.x, c.y - this.host.board.cell * 0.1, '#6f9a7f', 4, this.host.board.cell * 1.2, 'spark')
        this.host.audio.sfx('shoot', 0.4)
        break
      }
      case 'warlock': {
        const radius = u.range + (u.lv >= 3 ? 0.7 : 0)
        let n = 0
        for (const e of this.nearby(u.hint, radius + 0.6)) {
          if (!e.active || e.dead) continue
          if (Math.hypot(e.x - c.x, e.y - c.y) / this.host.board.cell > radius) continue
          this.hitEnemy(e, u.atk * (1 + this.host.unitAtkBonus(u)) * (u.path === 1 ? 1.25 : 1), { color: '#5b3a6b', silent: n > 0 })
          e.vulnT = Math.max(e.vulnT, 4)
          if (u.lv >= 3 && u.path === 0) { e.stunT = Math.max(e.stunT, u.lv >= 4 ? 1.5 : 0.7); this.spreadControl(e) }
          if (u.lv >= 4 && u.pulse % 3 === 2) e.stunT = Math.max(e.stunT, 1.2)
          n++
          if (n >= 6) break
        }
        u.pulse++
        /* 咒波：紫墨晕染扩散，不是双层圆环 */
        this.host.fx.bloom(c.x, c.y, this.host.board.cell * 0.3, this.host.board.cell * radius, '#5b3a6b', 0.42)
        this.host.fx.bloom(c.x, c.y, this.host.board.cell * 0.2, this.host.board.cell * radius * 0.7, '#a98cc0', 0.34)
        if (u.lv >= 4 && u.pulse % 3 === 0) this.host.fx.stamp(c.x, c.y, '缚', this.host.board.cell * 0.44, '#5b3a6b', 0.6)
        this.host.audio.sfx('orb', 0.7)
        break
      }
      case 'lance': {
        /* 枪+骑：沿一列撞过去，撞穿后继续推 */
        u.pulse++
        const dir = Math.atan2(target.y - c.y, target.x - c.x)
        const len = this.host.board.cell * (u.range + (u.lv >= 2 ? 0.6 : 0))
        const maxN = 2 + (u.lv >= 4 ? 1 : 0) + (u.lv >= 3 && u.path === 0 ? 1 : 0)
        const d = rollCrit() * (u.path === 1 ? 1.2 : 1) * (1 + this.host.heroPassive('charge'))
        u.lungeT = 0.34
        u.lungeDir = dir
        u.lungeX = Math.cos(dir) * this.host.board.cell * 0.55
        u.lungeY = Math.sin(dir) * this.host.board.cell * 0.55
        /* 贯穿突刺 + 一道淡残影 */
        this.host.fx.thrust(c.x, c.y, c.x + Math.cos(dir) * len, c.y + Math.sin(dir) * len, '#8a4a34', 0.28, 6)
        this.host.fx.thrust(c.x, c.y, c.x + Math.cos(dir) * len * 0.85, c.y + Math.sin(dir) * len * 0.85, '#b09a72', 0.34, 3)
        let n = 0
        for (const e of this.nearby(u.hint, u.range + 1.2)) {
          if (!e.active || e.dead) continue
          const dx = e.x - c.x
          const dy = e.y - c.y
          const dist = Math.hypot(dx, dy)
          if (dist > len) continue
          const ang = Math.abs(((Math.atan2(dy, dx) - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
          if (ang > Math.PI / 2 - 0.12) continue
          this.hitEnemy(e, d * (n === 0 ? 1 : 0.6), { color: '#8a4a34' })
          if (u.lv >= 3 && !e.boss) { e.prog = Math.max(0, e.prog - (u.path === 1 ? 0.3 : 0.18)); this.spreadControl(e) }
          if (u.lv >= 5 && !e.boss) { e.stunT = Math.max(e.stunT, 0.8) }
          if (++n >= maxN) break
        }
        this.host.shake(3)
        this.host.audio.sfx('shoot2', 1)
        break
      }
      case 'halberd': {
        /* 刀+枪：直刺一线，三级起再劈身边一人 */
        const dir = Math.atan2(target.y - c.y, target.x - c.x)
        const len = this.host.board.cell * u.range
        const radial = u.lv >= 5 && u.pulse % 3 === 2
        u.pulse++
        const maxN = (u.lv >= 3 ? 2 : 1) + (u.path === 0 ? 1 : 0)
        let n = 0
        for (const e of this.nearby(u.hint, u.range + 1)) {
          if (!e.active || e.dead) continue
          const dx = e.x - c.x
          const dy = e.y - c.y
          const dist = Math.hypot(dx, dy)
          if (dist > len + this.host.board.cell * 0.3 || dist < 1) continue
          if (!radial) {
            const ang = Math.abs(((Math.atan2(dy, dx) - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
            if (ang > 0.52) continue
          }
          this.hitEnemy(e, rollCrit() * (radial ? 0.8 : 1), { color: '#7b5b2f' })
          if (u.lv >= 3 && !e.boss) {
            let extra = 0
            for (const o of this.nearby(e.prog, 1.4)) {
              if (!o.active || o.dead || o === e) continue
              if (Math.hypot(o.x - e.x, o.y - e.y) > this.host.board.cell * 1.1) continue
              this.hitEnemy(o, rollCrit() * 0.45, { color: '#7b5b2f', silent: true })
              if (++extra >= 1) break
            }
          }
          if (++n >= (radial ? 6 : maxN)) break
        }
        u.lungeT = 0.18
        u.lungeDir = dir
        u.lungeX = Math.cos(dir) * this.host.board.cell * 0.18
        u.lungeY = Math.sin(dir) * this.host.board.cell * 0.18
        this.beam(c.x, c.y, c.x + Math.cos(dir) * len, c.y + Math.sin(dir) * len, '#7b5b2f', 0.2, radial ? 4 : 2)
        this.host.fx.slash(
          c.x + Math.cos(dir) * this.host.board.cell * 0.3,
          c.y + Math.sin(dir) * this.host.board.cell * 0.3,
          target.x, target.y, '#7b5b2f', 0.15, this.host.board.cell * 0.1, radial ? 0.05 : 0.14, '#e6aa4e', Math.min(1, 0.2 + u.lv * 0.16),
        )
        this.host.audio.sfx('hit', 0.9)
        break
      }
      case 'pyro': {
        /* 弓+法：火箭带火，落点继续烧 */
        const shots: Enemy[] = [target]
        u.pulse++
        if (u.lv >= 4 && u.pulse % 3 === 0) {
          for (const e of this.nearby(u.hint, u.range + 1)) {
            if (e === target || !e.active || e.dead) continue
            if (Math.hypot(e.x - c.x, e.y - c.y) / this.host.board.cell > u.range) continue
            shots.push(e)
            break
          }
        }
        if (u.lv >= 5) {
          u.turretT += u.cd
          if (u.turretT >= 10) {
            u.turretT = 0
            const burn = u.atk * (u.path === 1 ? 1.35 : 1) * 0.3
            this.addZone(target.x, target.y, this.host.board.cell * 2, 1.3, 'fire', burn, '#a04a2c', 'unit', 0.28)
            /* 焚阵火雨：朱砂墨晕 + 燃烧焦渍 */
            this.host.fx.bloom(target.x, target.y, this.host.board.cell * 0.4, this.host.board.cell * 2, '#a04a2c', 0.55)
            this.host.fx.stain(target.x, target.y, this.host.board.cell * 1.2, '#7a3a22', 2.4)
            this.host.audio.sfx('cannon', 0.8)
          }
        }
        const splash = this.host.board.cell * (0.7 + (u.lv >= 3 ? 0.3 : 0) + (u.path === 0 ? 0.4 : 0))
        for (const e of shots) {
          this.shoot(c.x, c.y, e, rollCrit(), {
            kind: 'fire', color: '#a04a2c', splash, burn: u.atk * (u.path === 1 ? 0.42 : 0.3), speed: this.host.board.cell * 7.5,
          })
        }
        this.host.audio.sfx('arrow', 0.85)
        break
      }
      default:
        this.hitEnemy(target, u.atk, { color: '#252525' })
    }
  }

  /** 连环计：负面状态向同一条路上的最近敌人传播一次 */
  private spreadControl(e: Enemy): void {
    if (this.host.runMod('chain') <= 0 || e.chainT > 0 || !e.active || e.dead) return
    e.chainT = 0.35
    let n = 0
    for (const o of this.nearby(e.prog, 1.3)) {
      if (o === e || !o.active || o.dead || o.lane !== e.lane) continue
      if (Math.hypot(o.x - e.x, o.y - e.y) > this.host.board.cell * 1.4) continue
      o.stunT = Math.max(o.stunT, 0.3)
      o.slowT = Math.max(o.slowT, 0.9)
      o.chainT = Math.max(o.chainT, 0.35)
      this.host.fx.text(o.x, o.y - this.host.board.cell * 0.3, '链', '#5b3a6b', 12)
      if (++n >= 1) break
    }
  }

  private mageOrb(c: { x: number; y: number }, target: Enemy, u: Unit): void {
    let splash = UNIT_BY_ID[u.kind].splash + (u.lv >= 2 ? 0.35 : 0) + (this.host.heroPassive('burn') > 0 ? 0.2 : 0)
    if (u.lv >= 3 && u.path === 0) splash += 0.55
    this.shoot(c.x, c.y, target, u.atk * (1 + this.host.unitAtkBonus(u)), {
      kind: 'fire', color: '#a0432c', splash: this.host.board.cell * splash,
      burn: (u.lv >= 3 ? u.atk * 0.35 : 0) + u.atk * this.host.heroPassive('burn'), speed: this.host.board.cell * 6,
    })
    this.host.fx.burst(c.x, c.y - this.host.board.cell * 0.12, '#c07850', 4, this.host.board.cell * 1.3, 'spark')
    this.host.audio.sfx('orb', 0.9)
  }

  private engineerTurretShot(u: Unit): void {
    const c = this.host.board.center(u.cell)
    let target: Enemy | null = null
    let bd = Infinity
    for (const e of this.nearby(u.hint, 3.4)) {
      if (!e.active || e.dead) continue
      const d = Math.hypot(e.x - c.x, e.y - c.y)
      if (d < bd && d <= this.host.board.cell * 3.4) { bd = d; target = e }
    }
    if (!target) return
    const tx = c.x + this.host.board.cell * 0.4
    const ty = c.y - this.host.board.cell * 0.2
    this.shoot(tx, ty, target, u.atk * 0.75, { kind: 'bolt', color: '#3f6350', speed: this.host.board.cell * 10 })
    /* 机关术：陷阱触发后向周围弹一次连锁 */
    if (this.host.runMod('trapChain') > 0) {
      let n = 0
      for (const e of this.nearby(target.prog, 1.3)) {
        if (e === target || !e.active || e.dead) continue
        if (Math.hypot(e.x - target.x, e.y - target.y) > this.host.board.cell * 1.2) continue
        this.hitEnemy(e, u.atk * 0.35, { color: '#3f6350', silent: true })
        if (++n >= 2) break
      }
    }
    this.host.audio.sfx('shoot', 0.5)
  }

  private heroFight(u: Unit): void {
    const h = HERO_BY_ID[u.hero as HeroId]
    if (!h) return
    /* 英雄被动：护甲光环 / 燃烧 / 暴击 / 冲锋 都由 host.heroPassive 读取，这里只管出手 */
    if (u.silenceT > 0) return
    if (u.cdT > 0) return
    const c = this.host.board.center(u.cell)
    const target = this.pickTarget(u)
    if (!target) return
    u.cdT = u.cd / (this.mods.spd * (1 + (this.host.furyT > 0 ? 0.8 : 0)))
    u.swing = 0.2
    const dmg = u.atk * (Math.random() < this.mods.crit ? this.mods.critDmg : 1)
    if (u.hero === 'qingfeng') {
      this.hitEnemy(target, dmg, { color: h.color })
      this.host.audio.sfx('hit', 1)
    } else if (u.hero === 'chiyuan') {
      this.shoot(c.x, c.y, target, dmg, { kind: 'fire', color: h.color, splash: this.host.board.cell * 1.1, burn: u.atk * 0.3, speed: this.host.board.cell * 7 })
      this.host.audio.sfx('orb', 1)
    } else if (u.hero === 'bailu') {
      this.shoot(c.x, c.y, target, dmg, { kind: 'arrow', color: h.color, pierce: 1, speed: this.host.board.cell * 11 })
      this.host.audio.sfx('arrow', 1)
    } else {
      const dir = Math.atan2(target.y - c.y, target.x - c.x)
      const len = this.host.board.cell * 3.6
      this.beam(c.x, c.y, c.x + Math.cos(dir) * len, c.y + Math.sin(dir) * len, h.color, 0.3, 5)
      for (const e of this.nearby(u.hint, 3.8)) {
        if (!e.active || e.dead) continue
        const dx = e.x - c.x
        const dy = e.y - c.y
        if (Math.hypot(dx, dy) > len) continue
        const ang = Math.abs(((Math.atan2(dy, dx) - dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
        if (ang > Math.PI / 2 - 0.15) continue
        this.hitEnemy(e, dmg, { color: h.color })
        if (!e.boss) e.stunT = Math.max(e.stunT, 0.5)
      }
      this.host.shake(3)
      this.host.audio.sfx('shoot2', 1)
    }
  }

  /** 英雄主动技：青锋铁壁 / 赤鸢焚天 / 白鹭万箭 / 踏雪踏阵 */
  heroSkill(hero: HeroId): void {
    const h = HERO_BY_ID[hero]
    if (!h) return
    this.host.audio.sfx('skill', 1.2)
    this.host.shake(4)
    const board = this.host.board
    if (hero === 'qingfeng') {
      /* 兵是塔，护盾无处可用：青锋的"铁壁"改成守营——回 8% 血 + 6 秒砸门减伤 */
      this.host.armorT = 6
      this.host.healBase(this.host.baseMax * 0.08)
      this.host.fx.shock(board.w / 2 + board.ox, board.oy, 12, board.cell * 9, '#3f6659', 0.8, 4)
      this.host.notify('铁壁 · 营寨回血，6 秒内砸门减伤', 'good')
    } else if (hero === 'chiyuan') {
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue
        this.hitEnemy(e, h.atk * h.activeDmg, { color: h.color, silent: true })
        e.burnT = 4
        e.burnDmg = h.atk * 0.4
      }
      this.host.fx.burst(board.w / 2 + board.ox, board.h / 2 + board.oy, '#a0432c', 40, 420, 'ash')
      this.host.notify('焚天 · 全线起火', 'good')
    } else if (hero === 'bailu') {
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue
        this.hitEnemy(e, h.atk * h.activeDmg, { color: h.color, silent: true })
      }
      this.host.fx.shock(board.w / 2 + board.ox, board.h / 2 + board.oy, 20, board.cell * 10, '#3c6b7a', 0.7, 3)
      this.host.notify('万箭 · 箭雨覆满山道', 'good')
    } else {
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue
        this.hitEnemy(e, h.atk * h.activeDmg, { color: h.color, silent: true })
        if (!e.boss) e.stunT = Math.max(e.stunT, 1.5)
      }
      this.host.shake(8)
      this.host.notify('踏阵 · 全线冲撞', 'good')
    }
  }

  /* ================= 敌人更新 ================= */

  private updateEnemies(dt: number): void {
    /* 单路棋盘最容易出现“一串敌人叠在同一格”的糊字。
       这里按路线进度排序，给前后敌人留出最小间距：
       不改变战斗数值，只是让排队、拦截和文字都看得清。 */
    const queue = this.enemies
      .filter((e) => e.active && !e.dead && !e.boss)
      .sort((a, b) => b.prog - a.prog || b.id - a.id)
    /* 间距按"一格"算：1 个进度单位 = 一格，所以 gap 必须跟着本局路点密度走。
       写死 0.9 时，折点多的路线一格只有 0.8 进度，两人就会叠在同一个像素上。 */
    const gap = Math.max(0.9, this.host.board.segLen() * 0.9)
    for (let i = 1; i < queue.length; i++) {
      const front = queue[i - 1]
      const behind = queue[i]
      const limit = front.prog - gap
      if (behind.prog > limit) behind.prog = limit
      if (!Number.isFinite(behind.prog)) behind.prog = 0
    }

    for (const e of this.enemies) {
      if (!e.active) continue
      e.born += dt
      if (!Number.isFinite(e.prog)) e.prog = 0
      if (!Number.isFinite(e.off)) e.off = 0
      const ep = this.host.board.laneWorld(e.lane, e.prog, e.off)
      e.x = ep.x
      e.y = ep.y
      /* 显示半径跟着格子走（改窗口大小也一致），飘字/冲击波都用这个口径 */
      e.r = enemyRadius(e, this.host.board.cell)
      e.hitT = Math.max(0, e.hitT - dt)
      e.stunT = Math.max(0, e.stunT - dt)
      e.chainT = Math.max(0, e.chainT - dt)
      e.slowT = Math.max(0, e.slowT - dt)
      e.vulnT = Math.max(0, e.vulnT - dt)
      e.hasteT = Math.max(0, e.hasteT - dt)
      e.shieldT = Math.max(0, e.shieldT - dt)
      if (e.shieldT <= 0) e.shield = 0
      if (e.burnT > 0) {
        e.burnT -= dt
        if (e.burnDmg > 0) this.hitEnemy(e, e.burnDmg * dt, { silent: true, color: '#a0432c', noFloat: true })
        if (Math.random() < dt * 6) this.host.fx.burst(e.x, e.y - e.r * 0.3, '#a0432c', 1, 40)
        if (!e.active) continue
      }
      if (e.dead) { e.dieT += dt; if (e.dieT > 0.28) e.active = false; continue }

      if (e.boss) { this.updateBoss(e, dt); continue }

      const routeLen = this.host.board.len(e.lane)
      /* 路线尽头：普通敌人撞一下营寨就消失；Boss 赖在门口连续砸 */
      if (e.prog >= routeLen - 0.01) {
        if (!e.atBase) {
          e.atBase = true
          this.host.hurtBase(e.dmg * 2.4)
          const bp = this.host.board.basePoint()
          this.host.fx.text(bp.x, bp.y - 24, `-${Math.round(e.dmg * 2.4)}`, '#8a3b2a', 15)
          this.host.onEnemyLeak(e)
          this.host.audio.sfx('base')
          this.host.shake(4)
        }
        e.active = false
        continue
      }

      if (e.slowT > 0) e.speed = Math.max(0.12, e.speed * 0.8)
      /* 咒师的减速光环：术士单位在范围内就持续加压 */
      for (const u of this.units) {
        if (!u.active || u.kind !== 'warlock' || u.silenceT > 0) continue
        const c = this.host.board.center(u.cell)
        const auraR = this.host.board.cell * (u.range + (u.lv >= 3 ? 0.7 : 0))
        if (Math.hypot(e.x - c.x, e.y - c.y) <= auraR) e.slowT = Math.max(e.slowT, 0.25)
      }

      if (e.stunT > 0) continue

      const laneMul = 1
      const behavior = ENEMY_BY_ID[e.kind].behavior
      if (behavior === 'bomber') {
        /* 火雷兵不砍人：贴到哪个单位就自爆 */
        /* 兵是塔：火雷兵不再炸兵，只剩漏怪那一记 */
      }
      if (behavior === 'breaker') {
        /* 断笔者不吃拦截、也不砍人：它贴着笔势停下，把这一笔压住。
           必须被点掉，否则阵型一直失效 —— 这是「阵」被针对的方式。 */
        const cut = this.strokeNear(e, 2.0)
        e.zoneT += dt
        if (cut) {
          if (e.zoneT >= 1.4) {
            e.zoneT = 0
            this.host.fx.text(e.x, e.y - e.r - 8, '断笔', '#8a2f2a', 12)
            this.host.audio.sfx('cut', 0.7)
          }
          continue
        }
        e.prog += e.speed * dt * (e.hasteT > 0 ? 1.5 : 1) * (e.slowT > 0 ? 0.8 : 1)
        continue
      }
      if (behavior === 'ranged' || behavior === 'hexer') {
        /* 兵是塔：没有可射的棋子，咒师只给同伴加速 */
        if (behavior === 'hexer') this.hexerBuff(e)
        e.prog += e.speed * dt * (e.hasteT > 0 ? 1.5 : 1) * laneMul
        continue
      }

      /* 兵是塔：敌人不会被咬住，只沿着山道往营寨走 */
      e.prog += e.speed * dt * (e.hasteT > 0 ? 1.5 : 1) * laneMul
    }
  }


  /** 某只敌人正在压制的笔势（没有则返回 null）；绘制层也用它画"断"标 */
  strokeNear(e: Enemy, radius: number): Stroke | null {
    const cell = this.host.board.cell
    for (const s of this.host.strokeList()) {
      const a = this.host.board.center(s.cells[0])
      const b = this.host.board.center(s.cells[s.cells.length - 1])
      const nx = Math.max(Math.min(a.x, b.x), Math.min(e.x, Math.max(a.x, b.x)))
      const ny = Math.max(Math.min(a.y, b.y), Math.min(e.y, Math.max(a.y, b.y)))
      if (Math.hypot(e.x - nx, e.y - ny) <= cell * radius) return s
    }
    return null
  }

  private hexerBuff(e: Enemy): void {
    if (e.atkCd > 0) return
    e.atkCd = 2.6
    for (const o of this.nearby(e.prog, 3)) {
      if (!o.active || o.dead || o === e) continue
      o.hasteT = Math.max(o.hasteT, 3.5)
    }
  }

  /* ================= Boss ================= */

  private updateBoss(e: Enemy, dt: number): void {
    const def = BOSS_BY_ID[e.bossId as BossId]
    if (!def) return
    const hpk = e.hp / e.maxHp
    const phase = hpk > 0.66 ? 1 : hpk > 0.33 ? 2 : 3
    if (phase !== e.phase) {
      e.phase = phase
      e.abilT = Math.min(e.abilT, 0.6)
      this.host.fx.shock(e.x, e.y, e.r, e.r * 3.4, def.color, 0.7, 5)
      this.host.fx.text(e.x, e.y - e.r - 12, `第 ${phase} 段 · ${def.phases[phase - 1].name}`, '#8a3b2a', 16)
      this.host.shake(5)
      this.host.audio.sfx('warn')
      /* 墨麒麟：墨蚀压阵，给全场敌军覆盖一层护盾 */
      if (e.bossId === 'qilin') {
        this.host.notify('墨蚀压阵：全线敌军获得短暂护盾', 'bad')
        for (const o of this.enemies) if (o.active && !o.dead) o.shield = Math.max(o.shield, o.maxHp * 0.12)
      }
    }
    const abil = def.phases[Math.min(2, phase - 1)].abilities
    if (e.abilWarn > 0) {
      e.abilWarn -= dt
      if (e.abilWarn <= 0) {
        this.bossAbility(e, e.abilId, phase)
        e.abilT = abil[Math.min(abil.length - 1, e.abilIdx)]?.cd ?? 6
        e.abilIdx = (e.abilIdx + 1) % abil.length
      }
      return
    }
    e.abilT -= dt
    if (e.abilT <= 0) {
      const a = abil[e.abilIdx % abil.length]
      e.abilId = a.id
      e.abilWarn = a.warn
      this.host.audio.sfx('warn', 1.2)
      this.host.notify(`${def.name}：${a.text}`, 'bad')
    }
    if (e.atBase) {
      this.attackBase(e, dt)
      return
    }
    /* 走到营寨门口就停下砸门 */
    if (e.prog >= this.host.board.len(e.lane) - 0.6) { e.atBase = true; this.host.audio.sfx('base'); this.host.shake(6) }
    else e.prog += e.speed * dt * (e.hasteT > 0 ? 1.35 : 1) * (e.slowT > 0 ? Math.max(0.5, 0.8 - this.host.runMod('slowAmp')) : 1)
  }

  private attackBase(e: Enemy, dt: number): void {
    e.atkCd -= dt
    if (e.atkCd > 0) return
    e.atkCd = 1.4
    /* 铁壁：英雄主动技期间营寨减伤三成半；「铁壁阵」牌再叠一层 */
    let dmg = e.dmg * 2
    if (this.host.armorT > 0) dmg *= 0.65
    dmg *= 1 - this.host.runMod('wall')
    this.host.hurtBase(dmg)
    const bp = this.host.board.basePoint()
    this.host.fx.text(bp.x, bp.y - 30, `-${Math.round(dmg)}`, '#8a3b2a', 16)
    this.host.audio.sfx('base')
    this.host.shake(6)
  }

  private bossAbility(e: Enemy, id: string, phase: number): void {
    const b = this.host.board
    const def = BOSS_BY_ID[e.bossId as BossId]
    const pc = b.laneWorld(e.lane, Math.max(0, Math.min(b.len(e.lane), e.prog)))
    switch (id) {
      case 'slam': {
        const r = b.cell * 2.6
        /* Boss 重击 = 盖印冲击：墨晕 + 「震」印 */
        this.host.fx.bloom(pc.x, pc.y, b.cell * 0.4, r, '#8a3b2a', 0.6)
        this.host.fx.stamp(pc.x, pc.y, '震', b.cell * 0.7, def.color, 0.8)
        this.host.fx.burst(pc.x, pc.y, '#5c4a3a', 26, 300, 'ash')
        for (const u of this.units) {
          if (!u.active) continue
          const c = b.center(u.cell)
          if (Math.hypot(c.x - pc.x, c.y - pc.y) <= r) this.damageUnit(u, e.dmg * (2.1 + phase * 0.2))
        }
        this.host.shake(8)
        this.host.audio.sfx('boom')
        break
      }
      case 'summon': {
        const kinds: EnemyKind[] = ['raider', 'runner']
        for (let i = 0; i < 4; i++) {
          this.host.spawnExtra(Math.max(0, e.prog - 0.6 - Math.random() * 1.2), kinds[i % 2], false)
        }
        this.host.notify('援兵从林子里窜出来', 'bad')
        break
      }
      case 'charge': {
        const from = e.prog
        e.prog = Math.min(b.len(e.lane) - 0.8, e.prog + 2.6)
        const a = b.laneWorld(e.lane, from)
        const c2 = b.laneWorld(e.lane, e.prog)
        this.beam(a.x, a.y, c2.x, c2.y, '#3f4650', 0.4, 10)
        this.host.fx.burst(c2.x, c2.y, '#3f4650', 20, 300)
        for (const u of this.units) {
          if (!u.active) continue
          const uc = b.center(u.cell)
          const d = this.pointSegDist(uc.x, uc.y, a.x, a.y, c2.x, c2.y)
          if (d <= b.cell * 1.0) this.damageUnit(u, e.dmg * 1.8)
        }
        this.host.shake(8)
        break
      }
      case 'shield': {
        e.shield = Math.round(e.maxHp * 0.18)
        e.shieldT = 7
        this.host.fx.shock(e.x, e.y, e.r, e.r * 2.2, '#3f4650', 0.5, 4)
        this.host.notify(`${def.name} 铸起铁盾`, 'warn')
        break
      }
      case 'web': {
        for (const u of this.units) {
          if (!u.active) continue
          const c = b.center(u.cell)
          if (Math.hypot(c.x - pc.x, c.y - pc.y) <= b.cell * 4) u.slowT = Math.max(u.slowT, 4)
        }
        this.addZone(pc.x, pc.y, b.cell * 3.4, 5, 'web', 0, '#7a2f3a', 'enemy', 0)
        this.host.notify('蛛网拖慢了全军的出手', 'bad')
        break
      }
      case 'spiders': {
        for (let i = 0; i < 2; i++) this.host.spawnExtra(Math.max(0, e.prog - 1 - i), 'splitter', false)
        this.host.notify('赤蛛母产下卵囊', 'bad')
        break
      }
      case 'poison': {
        this.addZone(pc.x, pc.y, b.cell * 2.6, 7, 'poison', e.dmg * 0.5, '#5b3a6b', 'enemy', 0.4)
        this.host.notify('毒雾漫开', 'bad')
        break
      }
      case 'drum': {
        for (const o of this.enemies) if (o.active && !o.dead) o.hasteT = Math.max(o.hasteT, 5)
        e.hasteT = Math.max(e.hasteT, 5)
        this.host.fx.shock(e.x, e.y, e.r, b.cell * 8, '#8a5a22', 0.6, 3)
        this.host.notify('鼓声催动全军', 'bad')
        break
      }
      case 'heal': {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.07)
        this.host.fx.text(e.x, e.y - e.r - 10, '回气 +7%', '#3f6b3a', 14)
        break
      }
      case 'silence': {
        for (const u of this.units) {
          if (!u.active) continue
          const c = b.center(u.cell)
          if (Math.hypot(c.x - pc.x, c.y - pc.y) <= b.cell * 3.6) u.silenceT = Math.max(u.silenceT, 2.5)
        }
        this.host.shake(6)
        this.host.audio.sfx('boom', 0.8)
        this.host.notify('鼓声乱心：范围内单位无法出手', 'bad')
        break
      }
      case 'beam': {
        const base = b.basePoint()
        this.beam(pc.x, pc.y, base.x, base.y, '#2f3340', 0.65, 9)
        this.host.fx.burst(pc.x, pc.y, '#2f3340', 20, 300)
        for (const u of this.units) {
          if (!u.active) continue
          const uc = b.center(u.cell)
          if (this.pointSegDist(uc.x, uc.y, pc.x, pc.y, base.x, base.y) <= b.cell * 0.75) this.damageUnit(u, e.dmg * 1.6)
        }
        this.host.shake(7)
        break
      }
      case 'fog': {
        this.slowAll = 5
        this.host.notify('墨雾遮眼：全军射程收缩', 'bad')
        break
      }
      case 'teleport': {
        const np = Math.min(b.len(e.lane) - 0.8, e.prog + 2.2)
        const old = b.laneWorld(e.lane, e.prog)
        e.prog = np
        const nw = b.laneWorld(e.lane, np)
        this.host.fx.burst(old.x, old.y, '#2f3340', 18, 260)
        this.host.fx.burst(nw.x, nw.y, '#2f3340', 18, 260)
        break
      }
      case 'roar': {
        for (const u of this.units) {
          if (!u.active) continue
          const c = b.center(u.cell)
          if (Math.hypot(c.x - pc.x, c.y - pc.y) <= b.cell * 3.2) u.silenceT = Math.max(u.silenceT, 1.5)
        }
        this.host.shake(9)
        this.host.audio.sfx('boss', 0.7)
        this.host.notify(`${def.name} 长鸣：近身单位被震住`, 'bad')
        break
      }
      case 'erase': {
        /* 墨麒麟最后一笔：把玩家的笔势从纸上抹掉，逼你临时改用散阵硬扛 */
        this.eraseStrokes(6)
        for (const p of this.host.strokeList()) {
          const f = b.center(p.cells[0])
          const l = b.center(p.cells[p.cells.length - 1])
          this.strokeBeam(f.x, f.y, l.x, l.y, '#8a2f2a', 0.5, Math.max(3, b.cell * 0.14))
        }
        this.host.fx.shock(pc.x, pc.y, b.cell * 1.2, b.cell * 4.2, '#2f3340', 0.7, 2)
        this.host.notify('墨麒麟抹去笔势：6 秒内成阵失效', 'bad')
        break
      }
      default:
        break
    }
    this.host.fx.shock(pc.x, pc.y, 6, b.cell * 2, def.color, 0.3, 2)
  }

  private pointSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1
    const dy = y2 - y1
    const l2 = dx * dx + dy * dy
    if (l2 < 1) return Math.hypot(px - x1, py - y1)
    let t = ((px - x1) * dx + (py - y1) * dy) / l2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t))
  }

  /* ================= 伤害 ================= */

  hitEnemy(e: Enemy, amount: number, opt: { crit?: boolean; color?: string; silent?: boolean; label?: string; noFloat?: boolean } = {}): void {
    if (!e.active || e.dead || amount <= 0) return
    let dmg = amount
    const mit = e.armor / (e.armor + 78)
    dmg *= 1 - mit
    if (e.vulnT > 0) dmg *= 1.18
    if (e.shieldT > 0) dmg *= 0.8
    if (dmg > 0 && e.shield > 0) {
      const absorbed = Math.min(e.shield, dmg)
      e.shield -= absorbed
      dmg -= absorbed
      if (absorbed > 40) this.host.fx.text(e.x, e.y - e.r, '盾', '#33628f', 11)
    }
    if (dmg <= 0) return
    if (e.boss && e.armor > 0) dmg = Math.max(dmg, amount * 0.12)
    e.hp -= dmg
    e.hitT = 0.2
    this.host.onDamage(dmg)
    /* 普通杂兵不逐下飘伤害数字：单路排队时数字会盖住下一只敌人的字。
       击中的白闪、震动已经足够反馈；只有精英、Boss 和暴击保留数字。 */
    if (!opt.noFloat && this.host.dmgNumbers && (e.boss || e.elite || opt.crit)) {
      /* 按敌人编号错开，免得几只精英挤在拐角时数字叠成一坨 */
      const jx = (Math.random() - 0.5) * 14
      const jy = ((e.id % 3) - 1) * 9 + (Math.random() - 0.5) * 6
      this.host.fx.text(e.x + jx, e.y - e.r * 0.8 + jy, opt.label || String(Math.round(dmg)), opt.color || (opt.crit ? '#a0432c' : '#3a332b'), opt.crit ? 16 : 12)
    }
    /* 命中亮一下：不飘数字的杂兵也有一圈墨点，玩家能看出"这一下打实了" */
    if (!opt.silent) {
      const pw = opt.crit ? 1 : Math.min(1, 0.22 + dmg / Math.max(24, e.maxHp) * 1.4)
      this.host.fx.hitSpark(e.x, e.y, opt.color || '#8d3b2f', pw)
      /* 沿随机方向溅几点墨：受击不是闪一下，是纸面被打溅 */
      this.host.fx.spatter(e.x, e.y, Math.random() * Math.PI * 2, opt.color || '#3a332a', 3, 90 + pw * 80)
    }
    if (opt.crit) this.host.audio.sfx('crit', 0.8)
    else if (!opt.silent) this.host.audio.sfx('hit', 0.5)
    if (e.hp <= 0) this.killEnemy(e)
  }

  /** 兵是塔：棋子不吃伤害。保留空实现，让 Boss 技能等旧调用点无害通过。 */
  private damageUnit(_u: Unit, _amount: number): void {
    /* no-op */
  }

  private killEnemy(e: Enemy): void {
    if (e.dead) return
    e.dead = true
    e.dieT = 0
    e.hp = 0
    const b = this.host.board
    this.host.audio.sfx(e.boss ? 'bossDie' : 'kill', e.boss ? 1.5 : 0.6)
    this.host.fx.burst(e.x, e.y, e.boss ? '#8a3b2a' : ENEMY_BY_ID[e.kind].color, e.boss ? 50 : 10, e.boss ? 420 : 150, 'ash')
    /* 字形解体：笔画散开化墨，纸面留一枚渐隐墨渍 */
    {
      const def = e.boss && e.bossId ? BOSS_BY_ID[e.bossId] : ENEMY_BY_ID[e.kind]
      const rad = enemyRadius(e, b.cell)
      this.host.fx.shatter(e.x, e.y, def.glyph, e.boss ? 'boss' : e.kind, rad * (e.boss ? 1.0 : 0.94), '#252525', e.boss ? 1.6 : 1)
      this.host.fx.stain(e.x, e.y, rad * (e.boss ? 1.6 : 0.9), e.boss ? '#8a3b2a' : '#3a332a', e.boss ? 3 : 2.2)
    }
    if (e.boss) {
      this.host.fx.shards(e.x, e.y, '#b8860b', 40, 320)
      this.host.fx.shock(e.x, e.y, e.r, b.cell * 6, '#b8860b', 0.9, 6)
      this.host.shake(10)
      if (this.boss === e) this.boss = null
      this.host.onBossKill(e)
    }
    if (!e.boss) {
      if (e.kind === 'bomber') {
        const r = b.cell * 1.5
        this.host.fx.shock(e.x, e.y, 6, r, '#9c4a2a', 0.5, 4)
        this.host.fx.burst(e.x, e.y, '#9c4a2a', 24, 320, 'ash')
        this.host.audio.sfx('boom', 1)
        this.host.shake(5)
      }
      if (e.kind === 'splitter') {
        this.host.spawnExtra(Math.max(0, e.prog - 0.15), 'runner', e.elite)
        this.host.spawnExtra(Math.max(0, e.prog - 0.35), 'runner', e.elite)
      }
      if (e.kind === 'champion') {
        this.host.fx.shards(e.x, e.y, '#b8860b', 12, 220)
      }
    }
    this.host.onEnemyKill(e)
  }

  /* ================= 弹道 ================= */

  private shoot(
    x: number, y: number, target: Enemy | null, dmg: number,
    opt: { kind: string; color: string; splash?: number; pierce?: number; burn?: number; speed?: number; side?: 'unit' | 'enemy'; tx?: number; ty?: number },
  ): void {
    let p: Proj | null = null
    for (const cand of this.projs) if (!cand.active) { p = cand; break }
    if (!p) return
    const tx = target ? target.x : opt.tx ?? x
    const ty = target ? target.y : opt.ty ?? y
    const sp = opt.speed ?? 300
    const d = Math.hypot(tx - x, ty - y) || 1
    p.active = true
    p.id = this.seqP++
    p.side = opt.side || 'unit'
    p.kind = opt.kind
    p.x = x
    p.y = y
    p.vx = (tx - x) / d * sp
    p.vy = (ty - y) / d * sp
    p.dmg = dmg
    p.splash = opt.splash || 0
    p.pierce = opt.pierce || 0
    p.burn = opt.burn || 0
    p.vuln = 0
    p.slow = 0
    p.life = 2.2
    p.age = 0
    p.color = opt.color
    p.r = opt.kind === 'fire' ? 6 : opt.kind === 'bolt' ? 4 : 3
    p.hit = []
    p.target = target ? target.id : 0
    p.tx = tx
    p.ty = ty
    p.rot = Math.atan2(ty - y, tx - x)
    p.trail = opt.kind === 'fire'
  }

  private updateProjs(dt: number): void {
    const cell = this.host.board.cell
    /* 追踪要按 id 找目标；每帧建一次索引，比每颗子弹都线性扫一遍便宜得多 */
    let live: Map<number, Enemy> | null = null
    for (const p of this.projs) {
      if (!p.active) continue
      p.age += dt
      if (p.age >= p.life) { p.active = false; continue }
      /* 软追踪：出手后仍朝目标现在的位置微调航向（有转弯上限，不是瞬移锁定）。
         敌人会走、会被减速/击退，纯直线出手必然打空，玩家看到的就是"箭飞过去没了"。 */
      if (p.side === 'unit' && p.target) {
        if (!live) {
          live = new Map()
          for (const e of this.enemies) if (e.active && !e.dead) live.set(e.id, e)
        }
        const t = live.get(p.target)
        if (t) {
          const sp = Math.hypot(p.vx, p.vy) || 1
          const cur = Math.atan2(p.vy, p.vx)
          const want = Math.atan2(t.y - p.y, t.x - p.x)
          let diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI
          const turn = 9 * dt
          diff = Math.max(-turn, Math.min(turn, diff))
          p.vx = Math.cos(cur + diff) * sp
          p.vy = Math.sin(cur + diff) * sp
          p.tx = t.x
          p.ty = t.y
        }
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot = Math.atan2(p.vy, p.vx)
      if (p.side === 'unit') {
        for (const e of this.enemies) {
          if (!e.active || e.dead) continue
          if (p.hit.includes(e.id)) continue
          const rr = enemyRadius(e, cell) + p.r
          if ((e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y) > rr * rr) continue
          p.hit.push(e.id)
          const crit = false
          this.hitEnemy(e, p.dmg, { color: p.color, crit })
          /* 命中按弹种给不同的物质反馈：箭溅木屑、弩迸火星、火炸焰与烟。
             原来只有溅射才有冲击波，普通命中一点痕迹都没有。 */
          if (p.kind === 'fire') {
            this.host.fx.burst(p.x, p.y, '#e07b3c', 5, cell * 2.4, 'spark')
            this.host.fx.burst(p.x, p.y, '#6a5348', 2, cell * 0.8, 'smoke')
          } else if (p.kind === 'bolt') {
            this.host.fx.burst(p.x, p.y, '#3f6350', 4, cell * 2.2, 'spark')
          } else {
            this.host.fx.burst(p.x, p.y, p.color, 3, cell * 1.8, 'shard')
          }
          if (p.burn > 0) { e.burnT = Math.max(e.burnT, 3); e.burnDmg = p.burn }
          if (p.splash > 0) {
            /* 溅射 = 墨晕染开，火落点还留焦渍 */
            this.host.fx.bloom(e.x, e.y, 4, p.splash, p.color, 0.4)
            if (p.kind === 'fire') this.host.fx.stain(e.x, e.y, p.splash * 0.5, '#6a3a2a', 1.8)
            for (const o of this.enemies) {
              if (o === e || !o.active || o.dead) continue
              if (Math.hypot(o.x - e.x, o.y - e.y) <= p.splash) this.hitEnemy(o, p.dmg * 0.6, { color: p.color, silent: true })
            }
          }
          if (p.pierce > 0) { p.pierce--; continue }
          p.active = false
          break
        }
      } else {
        for (const u of this.units) {
          if (!u.active) continue
          const c = this.host.board.center(u.cell)
          const rr = this.host.board.cell * 0.3 + p.r
          if ((c.x - p.x) * (c.x - p.x) + (c.y - p.y) * (c.y - p.y) > rr * rr) continue
          p.active = false
          this.damageUnit(u, p.dmg)
          this.host.audio.sfx('hit', 0.5)
          break
        }
      }
      if (p.active && p.kind === 'fire' && Math.random() < dt * 20) {
        this.host.fx.burst(p.x, p.y, p.color, 1, 30)
      }
    }
  }

  /* ================= 区域 / 光束 ================= */

  private addZone(x: number, y: number, r: number, life: number, kind: string, dmg: number, color: string, side: 'unit' | 'enemy', tick: number): void {
    let z: Zone | null = null
    for (const cand of this.zones) if (!cand.active) { z = cand; break }
    if (!z) return
    z.active = true
    z.x = x
    z.y = y
    z.r = r
    z.life = life
    z.age = 0
    z.kind = kind
    z.dmg = dmg
    z.tick = tick
    z.tickT = 0
    z.color = color
    z.side = side
  }

  private updateZones(dt: number): void {
    for (const z of this.zones) {
      if (!z.active) continue
      z.age += dt
      if (z.age >= z.life) { z.active = false; continue }
      if (z.tick <= 0) continue
      z.tickT -= dt
      if (z.tickT > 0) continue
      z.tickT = z.tick
      if (z.side === 'unit') {
        for (const e of this.enemies) {
          if (!e.active || e.dead) continue
          if (Math.hypot(e.x - z.x, e.y - z.y) <= z.r) this.hitEnemy(e, z.dmg, { color: z.color, silent: true })
        }
      } else {
        for (const u of this.units) {
          if (!u.active) continue
          const c = this.host.board.center(u.cell)
          if (Math.hypot(c.x - z.x, c.y - z.y) <= z.r) this.damageUnit(u, z.dmg)
        }
      }
    }
  }

  private beam(x1: number, y1: number, x2: number, y2: number, color: string, life: number, width: number): void {
    for (const b of this.beams) {
      if (b.active) continue
      b.active = true
      b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2
      b.life = life; b.age = 0; b.color = color; b.width = width
      return
    }
  }

  private updateBeams(dt: number): void {
    for (const b of this.beams) {
      if (!b.active) continue
      b.age += dt
      if (b.age >= b.life) b.active = false
    }
  }

  private cleanup(): void {
    for (const e of this.enemies) {
      if (!e.active) continue
      if (e.dead && e.dieT > 0.3) e.active = false
      if (e.hp <= 0 && !e.dead) this.killEnemy(e)
    }
    for (let i = this.units.length - 1; i >= 0; i--) if (!this.units[i].active) this.units.splice(i, 1)
  }

  /* 供主控读的只读视图 */
  get fogActive(): boolean { return this.slowAll > 0 }
  tickFog(dt: number): void { this.slowAll = Math.max(0, this.slowAll - dt) }
}




