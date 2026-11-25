/* 活字兵阵 · 特效层
 *
 * 攻击不是几何线条，是书法笔画；重击不是光圈，是朱砂盖印；范围不是圆环，是墨晕。
 * 所有特效定长对象池，池满复用最老的；战斗层只调 spawn 接口，绘制层只调 update/draw。
 *
 * 生命周期统一：起手(聚墨) → 释放(行笔/延伸) → 命中(溅墨/盖印) → 消散(洇开渐隐)。
 * 坐标全是 CSS 像素，画布已按 dpr 缩放。
 */
import type { FloatText, Particle, Shock } from './types'
import type { Frag } from './glyph'
import { glyphFrags, type GlyphStyleKey } from './glyph'

const MAX_P = 520
const MAX_T = 90
const MAX_S = 44
const MAX_SL = 28
const MAX_STAMP = 12
const MAX_BLOOM = 20
const MAX_THRUST = 24
const MAX_STAIN = 24
const MAX_SHATTER = 16

export interface Slash {
  active: boolean
  x1: number; y1: number; x2: number; y2: number
  color: string; life: number; age: number
  w: number; bend: number; glow: string; power: number
}
export interface Stamp {
  active: boolean; x: number; y: number; size: number
  char: string; color: string; life: number; age: number
  rot: number; seed: number; struck: boolean
}
export interface Bloom {
  active: boolean; x: number; y: number; r0: number; r1: number
  color: string; life: number; age: number; seed: number
}
export interface Thrust {
  active: boolean; x1: number; y1: number; x2: number; y2: number
  color: string; life: number; age: number; w: number; seed: number; struck: boolean
}
export interface Stain {
  active: boolean; x: number; y: number; r: number
  color: string; life: number; age: number; seed: number
}
interface ShatterFrag { f: Frag; vx: number; vy: number; spin: number }
export interface Shatter {
  active: boolean; x: number; y: number; age: number; life: number
  frags: ShatterFrag[]
}

function blankSl(): Slash {
  return { active: false, x1: 0, y1: 0, x2: 0, y2: 0, color: '#2c261d', life: 0.17, age: 0, w: 3, bend: 0.2, glow: '#f0a63c', power: 0 }
}
function blankP(): Particle {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, age: 0, size: 3, color: '#252525', kind: 'ink', rot: 0, spin: 0 }
}
function blankT(): FloatText {
  return { active: false, x: 0, y: 0, vy: 0, life: 0, age: 0, text: '', color: '#252525', size: 13 }
}
function blankS(): Shock {
  return { active: false, x: 0, y: 0, r0: 0, r1: 0, life: 0, age: 0, color: '#252525', width: 2 }
}
function blankStamp(): Stamp {
  return { active: false, x: 0, y: 0, size: 30, char: '印', color: '#a8342a', life: 0.7, age: 0, rot: 0, seed: 0, struck: false }
}
function blankBloom(): Bloom {
  return { active: false, x: 0, y: 0, r0: 0, r1: 0, color: '#252525', life: 0.5, age: 0, seed: 0 }
}
function blankThrust(): Thrust {
  return { active: false, x1: 0, y1: 0, x2: 0, y2: 0, color: '#252525', life: 0.24, age: 0, w: 4, seed: 0, struck: false }
}
function blankStain(): Stain {
  return { active: false, x: 0, y: 0, r: 10, color: '#252525', life: 2.4, age: 0, seed: 0 }
}
function blankShatter(): Shatter {
  return { active: false, x: 0, y: 0, age: 0, life: 0.55, frags: [] }
}

function hashN(s: number): number {
  let h = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3) }
function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** 书法笔画的中心线 + 笔压轮廓。profile: slash=撇捺收锋 / needle=悬针 / sweep=横扫。
 *  reveal 0..1 控制"行笔"进度（起手→释放）。导出给绘制层画光束复用。 */
export function brushStroke(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  width: number, bend: number, reveal: number, profile: 'slash' | 'needle' | 'sweep', seed = 0,
): void {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  const cx = (x1 + x2) / 2 + nx * bend * len
  const cy = (y1 + y2) / 2 + ny * bend * len
  const seg = 12
  const rv = Math.max(0.02, Math.min(1, reveal))
  const pressure = (t: number): number => {
    if (profile === 'needle') return Math.sin(Math.PI * Math.pow(t, 0.55))
    if (profile === 'sweep') return Math.sin(Math.PI * (0.16 + 0.84 * t))
    return Math.sin(Math.PI * (0.1 + 0.9 * t)) * (1 - 0.3 * t)
  }
  const pts: { x: number; y: number; w: number }[] = []
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * rv
    const u = 1 - t
    const px = u * u * x1 + 2 * u * t * cx + t * t * x2
    const py = u * u * y1 + 2 * u * t * cy + t * t * y2
    const wob = Math.sin(t * 7 + seed * 6.28) * width * 0.05
    pts.push({ x: px + nx * wob, y: py + ny * wob, w: width * pressure(t) })
  }
  ctx.beginPath()
  for (let i = 0; i <= seg; i++) {
    const p = pts[i]
    const px = p.x - nx * p.w / 2, py = p.y + ny * p.w / 2
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  for (let i = seg; i >= 0; i--) {
    const p = pts[i]
    ctx.lineTo(p.x + nx * p.w / 2, p.y - ny * p.w / 2)
  }
  ctx.closePath()
  ctx.fill()
}

/** 不规则墨团轮廓（晕染 / 墨渍共用）：12 个半径噪声点 */
function blobPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  ctx.beginPath()
  const n = 12
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = r * (0.82 + hashN(seed * 97 + i) * 0.34)
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

export class Effects {
  parts: Particle[] = Array.from({ length: MAX_P }, blankP)
  texts: FloatText[] = Array.from({ length: MAX_T }, blankT)
  shocks: Shock[] = Array.from({ length: MAX_S }, blankS)
  slashes: Slash[] = Array.from({ length: MAX_SL }, blankSl)
  stamps: Stamp[] = Array.from({ length: MAX_STAMP }, blankStamp)
  blooms: Bloom[] = Array.from({ length: MAX_BLOOM }, blankBloom)
  thrusts: Thrust[] = Array.from({ length: MAX_THRUST }, blankThrust)
  stains: Stain[] = Array.from({ length: MAX_STAIN }, blankStain)
  shatters: Shatter[] = Array.from({ length: MAX_SHATTER }, blankShatter)
  private pi = 0; private ti = 0; private si = 0; private li = 0
  private sti = 0; private bi = 0; private thi = 0; private stai = 0; private shi = 0
  reduced = false

  setReduced(v: boolean): void { this.reduced = v }

  private takeSl(): Slash { const s = this.slashes[this.li]; this.li = (this.li + 1) % MAX_SL; return s }
  private takeP(): Particle {
    for (let k = 0; k < MAX_P; k++) {
      const p = this.parts[(this.pi + k) % MAX_P]
      if (!p.active) { this.pi = (this.pi + k + 1) % MAX_P; return p }
    }
    const p = this.parts[this.pi]; this.pi = (this.pi + 1) % MAX_P; return p
  }
  private takeT(): FloatText {
    for (let k = 0; k < MAX_T; k++) {
      const t = this.texts[(this.ti + k) % MAX_T]
      if (!t.active) { this.ti = (this.ti + k + 1) % MAX_T; return t }
    }
    const t = this.texts[this.ti]; this.ti = (this.ti + 1) % MAX_T; return t
  }
  private takeS(): Shock { const s = this.shocks[this.si]; this.si = (this.si + 1) % MAX_S; return s }

  /** 一刀：书法撇捺，起笔顿、行笔 sweeping、收锋出尖。power 跟等级走。 */
  slash(ax: number, ay: number, bx: number, by: number, color = '#2c261d', life = 0.2, width = 3.2, bend = 0.2, glow = '', power = -1): void {
    const s = this.takeSl()
    s.active = true
    s.x1 = ax; s.y1 = ay; s.x2 = bx; s.y2 = by
    s.color = color; s.life = life; s.age = 0; s.w = width; s.bend = bend
    s.glow = glow || color
    s.power = power >= 0 ? Math.min(1, power) : Math.min(1, width / 9)
  }

  /** 朱砂盖印：重击 / 升级 / 处决 / 融合。落下时砸出一圈溅墨。 */
  stamp(x: number, y: number, char: string, size: number, color = '#a8342a', life = 0.72): void {
    const s = this.stamps[this.sti]; this.sti = (this.sti + 1) % MAX_STAMP
    s.active = true; s.x = x; s.y = y; s.char = char; s.size = size; s.color = color
    s.life = life; s.age = 0; s.rot = (hashN(x * 7 + y * 13) - 0.5) * 0.22
    s.seed = Math.floor(hashN(x + y * 3) * 1e6); s.struck = false
  }

  /** 墨晕：范围攻击的纸面扩散（替代圆环冲击波）。 */
  bloom(x: number, y: number, r0: number, r1: number, color = '#252525', life = 0.5): void {
    const b = this.blooms[this.bi]; this.bi = (this.bi + 1) % MAX_BLOOM
    b.active = true; b.x = x; b.y = y; b.r0 = r0; b.r1 = r1; b.color = color
    b.life = life; b.age = 0; b.seed = Math.floor(hashN(x * 3 + y * 5) * 1e6)
  }

  /** 墨针突刺：笔画凝聚成针，瞬间延伸贯穿（枪 / 骁 / 戟）。 */
  thrust(x1: number, y1: number, x2: number, y2: number, color = '#252525', life = 0.26, w = 4): void {
    const t = this.thrusts[this.thi]; this.thi = (this.thi + 1) % MAX_THRUST
    t.active = true; t.x1 = x1; t.y1 = y1; t.x2 = x2; t.y2 = y2
    t.color = color; t.life = life; t.age = 0; t.w = w
    t.seed = Math.floor(hashN(x1 + y2) * 1e6); t.struck = false
  }

  /** 墨渍：死亡 / 灼烧留在纸上的渐隐痕迹（地面层）。 */
  stain(x: number, y: number, r: number, color = '#252525', life = 2.4): void {
    if (this.reduced) return
    const s = this.stains[this.stai]; this.stai = (this.stai + 1) % MAX_STAIN
    s.active = true; s.x = x; s.y = y; s.r = r; s.color = color
    s.life = life; s.age = 0; s.seed = Math.floor(hashN(x * 11 + y * 17) * 1e6)
  }

  /** 字形解体：笔画碎片飞散（死亡）。碎片来自字形层的连通域缓存。 */
  shatter(x: number, y: number, text: string, style: GlyphStyleKey, size: number, color: string, power = 1): void {
    const frags = glyphFrags(text, style, size, color)
    if (!frags.length) return
    const s = this.shatters[this.shi]; this.shi = (this.shi + 1) % MAX_SHATTER
    s.active = true; s.x = x; s.y = y; s.age = 0; s.life = 0.55
    s.frags = frags.map((f, i) => {
      const a = Math.atan2(f.oy, f.ox) + (hashN(i * 31 + x) - 0.5) * 0.9
      const sp = (90 + hashN(i * 17 + y) * 150) * power
      return { f, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * power, spin: (hashN(i * 7 + x + y) - 0.5) * 10 }
    })
  }

  burst(x: number, y: number, color: string, count = 10, power = 180, kind = 'ink'): void {
    const n = this.reduced ? Math.ceil(count / 2) : count
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const a = Math.random() * Math.PI * 2
      const sp = power * (0.35 + Math.random() * 0.75)
      p.active = true
      p.x = x + (Math.random() - 0.5) * 6
      p.y = y + (Math.random() - 0.5) * 6
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp - (kind === 'ash' ? 40 : 10)
      p.life = 0.35 + Math.random() * 0.45
      p.age = 0
      p.size = 2 + Math.random() * 4
      p.color = color; p.kind = kind
      p.rot = Math.random() * 6.28
      p.spin = (Math.random() - 0.5) * 12
    }
  }

  /** 定向溅墨：沿打击方向的一锥形墨点（受击反馈）。 */
  spatter(x: number, y: number, dir: number, color: string, count = 5, power = 140): void {
    const n = this.reduced ? Math.ceil(count / 2) : count
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const a = dir + (Math.random() - 0.5) * 1.1
      const sp = power * (0.4 + Math.random() * 0.9)
      p.active = true
      p.x = x; p.y = y
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp
      p.life = 0.22 + Math.random() * 0.25
      p.age = 0
      p.size = 1.5 + Math.random() * 3
      p.color = color; p.kind = 'ink'
      p.rot = 0; p.spin = 0
    }
  }

  shards(x: number, y: number, color: string, count = 12, power = 240): void {
    const n = this.reduced ? Math.ceil(count / 2) : count
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6
      const sp = power * (0.3 + Math.random() * 0.8)
      p.active = true
      p.x = x; p.y = y
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp
      p.life = 0.5 + Math.random() * 0.6
      p.age = 0
      p.size = 3 + Math.random() * 6
      p.color = color; p.kind = 'shard'
      p.rot = Math.random() * 6.28
      p.spin = (Math.random() - 0.5) * 16
    }
  }

  converge(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    const n = this.reduced ? 6 : 12
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const fromA = i % 2 === 0
      const sx = fromA ? x1 : x2, sy = fromA ? y1 : y2
      p.active = true
      p.x = sx + (Math.random() - 0.5) * 20
      p.y = sy + (Math.random() - 0.5) * 20
      p.vx = (mx - p.x) / 0.16; p.vy = (my - p.y) / 0.16
      p.life = 0.32; p.age = 0
      p.size = 2 + Math.random() * 3
      p.color = color; p.kind = 'ink'
      p.rot = 0; p.spin = 0
    }
  }

  smoke(x: number, y: number, color: string, count = 6): void {
    for (let i = 0; i < count; i++) {
      const p = this.takeP()
      p.active = true
      p.x = x + (Math.random() - 0.5) * 12
      p.y = y + (Math.random() - 0.5) * 8
      p.vx = (Math.random() - 0.5) * 40
      p.vy = -20 - Math.random() * 50
      p.life = 0.7 + Math.random() * 0.6
      p.age = 0
      p.size = 6 + Math.random() * 10
      p.color = color; p.kind = 'smoke'
      p.rot = 0; p.spin = 0
    }
  }

  text(x: number, y: number, str: string, color = '#252525', size = 13): void {
    if (this.reduced && str.length > 5) return
    const t = this.takeT()
    t.active = true
    t.x = x; t.y = y; t.vy = -42; t.life = 0.75; t.age = 0
    t.text = str; t.color = color; t.size = size
  }

  shock(x: number, y: number, r0: number, r1: number, color = '#252525', life = 0.4, width = 2): void {
    const s = this.takeS()
    s.active = true
    s.x = x; s.y = y; s.r0 = r0; s.r1 = r1; s.life = life; s.age = 0
    s.color = color; s.width = width
  }

  /** 命中：一圈细墨环 + 几粒墨点（不是火星四溅的霓虹）。 */
  hitSpark(x: number, y: number, color: string, power = 0): void {
    const n = this.reduced ? 4 : 6 + Math.round(power * 6)
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const a = Math.random() * Math.PI * 2
      const sp = (70 + power * 180) * (0.4 + Math.random() * 0.95)
      p.active = true
      p.x = x + (Math.random() - 0.5) * 3
      p.y = y + (Math.random() - 0.5) * 3
      p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp
      p.life = 0.12 + Math.random() * 0.16
      p.age = 0
      p.size = 1.5 + Math.random() * (2 + power * 2.5)
      p.color = color; p.kind = 'ink'
      p.rot = 0; p.spin = 0
    }
    const s = this.takeS()
    s.active = true
    s.x = x; s.y = y; s.r0 = 1; s.r1 = 8 + power * 13
    s.life = 0.22; s.age = 0
    s.color = color; s.width = 1.2 + power * 1.6
  }

  clear(): void {
    for (const p of this.parts) p.active = false
    for (const t of this.texts) t.active = false
    for (const s of this.shocks) s.active = false
    for (const s of this.slashes) s.active = false
    for (const s of this.stamps) s.active = false
    for (const b of this.blooms) b.active = false
    for (const t of this.thrusts) t.active = false
    for (const s of this.stains) s.active = false
    for (const s of this.shatters) s.active = false
  }

  update(dt: number): void {
    for (const p of this.parts) {
      if (!p.active) continue
      p.age += dt
      if (p.age >= p.life) { p.active = false; continue }
      p.x += p.vx * dt; p.y += p.vy * dt
      if (p.kind === 'shard') { p.vy += 520 * dt; p.vx *= 0.97 }
      else if (p.kind === 'smoke') { p.vy -= 12 * dt; p.size += dt * 14 }
      else { p.vx *= 0.92; p.vy *= 0.92 }
      p.rot += p.spin * dt
    }
    for (const t of this.texts) {
      if (!t.active) continue
      t.age += dt
      if (t.age >= t.life) { t.active = false; continue }
      t.y += t.vy * dt; t.vy *= 0.94
    }
    for (const s of this.shocks) { if (s.active) { s.age += dt; if (s.age >= s.life) s.active = false } }
    for (const s of this.slashes) { if (s.active) { s.age += dt; if (s.age >= s.life) s.active = false } }
    for (const s of this.stamps) {
      if (!s.active) continue
      s.age += dt
      if (s.age >= s.life) { s.active = false; continue }
      if (!s.struck && s.age >= 0.1) {
        s.struck = true
        this.shock(s.x, s.y, s.size * 0.3, s.size * 1.5, s.color, 0.3, 2)
        this.spatter(s.x, s.y, Math.PI / 2, s.color, 6, s.size * 4)
      }
    }
    for (const b of this.blooms) { if (b.active) { b.age += dt; if (b.age >= b.life) b.active = false } }
    for (const t of this.thrusts) {
      if (!t.active) continue
      t.age += dt
      if (t.age >= t.life) { t.active = false; continue }
      if (!t.struck && t.age >= t.life * 0.3) {
        t.struck = true
        this.spatter(t.x2, t.y2, Math.atan2(t.y2 - t.y1, t.x2 - t.x1), t.color, 4, 120)
      }
    }
    for (const s of this.stains) { if (s.active) { s.age += dt; if (s.age >= s.life) s.active = false } }
    for (const s of this.shatters) { if (s.active) { s.age += dt; if (s.age >= s.life) s.active = false } }
  }

  /** 地面层：墨渍。在棋子之前画，压在纸面上。 */
  drawGround(ctx: CanvasRenderingContext2D): void {
    for (const s of this.stains) {
      if (!s.active) continue
      const k = s.age / s.life
      ctx.globalAlpha = 0.16 * Math.pow(1 - k, 1.5)
      ctx.fillStyle = s.color
      blobPath(ctx, s.x, s.y, s.r * (0.9 + k * 0.25), s.seed)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  draw(ctx: CanvasRenderingContext2D): void {
    /* 墨晕：范围攻击的纸面扩散 */
    for (const b of this.blooms) {
      if (!b.active) continue
      const k = b.age / b.life
      const r = b.r0 + (b.r1 - b.r0) * easeOutCubic(k)
      ctx.globalAlpha = 0.1 * (1 - k)
      ctx.fillStyle = b.color
      blobPath(ctx, b.x, b.y, r, b.seed)
      ctx.fill()
      ctx.globalAlpha = 0.22 * (1 - k)
      ctx.strokeStyle = b.color
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    /* 墨针突刺：延伸 → 顿住 → 收锋 */
    for (const t of this.thrusts) {
      if (!t.active) continue
      const k = t.age / t.life
      const reveal = Math.min(1, t.age / (t.life * 0.3))
      const fade = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1
      ctx.globalAlpha = 0.9 * fade
      ctx.fillStyle = t.color
      brushStroke(ctx, t.x1, t.y1, t.x2, t.y2, t.w, 0.02, reveal, 'needle', t.seed)
      /* 针尖一点浓墨 */
      if (reveal >= 1) {
        ctx.globalAlpha = 0.85 * fade
        ctx.beginPath()
        ctx.arc(t.x2, t.y2, t.w * 0.4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    /* 书法斩击：洇墨底 + 主笔 + 飞白 +（暴击）暖芯 */
    for (const s of this.slashes) {
      if (!s.active) continue
      const k = s.age / s.life
      const fade = 1 - k
      if (fade <= 0) continue
      const reveal = Math.min(1, s.age / (s.life * 0.38))
      const pw = s.power
      ctx.save()
      /* 洇墨底 */
      ctx.globalAlpha = 0.18 * fade
      ctx.fillStyle = s.color
      brushStroke(ctx, s.x1, s.y1, s.x2, s.y2, s.w * 1.9, s.bend, reveal, 'slash', pw)
      /* 主笔 */
      ctx.globalAlpha = 0.92 * fade
      ctx.fillStyle = s.color
      brushStroke(ctx, s.x1, s.y1, s.x2, s.y2, s.w * (0.6 + 0.4 * fade), s.bend, reveal, 'slash', pw)
      /* 飞白：高等级才有的枯笔丝 */
      if (pw > 0.45 && !this.reduced) {
        ctx.globalAlpha = 0.28 * fade
        ctx.strokeStyle = '#fff8e8'
        ctx.lineWidth = Math.max(0.6, s.w * 0.12)
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len, ny = dx / len
        for (const o of [-0.18, 0.14]) {
          ctx.beginPath()
          ctx.moveTo(s.x1 + nx * s.w * o + dx * 0.25, s.y1 + ny * s.w * o + dy * 0.25)
          ctx.lineTo(s.x1 + nx * s.w * o + dx * 0.8, s.y1 + ny * s.w * o + dy * 0.8)
          ctx.stroke()
        }
      }
      /* 暴击暖芯：一线纸白发热，不是霓虹光晕 */
      if (pw > 0.7) {
        ctx.globalAlpha = 0.4 * fade
        ctx.strokeStyle = '#fff3cf'
        ctx.lineWidth = Math.max(0.8, s.w * 0.2)
        ctx.beginPath()
        ctx.moveTo(s.x1 + (s.x2 - s.x1) * 0.3, s.y1 + (s.y2 - s.y1) * 0.3)
        ctx.lineTo(s.x2, s.y2)
        ctx.stroke()
      }
      ctx.restore()
    }

    /* 细墨环（命中 / 小冲击） */
    for (const s of this.shocks) {
      if (!s.active) continue
      const k = s.age / s.life
      const r = s.r0 + (s.r1 - s.r0) * (1 - Math.pow(1 - k, 2))
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.85
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width * (1 - k * 0.6)
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    /* 字形解体：笔画碎片飞散 */
    for (const s of this.shatters) {
      if (!s.active) continue
      const k = s.age / s.life
      const a = Math.max(0, 1 - k)
      const sc = 1 - k * 0.25
      for (const sf of s.frags) {
        const px = s.x + sf.f.ox + sf.vx * s.age
        const py = s.y + sf.f.oy + sf.vy * s.age + 260 * s.age * s.age
        ctx.save()
        ctx.globalAlpha = a
        ctx.translate(px, py)
        ctx.rotate(sf.spin * s.age)
        ctx.scale(sc, sc)
        ctx.drawImage(sf.f.cv, -sf.f.w / 2, -sf.f.h / 2)
        ctx.restore()
      }
    }

    /* 粒子 */
    for (const p of this.parts) {
      if (!p.active) continue
      const k = p.age / p.life
      ctx.globalAlpha = Math.max(0, 1 - k)
      ctx.fillStyle = p.color
      if (p.kind === 'shard') {
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.restore()
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.35
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill()
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.globalAlpha = 1

    /* 朱砂盖印：最上层的状态语言 */
    for (const s of this.stamps) {
      if (!s.active) continue
      const k = s.age / s.life
      const appear = Math.min(1, s.age / 0.1)
      const scale = 1.6 - 0.6 * easeOutBack(appear)
      const alpha = appear * (k > 0.6 ? (1 - k) / 0.4 : 1)
      const sz = s.size
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(s.x, s.y)
      ctx.rotate(s.rot * (1 - appear))
      ctx.scale(scale, scale)
      /* 压印投影 */
      ctx.fillStyle = 'rgba(40,20,16,0.22)'
      ctx.fillRect(-sz / 2 + 2, -sz / 2 + 3, sz, sz)
      /* 印面 */
      ctx.fillStyle = s.color
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz)
      ctx.strokeStyle = 'rgba(255,240,230,0.7)'
      ctx.lineWidth = Math.max(1, sz * 0.045)
      ctx.strokeRect(-sz / 2 + sz * 0.09, -sz / 2 + sz * 0.09, sz * 0.82, sz * 0.82)
      /* 印文（阴文白字） */
      ctx.fillStyle = '#fff3ec'
      ctx.font = `700 ${Math.round(sz * 0.6)}px "KaiTi","STKaiti","Ma Shan Zheng",serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(s.char, 0, sz * 0.03)
      ctx.restore()
    }

    /* 飘字 */
    for (const t of this.texts) {
      if (!t.active) continue
      const k = t.age / t.life
      const a = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85)
      ctx.globalAlpha = a
      ctx.font = `900 ${t.size}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(255,248,232,.9)'
      ctx.strokeText(t.text, t.x, t.y)
      ctx.fillStyle = t.color
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1
  }
}