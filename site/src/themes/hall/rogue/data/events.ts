/* 战场随机事件与商人货架。
 *
 * 事件必须真的改战斗：增益区站在里面才有效、危险区踩上去就慢、
 * 墨雨期间刷怪翻倍且经验翻倍、精英包清完才掉箱子。
 * 这里只定义"什么时候可能发生、叫什么、持续多久"，生效逻辑在 game.ts。
 */
export interface EventDef {
  id: string
  name: string
  desc: string
  color: string
  weight: number
  /** 第几分钟后可能出现 */
  min: number
  /** 事件持续秒数，0 = 瞬时 */
  dur: number
}

export const EVENTS: EventDef[] = [
  {
    id: 'buff', name: '静心池', color: '#4f7757', weight: 5, min: 2, dur: 26,
    desc: '纸面凹下去一小块，站进去回血、攻击也更重。',
  },
  {
    id: 'hazard', name: '墨沼', color: '#5b5751', weight: 5, min: 4, dur: 22,
    desc: '一片黏墨，踩进去走不动，隔一会儿还会落雷。',
  },
  {
    id: 'elite', name: '墨将巡游', color: '#b5342b', weight: 4, min: 5, dur: 0,
    desc: '三只精英结伴而来，清完原地留一只箱子。',
  },
  {
    id: 'rain', name: '墨雨', color: '#3f5c86', weight: 5, min: 3, dur: 28,
    desc: '天上落墨，敌人变多，但每一滴经验都翻倍。',
  },
  {
    id: 'tide', name: '潮涌', color: '#26221e', weight: 4, min: 6, dur: 0,
    desc: '一整排墨从同一个方向压过来，别站在那条线上。',
  },
  {
    id: 'gold', name: '落金', color: '#b8892f', weight: 3, min: 3, dur: 0,
    desc: '纸缝里翻出一把铜钱，捡了就能在商人那里花。',
  },
  {
    id: 'treasure', name: '墨藏', color: '#7c4a63', weight: 3, min: 4, dur: 0,
    desc: '一只箱子自己从纸下顶出来。',
  },
];

export const EVENT_BY_ID: Record<string, EventDef> = {};
for (const e of EVENTS) EVENT_BY_ID[e.id] = e;

export interface MerchantGood {
  id: string
  name: string
  desc: string
  /** 基础价，会随时间上浮 */
  cost: number
  glyph: string
}

export const MERCHANT_GOODS: MerchantGood[] = [
  { id: 'heal', name: '一盏热茶', desc: '回三成血', cost: 55, glyph: '茶' },
  { id: 'weapon', name: '半页残谱', desc: '随机一件武器 +1 级', cost: 130, glyph: '谱' },
  { id: 'passive', name: '一枚旧印', desc: '随机一个被动 +1 级', cost: 110, glyph: '印' },
  { id: 'reroll', name: '重选符', desc: '本局重选次数 +1', cost: 70, glyph: '符' },
  { id: 'armor', name: '砚台碎块', desc: '本局护甲 +3', cost: 100, glyph: '砚' },
  { id: 'speed', name: '轻身纸', desc: '本局移速 +6%', cost: 85, glyph: '纸' },
  { id: 'shield', name: '护身墨', desc: '获得一层护盾（血量两成）', cost: 75, glyph: '盾' },
];

/** 宝箱的三选一：按幸运加权，进化材料只在"真的有武器满级"时才出现。 */
export const CHEST_KINDS = [
  { id: 'weapon', name: '一件武器 +2', desc: '随机武器连升两级', color: '#b8892f' },
  { id: 'evo', name: '进化墨引', desc: '把一件满级武器推进化', color: '#b5342b' },
  { id: 'gold', name: '一把铜钱', desc: '铜钱 +80~160', color: '#8a6a3a' },
  { id: 'heal', name: '一口回墨', desc: '回复 45% 生命', color: '#4f7757' },
  { id: 'passive', name: '一枚旧印', desc: '随机被动 +1', color: '#3f5c86' },
  { id: 'reroll', name: '重选符 ×2', desc: '本局重选 +2', color: '#7c4a63' },
] as const;
