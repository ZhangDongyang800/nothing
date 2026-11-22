/* 十九种被动。
 *
 * 被动不是"加一点数值"的清单：每一条都要能和武器连起来。
 * 例如「笔势」放大范围，飞白的进化「泼墨」正是靠它；「静心」压冷却，
 * 惊雷的「天罚」靠它把落雷频率顶上去。进化条件因此是有意义的搭配，而不是巧合。
 *
 * apply 直接改 PlayerStats —— 属性重算只有"升级 / 结算 / 商店"几个时刻，
 * 不会进每帧循环。
 */
import type { PlayerStats } from '../types';

export interface BaseStats {
  maxHp: number
  speed: number
  damage: number
  armor: number
}

export interface PassiveDef {
  id: string
  name: string
  glyph: string
  tag: string
  max: number
  desc: (next: number) => string
  apply: (s: PlayerStats, lv: number, base: BaseStats) => void
}

export const PASSIVES: PassiveDef[] = [
  {
    id: 'damage', name: '锋锐', glyph: '锋', tag: '伤害', max: 8,
    desc: (n) => `攻击 +${8 * n}%`,
    apply: (s, lv) => { s.damage *= 1 + 0.08 * lv; },
  },
  {
    id: 'attackSpeed', name: '快手', glyph: '快', tag: '攻速', max: 8,
    desc: (n) => `出手速度 +${7 * n}%`,
    apply: (s, lv) => { s.attackSpeed *= 1 + 0.07 * lv; },
  },
  {
    id: 'crit', name: '会心', glyph: '会', tag: '暴击', max: 6,
    desc: (n) => `暴击率 +${4 * n}%`,
    apply: (s, lv) => { s.crit += 0.04 * lv; },
  },
  {
    id: 'critMul', name: '破甲', glyph: '破', tag: '暴伤', max: 6,
    desc: (n) => `暴击伤害 +${12 * n}%`,
    apply: (s, lv) => { s.critMul += 0.12 * lv; },
  },
  {
    id: 'move', name: '轻身', glyph: '轻', tag: '移动', max: 6,
    desc: (n) => `移动速度 +${5 * n}%`,
    apply: (s, lv) => { s.speed *= 1 + 0.05 * lv; },
  },
  {
    id: 'hp', name: '厚墨', glyph: '厚', tag: '生命', max: 8,
    desc: (n) => `最大生命 +${12 * n}%`,
    apply: (s, lv, base) => { s.maxHp = base.maxHp * (1 + 0.12 * lv); },
  },
  {
    id: 'regen', name: '回墨', glyph: '回', tag: '回复', max: 6,
    desc: (n) => `每秒回 ${(0.7 * n).toFixed(1)} 点`,
    apply: (s, lv) => { s.regen += 0.7 * lv; },
  },
  {
    id: 'armor', name: '砚台', glyph: '砚', tag: '护甲', max: 6,
    desc: (n) => `护甲 +${2 * n} · 减伤 ${Math.round((2 * n) / (2 * n + 40) * 100)}%`,
    apply: (s, lv) => { s.armor += 2 * lv; },
  },
  {
    id: 'xp', name: '悟性', glyph: '悟', tag: '经验', max: 6,
    desc: (n) => `经验 +${8 * n}%`,
    apply: (s, lv) => { s.xp *= 1 + 0.08 * lv; },
  },
  {
    id: 'gold', name: '拾金', glyph: '金', tag: '金币', max: 6,
    desc: (n) => `金币 +${12 * n}%`,
    apply: (s, lv) => { s.gold *= 1 + 0.12 * lv; },
  },
  {
    id: 'area', name: '笔势', glyph: '势', tag: '范围', max: 6,
    desc: (n) => `攻击范围 +${7 * n}%`,
    apply: (s, lv) => { s.area *= 1 + 0.07 * lv; },
  },
  {
    id: 'extra', name: '分身', glyph: '分', tag: '弹数', max: 3,
    desc: (n) => `多弹武器 +${n} 枚`,
    apply: (s, lv) => { s.extraProj += lv; },
  },
  {
    id: 'cdr', name: '静心', glyph: '静', tag: '冷却', max: 6,
    desc: (n) => `冷却缩短 ${6 * n}%`,
    apply: (s, lv) => { s.cdr += 0.06 * lv; },
  },
  {
    id: 'pierce', name: '穿石', glyph: '穿', tag: '穿透', max: 5,
    desc: (n) => `穿透 +${n} 名`,
    apply: (s, lv) => { s.pierce += lv; },
  },
  {
    id: 'pickup', name: '贪墨', glyph: '贪', tag: '拾取', max: 5,
    desc: (n) => `拾取范围 +${20 * n}%`,
    apply: (s, lv) => { s.pickup *= 1 + 0.2 * lv; },
  },
  {
    id: 'luck', name: '天运', glyph: '运', tag: '幸运', max: 6,
    desc: (n) => `幸运 +${8 * n}% · 宝箱与商店更好`,
    apply: (s, lv) => { s.luck += 0.08 * lv; },
  },
  {
    id: 'thorns', name: '刺甲', glyph: '刺', tag: '反伤', max: 5,
    desc: (n) => `反伤 ${8 * n}% · 被撞时还给对方`,
    apply: (s, lv) => { s.thorns += 0.08 * lv; },
  },
  {
    id: 'killHeal', name: '血偿', glyph: '血', tag: '击杀回复', max: 4,
    desc: (n) => `每杀一个回 ${(0.5 * n).toFixed(1)} 点`,
    apply: (s, lv) => { s.killHeal += 0.5 * lv; },
  },
  {
    id: 'streak', name: '连斩', glyph: '斩', tag: '连杀', max: 1,
    desc: () => `每杀一个攻击 +5%，叠 20 层`,
    apply: (s) => { s.streak += 0.05; },
  },
];

export const PASSIVE_BY_ID: Record<string, PassiveDef> = {};
for (const p of PASSIVES) PASSIVE_BY_ID[p.id] = p;

export function passiveText(id: string, lv: number): string {
  const p = PASSIVE_BY_ID[id];
  return p ? p.desc(lv) : '';
}
