/* 纸上军团 · 运行时 Token
 * ------------------------------------------------------------------
 * canvas 用不了 CSS 变量，所以同一套值在这里再导出一份纯 TS。
 * 两份必须一致：tests/design-tokens.test.ts（见验收脚本）会比对
 * tokens.css 与 tokens.ts 的主色，任何一边改了另一边没改就报错。
 *
 * 组件里永远 `import { C } from './design/tokens'`，不要写 '#a8352a'。
 * ------------------------------------------------------------------ */
import type { Rarity } from '../types'

/** 纸 —— 对应 --lg-paper-0..4 */
export const PAPER = ['#f6eedc', '#fbf6e8', '#ede1c6', '#e3d5b5', '#d8c79f'] as const

/** 墨 —— 对应 --lg-ink-0..3 */
export const INK = ['#23201a', '#57503f', '#8a8069', '#b6ab93'] as const

/** 结构线 —— 对应 --lg-rule-1..3（canvas 需要 alpha，用 rgba 直写） */
export const RULE = ['rgba(35,32,26,0.16)', 'rgba(35,32,26,0.32)', 'rgba(35,32,26,0.64)'] as const

export const SEAL = '#a8342a'
export const SEAL_DEEP = '#8c2419'
export const GOLD = '#b8860b'
export const JADE = '#3f6b3a'
export const INDIGO = '#33628f'
export const VIOLET = '#6b4a8f'
export const GRAIN = '#9a6b1e'
export const SILVER = '#5b6472'

/** 组件级派生色 —— 与 tokens.css 的 --lg-* 派生变量同值。
 *  只给组件/画布用，业务代码不得直接取这些值。 */
export const DERIVED = {
  paperHi: '#ffffff',
  inkHi: '#322e26',
  sealHover: 'rgba(168,52,42,0.06)',
  sealTint: 'rgba(168,52,42,0.07)',
  sealLine: 'rgba(168,52,42,0.55)',
  sealDim: 'rgba(168,52,42,0.18)',
  paperOnInk: 'rgba(251,246,232,0.18)',
  paperTrack: 'rgba(251,246,232,0.28)',
  inkVeil: 'rgba(35,32,26,0.04)',
  scrim: 'rgba(28,25,20,0.55)',
} as const

/** 品质色：与 data/rarity.ts 的 RARITY_COLOR 必须完全一致 */
export const RARITY_TOKEN: Record<Rarity, string> = {
  common: '#6b6255',
  fine: '#3f6b3a',
  rare: '#33628f',
  epic: '#6b4a8f',
  legend: '#b8860b',
}

/** 棋盘专用：土路用纸三级，不用高饱和黄；只有入口/营寨用朱砂 */
export const BOARD = {
  paper: PAPER[3],
  paperShadow: PAPER[4],
  cellLine: RULE[0],
  routeFill: 'rgba(154,107,30,0.10)',
  routeLine: 'rgba(87,80,63,0.45)',
  unitFill: INK[0],
  unitText: PAPER[1],
  unitRule: RULE[2],
  entry: SEAL,
  stronghold: SEAL,
  stroke: INK[0],
  strokeCap: SEAL,
} as const

/** 字号阶梯（与 --lg-fs-* 同值；canvas 里画字用它换算） */
export const FS = {
  display: 44,
  h1: 28,
  num: 24,
  h2: 20,
  bodyLg: 15,
  body: 13,
  label: 12,
  caption: 11,
  micro: 10,
} as const

/** 动效时长（ms），canvas 补间用它 */
export const T = { fast: 80, base: 160, slow: 240 } as const

/** 层级 */
export const Z = { canvas: 0, hud: 1, dock: 2, popover: 3, overlay: 4, toast: 5 } as const
