/* 活字兵阵 · 字形层
 *
 * 文字是角色主体：每个兵种 / 敌人 / Boss 有独立书风（字体 × 笔势 × 墨色 × 飞白），
 * 绝不共用一个字体模板。字形渲染一次、缓存离屏 canvas；受击 / 死亡时按"连通笔画块"
 * 拆成碎片，让字真的会散架。
 *
 * 性能约定：
 *   · 缓存键 = 字 × 书风 × 尺寸档(4px) × 墨色；正常帧每字 = 1 次 drawImage。
 *   · 笔画碎片惰性构建（第一次受击 / 死亡才做连通域分析），之后常驻缓存。
 *   · 毛笔字体加载完成前用系统楷 fallback；加载好后 bump 代数号，整体重建。
 */
import type { UnitKind, EnemyKind } from './types'

export type GlyphStyleKey = UnitKind | EnemyKind | 'hero' | 'boss'

interface StyleDef {
  family: string
  /** 合成加粗（系统楷/仿宋只有 400，靠 strokeText 补笔画厚度） */
  bold: number
  /** 水平剪切：负值前倾（冲势），正值后仰 */
  shear: number
  /** 纵向拉伸：枪的悬针竖取势 */
  stretch: number
  /** 飞白强度 0..1：枯笔擦出的纸白丝 */
  dry: number
  /** 洇墨强度 0..1：笔画外圈晕开的墨 */
  bleed: number
  /** 墨色渐变：底部混入的副色（朱砂 / 紫 / 暖纸影） */
  tint: string
  tintAmt: number
}

const BRUSH = '"Ma Shan Zheng","STKaiti","KaiTi","Noto Serif SC",serif'
const RUNNING = '"Zhi Mang Xing","STKaiti","KaiTi","Noto Serif SC",serif'
const HAND = '"Long Cang","STKaiti","KaiTi","Noto Serif SC",serif'
const KAI = '"KaiTi","STKaiti","Noto Serif SC","Songti SC",serif'
const FANG = '"FangSong","STFangsong","KaiTi","Noto Serif SC",serif'

const S = (o: Partial<StyleDef>): StyleDef => ({
  family: KAI, bold: 0, shear: 0, stretch: 1, dry: 0.2, bleed: 0.12, tint: '', tintAmt: 0, ...o,
})

/** 每兵种 / 每敌人一套书风。友军是墨牌上的纸白字（碑拓语言），敌军是纸牌上的墨字。 */
export const GLYPH_STYLES: Record<GlyphStyleKey, StyleDef> = {
  blade: S({ family: BRUSH, shear: -0.04, dry: 0.26, bleed: 0.16, tint: '#d8cbaa', tintAmt: 0.35 }),
  spear: S({ family: RUNNING, stretch: 1.07, dry: 0.4, bleed: 0.08, tint: '#d8cbaa', tintAmt: 0.3 }),
  bow: S({ family: HAND, shear: 0.05, dry: 0.22, bleed: 0.1, tint: '#e2d6b8', tintAmt: 0.4 }),
  cavalry: S({ family: BRUSH, shear: -0.14, dry: 0.3, bleed: 0.18, tint: '#d8cbaa', tintAmt: 0.35 }),
  mage: S({ family: RUNNING, dry: 0.16, bleed: 0.3, tint: '#e8b49a', tintAmt: 0.45 }),
  engineer: S({ family: FANG, dry: 0.04, bleed: 0.04, tint: '#ddd2b6', tintAmt: 0.3 }),
  warlock: S({ family: HAND, dry: 0.2, bleed: 0.26, tint: '#cdb8e0', tintAmt: 0.45 }),
  lance: S({ family: BRUSH, shear: -0.12, dry: 0.3, bleed: 0.18, tint: '#d8cbaa', tintAmt: 0.35 }),
  halberd: S({ family: RUNNING, dry: 0.3, bleed: 0.14, tint: '#d8cbaa', tintAmt: 0.3 }),
  pyro: S({ family: BRUSH, dry: 0.2, bleed: 0.26, tint: '#f0b090', tintAmt: 0.55 }),
  hero: S({ family: BRUSH, dry: 0.14, bleed: 0.22, tint: '#ffe9b0', tintAmt: 0.5 }),
  raider: S({ family: KAI, dry: 0.36, bleed: 0.14 }),
  runner: S({ family: RUNNING, shear: -0.16, dry: 0.42, bleed: 0.08 }),
  brute: S({ family: KAI, bold: 0.05, dry: 0.1, bleed: 0.2 }),
  gunner: S({ family: FANG, dry: 0.2, bleed: 0.08 }),
  bomber: S({ family: BRUSH, dry: 0.14, bleed: 0.36, tint: '#a0432c', tintAmt: 0.3 }),
  splitter: S({ family: KAI, dry: 0.32, bleed: 0.16 }),
  hexer: S({ family: RUNNING, dry: 0.2, bleed: 0.24, tint: '#5b3a6b', tintAmt: 0.35 }),
  champion: S({ family: KAI, bold: 0.05, dry: 0.1, bleed: 0.16, tint: '#7d2f2f', tintAmt: 0.25 }),
  breaker: S({ family: KAI, dry: 0.52, bleed: 0.1, tint: '#8a2f2a', tintAmt: 0.3 }),
  boss: S({ family: BRUSH, dry: 0.2, bleed: 0.45 }),
}

/* ---------------- 字体加载与代数号 ---------------- */

let gen = 0
export function glyphGen(): number { return gen }

const FONT_FAMILIES = ['Ma Shan Zheng', 'Zhi Mang Xing', 'Long Cang']
const SAMPLE = '刀枪弓骑法术工骁戟焰锋鸢鹭雪寇驰甲弩雷裂咒卫断魈铁蛛鼓麟'
if (typeof document !== 'undefined' && document.fonts) {
  Promise.all(FONT_FAMILIES.map((f) => document.fonts.load(`20px "${f}"`, SAMPLE)))
    .then(() => { gen++; cache.clear() })
    .catch(() => { /* 字体加载失败就沿用系统楷，不阻塞游戏 */ })
}

/* ---------------- 缓存 ---------------- */

export interface Frag {
  cv: HTMLCanvasElement
  /** 碎片质心相对字形中心的偏移（全分辨率 px） */
  ox: number
  oy: number
  w: number
  h: number
}

interface Entry {
  cv: HTMLCanvasElement
  w: number
  h: number
  gen: number
  frags: Frag[] | null
}

const cache = new Map<string, Entry>()

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) / 4294967296
}

function mixHex(a: string, b: string, t: number): string {
  const pa = a.replace('#', ''), pb = b.replace('#', '')
  const r = Math.round(parseInt(pa.slice(0, 2), 16) * (1 - t) + parseInt(pb.slice(0, 2), 16) * t)
  const g = Math.round(parseInt(pa.slice(2, 4), 16) * (1 - t) + parseInt(pb.slice(2, 4), 16) * t)
  const bl = Math.round(parseInt(pa.slice(4, 6), 16) * (1 - t) + parseInt(pb.slice(4, 6), 16) * t)
  return `rgb(${r},${g},${bl})`
}

function buildEntry(text: string, style: GlyphStyleKey, sz: number, color: string): Entry {
  const st = GLYPH_STYLES[style] || GLYPH_STYLES.raider
  const pad = Math.ceil(sz * (0.24 + st.bleed * 0.14))
  const w = Math.ceil(sz * (1 + Math.abs(st.shear)) + pad * 2)
  const h = Math.ceil(sz * st.stretch + pad * 2)
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const g = cv.getContext('2d')!
  g.translate(w / 2, h / 2)
  g.transform(1, 0, st.shear, st.stretch, 0, 0)
  g.font = `400 ${sz}px ${st.family}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'

  /* 洇墨：笔画外圈先晕一层淡墨，纸面吃墨的感觉 */
  if (st.bleed > 0.02) {
    g.save()
    g.globalAlpha = 0.3 * st.bleed
    g.shadowColor = color
    g.shadowBlur = sz * 0.14 * st.bleed
    g.fillStyle = color
    g.fillText(text, 0, 0)
    g.restore()
  }

  /* 主笔：墨色上浓下淡（或混入朱砂 / 紫），不是平涂 */
  const grad = g.createLinearGradient(0, -sz * 0.5, 0, sz * 0.5)
  grad.addColorStop(0, color)
  grad.addColorStop(1, st.tint ? mixHex(color, st.tint, st.tintAmt) : color)
  g.fillStyle = grad
  if (st.bold > 0) {
    g.lineWidth = sz * st.bold
    g.strokeStyle = color
    g.lineJoin = 'round'
    g.strokeText(text, 0, 0)
  }
  g.fillText(text, 0, 0)

  /* 飞白：枯笔擦出几道纸白丝，方向随字而定，同一字永远一致 */
  if (st.dry > 0.05) {
    g.globalCompositeOperation = 'destination-out'
    const seed = hashStr(text + style)
    const n = 2 + Math.round(st.dry * 4)
    for (let i = 0; i < n; i++) {
      const a = (seed * 6.28 + i * 1.7) % Math.PI
      const off = (hashStr(text + i + style) - 0.5) * sz * 0.7
      const lx = Math.cos(a), ly = Math.sin(a)
      g.globalAlpha = st.dry * (0.22 + hashStr(style + i + text) * 0.3)
      g.lineWidth = sz * (0.015 + hashStr(text + style + i) * 0.03)
      g.beginPath()
      g.moveTo(-lx * sz * 0.6 - ly * off, -ly * sz * 0.6 + lx * off)
      g.lineTo(lx * sz * 0.6 - ly * off, ly * sz * 0.6 + lx * off)
      g.stroke()
    }
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
  }

  return { cv, w, h, gen, frags: null }
}

function entryOf(text: string, style: GlyphStyleKey, size: number, color: string): Entry {
  const sz = Math.max(12, Math.round(size / 4) * 4)
  const key = `${text}|${style}|${sz}|${color}`
  let e = cache.get(key)
  if (!e || e.gen !== gen) {
    e = buildEntry(text, style, sz, color)
    cache.set(key, e)
  }
  return e
}

/** 居中画一个活字。正常帧的唯一字形开销 = 1 次 drawImage。 */
export function drawGlyph(
  ctx: CanvasRenderingContext2D, text: string, style: GlyphStyleKey,
  size: number, color: string, x: number, y: number,
): void {
  const e = entryOf(text, style, size, color)
  ctx.drawImage(e.cv, x - e.w / 2, y - e.h / 2)
}

/* ---------------- 笔画碎片（连通域） ---------------- */

function buildFrags(e: Entry): Frag[] {
  const cap = 96
  const sc = Math.min(1, cap / Math.max(e.w, e.h))
  const sw = Math.max(1, Math.round(e.w * sc))
  const sh = Math.max(1, Math.round(e.h * sc))
  const tmp = document.createElement('canvas')
  tmp.width = sw; tmp.height = sh
  const tg = tmp.getContext('2d')!
  tg.drawImage(e.cv, 0, 0, sw, sh)
  const data = tg.getImageData(0, 0, sw, sh).data
  const label = new Int32Array(sw * sh).fill(-1)
  const comps: { x0: number; y0: number; x1: number; y1: number; n: number; cx: number; cy: number }[] = []
  const stack: number[] = []
  for (let i = 0; i < sw * sh; i++) {
    if (label[i] >= 0 || data[i * 4 + 3] < 50) continue
    const id = comps.length
    let x0 = sw, y0 = sh, x1 = 0, y1 = 0, n = 0, sx = 0, sy = 0
    stack.length = 0
    stack.push(i)
    label[i] = id
    while (stack.length) {
      const p = stack.pop()!
      const px = p % sw, py = (p / sw) | 0
      n++; sx += px; sy += py
      if (px < x0) x0 = px; if (px > x1) x1 = px
      if (py < y0) y0 = py; if (py > y1) y1 = py
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = px + dx, ny = py + dy
        if (nx < 0 || ny < 0 || nx >= sw || ny >= sh) continue
        const q = ny * sw + nx
        if (label[q] < 0 && data[q * 4 + 3] >= 50) { label[q] = id; stack.push(q) }
      }
    }
    comps.push({ x0, y0, x1, y1, n, cx: sx / n, cy: sy / n })
  }
  const total = comps.reduce((a, c) => a + c.n, 0) || 1
  const frags: Frag[] = []
  const push = (x0: number, y0: number, x1: number, y1: number, cx: number, cy: number, onlyId: number): void => {
    const fw = Math.max(1, Math.round((x1 - x0 + 1) / sc))
    const fh = Math.max(1, Math.round((y1 - y0 + 1) / sc))
    const fc = document.createElement('canvas')
    fc.width = fw; fc.height = fh
    const fg = fc.getContext('2d')!
    fg.drawImage(e.cv, x0 / sc, y0 / sc, (x1 - x0 + 1) / sc, (y1 - y0 + 1) / sc, 0, 0, fw, fh)
    /* 只留本连通域的像素：掩码放大盖回去 */
    const mask = document.createElement('canvas')
    mask.width = x1 - x0 + 1; mask.height = y1 - y0 + 1
    const mg = mask.getContext('2d')!
    const md = mg.createImageData(mask.width, mask.height)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (label[y * sw + x] === onlyId) {
        const o = ((y - y0) * mask.width + (x - x0)) * 4
        md.data[o] = 255; md.data[o + 1] = 255; md.data[o + 2] = 255; md.data[o + 3] = 255
      }
    }
    mg.putImageData(md, 0, 0)
    fg.globalCompositeOperation = 'destination-in'
    fg.drawImage(mask, 0, 0, fw, fh)
    frags.push({ cv: fc, ox: cx / sc - e.w / 2, oy: cy / sc - e.h / 2, w: fw, h: fh })
  }
  comps.forEach((c, id) => {
    if (c.n < 5) return
    /* 一整块太大（笔画粘连）就再切成 2×2，散开时才像"笔画"而不是"半块砖" */
    if (c.n > total * 0.5 && comps.length < 3) {
      const mx = (c.x0 + c.x1) / 2, my = (c.y0 + c.y1) / 2
      for (const [qx0, qy0, qx1, qy1] of [
        [c.x0, c.y0, mx, my], [mx, c.y0, c.x1, my], [c.x0, my, mx, c.y1], [mx, my, c.x1, c.y1],
      ]) push(qx0, qy0, qx1, qy1, (qx0 + qx1) / 2, (qy0 + qy1) / 2, id)
    } else {
      push(c.x0, c.y0, c.x1, c.y1, c.cx, c.cy, id)
    }
  })
  /* 碎片太多就合并最小的，控制在 14 片以内 */
  while (frags.length > 14) {
    let mi = 0
    for (let i = 1; i < frags.length; i++) if (frags[i].w * frags[i].h < frags[mi].w * frags[mi].h) mi = i
    frags.splice(mi, 1)
  }
  return frags
}

export function glyphFrags(text: string, style: GlyphStyleKey, size: number, color: string): Frag[] {
  const e = entryOf(text, style, size, color)
  if (!e.frags) e.frags = buildFrags(e)
  return e.frags
}

/** 受击：字形纵向压缩 + 笔画碎片错位。k 是受击强度 0..1。 */
export function drawGlyphHit(
  ctx: CanvasRenderingContext2D, text: string, style: GlyphStyleKey,
  size: number, color: string, x: number, y: number, k: number,
): void {
  if (k <= 0.02) { drawGlyph(ctx, text, style, size, color, x, y); return }
  const frags = glyphFrags(text, style, size, color)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1 + k * 0.09, 1 - k * 0.15)
  const seed = hashStr(text)
  for (let i = 0; i < frags.length; i++) {
    const f = frags[i]
    const jx = Math.sin(seed * 40 + i * 2.3) * 2.6 * k
    const jy = Math.cos(seed * 31 + i * 1.7) * 1.8 * k
    ctx.drawImage(f.cv, f.ox - f.w / 2 + jx, f.oy - f.h / 2 + jy)
  }
  ctx.restore()
}