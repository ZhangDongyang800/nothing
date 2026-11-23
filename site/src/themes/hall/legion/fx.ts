/* 粒子、飘字、冲击波：三组定长对象池，池满就复用最老的。
 *
 * 这一层跟战斗逻辑完全解耦 —— 战斗层只调 burst()/text()/shock()，
 * 绘制层只调 update()/draw()。所有绘制都在 CSS 像素坐标里，
 * 画布整体已经按 dpr 缩放过，粒子不需要再关心分辨率。
 */
import type { FloatText, Particle, Shock } from './types'

const MAX_P = 520
const MAX_T = 90
const MAX_S = 44
const MAX_SL = 28

export interface Slash {
  active: boolean
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  life: number
  age: number
  w: number
  bend: number
  glow: string
  power: number
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

export class Effects {
  parts: Particle[] = Array.from({ length: MAX_P }, blankP)
  texts: FloatText[] = Array.from({ length: MAX_T }, blankT)
  shocks: Shock[] = Array.from({ length: MAX_S }, blankS)
  /** 近战的挥击笔痕：短、弯、有锋，画在攻守两者之间 */
  slashes: Slash[] = Array.from({ length: MAX_SL }, blankSl)
  private pi = 0
  private ti = 0
  private si = 0
  private li = 0
  reduced = false

  setReduced(v: boolean): void { this.reduced = v }

  private takeSl(): Slash {
    const s = this.slashes[this.li]
    this.li = (this.li + 1) % MAX_SL
    return s
  }

  /** 一刀：从 a 扫到 b，法向微微弯曲；width 是笔画粗细，bend 是弯多少（相对长度） */
  slash(ax: number, ay: number, bx: number, by: number, color = '#2c261d', life = 0.17, width = 3.2, bend = 0.2, glow = '', power = -1): void {
    const s = this.takeSl()
    s.active = true
    s.x1 = ax; s.y1 = ay; s.x2 = bx; s.y2 = by
    s.color = color
    s.life = life
    s.age = 0
    s.w = width
    s.bend = bend
    s.glow = glow || color
    s.power = power >= 0 ? Math.min(1, power) : Math.min(1, width / 9)
  }

  private takeP(): Particle {
    for (let k = 0; k < MAX_P; k++) {
      const p = this.parts[(this.pi + k) % MAX_P]
      if (!p.active) { this.pi = (this.pi + k + 1) % MAX_P; return p }
    }
    const p = this.parts[this.pi]
    this.pi = (this.pi + 1) % MAX_P
    return p
  }

  private takeT(): FloatText {
    for (let k = 0; k < MAX_T; k++) {
      const t = this.texts[(this.ti + k) % MAX_T]
      if (!t.active) { this.ti = (this.ti + k + 1) % MAX_T; return t }
    }
    const t = this.texts[this.ti]
    this.ti = (this.ti + 1) % MAX_T
    return t
  }

  private takeS(): Shock {
    const s = this.shocks[this.si]
    this.si = (this.si + 1) % MAX_S
    return s
  }

  clear(): void {
    for (const p of this.parts) p.active = false
    for (const t of this.texts) t.active = false
    for (const s of this.shocks) s.active = false
    for (const s of this.slashes) s.active = false
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
      p.color = color
      p.kind = kind
      p.rot = Math.random() * 6.28
      p.spin = (Math.random() - 0.5) * 12
    }
  }

  /** 纸屑：合成、五级登场、Boss 倒下时用，带一点重力与旋转 */
  shards(x: number, y: number, color: string, count = 12, power = 240): void {
    const n = this.reduced ? Math.ceil(count / 2) : count
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6
      const sp = power * (0.3 + Math.random() * 0.8)
      p.active = true
      p.x = x
      p.y = y
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp
      p.life = 0.5 + Math.random() * 0.6
      p.age = 0
      p.size = 3 + Math.random() * 6
      p.color = color
      p.kind = 'shard'
      p.rot = Math.random() * 6.28
      p.spin = (Math.random() - 0.5) * 16
    }
  }

  /** 合成时两侧的墨点往中点收 —— 速度按距离反推，看着就是"吸过去" */
  converge(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const mx = (x1 + x2) / 2
    const my = (y1 + y2) / 2
    const n = this.reduced ? 6 : 12
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const fromA = i % 2 === 0
      const sx = fromA ? x1 : x2
      const sy = fromA ? y1 : y2
      p.active = true
      p.x = sx + (Math.random() - 0.5) * 20
      p.y = sy + (Math.random() - 0.5) * 20
      p.vx = (mx - p.x) / 0.16
      p.vy = (my - p.y) / 0.16
      p.life = 0.32
      p.age = 0
      p.size = 2 + Math.random() * 3
      p.color = color
      p.kind = 'ink'
      p.rot = 0
      p.spin = 0
    }
  }

  smoke(x: number, y: number, color: string, count = 6): void {    for (let i = 0; i < count; i++) {
      const p = this.takeP()
      p.active = true
      p.x = x + (Math.random() - 0.5) * 12
      p.y = y + (Math.random() - 0.5) * 8
      p.vx = (Math.random() - 0.5) * 40
      p.vy = -20 - Math.random() * 50
      p.life = 0.7 + Math.random() * 0.6
      p.age = 0
      p.size = 6 + Math.random() * 10
      p.color = color
      p.kind = 'smoke'
      p.rot = 0
      p.spin = 0
    }
  }

  text(x: number, y: number, str: string, color = '#252525', size = 13): void {
    if (this.reduced && str.length > 5) return
    const t = this.takeT()
    t.active = true
    t.x = x
    t.y = y
    t.vy = -42
    t.life = 0.75
    t.age = 0
    t.text = str
    t.color = color
    t.size = size
  }

  shock(x: number, y: number, r0: number, r1: number, color = '#252525', life = 0.4, width = 2): void {
    const s = this.takeS()
    s.active = true
    s.x = x
    s.y = y
    s.r0 = r0
    s.r1 = r1
    s.life = life
    s.age = 0
    s.color = color
    s.width = width
  }

  /** 命中亮斑：一圈细环 + 几粒火星。所有兵种共用，让"打中了"在纸面上亮一下。
   *  power 0..1 跟着等级升，越高火星越多、环越大。 */
  hitSpark(x: number, y: number, color: string, power = 0): void {
    const n = this.reduced ? 4 : 7 + Math.round(power * 7)
    for (let i = 0; i < n; i++) {
      const p = this.takeP()
      const a = Math.random() * Math.PI * 2
      const sp = (80 + power * 200) * (0.4 + Math.random() * 0.95)
      p.active = true
      p.x = x + (Math.random() - 0.5) * 3
      p.y = y + (Math.random() - 0.5) * 3
      p.vx = Math.cos(a) * sp
      p.vy = Math.sin(a) * sp
      p.life = 0.12 + Math.random() * 0.16
      p.age = 0
      p.size = 2 + Math.random() * (2 + power * 3)
      p.color = color
      p.kind = 'spark'
      p.rot = 0
      p.spin = 0
    }
    const s = this.takeS()
    s.active = true
    s.x = x
    s.y = y
    s.r0 = 1
    s.r1 = 9 + power * 15
    s.life = 0.24
    s.age = 0
    s.color = color
    s.width = 1.3 + power * 1.8
  }

  update(dt: number): void {
    for (const p of this.parts) {
      if (!p.active) continue
      p.age += dt
      if (p.age >= p.life) { p.active = false; continue }
      p.x += p.vx * dt
      p.y += p.vy * dt
      if (p.kind === 'shard') {
        p.vy += 520 * dt
        p.vx *= 0.97
      } else if (p.kind === 'smoke') {
        p.vy -= 12 * dt
        p.size += dt * 14
      } else {
        p.vx *= 0.92
        p.vy *= 0.92
      }
      p.rot += p.spin * dt
    }
    for (const t of this.texts) {
      if (!t.active) continue
      t.age += dt
      if (t.age >= t.life) { t.active = false; continue }
      t.y += t.vy * dt
      t.vy *= 0.94
    }
    for (const s of this.shocks) {
      if (!s.active) continue
      s.age += dt
      if (s.age >= s.life) s.active = false
    }
    for (const s of this.slashes) {
      if (!s.active) continue
      s.age += dt
      if (s.age >= s.life) s.active = false
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    /* 挥击：三层叠出来。深墨打底 → 暖光晕 → 亮芯。
       亮芯夹在深墨中间，纸面再浅也能读出"刃口在发光"；等级越高光晕越大、芯越粗。 */
    for (const s of this.slashes) {
      if (!s.active) continue
      const k = s.age / s.life
      const fade = 1 - k
      if (fade <= 0) continue
      const dx = s.x2 - s.x1
      const dy = s.y2 - s.y1
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      const bend = s.bend * len
      const cx = (s.x1 + s.x2) / 2 + nx * bend
      const cy = (s.y1 + s.y2) / 2 + ny * bend
      const pw = s.power
      const at = (t: number): [number, number] => {
        const u = 1 - t
        return [u * u * s.x1 + 2 * u * t * cx + t * t * s.x2, u * u * s.y1 + 2 * u * t * cy + t * t * s.y2]
      }
      /* ① 深墨主体：带一圈暖色 shadow，纸面上会浮起一层薄光 */
      ctx.save()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = fade * 0.95
      ctx.strokeStyle = s.color
      ctx.shadowColor = s.glow
      ctx.shadowBlur = (5 + pw * 16) * fade
      ctx.lineWidth = Math.max(1.1, s.w * (0.55 + 0.45 * fade))
      ctx.beginPath()
      ctx.moveTo(s.x1, s.y1)
      ctx.quadraticCurveTo(cx, cy, s.x2, s.y2)
      ctx.stroke()
      /* ② 亮芯：沿同一根曲线、从三成处收尾，越高级越亮越厚 */
      ctx.shadowBlur = (3 + pw * 8) * fade
      ctx.globalAlpha = fade * (0.5 + pw * 0.42)
      ctx.strokeStyle = `rgba(255,246,214,${0.72 + pw * 0.26})`
      ctx.lineWidth = Math.max(0.8, s.w * (0.22 + pw * 0.26))
      ctx.beginPath()
      const [ax0, ay0] = at(0.3)
      ctx.moveTo(ax0, ay0)
      for (let i = 1; i <= 6; i++) {
        const [px, py] = at(0.3 + (0.7 * i) / 6)
        ctx.lineTo(px, py)
      }
      ctx.stroke()
      /* ③ 高等级补一道更宽的淡光尾，像收势后留下的余亮 */
      if (pw > 0.55) {
        ctx.shadowBlur = 0
        ctx.globalAlpha = fade * 0.3
        ctx.strokeStyle = s.glow
        ctx.lineWidth = Math.max(1, s.w * 0.5)
        ctx.beginPath()
        ctx.moveTo(s.x1, s.y1)
        ctx.quadraticCurveTo(cx, cy, s.x2, s.y2)
        ctx.stroke()
      }
      ctx.restore()
    }
    for (const s of this.shocks) {
      if (!s.active) continue
      const k = s.age / s.life
      const r = s.r0 + (s.r1 - s.r0) * (1 - Math.pow(1 - k, 2))
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.9
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width * (1 - k * 0.6)
      ctx.beginPath()
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2)
      ctx.stroke()
    }
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
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()
      } else if (p.kind === 'spark') {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
      } else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
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
