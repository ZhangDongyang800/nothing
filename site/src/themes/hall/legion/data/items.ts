/* 道具、局内强化、里程碑、成就、存档外的成长曲线。 */
import type { AchievementDef, InGameUpDef, ItemDef, MetaDef, MilestoneDef } from '../types'

export const ITEM_DEFS: ItemDef[] = [
  { id: 'draft', name: '征兵令', glyph: '征', desc: '立刻免费招募一名随机兵种到预备兵营', rarity: 'fine', price: 18, target: null, color: '#3f6b3a' },
  { id: 'reroll', name: '重置令', glyph: '易', desc: '免费刷新三张招募栏', rarity: 'common', price: 12, target: null, color: '#6b6255' },
  { id: 'salve', name: '治疗药', glyph: '药', desc: '基地恢复 25% 最大生命', rarity: 'common', price: 24, target: null, color: '#3f6b3a' },
  { id: 'fury', name: '狂战令', glyph: '狂', desc: '12 秒内全军攻速 +80%', rarity: 'rare', price: 30, target: null, color: '#a0432c' },
  { id: 'freeze', name: '定身符', glyph: '定', desc: '全场敌人定住 3 秒', rarity: 'rare', price: 34, target: null, color: '#33628f' },
  { id: 'spade', name: '扩地铲', glyph: '扩', desc: '免费解锁一个棋盘格', rarity: 'rare', price: 32, target: null, color: '#5d6b3a' },
  { id: 'levelup', name: '升级符', glyph: '升', desc: '点选一个单位，直接升一级（五级封顶）', rarity: 'epic', price: 58, target: 'unit', color: '#6b4a8f' },
  { id: 'cannon', name: '炮击令', glyph: '炮', desc: '点选山道，对 1.6 格范围造成 320 伤害', rarity: 'epic', price: 44, target: 'board', color: '#8a3b2a' },
]

export const ITEM_BY_ID: Record<string, ItemDef> = ITEM_DEFS.reduce((m, i) => {
  m[i.id] = i
  return m
}, {} as Record<string, ItemDef>)

export const INGAME_UPS: InGameUpDef[] = [
  { id: 'atk', name: '兵锋', glyph: '锋', desc: '全军攻击 +7%', max: 12, price: (lv) => 16 + lv * 18 },
  { id: 'spd', name: '疾攻', glyph: '疾', desc: '全军攻速 +6%', max: 12, price: (lv) => 16 + lv * 18 },
  { id: 'crit', name: '锐气', glyph: '锐', desc: '暴击率 +4%，暴伤 +5%', max: 8, price: (lv) => 22 + lv * 20 },
  { id: 'baseHp', name: '城防', glyph: '城', desc: '基地最大生命 +6%', max: 10, price: (lv) => 24 + lv * 22 },
  { id: 'baseArmor', name: '甲胄', glyph: '甲', desc: '基地减伤 +5%', max: 8, price: (lv) => 20 + lv * 20 },
  { id: 'luck', name: '招募幸运', sub: '招贤', glyph: '贤', desc: '招募幸运 +4', max: 8, price: (lv) => 20 + lv * 16 },
  { id: 'grain', name: '屯田', glyph: '田', desc: '军粮收益 +8%', max: 8, price: (lv) => 18 + lv * 16 },
  { id: 'merge', name: '合成返还', sub: '炼兵', glyph: '炼', desc: '合成返还军粮 +30%', max: 6, price: (lv) => 26 + lv * 24 },
  { id: 'regen', name: '休整', glyph: '息', desc: '单位每秒回血 +0.6%', max: 6, price: (lv) => 24 + lv * 22 },
]

export const INGAME_UP_BY_ID: Record<string, InGameUpDef> = INGAME_UPS.reduce((m, u) => {
  m[u.id] = u
  return m
}, {} as Record<string, InGameUpDef>)

export const META_UPS: MetaDef[] = [
  { id: 'atk', name: '兵锋', glyph: '锋', desc: (lv) => `全军攻击 +${lv * 4}%`, max: 10, gold: (lv) => Math.round(40 * Math.pow(1.42, lv)), mat: (lv) => Math.round(10 * Math.pow(1.4, lv)) },
  { id: 'spd', name: '疾攻', glyph: '疾', desc: (lv) => `全军攻速 +${lv * 3}%`, max: 10, gold: (lv) => Math.round(40 * Math.pow(1.42, lv)), mat: (lv) => Math.round(10 * Math.pow(1.4, lv)) },
  { id: 'baseHp', name: '城防', glyph: '城', desc: (lv) => `基地生命 +${lv * 6}%`, max: 10, gold: (lv) => Math.round(34 * Math.pow(1.4, lv)), mat: (lv) => Math.round(8 * Math.pow(1.38, lv)) },
  { id: 'luck', name: '招募幸运', sub: '天佑', glyph: '佑', desc: (lv) => `招募幸运 +${lv * 3}`, max: 8, gold: (lv) => Math.round(46 * Math.pow(1.5, lv)), mat: (lv) => Math.round(12 * Math.pow(1.45, lv)) },
  { id: 'grain', name: '屯田', glyph: '田', desc: (lv) => `军粮收益 +${lv * 5}%`, max: 10, gold: (lv) => Math.round(32 * Math.pow(1.4, lv)), mat: (lv) => Math.round(8 * Math.pow(1.38, lv)) },
  { id: 'silver', name: '银币收益', sub: '商路', glyph: '商', desc: (lv) => `银币收益 +${lv * 5}%`, max: 10, gold: (lv) => Math.round(32 * Math.pow(1.4, lv)), mat: (lv) => Math.round(8 * Math.pow(1.38, lv)) },
  { id: 'cells', name: '扩大阵地', sub: '开疆', glyph: '疆', desc: (lv) => `开局部署格 +${lv}`, max: 6, gold: (lv) => Math.round(60 * Math.pow(1.5, lv)), mat: (lv) => Math.round(16 * Math.pow(1.45, lv)) },
  { id: 'grainStart', name: '初始军粮', sub: '仓廪', glyph: '仓', desc: (lv) => `开局军粮 +${lv * 10}`, max: 8, gold: (lv) => Math.round(36 * Math.pow(1.4, lv)), mat: (lv) => Math.round(9 * Math.pow(1.38, lv)) },
  { id: 'bench', name: '兵营扩容', sub: '将台', glyph: '台', desc: (lv) => `预备兵营 +${lv} 格`, max: 4, gold: (lv) => Math.round(80 * Math.pow(1.55, lv)), mat: (lv) => Math.round(20 * Math.pow(1.5, lv)) },
  { id: 'mergeGain', name: '合成返还', sub: '炼兵', glyph: '炼', desc: (lv) => `合成返还 +${lv * 6}%`, max: 6, gold: (lv) => Math.round(48 * Math.pow(1.45, lv)), mat: (lv) => Math.round(12 * Math.pow(1.4, lv)) },
]

export const META_BY_ID: Record<string, MetaDef> = META_UPS.reduce((m, u) => {
  m[u.id] = u
  return m
}, {} as Record<string, MetaDef>)

export const MILESTONES: MilestoneDef[] = [
  { wave: 5, name: '初立营', gold: 30, grain: 20, silver: 14 },
  { wave: 10, name: '破山魈', gold: 60, grain: 30, silver: 22 },
  { wave: 20, name: '守长夜', gold: 110, grain: 46, silver: 34 },
  { wave: 30, name: '镇蛛巢', gold: 170, grain: 64, silver: 50 },
  { wave: 50, name: '退墨兽', gold: 300, grain: 100, silver: 80 },
  { wave: 100, name: '百波不倒', gold: 600, grain: 200, silver: 160 },
  { wave: 200, name: '纸上传奇', gold: 1200, grain: 400, silver: 320 },
]

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first', name: '第一道防线', desc: '守住第 1 波', gold: 20 },
  { id: 'w5', name: '扎下营来', desc: '抵达第 5 波', gold: 40 },
  { id: 'w10', name: '挡下山魈', desc: '抵达第 10 波', gold: 70 },
  { id: 'w20', name: '铁壁长夜', desc: '抵达第 20 波', gold: 120 },
  { id: 'w50', name: '墨兽退散', desc: '抵达第 50 波', gold: 260 },
  { id: 'w100', name: '百波不倒', desc: '抵达第 100 波', gold: 520 },
  { id: 'boss1', name: '斩魈', desc: '击杀山魈王', gold: 60 },
  { id: 'boss5', name: '五兽皆退', desc: '五种 Boss 全部击杀过', gold: 400 },
  { id: 'lv4', name: '校尉成军', desc: '合成出一名四级单位', gold: 50 },
  { id: 'lv5', name: '不动如山', desc: '合成出一名五级单位', gold: 160 },
  { id: 'k300', name: '片甲不留', desc: '单局击杀 300 名敌人', gold: 50 },
  { id: 'k1500', name: '血染山道', desc: '单局击杀 1500 名敌人', gold: 180 },
  { id: 'dmg100k', name: '万军辟易', desc: '单局累计伤害 100,000', gold: 120 },
  { id: 'rich', name: '银库充盈', desc: '单局银币收益 1200', gold: 80 },
  { id: 'many', name: '满盘皆兵', desc: '棋盘上同时有 18 名单位', gold: 100 },
  { id: 'alltypes', name: '八门俱全', desc: '一局内招募齐八种兵种', gold: 140 },
  { id: 'skill20', name: '将令如流', desc: '单局释放 20 次英雄主动技', gold: 90 },
  { id: 'long', name: '长夜不放', desc: '单局生存 20 分钟', gold: 120 },
  { id: 'merge20', name: '炼兵成阵', desc: '单局合成 20 次', gold: 70 },
]

export const ACH_BY_ID: Record<string, AchievementDef> = ACHIEVEMENTS.reduce((m, a) => {
  m[a.id] = a
  return m
}, {} as Record<string, AchievementDef>)

export function stageName(wave: number): string {
  if (wave <= 3) return '初临山道'
  if (wave <= 9) return '流寇叩关'
  if (wave <= 19) return '血染长坡'
  if (wave <= 29) return '铁甲围城'
  if (wave <= 49) return '蛛影满山'
  if (wave <= 79) return '墨雾蔽日'
  if (wave <= 129) return '死地后生'
  return '纸上长夜'
}
