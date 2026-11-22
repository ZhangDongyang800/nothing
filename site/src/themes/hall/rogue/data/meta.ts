/* 局外成长与成就。
 *
 * 永久属性有上限、成本递增：每一级都比上一级贵 1.5 倍，
 * 满级之后只能靠"多活一分钟"继续，不会出现"挂机攒钱把攻击堆到无敌"。
 * 收益曲线按"一局 10 分钟 ≈ 150 墨屑"设计：第一次升级几十，
 * 后期一项满级要几千，刚好对应几十局。
 */
export interface MetaUpDef {
  id: string
  name: string
  glyph: string
  desc: string
  /** 每级效果（写给界面看的） */
  per: string
  base: number
  max: number
  /** 每级成本 = base × 1.55^当前等级 */
  costBase: number
}

export const META_UPS: MetaUpDef[] = [
  { id: 'damage', name: '墨力', glyph: '力', desc: '开局攻击更重', per: '攻击 +3%', base: 40, max: 20, costBase: 30 },
  { id: 'hp', name: '墨骨', glyph: '骨', desc: '开局血量更厚', per: '最大生命 +4%', base: 45, max: 20, costBase: 32 },
  { id: 'armor', name: '墨皮', glyph: '皮', desc: '少挨一点', per: '护甲 +1', base: 50, max: 10, costBase: 42 },
  { id: 'speed', name: '轻足', glyph: '足', desc: '起步更快', per: '移速 +1.5%', base: 40, max: 15, costBase: 34 },
  { id: 'xp', name: '慧根', glyph: '慧', desc: '升级更快', per: '经验 +3%', base: 55, max: 15, costBase: 46 },
  { id: 'gold', name: '财眼', glyph: '财', desc: '金币更多', per: '金币 +4%', base: 50, max: 15, costBase: 40 },
  { id: 'luck', name: '天运', glyph: '运', desc: '宝箱与商店更好', per: '幸运 +2%', base: 70, max: 10, costBase: 60 },
  { id: 'startGold', name: '开局金', glyph: '金', desc: '一开局就带钱', per: '开局 +30 金', base: 60, max: 10, costBase: 50 },
  { id: 'reroll', name: '重选', glyph: '选', desc: '升级卡可以重摇', per: '+1 次重选', base: 120, max: 3, costBase: 120 },
  { id: 'startPassive', name: '墨引', glyph: '引', desc: '开局多带一个被动', per: '+1 个开局被动', base: 220, max: 2, costBase: 220 },
  { id: 'revive', name: '墨魂', glyph: '魂', desc: '死一次还能站起来', per: '本局复活 1 次', base: 1600, max: 1, costBase: 1600 },
];

export const META_BY_ID: Record<string, MetaUpDef> = {};
for (const m of META_UPS) META_BY_ID[m.id] = m;

export function metaCost(def: MetaUpDef, lv: number): number {
  return Math.round(def.base + def.costBase * Math.pow(1.55, lv));
}

export interface AchievementDef {
  id: string
  name: string
  desc: string
  dust: number
  /** 判定写在 game.ts 结算里，这里只留一份目录 */
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first', name: '第一次落笔', desc: '完成一局', dust: 20 },
  { id: 't5', name: '撑过五分钟', desc: '单局活到 5 分钟', dust: 30 },
  { id: 't10', name: '一成不变', desc: '单局活到 10 分钟', dust: 50 },
  { id: 't20', name: '纸还很白', desc: '单局活到 20 分钟', dust: 100 },
  { id: 't30', name: '半页墨', desc: '单局活到 30 分钟', dust: 180 },
  { id: 't60', name: '一整页', desc: '单局活到 60 分钟', dust: 400 },
  { id: 't100', name: '墨海无岸', desc: '单局活到 100 分钟', dust: 900 },
  { id: 'kill100', name: '百点', desc: '单局击杀 100', dust: 20 },
  { id: 'kill1000', name: '千点', desc: '单局击杀 1000', dust: 80 },
  { id: 'kill5000', name: '万点归一', desc: '单局击杀 5000', dust: 260 },
  { id: 'lv20', name: '二十级', desc: '单局升到 20 级', dust: 50 },
  { id: 'lv40', name: '四十级', desc: '单局升到 40 级', dust: 150 },
  { id: 'evo1', name: '第一次进化', desc: '任意武器完成一次进化', dust: 80 },
  { id: 'evo3', name: '三件神器', desc: '单局进化 3 件武器', dust: 220 },
  { id: 'boss1', name: '第一只 Boss', desc: '击败任意 Boss', dust: 60 },
  { id: 'boss5', name: '连斩五将', desc: '单局击败 5 只 Boss', dust: 200 },
  { id: 'boss10', name: '墨将皆倒', desc: '单局击败 10 只 Boss', dust: 500 },
  { id: 'rich', name: '攒墨人', desc: '持有 1000 墨屑', dust: 100 },
];

export const ACH_BY_ID: Record<string, AchievementDef> = {};
for (const a of ACHIEVEMENTS) ACH_BY_ID[a.id] = a;

/** 生存里程碑：给的是墨屑，不是"通关"——过了一站，路还长。 */
export const MILESTONES: { min: number; name: string; dust: number }[] = [
  { min: 5, name: '墨稳', dust: 40 },
  { min: 10, name: '墨厚', dust: 80 },
  { min: 20, name: '墨深', dust: 150 },
  { min: 30, name: '墨重', dust: 220 },
  { min: 60, name: '墨海', dust: 450 },
  { min: 100, name: '墨无尽', dust: 900 },
];

/** 阶段名：只用于 HUD 上的"这一段时间叫什么"，不是终点。 */
export const STAGES: { at: number; name: string }[] = [
  { at: 0, name: '初落笔' },
  { at: 3, name: '墨渐浓' },
  { at: 8, name: '群墨压境' },
  { at: 15, name: '墨潮' },
  { at: 25, name: '深墨' },
  { at: 40, name: '墨海' },
  { at: 60, name: '无岸' },
  { at: 100, name: '墨外' },
];

export function stageName(minutes: number): string {
  let name = STAGES[0].name;
  for (const s of STAGES) if (minutes >= s.at) name = s.name;
  return name;
}
