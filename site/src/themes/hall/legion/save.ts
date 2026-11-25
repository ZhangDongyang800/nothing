/* 存档：localStorage['txxt.legion.v1']。
 *
 * 两条原则：
 *   ① 读坏的、读旧的都不丢玩家东西 —— 认得的字段照搬，认不得的用默认补齐；
 *   ② 局内断点存"能重建的局面"（格子、等级、资源、波次、升级、道具、招贤榜），
 *      不存敌人/弹道；恢复后从该波的准备期重新开始，不会出现半场怪物冻在原地的怪状态。
 */
import type { Checkpoint, HeroId, ItemSlot, RecruitCard, RunUnitSave, UnitKind } from './types'
import { START_UNLOCKED } from './data/units'

export const SAVE_KEY = 'txxt.legion.v1'
export const SAVE_VERSION = 1

export interface Records {
  bestWave: number
  bestTime: number
  bestKills: number
  bestDamage: number
  bestIncome: number
  bestLv: number
  runs: number
  totalKills: number
}

export interface SaveSettings {
  sfx: number
  bgm: number
  quality: 'high' | 'low'
  dmgNumbers: boolean
  shake: boolean
}

export interface SaveData {
  v: number
  gold: number
  mat: number
  frag: number
  units: UnitKind[]
  heroes: HeroId[]
  lastHero: HeroId
  meta: Record<string, number>
  records: Records
  achievements: Record<string, number>
  bossKilled: string[]
  settings: SaveSettings
  checkpoint: Checkpoint | null
  /** 新手引导是否已完成（旧存档缺省视为未完成，向后兼容） */
  tutorialDone?: boolean
}

export function defaultSave(): SaveData {
  return {
    v: SAVE_VERSION,
    gold: 0,
    mat: 0,
    frag: 0,
    units: START_UNLOCKED.slice(),
    heroes: ['qingfeng'],
    lastHero: 'qingfeng',
    meta: {},
    records: { bestWave: 0, bestTime: 0, bestKills: 0, bestDamage: 0, bestIncome: 0, bestLv: 0, runs: 0, totalKills: 0 },
    achievements: {},
    bossKilled: [],
    settings: { sfx: 0.75, bgm: 0.4, quality: 'high', dmgNumbers: true, shake: true },
    checkpoint: null,
    tutorialDone: false,
  }
}

const num = (n: unknown, fb: number): number => (typeof n === 'number' && isFinite(n) ? n : fb)

function sanitize(raw: unknown): SaveData {
  const d = defaultSave()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  d.gold = Math.max(0, num(o.gold, 0))
  d.mat = Math.max(0, num(o.mat, 0))
  d.frag = Math.max(0, num(o.frag, 0))
  if (Array.isArray(o.units)) {
    const ok: UnitKind[] = ['blade', 'spear', 'bow', 'cavalry', 'mage', 'engineer', 'warlock']
    d.units = [...new Set(o.units.filter((x): x is UnitKind => typeof x === 'string' && ok.includes(x as UnitKind)))]
    for (const s of START_UNLOCKED) if (!d.units.includes(s)) d.units.push(s)
  }
  if (Array.isArray(o.heroes)) {
    const ok: HeroId[] = ['qingfeng', 'chiyuan', 'bailu', 'taxue']
    d.heroes = [...new Set(o.heroes.filter((x): x is HeroId => typeof x === 'string' && ok.includes(x as HeroId)))]
    if (!d.heroes.length) d.heroes = ['qingfeng']
  }
  d.lastHero = typeof o.lastHero === 'string' && d.heroes.includes(o.lastHero as HeroId) ? (o.lastHero as HeroId) : d.heroes[0]
  if (o.meta && typeof o.meta === 'object') {
    for (const [k, v] of Object.entries(o.meta as Record<string, unknown>)) {
      if (typeof v === 'number' && v > 0) d.meta[k] = Math.min(99, Math.floor(v))
    }
  }
  const r = o.records as Record<string, unknown> | undefined
  if (r) {
    d.records.bestWave = Math.max(0, num(r.bestWave, 0))
    d.records.bestTime = Math.max(0, num(r.bestTime, 0))
    d.records.bestKills = Math.max(0, num(r.bestKills, 0))
    d.records.bestDamage = Math.max(0, num(r.bestDamage, 0))
    d.records.bestIncome = Math.max(0, num(r.bestIncome, 0))
    d.records.bestLv = Math.max(0, num(r.bestLv, 0))
    d.records.runs = Math.max(0, num(r.runs, 0))
    d.records.totalKills = Math.max(0, num(r.totalKills, 0))
  }
  if (o.achievements && typeof o.achievements === 'object') {
    for (const k of Object.keys(o.achievements as Record<string, unknown>)) d.achievements[k] = 1
  }
  if (Array.isArray(o.bossKilled)) d.bossKilled = o.bossKilled.filter((x): x is string => typeof x === 'string')
  const st = o.settings as Record<string, unknown> | undefined
  if (st) {
    d.settings.sfx = Math.max(0, Math.min(1, num(st.sfx, d.settings.sfx)))
    d.settings.bgm = Math.max(0, Math.min(1, num(st.bgm, d.settings.bgm)))
    d.settings.quality = st.quality === 'low' ? 'low' : 'high'
    d.settings.dmgNumbers = st.dmgNumbers !== false
    d.settings.shake = st.shake !== false
  }
  if (o.checkpoint && typeof o.checkpoint === 'object') {
    const cp = o.checkpoint as Record<string, unknown>
    const units = Array.isArray(cp.units) ? (cp.units as unknown[]).filter(unitOK) as RunUnitSave[] : []
    if (units.length) {
      const bench = Array.isArray(cp.bench) ? (cp.bench as unknown[]).filter(unitOK) as RunUnitSave[] : []
      d.checkpoint = {
        at: num(cp.at, 0),
        wave: Math.max(1, Math.floor(num(cp.wave, 1))),
        elapsed: Math.max(0, num(cp.elapsed, 0)),
        baseHp: Math.max(1, num(cp.baseHp, 1000)),
        baseMax: Math.max(1, num(cp.baseMax, 1000)),
        grain: Math.max(0, num(cp.grain, 0)),
        silver: Math.max(0, num(cp.silver, 0)),
        cells: Math.max(1, Math.floor(num(cp.cells, 8))),
        benchSlots: Math.max(1, Math.floor(num(cp.benchSlots, 4))),
        hero: typeof cp.hero === 'string' ? (cp.hero as HeroId) : 'qingfeng',
        heroDead: !!cp.heroDead,
        units,
        bench,
        ups: (cp.ups && typeof cp.ups === 'object') ? Object.fromEntries(Object.entries(cp.ups as Record<string, unknown>).filter(([, v]) => typeof v === 'number') as [string, number][]) : {},
        items: Array.isArray(cp.items) ? (cp.items as unknown[]).filter((x): x is ItemSlot => !!x && typeof x === 'object' && typeof (x as ItemSlot).id === 'string') : [],
        cards: Array.isArray(cp.cards) ? (cp.cards as unknown[]).filter((x): x is RecruitCard => !!x && typeof x === 'object' && typeof (x as RecruitCard).kind === 'string').slice(0, 3) : [],
        kills: Math.max(0, num(cp.kills, 0)),
        dmg: Math.max(0, num(cp.dmg, 0)),
        income: Math.max(0, num(cp.income, 0)),
        bestLv: Math.max(0, num(cp.bestLv, 0)),
        route: Array.isArray(cp.route) ? (cp.route as unknown[]).filter((x): x is number => typeof x === 'number' && x >= 0 && x < 81).slice(0, 40) : undefined,
      }
    }
  }
  d.v = SAVE_VERSION
  d.tutorialDone = o.tutorialDone === true
  return d
}

function unitOK(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const u = x as RunUnitSave
  const KINDS = new Set(['blade', 'spear', 'bow', 'cavalry', 'mage', 'engineer', 'warlock', 'lance', 'halberd', 'pyro'])
  return typeof u.kind === 'string' && KINDS.has(u.kind) && typeof u.lv === 'number' && typeof u.cell === 'number'
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return defaultSave()
    return sanitize(JSON.parse(raw))
  } catch {
    return defaultSave()
  }
}

export function writeSave(data: SaveData): void {
  try {
    data.v = SAVE_VERSION
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    /* 私隐模式/配额满：这一局照常能打完，只是下次进来从头 */
  }
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY) } catch { /* ignore */ }
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export function fmtNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(Math.round(n))
}
