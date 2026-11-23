/* 方格战场：9 × 9 的纸面棋局。
 *
 * 第五版：敌军不再只走正中一条直线。每局开局随机生成一条
 * 「从上沿入口拐进营寨」的折线土路（像阵图上的行军栈道），
 * 拐点每局不同，格、射程、相邻关系仍然一眼可读。
 *
 * 这里只负责几何与格子分类，不持有任何战斗对象。
 */

export const COLS = 9
export const ROWS = 9

/** 保留 LaneId 只为兼容战场内部的“路径”参数；现在只有一条折线路。 */
export type LaneId = 'center'

export interface CellCoord { x: number; y: number }

/** 这两项随 route 变化（导出的是活绑定，导入方拿到的永远是最新值）。 */
export let ENTRY: CellCoord = { x: 4, y: 0 }
export let BASE: CellCoord = { x: 4, y: 8 }

/** 一格道路在逻辑进度里占的长度。整条路的总长固定，格子越多每格越短。 */
export let SEG = 2.4
/** 整条路线的逻辑总长：行军时长只跟这个数有关，跟拐几个弯无关。 */
export const ROUTE_LEN = 20.4

/** 当前这局的折线路线（默认是旧的中央直路，旧存档沿用它）。 */
export let ROUTE: CellCoord[] = [
  { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 },
  { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }, { x: 4, y: 8 },
]

export function idx(x: number, y: number): number {
  return y * COLS + x
}

export function cellX(i: number): number {
  return i % COLS
}

export function cellY(i: number): number {
  return Math.floor(i / COLS)
}

let PATH_SET = new Set<number>()
let BASE_IDX = 0
/** 换阵图的版本号：静态棋盘缓存靠它判断要不要重画 */
export let ROUTE_REV = 0

/** 72 个可布阵格（会随路线重算，原地清空以保留引用）。 */
export const DEPLOY_CELLS: number[] = []

function rebuild(): void {
  PATH_SET = new Set<number>(ROUTE.map((p) => idx(p.x, p.y)))
  BASE_IDX = idx(BASE.x, BASE.y)
  SEG = Math.max(1.1, ROUTE_LEN / Math.max(1, ROUTE.length - 1))
  ROUTE_REV++
  DEPLOY_CELLS.length = 0
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = idx(x, y)
      if (!PATH_SET.has(i)) DEPLOY_CELLS.push(i)
    }
  }
}

export function setRoute(cells: CellCoord[]): void {
  const list = cells.filter((p) => p.x >= 0 && p.x < COLS && p.y >= 0 && p.y < ROWS)
  if (list.length < 6) return
  ROUTE = list
  ENTRY = list[0]
  BASE = list[list.length - 1]
  rebuild()
}

/** 当前路线的坐标副本（存档用）。 */
export function routeCoords(): CellCoord[] {
  return ROUTE.map((p) => ({ x: p.x, y: p.y }))
}

rebuild()

export function isPathCell(i: number): boolean {
  return PATH_SET.has(i)
}

export function isBaseCell(i: number): boolean {
  return i === BASE_IDX
}

export function isDeployCell(i: number): boolean {
  if (i < 0 || i >= COLS * ROWS) return false
  return !PATH_SET.has(i)
}

/** 开局格：贴着土路下段（先让玩家组出一条防线），再按行往下铺开。 */
export function initialCells(count: number): number[] {
  const order: number[] = []
  const push = (i: number): void => {
    if (i < 0 || i >= COLS * ROWS) return
    if (PATH_SET.has(i)) return
    if (order.includes(i)) return
    order.push(i)
  }
  const near = (i: number): boolean => {
    const x = cellX(i)
    const y = cellY(i)
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + d[0]
      const ny = y + d[1]
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue
      if (PATH_SET.has(idx(nx, ny))) return true
    }
    return false
  }
  /* 先给营寨上方的贴身格，再往上、往两侧扩散 */
  for (let y = ROWS - 2; y >= 4; y--) {
    for (let x = 0; x < COLS; x++) {
      const i = idx(x, y)
      if (isDeployCell(i) && near(i)) push(i)
    }
  }
  for (let y = ROWS - 1; y >= 0; y--) for (let x = 0; x < COLS; x++) push(idx(x, y))
  for (const i of DEPLOY_CELLS) push(i)
  return order.slice(0, count)
}

/** 解锁一格的价格：从第 13 格起涨价。 */
export function unlockCost(unlocked: number): number {
  return 14 + 6 * Math.max(0, unlocked - 12)
}

/** 方格不再绑定三路地形；保留该函数给阵型层判断“是否靠路”。 */
export function laneAtCell(cell: number): LaneId | '' {
  if (cell < 0) return ''
  return 'center'
}

/** 同一列 / 相邻列判断用到的辅助。 */
export function sameColumn(a: number, b: number): boolean {
  return cellX(a) === cellX(b)
}

export function columnDistance(a: number, b: number): number {
  return Math.abs(cellX(a) - cellX(b))
}

export class Board {
  cell = 64
  ox = 0
  oy = 0
  w = COLS * 64
  h = ROWS * 64

  routePts: { center: { x: number; y: number }[] }
  routeLen: { center: number }

  constructor() {
    this.routePts = { center: ROUTE.map((p) => ({ x: p.x, y: p.y })) }
    this.routeLen = { center: (this.routePts.center.length - 1) * SEG }
  }

  /** 换了阵图（新一局 / 读档）：折点与总长一起重算 */
  syncRoute(): void {
    this.routePts = { center: ROUTE.map((p) => ({ x: p.x, y: p.y })) }
    this.routeLen = { center: (this.routePts.center.length - 1) * SEG }
  }

  fit(rectW: number, rectH: number, pad = 0): void {
    this.place(0, 0, rectW, rectH, pad)
  }

  place(x0: number, y0: number, rectW: number, rectH: number, pad = 0): void {
    const cell = Math.max(24, Math.floor(Math.min((rectW - pad * 2) / COLS, (rectH - pad * 2) / ROWS)))
    this.cell = cell
    this.w = cell * COLS
    this.h = cell * ROWS
    this.ox = Math.round(x0 + (rectW - this.w) / 2)
    this.oy = Math.round(y0 + (rectH - this.h) / 2)
  }

  center(i: number): { x: number; y: number } {
    return {
      x: this.ox + (cellX(i) + 0.5) * this.cell,
      y: this.oy + (cellY(i) + 0.5) * this.cell,
    }
  }

  rectOf(i: number): { x: number; y: number; w: number; h: number } {
    return {
      x: this.ox + cellX(i) * this.cell,
      y: this.oy + cellY(i) * this.cell,
      w: this.cell,
      h: this.cell,
    }
  }

  hit(px: number, py: number): number {
    const x = Math.floor((px - this.ox) / this.cell)
    const y = Math.floor((py - this.oy) / this.cell)
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return -1
    return idx(x, y)
  }

  len(_lane: LaneId = 'center'): number {
    return this.routeLen.center
  }

  /** 一个"进度单位"等于多长：相邻两个路点之间的进度差，也就是一格。
   *  排队间距、入口闸门都得按这个算，否则路线拐点多时同一段进度会挤在一起。 */
  segLen(): number {
    const n = this.routePts.center.length
    return this.routeLen.center / Math.max(1, n - 1)
  }

  /** 路线上第 i 个格子中心（i 为格子序号，不是进度） */
  lanePoint(_lane: LaneId, i: number): { x: number; y: number } {
    const pts = this.routePts.center
    const k = Number.isFinite(i) ? Math.max(0, Math.min(pts.length - 1, Math.round(i))) : 0
    const p = pts[k]
    return { x: this.ox + (p.x + 0.5) * this.cell, y: this.oy + (p.y + 0.5) * this.cell }
  }

  /** 把路线进度（0..len）插值成像素坐标；off 为偏离中轴的格数（沿路段的法向，不是固定的 x 方向）。 */
  laneWorld(_lane: LaneId, prog: number, off = 0): { x: number; y: number } {
    const pts = this.routePts.center
    const max = this.routeLen.center
    const p = Number.isFinite(prog) ? Math.max(0, Math.min(max, prog)) : 0
    const o = Number.isFinite(off) ? off : 0
    const t = Math.min(1, Math.max(0, p / max)) * (pts.length - 1)
    const i = Math.min(pts.length - 1, Math.floor(t))
    const f = t - i
    const a = this.lanePoint('center', i)
    const b = this.lanePoint('center', Math.min(pts.length - 1, i + 1))
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    /* 法向：横段上左右错开，竖段上前后错开，拐角处不会把两个人叠在同一像素 */
    const nx = -dy / len
    const ny = dx / len
    return { x: a.x + dx * f + o * this.cell * nx, y: a.y + dy * f + o * this.cell * ny }
  }

  laneIndexAt(_lane: LaneId, prog: number): number {
    const pts = this.routePts.center
    const t = Math.min(1, Math.max(0, prog / this.routeLen.center)) * (pts.length - 1)
    return Math.max(0, Math.min(pts.length - 1, Math.round(t)))
  }

  pathPoint(i: number): { x: number; y: number } {
    return this.lanePoint('center', i)
  }

  world(prog: number, off = 0): { x: number; y: number } {
    return this.laneWorld('center', prog, off)
  }

  pathIndexAt(prog: number): number {
    return this.laneIndexAt('center', prog)
  }

  basePoint(): { x: number; y: number } {
    return this.center(BASE_IDX)
  }

  /** 入口点（画敌军来向）。 */
  entryPoint(): { x: number; y: number } {
    return this.center(idx(ENTRY.x, ENTRY.y))
  }

  neighborsOfPath(i: number, _lane: LaneId = 'center'): number[] {
    const p = ROUTE[Math.max(0, Math.min(ROUTE.length - 1, i))]
    const out: number[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const x = p.x + dx
        const y = p.y + dy
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue
        const cell = idx(x, y)
        if (isDeployCell(cell)) out.push(cell)
      }
    }
    return out
  }

  cellDist(unitCell: number, enemy: { x: number; y: number }): number {
    const c = this.center(unitCell)
    return Math.hypot(c.x - enemy.x, c.y - enemy.y) / this.cell
  }

  drawRect(): { x: number; y: number; w: number; h: number } {
    return { x: this.ox, y: this.oy, w: this.w, h: this.h }
  }
}
