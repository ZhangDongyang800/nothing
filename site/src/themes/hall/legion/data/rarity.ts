/* 品质：一个兵种天生属于一档品质，招募先抽档、再抽兵种。
 *
 * 这样"品质"不是一张贴在卡片上的标签，而是真的决定出场概率与成长潜力：
 * 盾卫永远比术士常见，术士的基础数值与每级加成也更高。
 * 幸运属性只改抽取权重，不改兵种本身的数值。
 */
import type { Rarity, UnitKind } from '../types'

export const RARITY_ORDER: Rarity[] = ['common', 'fine', 'rare', 'epic', 'legend']

export const RARITY_LABEL: Record<Rarity, string> = {
  common: '普通',
  fine: '优秀',
  rare: '稀有',
  epic: '史诗',
  legend: '传说',
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#6b6255',
  fine: '#3f6b3a',
  rare: '#33628f',
  epic: '#6b4a8f',
  legend: '#b8860b',
}

/** 普通招募的基础权重（合计 100） */
const BASE_WEIGHT: Record<Rarity, number> = { common: 52, fine: 26, rare: 14, epic: 6.5, legend: 1.5 }

/** 重金纳贤的基础权重 */
const PREMIUM_WEIGHT: Record<Rarity, number> = { common: 16, fine: 32, rare: 30, epic: 17, legend: 5 }

/** 每个品质档池里的兵种 */
export const RARITY_POOL: Record<Rarity, UnitKind[]> = {
  common: ['blade', 'bow'],
  fine: ['spear', 'engineer'],
  rare: ['mage'],
  epic: ['cavalry'],
  legend: ['warlock'],
}

export function rarityWeights(luck: number, premium: boolean): Record<Rarity, number> {
  const base = premium ? PREMIUM_WEIGHT : BASE_WEIGHT
  const l = Math.max(0, Math.min(60, luck))
  const w: Record<Rarity, number> = { ...base }
  w.rare += l * 0.55
  w.epic += l * 0.34
  w.legend += l * 0.12
  w.common = Math.max(6, w.common - l * 1.01)
  return w
}

export function pickRarity(luck: number, premium: boolean, rand: () => number): Rarity {
  const w = rarityWeights(luck, premium)
  let total = 0
  for (const r of RARITY_ORDER) total += w[r]
  let t = rand() * total
  for (const r of RARITY_ORDER) {
    t -= w[r]
    if (t <= 0) return r
  }
  return 'common'
}

export function pickKind(rarity: Rarity, rand: () => number): UnitKind {
  const pool = RARITY_POOL[rarity]
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]
}

/** 精锐（老兵）：数值 +25%，牌面描金。概率随幸运上升，封顶 40%。 */
export function veteranChance(luck: number): number {
  return Math.min(0.4, 0.05 + Math.max(0, luck) * 0.007)
}
