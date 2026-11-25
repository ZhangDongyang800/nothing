/* 五只 Boss：机制各不相同，不是换皮加血。
 *
 * 山魈王逼你分散站位（砸地是范围伤害）；
 * 铁浮屠要你先破盾再谈输出；
 * 赤蛛母会生小蜘蛛、铺蛛网拖慢你的攻速；
 * 鼓妖给全军加速并给自己回血，考验你能否在鼓点里持续压制；
 * 墨麒麟会起雾、封眼、瞬移，逼你把射程与集火重新分配。
 *
 * 每只 Boss 三段（按剩余生命百分比切），三段共用一组技能但冷却/频率不同。
 */
import type { BossDef, BossId } from '../types'

export const BOSS_DEFS: BossDef[] = [
  {
    id: 'shanxiao',
    name: '山魈王',
    title: '第 10 波 · 林魈之主',
    glyph: '魈',
    color: '#5c4a3a',
    hp: 1900,
    speed: 0.42,
    dmg: 46,
    armor: 22,
    r: 40,
    rewardGrain: 40,
    rewardSilver: 24,
    intro: '山魈王踏着枯枝下来了',
    phases: [
      { name: '怒啸', abilities: [{ id: 'slam', cd: 6, warn: 0.9, text: '砸地 · 范围伤害' }, { id: 'summon', cd: 9, warn: 0.6, text: '召唤援兵' }] },
      { name: '裂岩', abilities: [{ id: 'slam', cd: 5, warn: 0.8, text: '砸地 · 范围伤害' }, { id: 'charge', cd: 8, warn: 0.9, text: '冲撞 · 直线伤害并前进' }] },
      { name: '狂魈', abilities: [{ id: 'slam', cd: 4, warn: 0.7, text: '砸地 · 范围伤害' }, { id: 'summon', cd: 7, warn: 0.5, text: '召唤援兵' }, { id: 'roar', cd: 10, warn: 0.7, text: '怒吼 · 震住近身单位' }] },
    ],
  },
  {
    id: 'iron',
    name: '铁浮屠',
    title: '第 20 波 · 铁甲巨像',
    glyph: '铁',
    color: '#3f4650',
    hp: 3200,
    speed: 0.34,
    dmg: 54,
    armor: 40,
    r: 44,
    rewardGrain: 60,
    rewardSilver: 36,
    intro: '铁浮屠压过来，纸面都在响',
    phases: [
      { name: '铸甲', abilities: [{ id: 'shield', cd: 8, warn: 0.5, text: '铸盾 · 需先破盾' }, { id: 'charge', cd: 11, warn: 1.0, text: '冲撞 · 直线伤害并前进' }] },
      { name: '崩甲', abilities: [{ id: 'slam', cd: 6, warn: 0.9, text: '震地 · 范围伤害' }, { id: 'shield', cd: 9, warn: 0.5, text: '铸盾 · 需先破盾' }] },
      { name: '碾阵', abilities: [{ id: 'charge', cd: 7, warn: 0.8, text: '冲撞 · 直线伤害并前进' }, { id: 'slam', cd: 5, warn: 0.8, text: '震地 · 范围伤害' }, { id: 'shield', cd: 10, warn: 0.4, text: '铸盾 · 需先破盾' }] },
    ],
  },
  {
    id: 'spider',
    name: '赤蛛母',
    title: '第 30 波 · 山腹蛛后',
    glyph: '蛛',
    color: '#7a2f3a',
    hp: 4200,
    speed: 0.44,
    dmg: 48,
    armor: 26,
    r: 46,
    rewardGrain: 76,
    rewardSilver: 46,
    intro: '赤蛛母拖着卵囊爬上山道',
    phases: [
      { name: '产卵', abilities: [{ id: 'spiders', cd: 7, warn: 0.6, text: '产卵 · 生成裂虫' }, { id: 'web', cd: 9, warn: 0.5, text: '铺网 · 降低我军攻速' }] },
      { name: '毒雾', abilities: [{ id: 'poison', cd: 8, warn: 0.9, text: '毒雾 · 范围持续伤害' }, { id: 'spiders', cd: 9, warn: 0.5, text: '产卵 · 生成裂虫' }] },
      { name: '蛛巢', abilities: [{ id: 'poison', cd: 6, warn: 0.8, text: '毒雾 · 范围持续伤害' }, { id: 'web', cd: 6, warn: 0.4, text: '铺网 · 降低我军攻速' }, { id: 'summon', cd: 8, warn: 0.5, text: '涌出裂虫' }] },
    ],
  },
  {
    id: 'drum',
    name: '鼓妖',
    title: '第 40 波 · 战鼓化妖',
    glyph: '鼓',
    color: '#8a5a22',
    hp: 5000,
    speed: 0.38,
    dmg: 50,
    armor: 30,
    r: 42,
    rewardGrain: 90,
    rewardSilver: 54,
    intro: '鼓妖敲响自己，山道跟着一起跳',
    phases: [
      { name: '催阵', abilities: [{ id: 'drum', cd: 7, warn: 0.5, text: '催阵 · 全体敌人加速' }, { id: 'heal', cd: 10, warn: 0.4, text: '回气 · 自我回血' }] },
      { name: '乱心', abilities: [{ id: 'silence', cd: 9, warn: 0.8, text: '乱心 · 范围内无法出手' }, { id: 'drum', cd: 8, warn: 0.5, text: '催阵 · 全体敌人加速' }] },
      { name: '破阵', abilities: [{ id: 'drum', cd: 6, warn: 0.4, text: '催阵 · 全体敌人加速' }, { id: 'slam', cd: 7, warn: 0.7, text: '震地 · 范围伤害' }, { id: 'heal', cd: 9, warn: 0.3, text: '回气 · 自我回血' }] },
    ],
  },
  {
    id: 'qilin',
    name: '墨麒麟',
    title: '第 50 波 · 纸上墨兽',
    glyph: '麟',
    color: '#2f3340',
    hp: 6400,
    speed: 0.46,
    dmg: 60,
    armor: 34,
    r: 48,
    rewardGrain: 120,
    rewardSilver: 70,
    intro: '墨麒麟从纸背里走了出来',
    phases: [
      { name: '起雾', abilities: [{ id: 'fog', cd: 8, warn: 0.6, text: '起雾 · 全军射程收缩' }, { id: 'teleport', cd: 10, warn: 0.5, text: '潜行 · 向前瞬移' }] },
      { name: '开卷', abilities: [{ id: 'beam', cd: 9, warn: 1.0, text: '墨线 · 直线贯阵伤害' }, { id: 'fog', cd: 10, warn: 0.6, text: '起雾 · 全军射程收缩' }] },
      { name: '收官', abilities: [{ id: 'erase', cd: 11, warn: 0.8, text: '抹笔 · 暂停所有合击 6 秒' }, { id: 'beam', cd: 7, warn: 0.8, text: '墨线 · 直线贯阵伤害' }, { id: 'slam', cd: 7, warn: 0.7, text: '踏地 · 范围伤害' }] },
    ],
  },
]

export const BOSS_BY_ID: Record<BossId, BossDef> = BOSS_DEFS.reduce((m, b) => {
  m[b.id] = b
  return m
}, {} as Record<BossId, BossDef>)

/** 第 50 波之后每 10 波再来一轮：表走完后按轮次加血加甲，技能仍是同一套。 */
export function bossTier(wave: number): number {
  return Math.max(1, Math.floor(wave / 50) + 1)
}
