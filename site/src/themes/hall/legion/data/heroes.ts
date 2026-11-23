/* 四名英雄。
 *
 * 英雄占一个棋盘格、按单位的方式被攻击，但有独立的主动技与全队被动；
 * 主动技由玩家按（快捷键 Q 或点按钮），不再自动放 —— 什么时候留、什么时候开，
 * 是这一局真正的决策点。英雄阵亡后在下一波开始时以 60% 生命归队。
 */
import type { HeroDef, HeroId } from '../types'

export const HERO_DEFS: HeroDef[] = [
  {
    id: 'qingfeng',
    name: '青锋',
    title: '执刀校尉',
    glyph: '锋',
    color: '#3f6659',
    desc: '站在最前面的人。全军的甲都由他一层层压紧。',
    hp: 560,
    atk: 44,
    armor: 32,
    range: 1.5,
    cd: 0.85,
    block: 0,
    synergy: 'blade',
    synergyText: '刀兵暴击伤害 +20%，全军护甲 +12%',
    passiveName: '整军',
    passiveText: '全体友军护甲 +12%；刀兵暴击伤害 +20%。',
    activeName: '铁壁',
    activeText: '6 秒内全体友军减伤 35%，基地恢复 8% 生命。',
    activeCd: 38,
    activeDmg: 0,
    activeRadius: 0,
  },
  {
    id: 'chiyuan',
    name: '赤鸢',
    title: '焚原术者',
    glyph: '鸢',
    color: '#a0432c',
    desc: '一团火从纸面烧过去，留下一道焦痕。',
    hp: 320,
    atk: 68,
    armor: 8,
    range: 3.6,
    cd: 1.1,
    block: 0,
    synergy: 'mage',
    synergyText: '法师溅射 +20%，灼烧延长 1 秒',
    passiveName: '引燃',
    passiveText: '所有友军攻击附带 6% 攻击力的灼烧伤害。',
    activeName: '焚天',
    activeText: '全线起火：所有敌人受到 300% 攻击力伤害并灼烧 4 秒。',
    activeCd: 42,
    activeDmg: 3,
    activeRadius: 0,
  },
  {
    id: 'bailu',
    name: '白鹭',
    title: '落羽弓主',
    glyph: '鹭',
    color: '#3c6b7a',
    desc: '她不看人，只看风。风到哪儿，箭就到哪儿。',
    hp: 280,
    atk: 60,
    armor: 6,
    range: 4.8,
    cd: 0.66,
    block: 0,
    synergy: 'bow',
    synergyText: '弓兵攻速 +15%，暴击 +8%',
    passiveName: '听风',
    passiveText: '弓兵与枪兵暴击率 +10%，暴击伤害 +20%。',
    activeName: '万箭',
    activeText: '箭雨覆满山道：对全线敌人造成 250% 攻击力伤害。',
    activeCd: 38,
    activeDmg: 2.5,
    activeRadius: 0,
  },
  {
    id: 'taxue',
    name: '踏雪',
    title: '踏阵骑将',
    glyph: '雪',
    color: '#5a4b74',
    desc: '马蹄落在纸上的声音，比鼓还重。',
    hp: 440,
    atk: 86,
    armor: 18,
    range: 3.2,
    cd: 1.5,
    block: 2,
    synergy: 'cavalry',
    synergyText: '骑兵冲锋伤害 +35%，冷却 -15%',
    passiveName: '蹄声',
    passiveText: '骑兵冲锋伤害 +35%；骑兵出手间隔 -15%。',
    activeName: '踏阵',
    activeText: '纵贯全线冲锋：造成 320% 攻击力伤害，眩晕 1.5 秒。',
    activeCd: 34,
    activeDmg: 3.2,
    activeRadius: 0,
  },
]

export const HERO_BY_ID: Record<HeroId, HeroDef> = HERO_DEFS.reduce((m, h) => {
  m[h.id] = h
  return m
}, {} as Record<HeroId, HeroDef>)

export const HERO_UNLOCK: Record<HeroId, number> = { qingfeng: 0, chiyuan: 45, bailu: 90, taxue: 160 }
