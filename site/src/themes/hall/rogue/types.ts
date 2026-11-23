/* 「墨潮」—— 无尽肉鸽增量生存。
 *
 * 这个文件只放"大家都要用到"的形状定义：玩家属性、武器、敌人、弹体、区域。
 * 数据在 data/ 下，主循环在 game.ts，绘制在 draw.ts，界面在 ui.ts。
 * 所有实体都是可复用的对象池元素：字段一次定义好，运行时只改值、不新建。
 */

export interface Vec2 { x: number; y: number }

/** 玩家的最终属性（基础值 × 局外成长 × 被动）。每帧不重算，升级时重建一次。 */
export interface PlayerStats {
  maxHp: number
  speed: number
  damage: number
  attackSpeed: number
  crit: number
  critMul: number
  armor: number
  regen: number
  area: number
  extraProj: number
  pierce: number
  cdr: number
  xp: number
  gold: number
  pickup: number
  luck: number
  thorns: number
  killHeal: number
  /** 「连斩」：每杀一个，攻击 +x%，最多叠 20 层，2 秒不杀就回落 */
  streak: number
}

export interface Player {
  x: number
  y: number
  r: number
  hp: number
  maxHp: number
  level: number
  xp: number
  xpNext: number
  gold: number
  kills: number
  dmg: number
  invuln: number
  dashT: number
  dashCd: number
  vx: number
  vy: number
  face: number
  /** 连斩层数与剩余时间 */
  streak: number
  streakT: number
  /** 本局临时加成（来自商人 / 增益区域），单位是秒 */
  buffDmg: number
  buffSpeed: number
  buffArmor: number
  shield: number
  /** 被墨网 / 墨沼拖住的剩余秒数 */
  slowT: number
}

export interface WeaponLevel {
  dmg: number
  cd: number
  count: number
  pierce: number
  size: number
  life: number
  text: string
}

export interface WeaponEvo {
  id: string
  name: string
  glyph: string
  tag: string
  intro: string
  passive: string
  passiveLv: number
  stats: WeaponLevel
}

export interface WeaponDef {
  id: string
  name: string
  glyph: string
  color: string
  tag: string
  /** 战术角色一句话：索敌 / 几何 / 节奏，验收探针按它逐把比对 */
  role: string
  intro: string
  /** 八级成长；第八级满级后才可能进化 */
  levels: WeaponLevel[]
  evo: WeaponEvo
  fire: (g: GameApi, w: WeaponInst, dt: number) => void
}

export interface WeaponInst {
  id: string
  level: number
  evolved: boolean
  cool: number
  /** 环绕类武器的相位与半径（其余武器不用） */
  orbit?: { n: number; r: number; speed: number; dmg: number; ang: number }
}

export interface Enemy {
  active: boolean
  id: number
  kind: string
  name: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  hp: number
  maxHp: number
  dmg: number
  speed: number
  xp: number
  gold: number
  elite: boolean
  boss: boolean
  bossId: string
  hitT: number
  atkCd: number
  /** 行为状态计时（冲锋、开火、传送…） */
  st: number
  st2: number
  phase: number
  /** 护盾：>0 时先吃掉伤害 */
  shield: number
  shieldMax: number
  shieldT: number
  slowT: number
  spawnT: number
  /** 环绕武器的命中冷却 */
  orbitCd: number
  pack: boolean
  /** Boss 图案序号 / 阶段计时 */
  pattern: number
  phaseT: number
  enrage: boolean
  dead: boolean
  /** 死亡时的缩放动画进度 */
  dieT: number
  /** 受击方向（画喷溅用） */
  hx: number
  hy: number
  /** 预警：剩余预警秒数 / 招式类型。>0 表示伤害判定还没落下，画面先画预警 */
  teleT: number
  teleKind: string
}

export interface Shot {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  r: number
  dmg: number
  pierce: number
  life: number
  age: number
  kind: string
  color: string
  hitIds: number[]
  homing: number
  target: Enemy | null
  explodeR: number
  explodeDmg: number
  /** 命中后分裂出几枚小弹 */
  split: number
  /** >0 时在 age 超过它之后掉头回玩家身边（折扇） */
  returnAt: number
  returned: boolean
  slowT: number
  spin: number
  trail: boolean
  width: number
  /** 命中时给玩家回血（钟鸣的进化用不到，留给未来） */
  healPer: number
}

export interface EShot {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  r: number
  dmg: number
  life: number
  age: number
  color: string
  homing: number
  kind: string
  spin: number
}

export interface Zone {
  active: boolean
  x: number
  y: number
  r: number
  life: number
  age: number
  dmg: number
  tick: number
  type: string
  color: string
  /** 地面区域会减速 / 增益的强度 */
  slow: number
  buff: string
  follow: boolean
}

export interface Beam {
  active: boolean
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  life: number
  age: number
  dmg: number
  color: string
  hitIds: number[]
  kind: string
}

export interface Chain {
  active: boolean
  x: number
  y: number
  points: number[]
  life: number
  age: number
  color: string
}

export interface Meteor {
  active: boolean
  x: number
  y: number
  t: number
  delay: number
  dmg: number
  r: number
  color: string
}

export interface Turret {
  active: boolean
  x: number
  y: number
  life: number
  cd: number
  cool: number
  dmg: number
  range: number
  color: string
  kind: 'turret' | 'clone'
  /** 哪件武器召出来的：上限按武器等级算，不按"每 3 秒再召一个" */
  src: string
  /** 1 = 双管（进化后的墨塔） */
  double?: number
  r: number
}

export interface Gem {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  val: number
  kind: 'xp' | 'gold' | 'heal' | 'chest' | 'merchant' | 'dust'
  age: number
  r: number
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
  spin: number
  rot: number
}

export interface FloatText {
  active: boolean
  x: number
  y: number
  vy: number
  life: number
  age: number
  text: string
  kind: string
  size: number
}

/** 地上的宝箱 / 商人：不是战斗单位，靠近了才开。 */
export interface Pickup {
  active: boolean
  x: number
  y: number
  kind: 'chest' | 'merchant'
  age: number
  bob: number
}

/** 范围技的视觉环：只画，不结算（结算在 ring() 里一次完成）。 */
export interface Shockwave {
  active: boolean
  x: number
  y: number
  r: number
  life: number
  age: number
  color: string
  width: number
}

export interface GameApi {
  player: Player
  elapsed: number
  stats(): PlayerStats
  nearest(x: number, y: number, range: number): Enemy | null
  enemiesNear(x: number, y: number, r: number): Enemy[]
  shot(o: Partial<Shot> & { x: number; y: number; dmg: number }): void
  beam(x1: number, y1: number, x2: number, y2: number, o: Partial<Beam> & { dmg: number }): void
  zone(x: number, y: number, o: Partial<Zone> & { r: number; life: number; dmg: number }): void
  chain(x: number, y: number, targets: number, dmg: number, range: number, color: string): void
  meteor(x: number, y: number, delay: number, dmg: number, r: number, color: string): void
  turret(x: number, y: number, o: Partial<Turret> & { dmg: number }): void
  ring(x: number, y: number, r: number, dmg: number, knock: number, color: string, healPer?: number): void
  burst(x: number, y: number, color: string, count: number, power?: number): void
  pop(x: number, y: number, text: string, kind?: string, size?: number): void
  syncOrbit(w: WeaponInst, count: number, radius: number, speed: number, dmg: number): void
  randomEnemyNear(x: number, y: number, r: number): Enemy | null
  /** 还活着的召唤物数量（墨塔 / 影身的上限用） */
  turretCount(src: string): number
  /** 敌人朝某个方向射一发（投笔、Boss 的扇形弹都用它） */
  enemyShot(x: number, y: number, angle: number, speed: number, dmg: number, color: string, r?: number): void
  /** Boss 的横扫光柱：先画预警，再落下来伤玩家 */
  enemyBeam(x1: number, y1: number, x2: number, y2: number, width: number, dmg: number, color: string): void
  /** Boss 起手预警：登记预警开始时刻与招式类型，供画面与探针读取 */
  telegraph(kind: string, dur: number): void
  /** Boss 范围震击：同 ring 结算，单独留命中时刻 */
  enemyRing(x: number, y: number, r: number, dmg: number, knock: number, color: string): void
  /** 敌人造成的伤害：护甲 / 护盾 / 无敌帧 / 反伤都在这里统一算 */
  damagePlayer(dmg: number, sx: number, sy: number): void
  spawnEnemy(kind: string, x: number, y: number, elite?: boolean, pack?: boolean): void
  /** 以某点为中心炸一下（只伤玩家） */
  explode(x: number, y: number, r: number, dmg: number, color: string): void
  slowPlayer(sec: number): void
  rnd(): number
}
