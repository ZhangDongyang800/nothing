/* 纸上军团 · 图标注册表
 * ------------------------------------------------------------------
 * 本作有两套图标，不允许第三套：
 *
 * 1) 字印（Glyph Seal）—— 承载"游戏里的名词"：兵种、英雄、道具、强化。
 *    就是那个汉字本身，套一个固定规格的方框。理由：本作的单位本来就是"文字兵"，
 *    字就是图标；再画一把小刀反而更远。规格见 SEAL_SPEC。
 *
 * 2) 线符（Line Icon）—— 承载"界面里的动词"：暂停、设置、关闭、刷新、遣散、锁定…
 *    24×24 网格、1.5px 描边、方头、不填充、只用墨色。路径见 LINE。
 *
 * 禁止：emoji、彩色图标、填充+描边混用、带阴影的图标、
 *      在字印里加齿轮/星星/飘带等"看起来像游戏"的装饰。
 * ------------------------------------------------------------------ */

/** 字印规格：正方形、2px 墨框、直角、字占框内 62% */
export const SEAL_SPEC = {
  frame: 2, // px
  radius: 0,
  glyphRatio: 0.62, // 字号 = 框宽 × 0.62
  fill: 'paper', // 底为纸，字为墨；选中时反过来
  selectedFill: 'ink',
} as const

/** 线符：24 网格、1.5 描边、方头 */
export const LINE_SPEC = { grid: 24, stroke: 1.5, cap: 'square', fill: 'none' } as const

type IconKey =
  | 'pause'
  | 'play'
  | 'fast'
  | 'settings'
  | 'close'
  | 'sound'
  | 'mute'
  | 'reroll'
  | 'trash'
  | 'lock'
  | 'plus'
  | 'check'
  | 'chevron'
  | 'info'
  | 'target'
  | 'flag'

/** 每个 key 都必须在游戏里有一个真实动作与之对应；没有对应动作就不许加图标 */
export const LINE: Record<IconKey, string> = {
  pause: 'M9 5v14M15 5v14',
  play: 'M8 5l11 7-11 7z',
  fast: 'M3 6l7 6-7 6zM12 6l7 6-7 6z',
  settings: 'M4 7h16M4 12h16M4 17h16M9 4v6M16 9v6M7 14v6',
  close: 'M6 6l12 12M18 6L6 18',
  sound: 'M4 9v6h4l5 4V5L8 9H4zM17 9a4 4 0 010 6',
  mute: 'M4 9v6h4l5 4V5L8 9H4zM16 9l5 6M21 9l-5 6',
  reroll: 'M20 12a8 8 0 11-2.6-5.9M20 4v5h-5',
  trash: 'M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 13l4 4L19 7',
  chevron: 'M9 6l6 6-6 6',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 7.6v.1',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v2M12 14v2M8 12h2M14 12h2',
  flag: 'M5 21V4M5 4h13l-3 4 3 4H5',
}

/** 线符 → 语义说明。写在代码里是为了让"这个图标到底什么意思"有据可查 */
export const LINE_LABEL: Record<IconKey, string> = {
  pause: '暂停',
  play: '继续',
  fast: '倍速',
  settings: '设置',
  close: '关闭',
  sound: '音效',
  mute: '静音',
  reroll: '刷新招贤榜',
  trash: '遣散单位',
  lock: '未解锁',
  plus: '空格 / 增加',
  check: '已达成',
  chevron: '下一项',
  info: '说明',
  target: '选中 / 索敌',
  flag: '开战',
}

/** 返回一段可直接插入的 SVG；size 只允许 16 / 20 / 24 / 32 */
export function lineIcon(key: IconKey, size: 16 | 20 | 24 | 32 = 24): string {
  const d = LINE[key]
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" aria-hidden="true"><path d="${d}"/></svg>`
}
