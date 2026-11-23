/* 八类敌人与波次配方。
 *
 * 难度不是"生命值线性加倍"：每波同时动 生命 / 攻击 / 移速 / 出场密度 / 兵种组合 /
 * 精英概率 六个旋钮，并把新兵种按波次解锁。这样玩家看到的是"阵型被针对"，
 * 而不是"数字涨了但打起来一样"。
 */
import type { BossId, EnemyDef, EnemyKind } from '../types'

export const ENEMY_DEFS: EnemyDef[] = [
  {
    id: 'raider', name: '流寇', glyph: '寇', color: '#5b5446', hp: 58, speed: 0.74, dmg: 20, armor: 2,
    range: 0, cd: 1.1, r: 16, grain: 2, silver: 0.3, cost: 1, role: '普通近战', unlockWave: 1, behavior: 'melee',
  },
  {
    id: 'runner', name: '游骑', glyph: '驰', color: '#7a6a4a', hp: 40, speed: 1.42, dmg: 14, armor: 0,
    range: 0, cd: 1.0, r: 13, grain: 2, silver: 0.3, cost: 1.1, role: '高速', unlockWave: 2, behavior: 'melee',
  },
  {
    id: 'brute', name: '重甲', glyph: '甲', color: '#43494f', hp: 200, speed: 0.5, dmg: 36, armor: 18,
    range: 0, cd: 1.3, r: 23, grain: 5, silver: 1, cost: 3, role: '高生命重型', unlockWave: 4, behavior: 'melee',
  },
  {
    id: 'gunner', name: '弩手', glyph: '弩', color: '#6b5a3a', hp: 62, speed: 0.62, dmg: 17, armor: 2,
    range: 2.8, cd: 1.5, r: 15, grain: 3, silver: 0.8, cost: 2.4, role: '远程', unlockWave: 6, behavior: 'ranged',
  },
  {
    id: 'bomber', name: '火雷兵', glyph: '雷', color: '#9c4a2a', hp: 74, speed: 0.92, dmg: 0, armor: 0,
    range: 0, cd: 1.0, r: 16, grain: 3, silver: 0.6, cost: 2.2, role: '爆炸', unlockWave: 8, behavior: 'bomber',
  },
  {
    id: 'splitter', name: '裂虫', glyph: '裂', color: '#4f6b46', hp: 118, speed: 0.64, dmg: 18, armor: 4,
    range: 0, cd: 1.2, r: 19, grain: 4, silver: 0.6, cost: 2.6, role: '分裂', unlockWave: 11, behavior: 'splitter',
  },
  {
    id: 'hexer', name: '咒师', glyph: '咒', color: '#5b3f6b', hp: 92, speed: 0.56, dmg: 12, armor: 2,
    range: 3.2, cd: 1.8, r: 16, grain: 4, silver: 1.2, cost: 3, role: '特殊技能', unlockWave: 14, behavior: 'hexer',
  },
  {
    id: 'champion', name: '禁卫', glyph: '卫', color: '#7d2f2f', hp: 280, speed: 0.56, dmg: 42, armor: 22,
    range: 1.0, cd: 1.15, r: 25, grain: 9, silver: 2.4, cost: 5, role: '精英', unlockWave: 17, behavior: 'champion',
  },
  {
    id: 'breaker', name: '断笔者', glyph: '断', color: '#8a2f2a', hp: 78, speed: 1.12, dmg: 10, armor: 6,
    range: 0, cd: 1.6, r: 15, grain: 4, silver: 1.1, cost: 2.8, role: '压制笔势', unlockWave: 12, behavior: 'breaker',
  },
]

export const ENEMY_BY_ID: Record<EnemyKind, EnemyDef> = ENEMY_DEFS.reduce((m, e) => {
  m[e.id] = e
  return m
}, {} as Record<EnemyKind, EnemyDef>)

/* 断笔者不进随机池：它是"你成阵我才派"的反制兵，由局内按笔势数量追加，
   这样玩家永远能读懂"为什么今天来了断笔者"，而不是靠运气撞上。 */
export function spawnPool(wave: number): EnemyDef[] {
  return ENEMY_DEFS.filter((e) => e.unlockWave <= wave && e.behavior !== 'breaker')
}

export function hpScale(wave: number): number {
  const w = Math.max(1, wave)
  return 1 + 0.16 * (w - 1) + 0.012 * Math.pow(w - 1, 1.62)
}

export function dmgScale(wave: number): number {
  const w = Math.max(1, wave)
  return 1 + 0.13 * (w - 1) + 0.006 * Math.pow(w - 1, 1.5)
}

export function speedScale(wave: number): number {
  return 1 + Math.min(0.55, Math.max(0, wave - 1) * 0.006)
}

/** 敌人数量的"威胁预算"：到 30 波后不再线性膨胀，改为靠品质与精英率加压。 */
export function waveBudget(wave: number): number {
  const w = Math.max(1, wave)
  return Math.min(190, 3 + w * 2.2 + Math.pow(w, 1.4) * 0.75)
}

export interface SpawnRow { kind: EnemyKind; gap: number; elite: boolean }

export interface WavePlan {
  rows: SpawnRow[]
  boss: BossId | ''
  eliteChance: number
  interval: number
}

/** 每 10 波一个 Boss；Boss 波的小怪预算砍半，留给 Boss 出手空间。 */
export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % 10 === 0
}

export function bossForWave(wave: number): BossId {
  const order: BossId[] = ['shanxiao', 'iron', 'spider', 'drum', 'qilin']
  return order[Math.floor(wave / 10 - 1) % order.length]
}

export function eliteChance(wave: number): number {
  if (wave < 10) return 0
  return Math.min(0.42, 0.08 + (wave - 10) * 0.006)
}

export function wavePlan(wave: number, rand: () => number): WavePlan {
  const boss = isBossWave(wave) ? bossForWave(wave) : ''
  const budget = waveBudget(wave) * (boss ? 0.45 : 1)
  const pool = spawnPool(wave)
  const rows: SpawnRow[] = []
  let spent = 0
  let guard = 0
  while (spent < budget && rows.length < 64 && guard++ < 400) {
    /* 越到后期越偏向"贵"的兵种：前期全是流寇，后期重甲/禁卫占大头 */
    const bias = Math.min(0.85, 0.1 + wave * 0.022)
    let def: EnemyDef
    if (rand() < bias && pool.length > 1) {
      const sorted = pool.slice().sort((a, b) => b.cost - a.cost)
      const i = Math.min(sorted.length - 1, Math.floor(rand() * rand() * sorted.length))
      def = sorted[i]
    } else {
      def = pool[Math.floor(rand() * pool.length)]
    }
    const elite = wave >= 10 && rand() < eliteChance(wave) && def.id !== 'champion'
    rows.push({ kind: def.id, gap: 0, elite })
    spent += def.cost * (elite ? 1.8 : 1)
    if (rows.length > 12 && spent > budget * 0.7 && rand() < 0.35) break
  }
  const interval = Math.max(0.3, Math.min(0.92, 0.92 - wave * 0.012))
  return { rows, boss, eliteChance: eliteChance(wave), interval }
}
