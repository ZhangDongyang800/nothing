/* 绘制层 v3：宣纸方格棋盘 + 中文文字单位。
 *
 * 这一版刻意不再画小人、折纸道路和地形插画：
 *   · 静态层只画一张纸、9×9 方格、中央土路、营寨；
 *   · 动态层只画文字棋子、敌人、弹道、阵型连线和轻量反馈。
 *
 * 静态棋盘按尺寸/解锁数缓存到离屏 canvas；每帧只贴一次图，
 * 其余都是少量矩形与文字，保证 200 敌人时仍然轻。
 */
import type { HeroId, Unit, UnitKind } from './types'
import type { Board } from './board'
import {
  COLS, ROWS, ENTRY, ROUTE, ROUTE_REV, idx,
  isBaseCell, isDeployCell, isPathCell, unlockCost,
} from './board'
import type { Battle } from './battle'
import { enemyRadius } from './battle'
import type { Effects } from './fx'
import { HERO_BY_ID } from './data/heroes'
import { UNIT_BY_ID } from './data/units'
import { RARITY_COLOR } from './data/rarity'
import { BOSS_BY_ID } from './data/bosses'
import { ENEMY_BY_ID } from './data/enemies'
import type { Stroke } from './formation'

const PAPER = '#fff8e8'
const INK = '#252525'
const SEAL = '#e35b4f'
const GOLD = '#ffd166'
const SERIF = '"STKaiti","KaiTi","Noto Serif SC","Source Han Serif SC","Songti SC",serif'

/* 棋盘上每个兵种压一个字的职能标记：不解释数值，只提示怎么打 */
const KIND_MARK: Record<string, string> = {
  blade: '斩', spear: '穿', bow: '射', cavalry: '冲', mage: '法',
  engineer: '械', warlock: '咒', lance: '贯', halberd: '戟', pyro: '焰',
}

const RARITY_TINT: Record<string, string> = {
  common: '#f1eadc',
  fine: '#e6eddd',
  rare: '#dde8f2',
  epic: '#ece3f2',
  legend: '#f6ead0',
}

export interface DragView {
  from: number
  x: number
  y: number
  target: number
  kind: UnitKind
  lv: number
  veteran: boolean
  merge: boolean
  fuse: boolean
  illegal: boolean
  /** 这次叠合会拆掉的笔势数量 */
  lost: number
  hero: HeroId | ''
}

export interface MergeGhost {
  a: number
  b: number
  cell: number
  kind: UnitKind
  glyph: string
  color: string
  lv: number
  t0: number
}

export interface DrawState {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  board: Board
  battle: Battle
  unlocked: Set<number>
  time: number
  baseHp: number
  baseMax: number
  drag: DragView | null
  merges: MergeGhost[]
  hover: number
  selected: number
  shakeX: number
  shakeY: number
  frozen: boolean
  fx: Effects
  bossIntroT: number
  bossIntroName: string
  /** 阵型联动连线：从 a 格到 b 格 */
  links: { a: number; b: number; kind: string }[]
  /** 笔势：横锋 / 直锋，画成纸上的墨线 */
  strokes: Stroke[]
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export class Scene {
  private staticCv: HTMLCanvasElement | null = null
  private staticKey = ''
  private lowQ = false

  setQuality(q: 'high' | 'low'): void { this.lowQ = q === 'low' }

  /* ---------------- 静态棋盘 ---------------- */

  private buildStatic(s: DrawState): void {
    const b = s.board
    const W = Math.max(1, s.w)
    const H = Math.max(1, s.h)
    const cv = document.createElement('canvas')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)

    /* 纸：暖米底 + 四角压暗。大面积同色最容易显灰，所以底色不是一块平涂，
       而是中间亮、边角沉的一张旧纸；纤维只做 5% 的斜纹，不抢棋子。 */
    const paper = g.createLinearGradient(0, 0, W * 0.9, H)
    paper.addColorStop(0, '#fff8e8')
    paper.addColorStop(0.5, '#fff8e8')
    paper.addColorStop(1, '#fffdf7')
    g.fillStyle = paper
    g.fillRect(0, 0, W, H)

    const vig = g.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.28, W * 0.5, H * 0.5, Math.max(W, H) * 0.82)
    vig.addColorStop(0, 'rgba(255,253,247,0)')
    vig.addColorStop(0.62, 'rgba(150,120,80,0)')
    vig.addColorStop(1, 'rgba(37,37,37,0.06)')
    g.fillStyle = vig
    g.fillRect(0, 0, W, H)

    g.save()
    g.globalAlpha = 0.045
    g.strokeStyle = '#252525'
    g.lineWidth = 1
    const gap = this.lowQ ? 26 : 15
    for (let x = -H; x < W + H; x += gap) {
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x + H * 0.2, H)
      g.stroke()
    }
    g.globalAlpha = 0.02
    for (let y = 0; y < H; y += 7) {
      g.fillStyle = y % 14 ? '#9b8461' : '#fbf6e9'
      g.fillRect(0, y, W, 1)
    }
    g.restore()

    const inset = Math.max(2, Math.round(b.cell * 0.045))
    const rad = Math.max(2, Math.round(b.cell * 0.05))
    const fenceW = Math.max(2, b.cell * 0.035)

    /* 棋盘底板：一张压着墨线的沙盘纸，比单层 strokeRect 更像战场 */
    g.save()
    g.fillStyle = 'rgba(37,37,37,0.16)'
    roundRect(g, b.ox - 12, b.oy - 9, b.w + 24, b.h + 24, 6)
    g.fill()
    const plate = g.createLinearGradient(b.ox, b.oy, b.ox, b.oy + b.h)
    plate.addColorStop(0, 'rgba(255,253,247,1)')
    plate.addColorStop(1, 'rgba(255,253,247,1)')
    g.fillStyle = plate
    roundRect(g, b.ox - 9, b.oy - 9, b.w + 18, b.h + 18, 4)
    g.fill()
    g.restore()

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const i = idx(x, y)
        const rx = b.ox + x * b.cell + inset
        const ry = b.oy + y * b.cell + inset
        const rw = b.cell - inset * 2
        const cell = b.cell
        const cx = rx + rw / 2
        const cy = ry + rw / 2

        if (isPathCell(i)) {
          if (isBaseCell(i)) {
            /* 营寨：一座压在纸上的小城。城垛 + 双层门额 */
            const halo = g.createRadialGradient(cx, cy, cell * 0.2, cx, cy, cell * 0.95)
            halo.addColorStop(0, 'rgba(168,53,42,0.30)')
            halo.addColorStop(1, 'rgba(168,53,42,0)')
            g.fillStyle = halo
            g.fillRect(b.ox + x * cell, b.oy + y * cell, cell, cell)

            g.fillStyle = '#e35b4f'
            roundRect(g, rx, ry + cell * 0.06, rw, rw - cell * 0.06, rad)
            g.fill()
            g.fillStyle = '#c8433a'
            const teeth = 5
            const tw = rw / (teeth * 2 - 1)
            for (let k = 0; k < teeth; k++) g.fillRect(rx + tw * (k * 2), ry, tw, cell * 0.09)
            g.strokeStyle = 'rgba(255,253,247,0.85)'
            g.lineWidth = 1.2
            roundRect(g, rx + cell * 0.07, ry + cell * 0.16, rw - cell * 0.14, rw - cell * 0.22, rad)
            g.stroke()
            g.fillStyle = '#fffdf7'
            g.font = '700 ' + Math.round(cell * 0.26) + 'px ' + SERIF
            g.textAlign = 'center'
            g.textBaseline = 'middle'
            g.fillText('寨', cx, ry + rw * 0.44)
            g.font = '500 ' + Math.round(cell * 0.10) + 'px ' + SERIF
            g.globalAlpha = 0.86
            g.fillText('营 寨', cx, ry + rw * 0.73)
            g.globalAlpha = 1
          } else {
            /* 行军土路：三层。底色吃光、中间浅、边线深 */
            const px = b.ox + x * cell
            const py = b.oy + y * cell
            g.fillStyle = '#ffd166'
            g.fillRect(px, py, cell, cell)
            const inner = cell * 0.16
            g.fillStyle = '#ffe9a8'
            roundRect(g, px + inner, py + inner, cell - inner * 2, cell - inner * 2, cell * 0.05)
            g.fill()
            const at = ROUTE.findIndex((p) => p.x === x && p.y === y)
            const nx2 = ROUTE[Math.min(ROUTE.length - 1, at + 1)]
            const lx = nx2 ? (nx2.x - x) * cell * 0.2 : 0
            const ly = nx2 ? (nx2.y - y) * cell * 0.2 : 0
            /* 车辙：两道极淡的平行短线，跟行进方向一致 */
            g.strokeStyle = withAlpha('#252525', 0.35)
            g.lineWidth = Math.max(1, cell * 0.02)
            for (const sgn of [-1, 1]) {
              g.beginPath()
              g.moveTo(cx - lx + ly * 0.22 * sgn, cy - ly - lx * 0.22 * sgn)
              g.lineTo(cx + lx + ly * 0.22 * sgn, cy + ly - lx * 0.22 * sgn)
              g.stroke()
            }

            if (i === idx(ENTRY.x, ENTRY.y)) {
              /* 敌军入口：一枚压在路口的朱砂封 */
              g.save()
              g.translate(cx, cy)
              g.fillStyle = withAlpha(SEAL, 0.94)
              roundRect(g, -rw * 0.44, -rw * 0.44, rw * 0.88, rw * 0.88, cell * 0.06)
              g.fill()
              g.strokeStyle = 'rgba(255,253,247,0.9)'
              g.lineWidth = 1.2
              roundRect(g, -rw * 0.37, -rw * 0.37, rw * 0.74, rw * 0.74, cell * 0.05)
              g.stroke()
              g.fillStyle = '#fffdf7'
              g.font = '700 ' + Math.round(cell * 0.24) + 'px ' + SERIF
              g.textAlign = 'center'
              g.textBaseline = 'middle'
              g.fillText('入', 0, -cell * 0.02)
              g.font = '500 ' + Math.round(cell * 0.085) + 'px ' + SERIF
              g.globalAlpha = 0.8
              g.fillText('敌 军', 0, cell * 0.19)
              g.globalAlpha = 1
              g.restore()
            } else if (at >= 0 && nx2) {
              /* 行进方向：一支墨箭头，拐弯的格一眼看得出往哪拐 */
              const dx = (nx2.x - x) * cell * 0.19
              const dy = (nx2.y - y) * cell * 0.19
              g.strokeStyle = withAlpha('#252525', 0.75)
              g.lineWidth = Math.max(1.4, cell * 0.026)
              g.lineCap = 'round'
              g.beginPath()
              g.moveTo(cx - dx, cy - dy)
              g.lineTo(cx + dx, cy + dy)
              g.stroke()
              g.beginPath()
              g.moveTo(cx + dx * 0.86 - dy * 0.34, cy + dy * 0.86 + dx * 0.34)
              g.lineTo(cx + dx, cy + dy)
              g.lineTo(cx + dx * 0.86 + dy * 0.34, cy + dy * 0.86 - dx * 0.34)
              g.stroke()
            }
          }
          continue
        }

        /* 布阵格：一张压了墨角的小纸片，不是虚线框 */
        if (s.unlocked.has(i)) {
          g.fillStyle = '#fffdf7'
          roundRect(g, rx, ry, rw, rw, rad)
          g.fill()
          g.strokeStyle = withAlpha('#252525', 0.9)
          g.lineWidth = 1
          roundRect(g, rx, ry, rw, rw, rad)
          g.stroke()
          if (y >= 6) {
            g.fillStyle = withAlpha(SEAL, 0.045)
            roundRect(g, rx, ry, rw, rw, rad)
            g.fill()
          }
          /* 四个墨角：比刻度短线更像可落子的棋位 */
          const tick = Math.round(cell * 0.13)
          g.strokeStyle = withAlpha('#252525', 0.85)
          g.lineWidth = Math.max(1, cell * 0.018)
          for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const px2 = rx + sx * rw
            const py2 = ry + sy * rw
            g.beginPath()
            g.moveTo(px2 + (sx ? -tick : tick), py2)
            g.lineTo(px2, py2)
            g.lineTo(px2, py2 + (sy ? -tick : tick))
            g.stroke()
          }
          g.globalAlpha = 0.16
          g.fillStyle = INK
          g.beginPath()
          g.arc(cx, cy, Math.max(1.2, cell * 0.028), 0, Math.PI * 2)
          g.fill()
          g.globalAlpha = 1
        } else {
          /* 未解锁：一道很淡的斜纹，读作这块还能开 */
          g.fillStyle = 'rgba(37,37,37,0.05)'
          roundRect(g, rx, ry, rw, rw, rad)
          g.fill()
          g.save()
          g.beginPath()
          roundRect(g, rx, ry, rw, rw, rad)
          g.clip()
          g.strokeStyle = 'rgba(37,37,37,0.16)'
          g.lineWidth = Math.max(1, cell * 0.03)
          for (let k = -rw; k < rw * 2; k += cell * 0.22) {
            g.beginPath()
            g.moveTo(rx + k, ry + rw)
            g.lineTo(rx + k + rw, ry)
            g.stroke()
          }
          g.restore()
          g.strokeStyle = 'rgba(37,37,37,0.3)'
          g.lineWidth = 1
          roundRect(g, rx, ry, rw, rw, rad)
          g.stroke()
        }
      }
    }

    /* 走廊外沿：只描这一格是路、邻居不是路的那条边 */
    const routeSet = new Set<number>(ROUTE.map((p) => idx(p.x, p.y)))
    g.strokeStyle = withAlpha('#252525', 1)
    g.lineWidth = fenceW
    g.lineCap = 'square'
    g.beginPath()
    for (const p of ROUTE) {
      if (isBaseCell(idx(p.x, p.y))) continue
      const x0 = b.ox + p.x * b.cell
      const y0 = b.oy + p.y * b.cell
      const x1 = x0 + b.cell
      const y1 = y0 + b.cell
      if (!routeSet.has(idx(p.x, p.y - 1))) { g.moveTo(x0, y0); g.lineTo(x1, y0) }
      if (!routeSet.has(idx(p.x, p.y + 1))) { g.moveTo(x0, y1); g.lineTo(x1, y1) }
      if (!routeSet.has(idx(p.x - 1, p.y))) { g.moveTo(x0, y0); g.lineTo(x0, y1) }
      if (!routeSet.has(idx(p.x + 1, p.y))) { g.moveTo(x1, y0); g.lineTo(x1, y1) }
    }
    g.stroke()

    /* 中轴：一条虚线，读作行军线 */
    g.setLineDash([5, 8])
    g.strokeStyle = withAlpha('#252525', 0.3)
    g.lineWidth = Math.max(1, b.cell * 0.02)
    g.beginPath()
    ROUTE.forEach((p, k) => {
      const cx2 = b.ox + (p.x + 0.5) * b.cell
      const cy2 = b.oy + (p.y + 0.5) * b.cell
      if (k === 0) g.moveTo(cx2, cy2)
      else g.lineTo(cx2, cy2)
    })
    g.stroke()
    g.setLineDash([])

    /* 棋盘外框：双墨线 + 四角朱砂小印 */
    g.strokeStyle = '#6b4c2c'
    g.lineWidth = Math.max(1.6, b.cell * 0.028)
    g.strokeRect(b.ox - 3, b.oy - 3, b.w + 6, b.h + 6)
    g.strokeStyle = withAlpha('#252525', 0.85)
    g.lineWidth = 1
    g.strokeRect(b.ox - 9, b.oy - 9, b.w + 18, b.h + 18)
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = b.ox - 9 + sx * (b.w + 18)
      const py = b.oy - 9 + sy * (b.h + 18)
      g.fillStyle = withAlpha(SEAL, 0.85)
      g.fillRect(px - 3, py - 3, 6, 6)
    }

    this.staticCv = cv
    this.staticKey = `${W}x${H}:${b.cell}:${b.ox}:${b.oy}:${s.unlocked.size}:${ROUTE_REV}`
  }

  /* ---------------- 主绘制 ---------------- */

  draw(s: DrawState): void {
    const ctx = s.ctx
    const key = `${s.w}x${s.h}:${s.board.cell}:${s.board.ox}:${s.board.oy}:${s.unlocked.size}:${ROUTE_REV}`
    if (!this.staticCv || key !== this.staticKey) this.buildStatic(s)

    ctx.save()
    ctx.translate(s.shakeX, s.shakeY)

    if (this.staticCv) ctx.drawImage(this.staticCv, 0, 0, s.w, s.h)
    else {
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, s.w, s.h)
    }

    const b = s.board
    const cell = b.cell
    const selected = s.battle.units.find((u) => u.active && u.cell === s.selected)

    /* 锁定格的价钱只在悬停/选中时出现 */
    if (s.hover >= 0 && !s.unlocked.has(s.hover) && isDeployCell(s.hover)) {
      const r = b.rectOf(s.hover)
      const cost = unlockCost(s.unlocked.size)
      ctx.fillStyle = 'rgba(44,38,29,0.82)'
      roundRect(ctx, r.x + cell * 0.08, r.y + cell * 0.3, cell * 0.84, cell * 0.4, cell * 0.08)
      ctx.fill()
      ctx.fillStyle = '#f7ecd6'
      ctx.font = `600 ${Math.round(cell * 0.155)}px ${SERIF}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`${cost} 银`, r.x + cell * 0.5, r.y + cell * 0.51)
    }

    /* 选中单位的射程：把格心落在射程内的格子浅浅染色 */
    if (selected) {
      const range = selected.range
      ctx.fillStyle = 'rgba(184,134,11,0.10)'
      for (let i = 0; i < COLS * ROWS; i++) {
        if (i === selected.cell) continue
        const c = b.center(i)
        const p = b.center(selected.cell)
        const d = Math.hypot(c.x - p.x, c.y - p.y) / cell
        if (d <= range + 0.35) {
          const r = b.rectOf(i)
          roundRect(ctx, r.x + 4, r.y + 4, cell - 8, cell - 8, cell * 0.08)
          ctx.fill()
        }
      }
    }

    /* 阵型连线：正常很淡；选中相关的那一条加深 */
    for (const l of s.links) {
      const a = b.center(l.a)
      const bb = b.center(l.b)
      const activeLink = selected && (selected.cell === l.a || selected.cell === l.b)
      ctx.save()
      ctx.globalAlpha = activeLink ? 0.85 : 0.28
      ctx.strokeStyle = activeLink ? GOLD : '#7b6b4e'
      ctx.lineWidth = activeLink ? 2 : 1
      ctx.setLineDash([4, 5])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(bb.x, bb.y)
      ctx.stroke()
      ctx.setLineDash([])
      if (activeLink) {
        ctx.fillStyle = GOLD
        ctx.font = `700 ${Math.round(cell * 0.13)}px ${SERIF}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(l.kind, (a.x + bb.x) / 2, (a.y + bb.y) / 2 - cell * 0.12)
      }
      ctx.restore()
    }

    /* 地面区域效果 */
    for (const z of s.battle.zones) {
      if (!z.active) continue
      const a = Math.max(0, 1 - z.age / Math.max(0.01, z.life))
      ctx.beginPath()
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(z.color, 0.10 * a)
      ctx.fill()
      ctx.strokeStyle = withAlpha(z.color, 0.5 * a)
      ctx.lineWidth = 1.4
      ctx.stroke()
    }

    /* 敌人挪到棋子之后画：之前棋子压在敌人身上，玩家看到的是"敌人被吃掉一半"。
       敌人是走在路上的，本就在棋子前面一层，压住棋子才符合视线。 */

    /* 合成：两个同名字阶向目标格聚拢，随后由 fx 的冲击波收尾 */
    for (const m of s.merges) {
      const age = s.time - m.t0
      if (age < 0 || age > 0.46) continue
      const t = age / 0.46
      const ease = (1 - Math.cos(Math.PI * t)) * 0.5
      const dst = b.center(m.cell)
      for (const from of [m.a, m.b]) {
        const src = b.center(from)
        const x = src.x + (dst.x - src.x) * ease
        const y = src.y + (dst.y - src.y) * ease - Math.sin(Math.PI * t) * cell * 0.16
        ctx.save()
        ctx.globalAlpha = Math.max(0, 1 - t)
        ctx.translate(x, y)
        ctx.fillStyle = withAlpha(m.color, 0.18)
        roundRect(ctx, -cell * 0.4, -cell * 0.4, cell * 0.8, cell * 0.8, cell * 0.08)
        ctx.fill()
        ctx.strokeStyle = withAlpha(m.color, 0.7)
        ctx.lineWidth = 1.5
        roundRect(ctx, -cell * 0.4, -cell * 0.4, cell * 0.8, cell * 0.8, cell * 0.08)
        ctx.stroke()
        ctx.fillStyle = INK
        ctx.font = `700 ${Math.round(cell * 0.38)}px ${SERIF}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(m.glyph, 0, 0)
        ctx.restore()
      }
    }

    /* 友军文字棋子 */
    for (const u of s.battle.units) {
      if (!u.active) continue
      this.drawUnit(ctx, s, u, u.cell === s.selected)
    }

    /* 选中单位与友邻的联动：给受影响的那一格描金边，线下藏在棋子下也能看懂 */
    if (selected) {
      for (const l of s.links) {
        if (l.a !== selected.cell && l.b !== selected.cell) continue
        const other = l.a === selected.cell ? l.b : l.a
        if (!s.unlocked.has(other)) continue
        const r = b.rectOf(other)
        ctx.strokeStyle = withAlpha(GOLD, 0.85)
        ctx.lineWidth = 2
        ctx.setLineDash([5, 4])
        roundRect(ctx, r.x + 5, r.y + 5, cell - 10, cell - 10, cell * 0.07)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = GOLD
        ctx.font = `700 ${Math.round(cell * 0.12)}px ${SERIF}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`+${l.kind}`, r.x + cell * 0.09, r.y + cell * 0.08)
      }
    }

    /* 笔势：一枚枚棋子下沿被"划"上一笔，连起来就是一条阵。
       压在棋子下沿而不是棋子中间，是为了不挡字，也避免看成格线。 */
    for (const st of s.strokes) this.drawStroke(ctx, s, st, selected);

    /* 敌人（压在棋子之上，经过谁的格子都不会被切掉半张脸） */
    for (const e of s.battle.enemies) {
      if (!e.active) continue
      this.drawEnemy(ctx, s, e)
    }

    /* 攻击墨线：压在敌人身上，才读得出"这一下打中了它" */
    this.drawBeams(ctx, s)

    /* 拖拽收在最上层：虚影、落点、合/融、拆阵提示都必须压住棋子，才看得见 */
    if (s.drag) {
      this.drawGhost(ctx, s)
      if (s.drag.from !== s.drag.target && s.drag.target >= 0) {
        const r = b.rectOf(s.drag.target)
        const col = s.drag.illegal ? '#a8352a' : s.drag.merge ? GOLD : s.drag.fuse ? '#a04a2c' : '#3f6b3a'
        ctx.strokeStyle = col
        ctx.lineWidth = 3
        ctx.setLineDash(s.drag.illegal ? [5, 4] : [])
        roundRect(ctx, r.x + 4, r.y + 4, cell - 8, cell - 8, cell * 0.08)
        ctx.stroke()
        ctx.setLineDash([])
        if (s.drag.merge || s.drag.fuse) {
          ctx.fillStyle = withAlpha(col, 0.12)
          roundRect(ctx, r.x + 4, r.y + 4, cell - 8, cell - 8, cell * 0.08)
          ctx.fill()
          /* 合/融 做成左侧一枚小印，避开右上角的等级徽标 */
          const seal = cell * 0.26
          const sx = r.x + cell * 0.17
          const sy = r.y + cell * 0.5
          ctx.fillStyle = withAlpha('#f7edd8', 0.95)
          ctx.beginPath()
          ctx.arc(sx, sy, seal, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = col
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.arc(sx, sy, seal, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = col
          ctx.font = `900 ${Math.round(cell * 0.15)}px ${SERIF}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(s.drag.fuse ? '融' : '合', sx, sy + 0.5)
        }
        /* 这一步会断掉几条笔势：先告诉你，再让你决定合不合 */
        if (s.drag.lost > 0) {
          ctx.fillStyle = withAlpha('#f7edd8', 0.94)
          roundRect(ctx, r.x + cell * 0.05, r.y + cell * 0.76, cell * 0.9, cell * 0.22, cell * 0.06)
          ctx.fill()
          ctx.strokeStyle = withAlpha(SEAL, 0.55)
          ctx.lineWidth = 1
          roundRect(ctx, r.x + cell * 0.05, r.y + cell * 0.76, cell * 0.9, cell * 0.22, cell * 0.06)
          ctx.stroke()
          ctx.fillStyle = SEAL
          ctx.font = `800 ${Math.round(cell * 0.125)}px ${SERIF}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`拆阵 -${s.drag.lost}`, r.x + cell * 0.5, r.y + cell * 0.875)
        }
      }
    }

    /* 弹道 */
    for (const p of s.battle.projs) {
      if (!p.active) continue
      this.drawProj(ctx, p, cell)
    }

    /* 粒子 / 飘字 / 冲击波 */
    s.fx.draw(ctx)


    /* Boss 入场 */
    if (s.bossIntroT > 0) {
      const a = Math.min(1, s.bossIntroT)
      ctx.save()
      ctx.globalAlpha = a
      ctx.fillStyle = 'rgba(30,24,16,0.22)'
      ctx.fillRect(0, 0, s.w, s.h)
      ctx.textAlign = 'center'
      ctx.fillStyle = '#f7ead2'
      ctx.font = `700 ${Math.round(Math.min(s.w, s.h) * 0.056)}px ${SERIF}`
      ctx.fillText(s.bossIntroName, s.w / 2, s.h * 0.44)
      ctx.fillStyle = withAlpha(GOLD, 0.9)
      ctx.font = `500 ${Math.round(Math.min(s.w, s.h) * 0.017)}px ${SERIF}`
      ctx.fillText('B O S S', s.w / 2, s.h * 0.44 + Math.min(s.w, s.h) * 0.045)
      ctx.restore()
    }

    if (s.frozen) {
      ctx.fillStyle = 'rgba(120,160,190,0.16)'
      ctx.fillRect(0, 0, s.w, s.h)
    }

    ctx.restore()
  }

  /* ---------------- 笔势墨线 ---------------- */

  /**
   * 一笔划在棋子边上：横锋＝每枚棋子底边一道墨痕，直锋＝每枚棋子朝土路那一侧一道墨痕；
   * 痕迹跨过格缝连成一条，就是这排/这列的"笔"。不压字，也不像表格边框。
   * 选中时转金，被断笔者压住时转朱砂虚线并盖「断」印。
   */
  /** 弹道：脱手即淡出，宽的那道（横扫/Boss 墨线）带一层更淡的外晕。
      以前这些只在战斗内核里排队、没人画出来，所有"穿透/连锁"看着都像没发生。 */
  private drawBeams(ctx: CanvasRenderingContext2D, s: DrawState): void {
    if (!s.battle.beams.length) return
    for (const b of s.battle.beams) {
      if (!b.active) continue
      const life = Math.max(0.01, b.life)
      const t = Math.max(0, Math.min(1, b.age / life))
      const fade = 1 - t
      const w = Math.max(1, b.width * (1 - t * 0.45))
      ctx.save()
      ctx.lineCap = 'butt'
      ctx.lineJoin = 'round'
      /* 外晕：一团抹开的墨，告诉玩家"这整片都被扫了" */
      if (b.width >= 6) {
        ctx.globalAlpha = 0.22 * fade
        ctx.strokeStyle = withAlpha(b.color, 0.5)
        ctx.lineWidth = w * 2.2
        ctx.beginPath()
        ctx.moveTo(b.x1, b.y1)
        ctx.lineTo(b.x2, b.y2)
        ctx.stroke()
      }
      /* 内芯 */
      ctx.globalAlpha = 0.9 * fade
      ctx.strokeStyle = b.color
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(b.x1, b.y1)
      ctx.lineTo(b.x2, b.y2)
      ctx.stroke()
      /* 亮芯：宽的光束（横扫/冲锋/穿刺）再压一条更细的暖白，让线条"发热" */
      if (b.width >= 4) {
        ctx.globalAlpha = 0.55 * fade
        ctx.strokeStyle = '#fff3cf'
        ctx.lineWidth = Math.max(1, w * 0.42)
        ctx.beginPath()
        ctx.moveTo(b.x1, b.y1)
        ctx.lineTo(b.x2, b.y2)
        ctx.stroke()
      }
      ctx.restore()
    }
  }

  private drawStroke(ctx: CanvasRenderingContext2D, s: DrawState, st: Stroke, selected: Unit | undefined): void {
    const b = s.board
    const cell = b.cell
    const row = st.kind === 'row'
    /* 直锋的墨痕落在远离土路的那一侧，免得和土路本身的边线混成一条 */
    const outer = st.col < 4 ? 0 : 1
    const hot = !!selected && st.cells.includes(selected.cell)
    const dead = !!st.suppress
    const ink = dead ? SEAL : hot ? GOLD : INK
    const thick = Math.max(3, cell * (hot ? 0.075 : 0.062))
    const seed = (st.key.charCodeAt(0) * 7 + st.key.length) % 7

    ctx.save()

    /* 淡淡的墨洗圈住整组：只染一层很浅的纸色，告诉眼睛"这几枚是一个阵" */
    const q0 = b.rectOf(st.cells[0])
    const q1 = b.rectOf(st.cells[st.cells.length - 1])
    const qx = q0.x + cell * 0.03
    const qy = q0.y + cell * 0.03
    const qw = row ? (q1.x - q0.x) + cell * 0.94 : cell * 0.94
    const qh = row ? cell * 0.94 : (q1.y - q0.y) + cell * 0.94
    ctx.globalAlpha = dead ? 0.3 : 1
    ctx.fillStyle = withAlpha(ink, 0.045)
    roundRect(ctx, qx, qy, qw, qh, cell * 0.09)
    ctx.fill()
    ctx.strokeStyle = withAlpha(ink, dead ? 0.18 : hot ? 0.7 : 0.22)
    ctx.lineWidth = hot ? 1.6 : 1
    roundRect(ctx, qx, qy, qw, qh, cell * 0.09)
    ctx.stroke()
    ctx.globalAlpha = 1

    /* 一笔画在整组的边上：起点在格缝里，微微起伏，两头收锋。
       画成直的粗线会像控件边框，起伏加收锋才像毛笔。 */
    const ax = row ? q0.x + cell * 0.08 : q0.x + (outer ? cell * 0.985 : cell * 0.015)
    const ay = row ? q0.y + cell * 0.985 : q0.y + cell * 0.08
    const bx = row ? q1.x + cell * 0.92 : ax
    const by = row ? ay : q1.y + cell * 0.92
    const len = Math.max(1, Math.hypot(bx - ax, by - ay))
    const ux = (bx - ax) / len
    const uy = (by - ay) / len
    const seg = 10
    const amp = cell * 0.012 + seed * 0.4

    /* 洇墨：同一笔再铺一层更宽更淡的底 */
    ctx.globalAlpha = dead ? 0.3 : 0.5
    ctx.fillStyle = withAlpha(ink, 0.28)
    this.brushPath(ctx, ax, ay, ux, uy, len, seg, thick * 2.1, amp)
    ctx.globalAlpha = dead ? 0.4 : 1
    ctx.fillStyle = withAlpha(ink, dead ? 0.55 : hot ? 0.95 : 0.8)
    this.brushPath(ctx, ax, ay, ux, uy, len, seg, thick, amp)

    /* 收笔：末端拖出一小截更细的飞白，方向顺着行笔 */
    ctx.globalAlpha = dead ? 0.3 : 0.55
    ctx.strokeStyle = withAlpha(ink, 0.8)
    ctx.lineWidth = Math.max(1, thick * 0.35)
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + ux * cell * 0.1 - uy * amp, by + uy * cell * 0.1 + ux * amp)
    ctx.stroke()
    ctx.globalAlpha = 1

    /* 被压制：整条笔改朱砂虚线，中点盖「断」印，只有异常状态才出字 */
    if (dead) {
      const a = b.center(st.cells[0])
      const c = b.center(st.cells[st.cells.length - 1])
      ctx.globalAlpha = 1
      ctx.setLineDash([cell * 0.12, cell * 0.1])
      ctx.strokeStyle = withAlpha(SEAL, 0.55)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      if (row) {
        ctx.moveTo(a.x - cell * 0.42, a.y + cell * 0.4)
        ctx.lineTo(c.x + cell * 0.42, c.y + cell * 0.4)
      } else {
        const x = outer ? a.x + cell * 0.4 : a.x - cell * 0.4
        ctx.moveTo(x, a.y - cell * 0.42)
        ctx.lineTo(x, c.y + cell * 0.42)
      }
      ctx.stroke()
      ctx.setLineDash([])
      const mx = row ? (a.x + c.x) / 2 : a.x + (outer ? cell * 0.4 : -cell * 0.4)
      const my = row ? a.y + cell * 0.4 : (a.y + c.y) / 2
      const tag = cell * 0.26
      ctx.fillStyle = withAlpha('#f7edd8', 0.92)
      roundRect(ctx, mx - tag / 2, my - tag / 2, tag, tag, tag * 0.2)
      ctx.fill()
      ctx.strokeStyle = withAlpha(SEAL, 0.5)
      ctx.lineWidth = 1
      roundRect(ctx, mx - tag / 2, my - tag / 2, tag, tag, tag * 0.2)
      ctx.stroke()
      ctx.fillStyle = withAlpha(SEAL, 0.95)
      ctx.font = `700 ${Math.round(cell * 0.115)}px ${SERIF}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('断', mx, my + 0.5)
    }
    ctx.restore()
  }

  /** 一笔的两侧轮廓：中间厚、两头收锋，并沿法向轻轻起伏 */
  private brushPath(
    ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number,
    len: number, seg: number, width: number, amp: number,
  ): void {
    const pts: { x: number; y: number; w: number }[] = []
    for (let i = 0; i <= seg; i++) {
      const t = i / seg
      const s = Math.sin(t * Math.PI * 2.1) * amp * 0.55
      pts.push({
        x: x + ux * len * t - uy * s,
        y: y + uy * len * t + ux * s,
        w: width * (0.34 + 0.78 * Math.sin(Math.PI * Math.min(1, t * 1.04))),
      })
    }
    ctx.beginPath()
    for (let i = 0; i <= seg; i++) {
      const p = pts[i]
      const px = p.x - uy * p.w / 2
      const py = p.y + ux * p.w / 2
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    for (let i = seg; i >= 0; i--) {
      const p = pts[i]
      ctx.lineTo(p.x + uy * p.w / 2, p.y - ux * p.w / 2)
    }
    ctx.closePath()
    ctx.fill()
  }

  /* ---------------- 文字棋子 ---------------- */

  private drawUnit(ctx: CanvasRenderingContext2D, s: DrawState, u: Unit, selected: boolean): void {
    const b = s.board
    const cell = b.cell
    const def = UNIT_BY_ID[u.kind]
    const hero = u.hero ? HERO_BY_ID[u.hero] : null
    const color = hero ? hero.color : RARITY_COLOR[def.rarity]
    const c = b.center(u.cell)

    const pop = Math.max(0, Math.min(1, u.born / 0.34))
    const scale = pop < 1 ? Math.max(0.2, easeOutBack(pop)) : 1
    const idle = Math.sin(s.time * 2.4 + u.id + u.cell) * 0.006 * cell
    const hit = u.hitT > 0 ? Math.sin(u.hitT * 55) * 2.4 : 0
    const lungeAmt = u.lungeT > 0 ? cell * 0.07 * Math.min(1, u.lungeT * 9) : 0
    const lungeX = Math.cos(u.lungeDir) * lungeAmt
    const lungeY = Math.sin(u.lungeDir) * lungeAmt
    /* 出手那一下整体往前"压"一点，棋子有重量感 */
    const swingK = u.swing > 0 ? Math.sin(Math.min(1, (0.18 - u.swing) / 0.18) * Math.PI) : 0
    const alpha = pop <= 0 ? 0 : 1

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(c.x + hit + lungeX, c.y + idle + lungeY)
    ctx.scale(scale * (1 + swingK * 0.055), scale * (1 - swingK * 0.025))

    /* 兵牌：墨黑方块 + 纸色汉字，右下压一块品质色硬阴影（官网撞色纸片的做法）。
       第一眼靠白字认兵种，第二眼靠色块认品质，第三眼才看等级。 */
    const w = cell * 0.92
    const h = cell * 0.92
    const x = -w / 2
    const y = -h / 2
    const cut = cell * 0.07

    /* 入场：品质色纸晕。只有史诗、传说和统帅有 */
    if (pop < 0.85 && (hero || def.rarity === 'epic' || def.rarity === 'legend')) {
      const left = Math.max(0, 1 - pop / 0.85)
      ctx.strokeStyle = withAlpha(color, 0.55 * left)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(0, 0, cell * (0.34 + 0.26 * (1 - left)), 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = withAlpha(color, 0.08 * left)
      ctx.beginPath()
      ctx.arc(0, 0, cell * 0.5, 0, Math.PI * 2)
      ctx.fill()
    }

    /* 品质色硬阴影：偏移实块，不是柔光 */
    ctx.fillStyle = color
    roundRect(ctx, x + 2.5, y + 3.5, w, h, cut)
    ctx.fill()

    const face = ctx.createLinearGradient(0, y, 0, y + h)
    face.addColorStop(0, '#3a3a3a')
    face.addColorStop(1, '#252525')
    ctx.fillStyle = face
    roundRect(ctx, x, y, w, h, cut)
    ctx.fill()

    /* 左侧品质书签 */
    ctx.fillStyle = color
    roundRect(ctx, x + cell * 0.035, y + cell * 0.1, cell * 0.042, h - cell * 0.2, 1.5)
    ctx.fill()

    ctx.strokeStyle = color
    ctx.lineWidth = selected ? 2.4 : 1.5
    roundRect(ctx, x, y, w, h, cut)
    ctx.stroke()

    /* 稀有以上：内细框；统帅：金色双框 */
    if (def.rarity === 'rare' || def.rarity === 'epic' || def.rarity === 'legend' || hero) {
      ctx.strokeStyle = withAlpha(hero ? GOLD : color, hero ? 0.6 : 0.32)
      ctx.lineWidth = 1
      roundRect(ctx, x + cell * 0.055, y + cell * 0.055, w - cell * 0.11, h - cell * 0.11, cut * 0.7)
      ctx.stroke()
    }

    /* 等级：一枚小角牌，字号跟着格子走 */
    const badge = Math.max(11, Math.round(cell * 0.235))
    const bx = x + w - badge - cell * 0.045
    const by = y + cell * 0.045
    ctx.fillStyle = u.lv >= 4 ? color : '#fffdf7'
    roundRect(ctx, bx, by, badge, badge, badge * 0.22)
    ctx.fill()
    ctx.fillStyle = '#fff8e8'
    ctx.font = '800 ' + Math.round(badge * 0.55) + 'px ' + SERIF
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(u.lv), bx + badge / 2, by + badge / 2 + 0.5)

    /* 主字：兵种字放到足够大，纸色压在墨底上 */
    if (u.flash > 0) ctx.fillStyle = withAlpha(color, 0.95)
    else ctx.fillStyle = '#fffdf7'
    ctx.font = '700 ' + Math.round(cell * (u.lv >= 4 ? 0.48 : 0.5)) + 'px ' + SERIF
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(hero ? hero.glyph : def.glyph, cell * 0.015, -cell * 0.035)

    /* 底部职能：一个字说明它怎么打 */
    if (cell >= 56) {
      const mark = KIND_MARK[u.kind] || ''
      ctx.fillStyle = withAlpha('#fffdf7', 0.62)
      ctx.font = '500 ' + Math.round(cell * 0.115) + 'px ' + SERIF
      ctx.textAlign = 'center'
      ctx.fillText(mark, cell * 0.015, cell * 0.305)
    }

    if (u.veteran) {
      ctx.fillStyle = SEAL
      ctx.font = '800 ' + Math.round(cell * 0.105) + 'px ' + SERIF
      ctx.textAlign = 'left'
      ctx.fillText('锐', x + cell * 0.1, y + h - cell * 0.09)
    }

    if (hero) {
      ctx.fillStyle = GOLD
      ctx.font = '800 ' + Math.round(cell * 0.115) + 'px ' + SERIF
      ctx.textAlign = 'right'
      ctx.fillText('将', x + w - cell * 0.08, y + h - cell * 0.09)
    }

    /* 友军不画血条：守军只看阵型和闪白，不拿血条占画面 */

    ctx.restore()

    if (selected) {
      ctx.save()
      ctx.strokeStyle = withAlpha(GOLD, 0.9)
      ctx.lineWidth = 2
      const r = b.rectOf(u.cell)
      roundRect(ctx, r.x + 2, r.y + 2, cell - 4, cell - 4, cell * 0.08)
      ctx.stroke()
      ctx.restore()
    }
  }

  /* ---------------- 敌人 ---------------- */

  private drawEnemy(ctx: CanvasRenderingContext2D, s: DrawState, e: NonNullable<Battle['boss']> | Battle['enemies'][number]): void {
    const b = s.board
    const cell = b.cell
    const def = e.boss && e.bossId ? BOSS_BY_ID[e.bossId] : ENEMY_BY_ID[e.kind]
    const color = def ? def.color : '#5a4a3a'
    const glyph = def ? def.glyph : '敌'
    /* 满血也要有血条：不然玩家读不出"这一枪打下去还差多少"。 */
    const cx = e.x
    const cy = e.y
    const radius = enemyRadius(e, cell)
    const pop = Math.max(0, Math.min(1, e.born / 0.3))
    const scale = e.boss ? 1 : 0.75 + 0.25 * Math.min(1, pop)
    const alpha = e.dead ? Math.max(0, 1 - e.dieT / 0.5) : 1
    const hit = e.hitT > 0 ? Math.sin(e.hitT * 66) * 2.2 : 0

    /* 断笔者的压制范围：四周点八小段，像裁切标记；不画成大圆压住战场 */
    if (e.kind === 'breaker' && !e.dead) {
      ctx.save()
      ctx.globalAlpha = 0.42
      ctx.strokeStyle = SEAL
      ctx.lineWidth = 1.4
      const rr = cell * 2.0
      for (let k = 0; k < 8; k++) {
        const a0 = (k * Math.PI) / 4 + 0.16
        ctx.beginPath()
        ctx.arc(cx, cy, rr, a0, a0 + 0.42)
        ctx.stroke()
      }
      ctx.restore()
    }

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.translate(cx + hit, cy)
    ctx.scale(scale, scale)

    ctx.fillStyle = 'rgba(60,45,26,0.12)'
    roundRect(ctx, -radius * 0.95 + 1, -radius * 0.95 + 2, radius * 1.9, radius * 1.9, radius * 0.28)
    ctx.fill()

    /* 底色带一点敌色：友军是米白纸片，敌军一眼就是"旧纸"，不会认错阵营 */
    ctx.fillStyle = 'rgba(244,236,219,0.97)'
    roundRect(ctx, -radius * 0.95, -radius * 0.95, radius * 1.9, radius * 1.9, radius * 0.28)
    ctx.fill()
    ctx.fillStyle = withAlpha(color, e.boss ? 0.18 : 0.09)
    roundRect(ctx, -radius * 0.95, -radius * 0.95, radius * 1.9, radius * 1.9, radius * 0.28)
    ctx.fill()
    ctx.strokeStyle = e.elite ? SEAL : color
    ctx.lineWidth = e.boss ? 2.8 : e.elite ? 2 : 1.4
    roundRect(ctx, -radius * 0.95, -radius * 0.95, radius * 1.9, radius * 1.9, radius * 0.28)
    ctx.stroke()

    ctx.fillStyle = e.hitT > 0 ? '#ffffff' : INK
    ctx.font = `700 ${Math.round(radius * (e.boss ? 1.0 : 0.94))}px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(glyph, 0, -radius * 0.04)

    ctx.restore()

    {
      const pct = Math.max(0, Math.min(1, e.hp / Math.max(1, e.maxHp)))
      const w = e.boss ? cell * 0.92 : radius * 1.9
      const hgt = e.boss ? 4.5 : e.elite ? 3.6 : 3
      const x = Math.round(cx - w / 2)
      const y = Math.round(cy + radius * 0.95 + 2.5)
      ctx.save()
      ctx.globalAlpha = e.dead ? Math.max(0, 1 - e.dieT / 0.5) : 1
      /* 血条用直角矩形：200 敌人时圆角路径+描边是帧时间的大头。
         深色槽 + 敌色填充，满血是一条实心墨条，掉血后露出的槽就是"还差多少"。 */
      ctx.fillStyle = 'rgba(44,38,29,0.26)'
      ctx.fillRect(x, y, w, hgt)
      ctx.fillStyle = e.boss ? SEAL : e.elite ? '#8a4a34' : color
      ctx.fillRect(x, y, Math.max(2, w * pct), hgt)
      ctx.restore()
    }
  }

  /* ---------------- 弹道 ---------------- */

  private drawProj(ctx: CanvasRenderingContext2D, p: Battle['projs'][number], cell: number): void {
    const speed = Math.hypot(p.vx, p.vy) || 1
    /* 箭画成一条短痕 + 一点箭镞：3px 的小圆点在满屏文字里根本看不见 */
    const len = cell * (p.side === 'unit' ? 0.26 : 0.16)
    const tx = p.x - (p.vx / speed) * len
    const ty = p.y - (p.vy / speed) * len
    ctx.save()
    /* 光点：弹道头部带一圈淡光，箭/弩/火球在土路上才"亮" */
    ctx.globalAlpha = 0.28
    ctx.fillStyle = p.color || INK
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(3, p.r * 2.1), 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = withAlpha(p.color || INK, 0.5)
    ctx.lineWidth = Math.max(1, p.r * 0.5)
    ctx.beginPath()
    ctx.moveTo(tx, ty)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.fillStyle = p.color || INK
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(1.6, p.r * 0.85), 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  /* ---------------- 拖拽虚影 ---------------- */

  private drawGhost(ctx: CanvasRenderingContext2D, s: DrawState): void {
    const d = s.drag
    if (!d) return
    const def = UNIT_BY_ID[d.kind]
    const hero = d.hero ? HERO_BY_ID[d.hero] : null
    const color = hero ? hero.color : RARITY_COLOR[def.rarity]
    const tint = hero ? '#f6ead0' : (RARITY_TINT[def.rarity] || '#f1eadc')
    const size = Math.max(34, s.board.cell * 0.82)
    ctx.save()
    ctx.globalAlpha = 0.94
    ctx.translate(d.x, d.y - 8)
    ctx.rotate(-0.035)
    ctx.fillStyle = 'rgba(40,30,16,0.20)'
    roundRect(ctx, -size / 2 + 3, -size / 2 + 6, size, size, size * 0.09)
    ctx.fill()
    ctx.fillStyle = tint
    roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.09)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    roundRect(ctx, -size / 2, -size / 2, size, size, size * 0.09)
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.font = `700 ${Math.round(size * 0.48)}px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(hero ? hero.glyph : def.glyph, 0, -size * 0.04)
    ctx.fillStyle = withAlpha(INK, 0.55)
    ctx.font = `500 ${Math.round(size * 0.13)}px ${SERIF}`
    ctx.fillText(`Lv.${d.lv}`, 0, size * 0.3)
    ctx.restore()
  }
}

/* 绘制层结束 */
