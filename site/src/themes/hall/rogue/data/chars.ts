/* 五个角色。
 *
 * 角色的差别不是"血多血少"，而是初始武器 + 一个自动触发的专属能力：
 * 墨客靠震荡清身周、笔锋靠冲刺收尾、守砚靠护盾硬吃、焚书靠点燃开场、
 * 无相脆但有一段无相时间。每个角色配一件不同的起手武器，等于五种开局。
 */
export interface CharDef {
  id: string
  name: string
  glyph: string
  title: string
  intro: string
  hp: number
  speed: number
  damage: number
  armor: number
  crit: number
  startWeapon: string
  ability: { name: string; cd: number; desc: string }
  /** 0 = 初始可用；>0 = 墨屑解锁价 */
  unlock: number
}

export const CHARS: CharDef[] = [
  {
    id: 'moke', name: '墨客', glyph: '墨', title: '稳', unlock: 0,
    intro: '一管旧笔，什么都会一点。血量与速度都在中间，适合先摸清墨潮的节奏。',
    hp: 112, speed: 280, damage: 1, armor: 0, crit: 0.05, startWeapon: 'feibai',
    ability: { name: '顿笔', cd: 10, desc: '每 10 秒落一次顿笔：身周荡开一圈，推开并震伤近身的墨点。' },
  },
  {
    id: 'bifeng', name: '笔锋', glyph: '锋', title: '疾', unlock: 0,
    intro: '笔尖朝前，人也朝前。冲刺冷却更短，起步带一件绕身武器，适合贴身绕圈。',
    hp: 96, speed: 300, damage: 1.04, armor: 0, crit: 0.09, startWeapon: 'orbit',
    ability: { name: '破锋', cd: 6, desc: '每 6 秒自动朝面向突进一小段，路上留下割人的墨痕。' },
  },
  {
    id: 'shouyan', name: '守砚', glyph: '砚', title: '守', unlock: 0,
    intro: '砚台成精，走得慢，但很难被推倒。起手钟鸣，越被围越稳。',
    hp: 152, speed: 248, damage: 0.96, armor: 3, crit: 0.04, startWeapon: 'bell',
    ability: { name: '砚守', cd: 12, desc: '每 12 秒罩一层护盾，护盾替你吃伤害，撑 5 秒。' },
  },
  {
    id: 'fenshu', name: '焚书', glyph: '焚', title: '烈', unlock: 0,
    intro: '书烧了，人还在。攻击最高、血最薄，起手炭火，靠一片火地换生存空间。',
    hp: 100, speed: 268, damage: 1.12, armor: 0, crit: 0.05, startWeapon: 'ember',
    ability: { name: '引燃', cd: 9, desc: '每 9 秒把脚下一片地点着，火里每秒都在掉血。' },
  },
  {
    id: 'wuxiang', name: '无相', glyph: '无', title: '险', unlock: 1200,
    intro: '没有形状，也就没有地方可打。血最少、暴击最高，起手追魂，靠两秒无相换一口气。',
    hp: 82, speed: 288, damage: 1.02, armor: 0, crit: 0.13, startWeapon: 'seek',
    ability: { name: '无相', cd: 14, desc: '每 14 秒进入 2 秒无相：不受任何伤害，穿过敌人。' },
  },
];

export const CHAR_BY_ID: Record<string, CharDef> = {};
for (const c of CHARS) CHAR_BY_ID[c.id] = c;
