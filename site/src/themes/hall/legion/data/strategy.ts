/* 第三版策略层：三级专精 + 方格棋盘上的 Roguelike 构筑。
 *
 * 所有条目都必须落到战斗判定；不做“只改说明文字”的牌。
 */
import type { UnitKind } from '../types'

export interface BranchDef {
  name: string
  glyph: string
  desc: string
  /** 一句战场上的实际效果，用于选中面板 */
  effect: string
}

export const BRANCHES: Record<UnitKind, { a: BranchDef; b: BranchDef }> = {
  spear: {
    a: { name: '穿云', glyph: '穿', desc: '沿直线穿透更多目标', effect: '一枪最多穿 4 人，正对中央土路时覆盖整列' },
    b: { name: '拒马', glyph: '拒', desc: '刺中即减速推回', effect: '命中的敌人减速 0.8 秒并被推回 0.12 格' },
  },
  bow: {
    a: { name: '连射', glyph: '连', desc: '出手更快，同时射两个', effect: '攻速 +35%，三级起一次两箭' },
    b: { name: '贯甲', glyph: '贯', desc: '重箭穿甲', effect: '伤害 +18%，箭矢可贯穿 2 名敌人' },
  },
  cavalry: {
    a: { name: '突骑', glyph: '突', desc: '冲锋撞更多目标', effect: '冲锋多撞 1 名敌人' },
    b: { name: '游骑', glyph: '游', desc: '回马再冲', effect: '伤害 +20%，击退更远，适合反复切割' },
  },
  engineer: {
    a: { name: '机关', glyph: '机', desc: '陷阱更密', effect: '陷阱冷却缩短，五级时每次触发双发' },
    b: { name: '军械', glyph: '械', desc: '给相邻友军上械', effect: '自身设施伤害 +15%，相邻友军共享军械加成' },
  },
  mage: {
    a: { name: '烈焰', glyph: '焰', desc: '火球溅射更宽', effect: '爆炸范围 +0.55 格，火焰伤害 +18%' },
    b: { name: '陨星', glyph: '陨', desc: '周期落星', effect: '周期砸下陨星，造成范围灼烧' },
  },
  warlock: {
    a: { name: '咒缚', glyph: '缚', desc: '控制更久', effect: '三级起范围命中即定身 0.7 秒' },
    b: { name: '蚀魂', glyph: '蚀', desc: '削弱与伤害并重', effect: '范围伤害 +25%，易伤延长到 4 秒' },
  },
  blade: {
    a: { name: '疾风', glyph: '疾', desc: '连斩', effect: '攻速 +15%，横扫更频繁' },
    b: { name: '重斩', glyph: '重', desc: '单体重击', effect: '暴击伤害 +35%' },
  },
  lance: {
    a: { name: '破阵', glyph: '破', desc: '撞穿更厚', effect: '冲锋多贯穿 1 名敌人' },
    b: { name: '回马', glyph: '回', desc: '冲完再压', effect: '冲锋伤害 +20%，击退更远' },
  },
  halberd: {
    a: { name: '横戟', glyph: '横', desc: '扫得更开', effect: '直线命中 +1，横扫再劈 1 人' },
    b: { name: '破甲', glyph: '甲', desc: '一戟破防', effect: '暴击伤害 +35%' },
  },
  pyro: {
    a: { name: '爆焰', glyph: '爆', desc: '火团更大', effect: '溅射 +0.4 格' },
    b: { name: '连焰', glyph: '连', desc: '火不熄灭', effect: '灼烧伤害 +35%，持续更久' },
  },
}

export function branchOf(kind: UnitKind, path: number): BranchDef | null {
  const pair = BRANCHES[kind]
  if (!pair) return null
  return path === 0 ? pair.a : path === 1 ? pair.b : null
}

export interface RunCardDef {
  id: string
  name: string
  glyph: string
  tag: string
  desc: string
  /** 叠层上限 */
  max: number
  mod: Record<string, number>
}

/** 三选一战术牌：全部改判定/范围/连锁，不做纯数值堆叠。 */
export const RUN_CARDS: RunCardDef[] = [
  {
    id: 'kite', name: '纸鸢阵', glyph: '鸢', tag: '弓阵', max: 3,
    desc: '弓兵射程 +0.8 格，隔着棋盘也能更早开火。',
    mod: { bowRange: 0.8 },
  },
  {
    id: 'wall', name: '铁壁阵', glyph: '壁', tag: '营寨', max: 3,
    desc: '营寨加固：敌军砸门伤害 -12%。',
    mod: { wall: 0.12 },
  },
  {
    id: 'fire', name: '火攻策', glyph: '火', tag: '火焰', max: 3,
    desc: '法师、术士火焰伤害 +20%，点燃更长。',
    mod: { flameDmg: 0.2 },
  },
  {
    id: 'chain', name: '连环计', glyph: '链', tag: '控制', max: 3,
    desc: '被定身/减速的敌人，会把负面状态传给最近的同伴。',
    mod: { chain: 1 },
  },
  {
    id: 'raid', name: '奇袭令', glyph: '袭', tag: '骑兵', max: 3,
    desc: '骑兵冲锋后 1.2 秒内再冲一次；撞阵伤害 +25%。',
    mod: { raid: 1, chargeDmg: 0.25 },
  },
  {
    id: 'thorn', name: '绊马索', glyph: '绊', tag: '控制', max: 2,
    desc: '已被减速的敌人再减速 25%。',
    mod: { slowAmp: 0.25 },
  },
  {
    id: 'gear', name: '机关术', glyph: '关', tag: '工程', max: 3,
    desc: '陷阱触发后向周围连锁，工程师设施射程 +1 格。',
    mod: { trapChain: 1, gearRange: 1 },
  },
  {
    id: 'spearwall', name: '枪林', glyph: '林', tag: '枪阵', max: 3,
    desc: '刀兵与枪兵相邻时，枪兵穿透 +1 目标，双方攻速 +12%。',
    mod: { spearLine: 1 },
  },
  {
    id: 'drill', name: '练兵令', glyph: '练', tag: '合成', max: 2,
    desc: '合成后新单位立即获得 15% 攻速，持续 8 秒；合成返还 10 粮。',
    mod: { mergeHaste: 0.15, mergeGrain: 10 },
  },
  {
    id: 'paperarmor', name: '落锋符', glyph: '锋', tag: '通用', max: 2,
    desc: '全体友军攻击 +8%，笔锋更利。',
    mod: { steel: 0.08 },
  },
]

export const RUN_BY_ID: Record<string, RunCardDef> = Object.fromEntries(RUN_CARDS.map((c) => [c.id, c]))
