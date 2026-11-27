/* 八种兵种。
 *
 * 数值口径：hp/atk 是 1 级数值，等级倍率走 GROWTH（合成一次约等于吃掉两个同级单位，
 * 所以倍率是次线性的 1.85 起步，不是翻倍 —— 否则五级单位会一秒清屏）。
 * cd 是基础出手间隔，等级越高，间隔按 CD_MUL 缩短。
 * 每个兵种的"升级路线"写进 levels，战斗层按 lv 查表拿真正的机制差异，而不是只改数值。
 */
import type { UnitDef, UnitKind, LevelStep } from '../types'

export const GROWTH = [1, 1.85, 3.4, 6.2, 11.5]
export const CD_MUL = [1, 0.9, 0.82, 0.74, 0.66]
export const MAX_UNIT_LV = 5

const steps = (names: string[], texts: string[]): LevelStep[] =>
  names.map((name, i) => ({ name, text: texts[i] ?? '' }))

export const UNIT_DEFS: UnitDef[] = [
  {
    id: 'blade',
    name: '刀兵',
    glyph: '刀',
    rarity: 'common',
    color: '#8d3b2f',
    role: '近战爆发',
    desc: '贴脸砍，出手快，暴击狠。',
    hp: 130,
    atk: 32,
    armor: 8,
    range: 1.3,
    cd: 0.72,
    block: 1,
    melee: true,
    splash: 0,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['短刀手', '刀客', '横刀', '快刀手', '一刀断'],
      [
        '贴路近身，砍最靠近山道的敌人。',
        '攻速与暴击率提升。',
        '「横扫」：一次攻击连带身边第二名敌人。',
        '暴击伤害提高到 2.4 倍。',
        '「断」：非 Boss 敌人生命低于 15% 时直接处决。',
      ],
    ),
  },
  {
    id: 'spear',
    name: '枪兵',
    glyph: '枪',
    rarity: 'fine',
    color: '#5d6b3a',
    role: '直线穿透',
    desc: '一条线戳穿一列，越远越赚。',
    hp: 118,
    atk: 26,
    armor: 6,
    range: 2.9,
    cd: 0.95,
    block: 0,
    melee: false,
    splash: 0,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['木枪手', '长枪兵', '穿杨枪', '铁骑枪', '枪阵'],
      [
        '向目标方向直线突刺，命中沿线敌人。',
        '射程 +0.6 格，攻速提升。',
        '一枪穿过 3 名敌人。',
        '命中后击退并短暂眩晕 0.6 秒。',
        '「枪阵」：每第三次出手改为四周环刺，命中一圈敌人。',
      ],
    ),
  },
  {
    id: 'bow',
    name: '弓兵',
    glyph: '弓',
    rarity: 'common',
    color: '#6a5b2e',
    role: '远程持续',
    desc: '站得远、打得稳，五级落箭雨。',
    hp: 92,
    atk: 24,
    armor: 4,
    range: 4.2,
    cd: 1.0,
    block: 0,
    melee: false,
    splash: 0,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['猎户', '弓手', '连珠箭', '破甲箭', '箭雨'],
      [
        '单发点射，射程 4.2 格。',
        '攻速 +18%。',
        '同时锁定两个目标各射一箭。',
        '箭矢穿透 2 名敌人。',
        '每第 4 次出手改为「箭雨」：覆盖目标周围 1.2 格的区域。',
      ],
    ),
  },
  {
    id: 'cavalry',
    name: '骑兵',
    glyph: '骑',
    rarity: 'epic',
    color: '#7a4a2f',
    role: '冲锋突击',
    desc: '一冲一条线，出手慢但很重。',
    hp: 210,
    atk: 46,
    armor: 14,
    range: 3.4,
    cd: 1.9,
    block: 1,
    melee: false,
    splash: 0,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['骑卒', '轻骑', '突骑', '重骑', '踏阵'],
      [
        '向目标冲锋，撞击沿途敌人。',
        '冲锋距离 +0.8 格，攻速提升。',
        '撞击点 1 格范围内的敌人一同受伤。',
        '冲锋可连续贯穿两次，暴击率提升。',
        '「踏阵」：冲锋命中者眩晕 1 秒并被推开一格。',
      ],
    ),
  },
  {
    id: 'mage',
    name: '法师',
    glyph: '法',
    rarity: 'rare',
    color: '#4a3f7a',
    role: '群体法术',
    desc: '专治扎堆：一发火球连人带甲一起烧。',
    hp: 96,
    atk: 36,
    armor: 4,
    range: 3.4,
    cd: 1.5,
    block: 0,
    melee: false,
    splash: 1.0,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['书童', '方士', '火法', '炎术师', '焚原'],
      [
        '火球落点 1 格范围伤害。',
        '溅射范围 +0.35 格。',
        '命中者灼烧 3 秒，每秒再掉一次伤害。',
        '每第三次出手改为双发火球，打两个目标。',
        '「陨火」：每 12 秒落下一颗陨石，覆盖 2.2 格。',
      ],
    ),
  },
  {
    id: 'engineer',
    name: '工程师',
    glyph: '工',
    rarity: 'fine',
    color: '#3f6350',
    role: '辅助经营',
    desc: '自己不主打输出：让周围友军出手更快，还定期产军粮。',
    hp: 140,
    atk: 14,
    armor: 12,
    range: 2.6,
    cd: 1.3,
    block: 0,
    melee: false,
    splash: 0,
    aura: 0.16,
    growth: GROWTH,
    levels: steps(
      ['匠户', '军匠', '设伏', '督造', '弩塔'],
      [
        '邻格友军攻速 +16%，每 8 秒产 3 军粮。',
        '光环扩到 2 格，产量翻倍。',
        '在相邻山道上布置拒马：踩中的敌人减速 45%。',
        '光环 +28%，每 10 秒为基地补 2% 生命。',
        '在身旁立起弩塔，独立索敌射击，不占格子。',
      ],
    ),
  },
  {
    id: 'warlock',
    name: '术士',
    glyph: '术',
    rarity: 'legend',
    color: '#5b3a6b',
    role: '控制削弱',
    desc: '不急着杀，他让敌人走不动、挨得更疼。',
    hp: 104,
    atk: 20,
    armor: 5,
    range: 3.2,
    cd: 1.4,
    block: 0,
    melee: false,
    splash: 0,
    aura: 0.22,
    growth: GROWTH,
    levels: steps(
      ['巫祝', '咒徒', '缚魂', '摄魄', '汲魂'],
      [
        '周身 2 格敌人减速 22%。',
        '命中者易伤：受到伤害 +18%，持续 4 秒。',
        '咒波范围 +0.7 格。',
        '每第 3 次出手改为「定身」：范围内敌人停住 1.2 秒。',
        '「汲魂」：造成伤害的 30% 转为基地治疗。',
      ],
    ),
  },
  /* ---- 融合兵种：不上招募池，只由两兵配合合成 ---- */
  {
    id: 'lance',
    name: '骁骑',
    glyph: '骁',
    rarity: 'epic',
    color: '#6e3b2e',
    role: '贯穿冲锋',
    desc: '枪与骑合成：一条线撞穿，不回头。',
    hp: 238,
    atk: 44,
    armor: 12,
    range: 3.6,
    cd: 1.55,
    block: 1,
    melee: false,
    splash: 0,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['轻骁', '突骁', '破阵骁', '重骁', '踏营'],
      [
        '向一列冲锋，最多贯穿 2 名敌人。',
        '冲锋距离 +0.6 格。',
        '命中后把敌人向后推 0.18 格。',
        '冲锋多贯穿 1 名敌人。',
        '「踏营」：被撞中的敌人眩晕 0.8 秒。',
      ],
    ),
  },
  {
    id: 'halberd',
    name: '戟兵',
    glyph: '戟',
    rarity: 'fine',
    color: '#7b5b2f',
    role: '横扫穿透',
    desc: '刀与枪合成：一戟扫一排，缺口也能补上。',
    hp: 152,
    atk: 31,
    armor: 10,
    range: 2.7,
    cd: 0.92,
    block: 1,
    melee: false,
    splash: 0.4,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['短戟', '长戟', '横戟', '破甲戟', '断阵戟'],
      [
        '向前一戟，最多命中直线 2 人。',
        '攻速提升，起手更快。',
        '命中后再劈相邻 1 人。',
        '暴击伤害 +35%。',
        '「断阵」：每第 3 次出手改为环身横扫。',
      ],
    ),
  },
  {
    id: 'pyro',
    name: '焰弓',
    glyph: '焰',
    rarity: 'rare',
    color: '#a04a2c',
    role: '灼烧箭雨',
    desc: '弓与法合成：箭带火，落点还在烧。',
    hp: 112,
    atk: 33,
    armor: 4,
    range: 3.7,
    cd: 1.18,
    block: 0,
    melee: false,
    splash: 0.7,
    aura: 0,
    growth: GROWTH,
    levels: steps(
      ['火弓', '焰矢', '燎原', '爆焰', '焚阵'],
      [
        '火箭落点 0.7 格范围伤害，并灼烧 2 秒。',
        '灼烧延长到 3 秒。',
        '溅射范围 +0.3 格。',
        '每第 3 次出手改为双发火箭。',
        '「焚阵」：每 10 秒向敌群落一片 2 格火雨。',
      ],
    ),
  },
]

/** 跨兵种配方：两种基础兵各取一个，合成后的文字兵取较高等级并向上取整。 */
export const FUSIONS: { a: UnitKind; b: UnitKind; out: UnitKind }[] = [
  { a: 'spear', b: 'cavalry', out: 'lance' },
  { a: 'blade', b: 'spear', out: 'halberd' },
  { a: 'bow', b: 'mage', out: 'pyro' },
]

export function fusionPair(a: UnitKind, b: UnitKind): UnitKind | null {
  if (a === b) return null
  for (const f of FUSIONS) {
    if ((f.a === a && f.b === b) || (f.a === b && f.b === a)) return f.out
  }
  return null
}

export function fusionOf(a: UnitKind, b: UnitKind): UnitKind | null {
  return fusionPair(a, b)
}

export function fusionLevel(a: number, b: number): number {
  return Math.max(1, Math.min(5, Math.ceil((a + b) / 2)))
}

export function isFusion(kind: UnitKind): boolean {
  return FUSIONS.some((f) => f.out === kind)
}

export const UNIT_BY_ID: Record<UnitKind, UnitDef> = UNIT_DEFS.reduce((m, u) => {
  m[u.id] = u
  return m
}, {} as Record<UnitKind, UnitDef>)

/** 初始解锁的兵种（其余走局外材料解锁） */
export const START_UNLOCKED: UnitKind[] = ['blade', 'bow', 'spear', 'engineer']
export const UNIT_UNLOCK_COST: Partial<Record<UnitKind, number>> = { mage: 120, cavalry: 260, warlock: 520 }

export interface UnitStats {
  hp: number
  atk: number
  armor: number
  range: number
  cd: number
}

/** 某一级单位的基础面板（不含局外/局内加成、精锐修正） */
export function unitStats(kind: UnitKind, lv: number, veteran = false): UnitStats {
  const d = UNIT_BY_ID[kind]
  const i = Math.max(0, Math.min(4, lv - 1))
  const g = d.growth[i]
  const v = veteran ? 1.25 : 1
  return {
    hp: Math.round(d.hp * g * v),
    atk: Math.round(d.atk * g * v),
    armor: Math.round(d.armor * (1 + i * 0.14)),
    range: d.range + (kind === 'spear' && lv >= 2 ? 0.6 : 0),
    cd: d.cd * CD_MUL[i],
  }
}

export function unitName(kind: UnitKind, lv: number): string {
  const d = UNIT_BY_ID[kind]
  return d.levels[Math.max(0, Math.min(4, lv - 1))].name
}
