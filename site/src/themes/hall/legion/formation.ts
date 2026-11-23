/* 「笔势」：方格棋盘上的横竖连笔。
 *
 * 这是本作的签名机制，不是光环加成：
 *   · 三名以上友军在同一条横线上连成一笔 → 横锋，周期横扫整行土路；
 *   · 三名以上友军在同一条竖线上连成一笔 → 直锋，同列合击、集火最前一敌。
 * 两者都必须真的走伤害计算、真的画出墨线，而不是写在说明里。
 *
 * 合成本身会抽走一个棋子，因此「合成升级」与「保住一条笔势」天然冲突 ——
 * 这就是合成取舍的来源：升级换数值与人数，保阵换覆盖与合击。
 *
 * 本文件只做纯几何判断（哪些格连成笔），不持有棋盘、不碰战斗。
 */
import { COLS, ROWS, cellX, cellY, idx, isPathCell } from './board'

export type StrokeKind = 'row' | 'col'

export interface Stroke {
  /** 'row:7' / 'col:3'，用来复用计时器 */
  key: string
  kind: StrokeKind
  /** 横笔的行号 / 竖笔的列号 */
  row: number
  col: number
  /** 从一端到另一端的格子序号（按坐标排序，首尾即笔画两端） */
  cells: number[]
  len: number
  /** 被「断笔者」或 Boss 抹笔压住时为 true，只影响表现与结算，不删数据 */
  suppress?: boolean
}

export const STROKE_MIN = 3

/** 连笔的最低人数：三名起步，五名封顶（棋盘左/右各最多 4 格横排）。 */
function pushRun(out: Stroke[], kind: StrokeKind, fixed: number, cells: number[]): void {
  if (cells.length < STROKE_MIN) return
  const first = cells[0]
  out.push({
    key: kind === 'row' ? `row:${fixed}` : `col:${fixed}`,
    kind,
    row: kind === 'row' ? fixed : cellY(first),
    col: kind === 'col' ? fixed : cellX(first),
    cells,
    len: cells.length,
  })
}

/**
 * 从"哪些格上有友军"的集合里找出所有笔势。
 * 只认同一直线上首尾相接的棋子：路格（中央土路）不可布阵，天然把横笔断开。
 */
export function findStrokes(occupied: Set<number>): Stroke[] {
  const out: Stroke[] = []

  for (let y = 0; y < ROWS; y++) {
    const xs: number[] = []
    for (let x = 0; x < COLS; x++) if (occupied.has(idx(x, y))) xs.push(x)
    let run: number[] = []
    let prev = -99
    for (const x of xs) {
      if (x === prev + 1) run.push(x)
      else {
        if (run.length >= STROKE_MIN) pushRun(out, 'row', y, run.map((v) => idx(v, y)))
        run = [x]
      }
      prev = x
    }
    if (run.length >= STROKE_MIN) pushRun(out, 'row', y, run.map((v) => idx(v, y)))
  }

  for (let x = 0; x < COLS; x++) {
    const ys: number[] = []
    for (let y = 0; y < ROWS; y++) if (occupied.has(idx(x, y))) ys.push(y)
    let run: number[] = []
    let prev = -99
    for (const y of ys) {
      if (y === prev + 1) run.push(y)
      else {
        if (run.length >= STROKE_MIN) pushRun(out, 'col', x, run.map((v) => idx(x, v)))
        run = [y]
      }
      prev = y
    }
    if (run.length >= STROKE_MIN) pushRun(out, 'col', x, run.map((v) => idx(x, v)))
  }

  return out
}

/** 某格属于哪些笔势（给单位打标签、给选中面板展示用）。 */
export function strokeTags(strokes: Stroke[]): Map<number, StrokeKind[]> {
  const map = new Map<number, StrokeKind[]>()
  for (const s of strokes) {
    for (const c of s.cells) {
      const list = map.get(c) || []
      if (!list.includes(s.kind)) list.push(s.kind)
      map.set(c, list)
    }
  }
  return map
}

/** 笔势的名字：一眼能看出是横是竖。 */
export function strokeName(kind: StrokeKind): string {
  return kind === 'row' ? '横锋' : '直锋'
}

export function strokeBrief(kind: StrokeKind): string {
  return kind === 'row' ? '横扫整行' : '同列合击'
}

/** 没被压制的笔势数量，给 HUD 用。被压制的单独记，界面上要说"被断"而不是"没阵"。 */
export function strokeSummary(strokes: Stroke[]): { rows: number; cols: number; dead: number; text: string } {
  let rows = 0
  let cols = 0
  let dead = 0
  for (const s of strokes) {
    if (s.suppress) { dead++; continue }
    if (s.kind === 'row') rows++
    else cols++
  }
  const parts: string[] = []
  if (rows) parts.push(`横×${rows}`)
  if (cols) parts.push(`直×${cols}`)
  if (dead) parts.push(`断×${dead}`)
  return { rows, cols, dead, text: parts.join(' ') || '未成阵' }
}

/** 判断是否是可布阵的空格（给阵型预览用）。 */
export function isDeployable(cell: number): boolean {
  return cell >= 0 && cell < COLS * ROWS && !isPathCell(cell)
}
