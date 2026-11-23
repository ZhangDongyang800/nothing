/* 阵图生成：每局一条不同的行军土路。
 *
 * 形状规则（像栈道一样折，不像迷宫的任意曲线），保证：
 *   · 起点永远在上沿入口格，终点永远是营寨格；
 *   · 只走上下左右，格与格之间不重叠、y 单调向下（敌人不会绕回头）；
 *   · 中段有 2～3 处横向折，折出的走廊让"贴路防守"和"横锋扫地"都有位置可选。
 */
import { COLS, ROWS, type CellCoord } from './board'

type Pt = CellCoord

const inBoard = (p: Pt): boolean => p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS

function pushV(out: Pt[], p: Pt, x: number, toY: number): void {
  while (p.y !== toY) {
    p = { x, y: p.y + (toY > p.y ? 1 : -1) }
    out.push(p)
  }
}

function pushH(out: Pt[], p: Pt, toX: number): void {
  while (p.x !== toX) {
    p = { x: p.x + (toX > p.x ? 1 : -1), y: p.y }
    out.push(p)
  }
}

/**
 * 生成一条折线。rand 传 0..1 的随机源（用局内 rng，读档时同种子可复现）。
 * 合法形状的检查很便宜：只要保证三段竖走 + 两段横走都不越界、且 y 一直向下，
 * 就不会自交，也不会出现两格重叠。
 */
export function makeRoute(rand: () => number): Pt[] {
  const pick = (arr: number[]): number => arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))]

  const entryX = pick([3, 4, 5])
  const x1 = pick([1, 2, 6, 7])
  const row1 = pick([2, 3])
  const row2 = pick([5, 6])
  /* 三分之一概率多拐一次：在两段竖走中间再横挪一格 */
  const extra = rand() < 0.34 && row2 - row1 >= 2 ? pick([1, 2, 6, 7]) : 0

  let p: Pt = { x: entryX, y: 0 }
  const out: Pt[] = [{ ...p }]

  pushV(out, p, entryX, row1)
  p = { x: entryX, y: row1 }

  pushH(out, p, x1)
  p = { x: x1, y: row1 }

  if (extra && extra !== x1) {
    pushV(out, p, x1, row1 + 1)
    p = { x: x1, y: row1 + 1 }
    pushH(out, p, extra)
    p = { x: extra, y: row1 + 1 }
  }

  pushV(out, p, p.x, row2)
  p = { x: p.x, y: row2 }

  /* 最后一段横折一定落在营寨那一列，之后直落到底 */
  pushH(out, p, 4)
  p = { x: 4, y: row2 }
  pushV(out, p, 4, ROWS - 1)

  const uniq = new Map<number, Pt>()
  for (const q of out) if (inBoard(q)) { const k = q.y * COLS + q.x; if (!uniq.has(k)) uniq.set(k, q) }
  /* 顺序按"走出来的顺序"，绝不能按坐标排序：横折那一段倒着排会让路来回折 */
  const list = [...uniq.values()]

  /* 兜底：万一生成器改坏了，退回旧的中路，玩法不会崩 */
  if (list.length < 7 || list[0].y !== 0 || list[list.length - 1].y !== ROWS - 1) {
    return Array.from({ length: ROWS }, (_, y) => ({ x: 4, y }))
  }
  return list
}

/** 老存档里没有阵图时用中路；有阵图就照着复原（存的就是行军顺序，不能重排）。 */
export function routeFromCells(cells: number[]): Pt[] {
  const list = cells
    .filter((i) => Number.isFinite(i) && i >= 0 && i < COLS * ROWS)
    .map((i) => ({ x: i % COLS, y: Math.floor(i / COLS) }))
  return list.length >= 7 ? list : Array.from({ length: ROWS }, (_, y) => ({ x: 4, y }))
}
