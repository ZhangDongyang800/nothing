/* 「纸上军团：无尽守卫」的类型层。
 *
 * 数据配置（data/）只描述"有什么"，战斗与渲染只读这些结构，不反向改配置。
 * 局内单位 / 敌人都用定长对象池里的可变对象（active 标记回收），
 * 所以类型里全部是可写字段，而不是 readonly 的不可变数据。
 */

export type UnitKind =
  | 'blade' | 'spear' | 'bow' | 'cavalry' | 'mage' | 'engineer' | 'warlock'
  | 'lance' | 'halberd' | 'pyro'
export type Rarity = 'common' | 'fine' | 'rare' | 'epic' | 'legend'
export type EnemyKind = 'raider' | 'runner' | 'brute' | 'gunner' | 'bomber' | 'splitter' | 'hexer' | 'champion' | 'breaker'
export type BossId = 'shanxiao' | 'iron' | 'spider' | 'drum' | 'qilin'
export type ItemId =
  | 'draft' | 'levelup' | 'reroll' | 'spade' | 'fury' | 'salve' | 'cannon' | 'freeze'
export type InGameUpId = 'atk' | 'spd' | 'crit' | 'baseHp' | 'baseArmor' | 'luck' | 'grain' | 'merge' | 'regen'
export type MetaId =
  | 'atk' | 'spd' | 'baseHp' | 'luck' | 'grain' | 'silver' | 'cells' | 'grainStart' | 'bench' | 'mergeGain'
export type HeroId = 'qingfeng' | 'chiyuan' | 'bailu' | 'taxue'

export interface LevelStep {
  name: string
  text: string
}

export interface UnitDef {
  id: UnitKind
  name: string
  glyph: string
  rarity: Rarity
  color: string
  role: string
  desc: string
  hp: number
  atk: number
  armor: number
  range: number
  cd: number
  block: number
  melee: boolean
  splash: number
  aura: number
  /** 五级成长曲线：等级 1..5 的生命/攻击倍率 */
  growth: number[]
  levels: LevelStep[]
}

export interface HeroDef {
  id: HeroId
  name: string
  title: string
  glyph: string
  color: string
  desc: string
  hp: number
  atk: number
  armor: number
  range: number
  cd: number
  block: number
  synergy: UnitKind
  synergyText: string
  passiveName: string
  passiveText: string
  activeName: string
  activeText: string
  activeCd: number
  activeDmg: number
  activeRadius: number
}

export interface EnemyDef {
  id: EnemyKind
  name: string
  glyph: string
  color: string
  hp: number
  speed: number
  dmg: number
  armor: number
  range: number
  cd: number
  r: number
  grain: number
  silver: number
  cost: number
  role: string
  unlockWave: number
  behavior: 'melee' | 'ranged' | 'bomber' | 'splitter' | 'hexer' | 'champion' | 'breaker'
}

export interface BossPhase {
  name: string
  abilities: BossAbility[]
}

export interface BossAbility {
  id:
    | 'slam' | 'summon' | 'charge' | 'shield' | 'web' | 'spiders' | 'poison'
    | 'drum' | 'heal' | 'silence' | 'beam' | 'fog' | 'teleport' | 'roar' | 'erase'
  cd: number
  warn: number
  text: string
}

export interface BossDef {
  id: BossId
  name: string
  title: string
  glyph: string
  color: string
  hp: number
  speed: number
  dmg: number
  armor: number
  r: number
  phases: BossPhase[]
  rewardGrain: number
  rewardSilver: number
  intro: string
}

export interface ItemDef {
  id: ItemId
  name: string
  glyph: string
  desc: string
  rarity: Rarity
  price: number
  target: 'unit' | 'board' | null
  color: string
}

export interface InGameUpDef {
  id: InGameUpId
  name: string
  /** 双层命名：原名作为小字副标题（name 已是通俗主名时省略） */
  sub?: string
  glyph: string
  desc: string
  max: number
  price: (lv: number, wave: number) => number
}

export interface MetaDef {
  id: MetaId
  name: string
  sub?: string
  glyph: string
  desc: (lv: number) => string
  max: number
  gold: (lv: number) => number
  mat: (lv: number) => number
}

export interface MilestoneDef {
  wave: number
  name: string
  gold: number
  grain: number
  silver: number
}

export interface AchievementDef {
  id: string
  name: string
  desc: string
  gold: number
}

/* ---------------- 局内可变对象 ---------------- */

export interface Unit {
  active: boolean
  id: number
  kind: UnitKind
  hero: HeroId | ''
  lv: number
  veteran: boolean
  cell: number
  hp: number
  maxHp: number
  atk: number
  armor: number
  range: number
  cd: number
  cdT: number
  block: number
  blocked: number
  /** 三级专精：0=左支，1=右支，-1=尚未选择 */
  path: number
  /** 布阵格所属路线（由主控在地形计算时写入） */
  terrain: string
  /** 当前生效的阵型联动标签，由主控每次布阵变化后重算 */
  syn: string[]
  hitT: number
  swing: number
  flash: number
  buffSpd: number
  slowT: number
  silenceT: number
  shield: number
  shieldT: number
  born: number
  /** 骑兵冲锋 / 刀兵挥砍的表现位移 */
  lungeT: number
  lungeDir: number
  lungeX: number
  lungeY: number
  /** 工程师的弩塔 / 陷阱引用 */
  turretT: number
  trapT: number
  /** 单位所在格对应的山道进度（每帧算一次，供索敌用） */
  hint: number
  /** 术士吸血 / 法师燃烧计数，由战斗层自用 */
  pulse: number
}

export interface Enemy {
  active: boolean
  id: number
  kind: EnemyKind
  bossId: BossId | ''
  name: string
  hp: number
  maxHp: number
  speed: number
  dmg: number
  armor: number
  r: number
  prog: number
  off: number
  lane: 'center'
  x: number
  y: number
  elite: boolean
  boss: boolean
  phase: number
  phaseT: number
  abilT: number
  abilIdx: number
  abilWarn: number
  abilId: string
  shield: number
  shieldT: number
  hasteT: number
  slowT: number
  vulnT: number
  stunT: number
  /** 连环计：负面状态传播的短冷却，避免无限链 */
  chainT: number
  engaged: number
  atkCd: number
  hitT: number
  dieT: number
  dead: boolean
  born: number
  grain: number
  silver: number
  zoneT: number
  burnT: number
  burnDmg: number
  atBase: boolean
}

export interface Proj {
  active: boolean
  id: number
  side: 'unit' | 'enemy'
  kind: string
  x: number
  y: number
  vx: number
  vy: number
  dmg: number
  splash: number
  pierce: number
  burn: number
  vuln: number
  slow: number
  life: number
  age: number
  color: string
  r: number
  hit: number[]
  target: number
  tx: number
  ty: number
  rot: number
  trail: boolean
}

export interface Particle {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  life: number
  age: number
  size: number
  color: string
  kind: string
  rot: number
  spin: number
}

export interface FloatText {
  active: boolean
  x: number
  y: number
  vy: number
  life: number
  age: number
  text: string
  color: string
  size: number
}

export interface Shock {
  active: boolean
  x: number
  y: number
  r0: number
  r1: number
  life: number
  age: number
  color: string
  width: number
}

export interface Zone {
  active: boolean
  x: number
  y: number
  r: number
  life: number
  age: number
  kind: string
  dmg: number
  tick: number
  tickT: number
  color: string
  side: 'unit' | 'enemy'
}

export interface RecruitCard {
  kind: UnitKind
  veteran: boolean
  cost: number
  key: string
}

export interface ItemSlot {
  id: ItemId
  charges: number
}

export interface RunUnitSave {
  kind: UnitKind
  lv: number
  veteran: boolean
  cell: number
  hero: HeroId | ''
  path?: number
}

export interface Checkpoint {
  at: number
  wave: number
  elapsed: number
  baseHp: number
  baseMax: number
  grain: number
  silver: number
  cells: number
  benchSlots: number
  hero: HeroId | ''
  heroDead: boolean
  units: RunUnitSave[]
  bench: RunUnitSave[]
  ups: Record<string, number>
  items: ItemSlot[]
  cards: RecruitCard[]
  kills: number
  dmg: number
  income: number
  bestLv: number
  freeRerolls?: number
  runMods?: Record<string, number>
  runCards?: string[]
  /** 这一局的折线土路（格子序号，从入口到营寨）；老存档没有这项就走中路 */
  route?: number[]
}
