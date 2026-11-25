/* 墨潮 · 造型库（离屏 sprite）
 *
 * 为什么要有这一层：
 *   原来十一种敌人有九种是 arc() 画的圆或椭圆，玩家在两百个墨点里分不出谁是谁。
 *   要做出"志怪"的轮廓——立起来的墨滴、梭形的疾影、鼓胀的爆囊、蛛形的织网——
 *   每只都得十几条路径。两百只 × 十几条路径 × 60 帧，主线程扛不住。
 *
 * 做法：把每一只的静态造型（洇墨底、主体、材质、五官、纸垫）一次性画进离屏 canvas，
 *   按 种类 + 半径 + 精英 + 受击 缓存；每帧只 drawImage，再叠很少的动态层
 *   （呼吸、倾斜、护盾环、精英环、死亡）。造型复杂度与帧时间就此解耦。
 *
 * 口径：纸是底，墨是形，朱砂只指危险。所有形状都是路径，没有一张外部贴图。
 */

const INK = '#26221e';
const RED = '#b5342b';
const PAPER = '#fffdf7';

/** 确定性抖动：同一个 seed 永远得到同一条边，形状不会每帧乱跳 */
function jit(seed: number, i: number): number {
  let h = Math.imul(seed * 374761393 + i * 668265263, 1274126177);
  h = (h ^ (h >>> 13)) >>> 0;
  return (h % 1000) / 1000 - 0.5;
}

/** 不规则墨团：以椭圆为骨，边缘按 hash 抖动，读作"洇开的墨"而不是几何圆 */
function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, seed: number, wob = 0.14, n = 12): void {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + jit(seed, i % n) * wob;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else {
      const pa = ((i - 0.5) / n) * Math.PI * 2;
      const pk = 1 + jit(seed, (i - 1) % n) * wob * 1.3;
      ctx.quadraticCurveTo(cx + Math.cos(pa) * rx * pk * 1.06, cy + Math.sin(pa) * ry * pk * 1.06, x, y);
    }
  }
  ctx.closePath();
}

/** 洇墨：主体外面先铺一层更淡更大的墨，边就"化"开了 */
function bleed(ctx: CanvasRenderingContext2D, r: number, seed: number, color: string, rx = 1, ry = 1): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.16;
  blob(ctx, 0, r * 0.06, r * 1.24 * rx, r * 1.2 * ry, seed + 7, 0.2);
  ctx.fill();
  ctx.globalAlpha = 0.1;
  blob(ctx, 0, r * 0.04, r * 1.45 * rx, r * 1.38 * ry, seed + 13, 0.26);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** 墨上的飞白：顺着形体的两三道纸色细痕，墨才有笔触而不是塑料 */
function dry(ctx: CanvasRenderingContext2D, r: number, seed: number, n = 3): void {
  ctx.strokeStyle = 'rgba(255,253,247,.30)';
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const y = -r * 0.5 + i * r * 0.42 + jit(seed, i) * r * 0.2;
    ctx.lineWidth = Math.max(0.7, r * (0.07 - i * 0.012));
    ctx.beginPath();
    ctx.moveTo(-r * 0.5 + jit(seed, i + 3) * r * 0.3, y);
    ctx.quadraticCurveTo(0, y - r * 0.12, r * 0.42 + jit(seed, i + 5) * r * 0.2, y + r * 0.06);
    ctx.stroke();
  }
}

/** 一对眼：纸白底 + 朱砂瞳。敌人再多，"有眼睛的那面"永远读得出朝向 */
function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number, rr: number, pupil = RED): void {
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.ellipse(x - gap, y, rr, rr * 1.15, 0, 0, Math.PI * 2);
  ctx.ellipse(x + gap, y, rr, rr * 1.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pupil;
  ctx.beginPath();
  ctx.arc(x - gap + rr * 0.18, y + rr * 0.1, rr * 0.46, 0, Math.PI * 2);
  ctx.arc(x + gap + rr * 0.18, y + rr * 0.1, rr * 0.46, 0, Math.PI * 2);
  ctx.fill();
}

export interface Palette { body: string; dark: string; light: string; accent: string }

function pal(body: string, flash: boolean): Palette {
  if (flash) return { body: '#ffd9c9', dark: '#e08a6a', light: '#fff3ea', accent: RED };
  return { body, dark: shade(body, -0.35), light: shade(body, 0.28), accent: RED };
}

function shade(hex: string, k: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/* ===================== 十一种普通敌人 ===================== */

type Painter = (ctx: CanvasRenderingContext2D, r: number, C: Palette, seed: number) => void;

/** 墨卒：一滴立起来的墨。下钝上尖，两只朱瞳，脚下一摊墨渍 */
const mote: Painter = (ctx, r, C, seed) => {
  bleed(ctx, r, seed, C.body, 0.9, 0.95);
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.5);
  ctx.bezierCurveTo(r * 0.5, -r * 0.85, r * 1.02, -r * 0.2, r * 0.96, r * 0.34);
  ctx.bezierCurveTo(r * 0.9, r * 1.02, r * 0.42, r * 1.16, 0, r * 1.14);
  ctx.bezierCurveTo(-r * 0.42, r * 1.16, -r * 0.9, r * 1.02, -r * 0.96, r * 0.34);
  ctx.bezierCurveTo(-r * 1.02, -r * 0.2, -r * 0.5, -r * 0.85, 0, -r * 1.5);
  ctx.closePath();
  ctx.fill();
  /* 顶上的尖再压一点浓墨，墨滴的"尖"才立得住 */
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.5);
  ctx.quadraticCurveTo(r * 0.3, -r * 0.7, r * 0.16, -r * 0.34);
  ctx.quadraticCurveTo(0, -r * 0.5, -r * 0.16, -r * 0.34);
  ctx.quadraticCurveTo(-r * 0.3, -r * 0.7, 0, -r * 1.5);
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.5;
  blob(ctx, -r * 0.34, -r * 0.1, r * 0.3, r * 0.42, seed + 3, 0.2, 8);
  ctx.fill();
  ctx.globalAlpha = 1;
  eyes(ctx, 0, r * 0.24, r * 0.34, r * 0.2);
};

/** 疾影：梭形的一条，头尖尾分叉，身后两道飞白。朝 +x，绘制时按速度旋转 */
const streak: Painter = (ctx, r, C, seed) => {
  ctx.fillStyle = C.body;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.moveTo(-r * 2.5, -r * 0.34); ctx.lineTo(-r * 0.6, -r * 0.12);
  ctx.lineTo(-r * 0.6, r * 0.12); ctx.lineTo(-r * 2.5, r * 0.34);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(r * 1.95, 0);
  ctx.bezierCurveTo(r * 0.9, -r * 0.62, -r * 0.2, -r * 0.66, -r * 0.95, -r * 0.3);
  ctx.lineTo(-r * 1.75, -r * 0.62);
  ctx.lineTo(-r * 1.2, 0);
  ctx.lineTo(-r * 1.75, r * 0.62);
  ctx.lineTo(-r * 0.95, r * 0.3);
  ctx.bezierCurveTo(-r * 0.2, r * 0.66, r * 0.9, r * 0.62, r * 1.95, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.ellipse(r * 0.35, -r * 0.16, r * 0.62, r * 0.16, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER;
  ctx.beginPath(); ctx.arc(r * 1.05, -r * 0.1, r * 0.17, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(r * 1.1, -r * 0.1, r * 0.08, 0, Math.PI * 2); ctx.fill();
  dry(ctx, r * 0.8, seed, 2);
};

/** 投笔：一支立着的笔。木杆、铜箍、墨头、笔尖一点朱 */
const caster: Painter = (ctx, r, C, seed) => {
  bleed(ctx, r, seed, C.body, 0.85, 0.8);
  ctx.strokeStyle = '#6b5436';
  ctx.lineWidth = r * 0.34;
  ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(0, -r * 2.35); ctx.lineTo(0, -r * 0.5); ctx.stroke();
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath(); ctx.moveTo(-r * 0.06, -r * 2.3); ctx.lineTo(-r * 0.06, -r * 0.6); ctx.stroke();
  ctx.fillStyle = '#c0922f';
  ctx.fillRect(-r * 0.26, -r * 0.78, r * 0.52, r * 0.26);
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(-r * 0.34, -r * 0.55);
  ctx.bezierCurveTo(-r * 1.05, -r * 0.1, -r * 0.95, r * 0.95, 0, r * 1.25);
  ctx.bezierCurveTo(r * 0.95, r * 0.95, r * 1.05, -r * 0.1, r * 0.34, -r * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.4;
  blob(ctx, -r * 0.3, r * 0.1, r * 0.26, r * 0.4, seed + 5, 0.2, 8);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(0, -r * 2.45, r * 0.2, 0, Math.PI * 2); ctx.fill();
  eyes(ctx, 0, r * 0.34, r * 0.3, r * 0.17);
};

/** 重墨：压下来的一块墨岩。塌角、裂纹、两道纸缝当眼 */
const heavy: Painter = (ctx, r, C, seed) => {
  bleed(ctx, r, seed, C.body, 1.05, 0.9);
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(-r * 0.82, -r * 1.02);
  ctx.lineTo(r * 0.7, -r * 1.12);
  ctx.lineTo(r * 1.08, -r * 0.42);
  ctx.lineTo(r * 1.02, r * 0.86);
  ctx.lineTo(r * 0.5, r * 1.16);
  ctx.lineTo(-r * 0.66, r * 1.1);
  ctx.lineTo(-r * 1.1, r * 0.36);
  ctx.closePath();
  ctx.fill();
  /* 顶面受光：一块更浅的墨，体积感来自这里 */
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.32;
  ctx.beginPath();
  ctx.moveTo(-r * 0.82, -r * 1.02); ctx.lineTo(r * 0.7, -r * 1.12);
  ctx.lineTo(r * 0.5, -r * 0.5); ctx.lineTo(-r * 0.62, -r * 0.42);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  /* 裂纹 */
  ctx.strokeStyle = C.dark;
  ctx.lineWidth = Math.max(1, r * 0.07);
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.4); ctx.lineTo(-r * 0.05, r * 0.15); ctx.lineTo(-r * 0.34, r * 0.7);
  ctx.moveTo(r * 0.42, -r * 0.2); ctx.lineTo(r * 0.62, r * 0.5);
  ctx.stroke();
  ctx.fillStyle = PAPER;
  ctx.fillRect(-r * 0.56, -r * 0.16, r * 0.36, r * 0.17);
  ctx.fillRect(r * 0.2, -r * 0.2, r * 0.36, r * 0.17);
  ctx.fillStyle = RED;
  ctx.fillRect(-r * 0.44, -r * 0.13, r * 0.13, r * 0.11);
  ctx.fillRect(r * 0.32, -r * 0.17, r * 0.13, r * 0.11);
};

/** 爆墨：鼓胀的墨囊，裂缝里透出朱火，顶上一根引线 */
const bomber: Painter = (ctx, r, C, seed) => {
  bleed(ctx, r, seed, RED, 1, 1);
  ctx.fillStyle = C.body;
  blob(ctx, 0, r * 0.08, r * 1.05, r * 1.0, seed, 0.1, 14);
  ctx.fill();
  /* 囊里的火：三层朱 → 橙 → 黄，裂缝是纸色 */
  const g = ctx.createRadialGradient(0, r * 0.1, r * 0.06, 0, r * 0.1, r * 0.86);
  g.addColorStop(0, '#ffd166');
  g.addColorStop(0.42, '#e07b3c');
  g.addColorStop(1, 'rgba(122,31,26,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.86, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7a1f1a';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath();
  ctx.moveTo(-r * 0.72, -r * 0.2); ctx.lineTo(-r * 0.2, r * 0.06); ctx.lineTo(-r * 0.42, r * 0.62);
  ctx.moveTo(r * 0.68, -r * 0.32); ctx.lineTo(r * 0.24, r * 0.14); ctx.lineTo(r * 0.5, r * 0.66);
  ctx.stroke();
  ctx.strokeStyle = '#4a3b2e';
  ctx.lineWidth = Math.max(1, r * 0.13);
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.98); ctx.quadraticCurveTo(r * 0.42, -r * 1.5, r * 0.16, -r * 1.85);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(r * 0.16, -r * 1.9, r * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e07b3c';
  ctx.beginPath(); ctx.arc(r * 0.16, -r * 1.9, r * 0.36, 0, Math.PI * 2); ctx.globalAlpha = 0.4; ctx.fill();
  ctx.globalAlpha = 1;
};

/** 裂墨：中间一道锯齿裂缝，两半明显错开——一眼看出"打碎会分" */
const splitter: Painter = (ctx, r, C, seed) => {
  bleed(ctx, r, seed, C.body, 1, 1);
  for (const sgn of [-1, 1]) {
    ctx.save();
    ctx.translate(sgn * r * 0.2, sgn * r * 0.1);
    ctx.fillStyle = sgn < 0 ? C.body : C.dark;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.0);
    ctx.bezierCurveTo(sgn * r * 1.12, -r * 0.86, sgn * r * 1.16, r * 0.82, 0, r * 1.02);
    ctx.lineTo(sgn * r * 0.2, r * 0.48);
    ctx.lineTo(-sgn * r * 0.12, r * 0.14);
    ctx.lineTo(sgn * r * 0.22, -r * 0.3);
    ctx.lineTo(-sgn * r * 0.08, -r * 0.64);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  /* 裂缝里透出纸：一条有宽度的锯齿，而不是一根 1px 的线 */
  ctx.fillStyle = 'rgba(255,253,247,.92)';
  ctx.beginPath();
  ctx.moveTo(-r * 0.06, -r * 1.02);
  ctx.lineTo(r * 0.2, -r * 0.38);
  ctx.lineTo(-r * 0.1, r * 0.12);
  ctx.lineTo(r * 0.18, r * 0.62);
  ctx.lineTo(r * 0.02, r * 1.04);
  ctx.lineTo(-r * 0.16, r * 0.6);
  ctx.lineTo(-r * 0.3, r * 0.1);
  ctx.lineTo(-r * 0.02, -r * 0.4);
  ctx.closePath();
  ctx.fill();
  eyes(ctx, 0, -r * 0.05, r * 0.52, r * 0.15);
};

/** 织网：蛛形。圆腹 + 小头 + 六条折腿，走过留网的那只 */
const weaver: Painter = (ctx, r, C, seed) => {
  ctx.strokeStyle = C.dark;
  ctx.lineWidth = Math.max(1, r * 0.13);
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1;
    const k = i % 3;
    const a = (-0.55 + k * 0.55) * side;
    const x0 = side * r * 0.5, y0 = -r * 0.1 + k * r * 0.2;
    const x1 = x0 + Math.cos(a) * r * 0.95 * side * (side < 0 ? -1 : 1);
    const y1 = y0 - r * 0.62 + k * r * 0.34;
    const x2 = x1 + side * r * 0.55;
    const y2 = y1 + r * 0.85;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  bleed(ctx, r, seed, C.body, 0.8, 0.8);
  ctx.fillStyle = C.body;
  blob(ctx, 0, r * 0.24, r * 0.86, r * 0.78, seed, 0.1, 12);
  ctx.fill();
  ctx.fillStyle = C.dark;
  ctx.beginPath(); ctx.arc(0, -r * 0.52, r * 0.42, 0, Math.PI * 2); ctx.fill();
  /* 腹上的网纹 */
  ctx.strokeStyle = 'rgba(255,253,247,.4)';
  ctx.lineWidth = Math.max(0.7, r * 0.06);
  for (let k = 1; k <= 2; k++) {
    ctx.beginPath(); ctx.arc(0, r * 0.24, r * 0.3 * k, 0.4, Math.PI - 0.4); ctx.stroke();
  }
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(-r * 0.16, -r * 0.58, r * 0.1, 0, Math.PI * 2);
  ctx.arc(r * 0.16, -r * 0.58, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
};

/** 盾墨：墨核 + 外挂的六角墨壳。壳在绘制层按护盾值单独画，这里只画核与壳座 */
const warder: Painter = (ctx, r, C, seed) => {
  bleed(ctx, r, seed, C.body, 0.9, 0.9);
  ctx.fillStyle = C.body;
  blob(ctx, 0, 0, r * 0.82, r * 0.86, seed, 0.1, 12);
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.35;
  blob(ctx, -r * 0.24, -r * 0.2, r * 0.28, r * 0.34, seed + 2, 0.2, 8);
  ctx.fill();
  ctx.globalAlpha = 1;
  /* 壳座：六个卡榫，护盾在时壳就扣在这上面 */
  ctx.fillStyle = '#c7a45a';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    ctx.save();
    ctx.translate(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
    ctx.rotate(a);
    ctx.fillRect(-r * 0.1, -r * 0.14, r * 0.2, r * 0.28);
    ctx.restore();
  }
  eyes(ctx, 0, r * 0.06, r * 0.28, r * 0.16, '#8a6a3a');
};

/** 幽影：鬼面。圆头、波浪下摆、两个空洞的眼 */
const phantom: Painter = (ctx, r, C, seed) => {
  ctx.fillStyle = C.body;
  ctx.globalAlpha = 0.2;
  blob(ctx, 0, 0, r * 1.3, r * 1.35, seed + 9, 0.24);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(-r * 0.95, r * 0.2);
  ctx.bezierCurveTo(-r * 1.05, -r * 1.15, r * 1.05, -r * 1.15, r * 0.95, r * 0.2);
  const hem = 5;
  for (let i = 0; i <= hem; i++) {
    const t = i / hem;
    const x = r * 0.95 - t * r * 1.9;
    const y = r * (i % 2 ? 1.22 : 0.72);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.45, r * 0.3, r * 0.4, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  /* 空洞的眼：纸色挖空 + 里面一点朱 */
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.ellipse(-r * 0.34, -r * 0.24, r * 0.2, r * 0.3, 0.1, 0, Math.PI * 2);
  ctx.ellipse(r * 0.34, -r * 0.24, r * 0.2, r * 0.3, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(-r * 0.34, -r * 0.2, r * 0.09, 0, Math.PI * 2);
  ctx.arc(r * 0.34, -r * 0.2, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,253,247,.5)';
  ctx.lineWidth = Math.max(0.8, r * 0.07);
  ctx.beginPath(); ctx.arc(0, r * 0.3, r * 0.26, 0.25, Math.PI - 0.25); ctx.stroke();
};

/** 咒者：披袍的人形。三角袍 + 兜帽 + 身前三枚符点 */
const chanter: Painter = (ctx, r, C, seed) => {
  bleed(ctx, r, seed, C.body, 0.9, 1);
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.35);
  ctx.bezierCurveTo(r * 0.62, -r * 1.2, r * 0.72, -r * 0.5, r * 0.5, -r * 0.24);
  ctx.lineTo(r * 1.12, r * 1.16);
  ctx.lineTo(-r * 1.12, r * 1.16);
  ctx.lineTo(-r * 0.5, -r * 0.24);
  ctx.bezierCurveTo(-r * 0.72, -r * 0.5, -r * 0.62, -r * 1.2, 0, -r * 1.35);
  ctx.closePath();
  ctx.fill();
  /* 袍襟：一道更深的墨，人形才有前后 */
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.2); ctx.lineTo(r * 0.34, r * 1.16); ctx.lineTo(-r * 0.1, r * 1.16);
  ctx.closePath(); ctx.fill();
  /* 兜帽里的脸：一片纸色阴影 + 两点朱 */
  ctx.fillStyle = 'rgba(20,16,14,.82)';
  ctx.beginPath(); ctx.ellipse(0, -r * 0.72, r * 0.36, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.arc(-r * 0.15, -r * 0.74, r * 0.09, 0, Math.PI * 2);
  ctx.arc(r * 0.15, -r * 0.74, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  /* 袍摆的符 */
  ctx.strokeStyle = 'rgba(255,253,247,.45)';
  ctx.lineWidth = Math.max(0.8, r * 0.06);
  ctx.beginPath();
  ctx.moveTo(-r * 0.66, r * 0.72); ctx.lineTo(r * 0.66, r * 0.72);
  ctx.moveTo(-r * 0.4, r * 0.94); ctx.lineTo(r * 0.4, r * 0.94);
  ctx.stroke();
};

/** 碎墨：裂墨掉下来的小片，一角带朱 */
const shard: Painter = (ctx, r, C) => {
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(-r * 1.0, r * 0.72);
  ctx.lineTo(-r * 0.2, -r * 1.1);
  ctx.lineTo(r * 1.05, r * 0.36);
  ctx.lineTo(r * 0.24, r * 0.98);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(-r * 0.2, -r * 1.1); ctx.lineTo(r * 0.3, r * 0.1); ctx.lineTo(-r * 0.5, r * 0.3);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
};

const PAINTERS: Record<string, Painter> = {
  mote, streak, caster, heavy, bomber, splitter, weaver, warder, phantom, chanter, shard,
};

const BODY_COLOR: Record<string, string> = {
  mote: '#2b2723', streak: '#3a3f4a', caster: '#3f5c86', heavy: '#1e1b18',
  bomber: '#7a2420', splitter: '#4a3b2e', weaver: '#4f7757', warder: '#5b5751',
  phantom: '#4d4a58', chanter: '#7c4a63', shard: '#4a3b2e',
};

/* ===================== Boss ===================== */

/** 墨牛：巨大的牛首墨团，两支压墨朱角，鼻环，红眼 */
const bossNiu: Painter = (ctx, r, C) => {
  ctx.fillStyle = 'rgba(38,34,30,.14)';
  ctx.beginPath(); ctx.ellipse(0, r * 0.95, r * 1.2, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  /* 角：先墨后朱。角要往外上方挑出去，收在内侧就成了两个提手 */
  for (const s of [-1, 1]) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.24;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s * r * 0.7, -r * 0.5);
    ctx.quadraticCurveTo(s * r * 1.5, -r * 0.95, s * r * 1.16, -r * 1.62);
    ctx.stroke();
    ctx.strokeStyle = RED;
    ctx.lineWidth = r * 0.1;
    ctx.beginPath();
    ctx.moveTo(s * r * 0.7, -r * 0.5);
    ctx.quadraticCurveTo(s * r * 1.5, -r * 0.95, s * r * 1.16, -r * 1.62);
    ctx.stroke();
  }
  bleed(ctx, r, 31, C.body, 1.15, 1);
  ctx.fillStyle = C.body;
  blob(ctx, 0, 0, r * 1.16, r * 0.98, 17, 0.08, 16);
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.22;
  blob(ctx, -r * 0.34, -r * 0.34, r * 0.5, r * 0.34, 23, 0.2, 10);
  ctx.fill();
  ctx.globalAlpha = 1;
  /* 鼻梁 */
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.moveTo(-r * 0.3, -r * 0.1); ctx.lineTo(r * 0.3, -r * 0.1);
  ctx.lineTo(r * 0.42, r * 0.72); ctx.lineTo(-r * 0.42, r * 0.72);
  ctx.closePath(); ctx.fill();
  eyes(ctx, 0, -r * 0.24, r * 0.52, r * 0.19);
  /* 鼻环 */
  ctx.strokeStyle = '#c0922f';
  ctx.lineWidth = r * 0.09;
  ctx.beginPath(); ctx.arc(0, r * 0.78, r * 0.22, 0.15, Math.PI - 0.15); ctx.stroke();
  dry(ctx, r, 41, 3);
};

/** 纸鸢：折纸风筝。菱形骨架 + 折痕 + 尾飘带 */
const bossZhiyuan: Painter = (ctx, r, C) => {
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 1.15, 0); ctx.lineTo(0, r * 1.3); ctx.lineTo(-r * 1.15, 0);
  ctx.closePath(); ctx.fill();
  /* 折面：一半浅一半深，纸的体积靠这个 */
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.3;
  ctx.beginPath(); ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 1.15, 0); ctx.lineTo(0, r * 1.3); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(1.2, r * 0.05);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.3); ctx.lineTo(0, r * 1.3);
  ctx.moveTo(-r * 1.15, 0); ctx.lineTo(r * 1.15, 0);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, r * 0.06);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 1.15, 0); ctx.lineTo(0, r * 1.3); ctx.lineTo(-r * 1.15, 0);
  ctx.closePath(); ctx.stroke();
  /* 尾飘带 */
  ctx.strokeStyle = RED;
  ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.beginPath();
  ctx.moveTo(0, r * 1.3);
  ctx.quadraticCurveTo(r * 0.4, r * 1.8, -r * 0.1, r * 2.2);
  ctx.stroke();
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.08, 0, Math.PI * 2); ctx.fill();
};

/** 碑灵：一块浮着的石碑。碑额、刻字、朱封、脚下碎石 */
const bossBeiling: Painter = (ctx, r, C) => {
  ctx.fillStyle = 'rgba(38,34,30,.16)';
  ctx.beginPath(); ctx.ellipse(0, r * 1.3, r * 0.9, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(-r * 0.72, -r * 0.95);
  ctx.quadraticCurveTo(0, -r * 1.5, r * 0.72, -r * 0.95);
  ctx.lineTo(r * 0.72, r * 1.15);
  ctx.lineTo(-r * 0.72, r * 1.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.light;
  ctx.globalAlpha = 0.22;
  ctx.fillRect(-r * 0.72, -r * 0.95, r * 0.3, r * 2.1);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, r * 0.05);
  ctx.stroke();
  /* 刻字：四道纸色横槽 */
  ctx.fillStyle = 'rgba(255,253,247,.72)';
  for (let i = 0; i < 4; i++) ctx.fillRect(-r * 0.4, -r * 0.6 + i * r * 0.42, r * 0.8, r * 0.1);
  /* 朱封 */
  ctx.fillStyle = RED;
  ctx.fillRect(-r * 0.22, r * 0.42, r * 0.44, r * 0.44);
  ctx.fillStyle = PAPER;
  ctx.font = `900 ${Math.round(r * 0.3)}px "Songti SC","SimSun",serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('碑', 0, r * 0.66);
  /* 悬浮碎石 */
  ctx.fillStyle = C.dark;
  for (const [dx, dy, s] of [[-1.05, 0.5, 0.16], [1.02, -0.2, 0.13], [0.95, 0.85, 0.1]] as const) {
    ctx.save();
    ctx.translate(dx * r, dy * r);
    ctx.rotate(dx);
    ctx.fillRect(-r * s, -r * s, r * s * 2, r * s * 2);
    ctx.restore();
  }
};

/** 墨龙：龙首。角、须、鬃、朱瞳；身段在绘制层按时间甩 */
const bossMolong: Painter = (ctx, r, C) => {
  bleed(ctx, r, 53, C.body, 1.1, 1);
  /* 鬃 */
  ctx.fillStyle = C.dark;
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.62 + (i / 6) * Math.PI * 0.76;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    ctx.lineTo(Math.cos(a - 0.12) * r * 1.62, Math.sin(a - 0.12) * r * 1.62);
    ctx.lineTo(Math.cos(a + 0.16) * r * 0.9, Math.sin(a + 0.16) * r * 0.9);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = C.body;
  blob(ctx, 0, 0, r * 1.02, r * 0.92, 29, 0.07, 14);
  ctx.fill();
  /* 吻部 */
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.moveTo(r * 0.3, -r * 0.1);
  ctx.quadraticCurveTo(r * 1.35, r * 0.05, r * 1.15, r * 0.5);
  ctx.quadraticCurveTo(r * 0.7, r * 0.62, r * 0.3, r * 0.42);
  ctx.closePath(); ctx.fill();
  /* 角 */
  ctx.strokeStyle = INK; ctx.lineWidth = r * 0.15; ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * r * 0.34, -r * 0.72);
    ctx.quadraticCurveTo(s * r * 0.72, -r * 1.4, s * r * 0.2, -r * 1.5);
    ctx.stroke();
  }
  /* 须 */
  ctx.strokeStyle = RED; ctx.lineWidth = Math.max(1.2, r * 0.055);
  ctx.beginPath();
  ctx.moveTo(r * 1.05, r * 0.34); ctx.quadraticCurveTo(r * 1.7, r * 0.8, r * 1.3, r * 1.35);
  ctx.moveTo(r * 0.9, r * 0.5); ctx.quadraticCurveTo(r * 1.3, r * 1.1, r * 0.8, r * 1.5);
  ctx.stroke();
  ctx.fillStyle = PAPER;
  ctx.beginPath(); ctx.ellipse(r * 0.24, -r * 0.26, r * 0.24, r * 0.2, -0.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(r * 0.3, -r * 0.24, r * 0.11, 0, Math.PI * 2); ctx.fill();
};

/** 执笔人：高瘦的袍影，扛一管比自己还长的笔 */
const bossZhibi: Painter = (ctx, r, C) => {
  ctx.fillStyle = 'rgba(38,34,30,.16)';
  ctx.beginPath(); ctx.ellipse(0, r * 1.35, r * 0.8, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
  bleed(ctx, r, 61, C.body, 0.85, 1.15);
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.45);
  ctx.bezierCurveTo(r * 0.5, -r * 1.3, r * 0.52, -r * 0.62, r * 0.34, -r * 0.36);
  ctx.lineTo(r * 0.86, r * 1.3);
  ctx.lineTo(-r * 0.86, r * 1.3);
  ctx.lineTo(-r * 0.34, -r * 0.36);
  ctx.bezierCurveTo(-r * 0.52, -r * 0.62, -r * 0.5, -r * 1.3, 0, -r * 1.45);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.dark;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.3); ctx.lineTo(r * 0.3, r * 1.3); ctx.lineTo(-r * 0.06, r * 1.3);
  ctx.closePath(); ctx.fill();
  /* 脸：一条纸缝 */
  ctx.fillStyle = 'rgba(255,253,247,.85)';
  ctx.fillRect(-r * 0.26, -r * 0.92, r * 0.52, r * 0.12);
  ctx.fillStyle = RED;
  ctx.fillRect(-r * 0.18, -r * 0.9, r * 0.1, r * 0.08);
  ctx.fillRect(r * 0.08, -r * 0.9, r * 0.1, r * 0.08);
  dry(ctx, r * 0.9, 67, 2);
};

const BOSS_PAINTERS: Record<string, Painter> = {
  niu: bossNiu, zhiyuan: bossZhiyuan, beiling: bossBeiling, molong: bossMolong, zhibi: bossZhibi,
};

const BOSS_COLOR: Record<string, string> = {
  niu: '#3a2a24', zhiyuan: '#3f5c86', beiling: '#5b5751', molong: '#26221e', zhibi: '#7c2a24',
};

/* ===================== sprite 缓存 ===================== */

interface Sprite { cv: HTMLCanvasElement; half: number }
const cache = new Map<string, Sprite>();
/** 缓存上限：半径会随精英/缩放变，超过就整批清掉重来，避免长局越堆越多 */
const MAX_CACHE = 96;

/** 造型的外扩倍数：疾影的尾巴、投笔的笔杆、牛的角都超出 r */
function padOf(kind: string, boss: boolean): number {
  if (boss) return kind === 'molong' ? 2.0 : 1.85;
  if (kind === 'streak') return 2.7;
  if (kind === 'caster') return 2.7;
  if (kind === 'weaver') return 2.1;
  if (kind === 'bomber') return 2.2;
  if (kind === 'chanter') return 1.6;
  return 1.7;
}

export function getSprite(kind: string, r: number, flash: boolean, boss: boolean): Sprite {
  const rq = Math.max(4, Math.round(r));
  const key = `${boss ? 'B' : 'e'}:${kind}:${rq}:${flash ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > MAX_CACHE) cache.clear();

  const pad = padOf(kind, boss);
  const half = rq * pad;
  const SS = 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(half * 2 * SS);
  cv.height = Math.ceil(half * 2 * SS);
  const c = cv.getContext('2d');
  if (!c) { const s = { cv, half }; cache.set(key, s); return s }
  c.setTransform(SS, 0, 0, SS, half * SS, half * SS);

  const body = boss ? (BOSS_COLOR[kind] || INK) : (BODY_COLOR[kind] || INK);
  const C = pal(body, flash);
  const seed = kind.charCodeAt(0) * 13 + kind.length * 7;

  /* 纸垫：每个墨点压在自己的纸片上，网格与墨渍不会从身体里透出来。
     必须是柔边晕开的——硬边白圆会让每只敌人看起来像贴在圆片上的贴纸。
     Boss 不垫，它本来就够大，垫了像挖了个洞。 */
  if (!boss) {
    const pg = c.createRadialGradient(0, 0, rq * 0.55, 0, 0, rq * 1.62);
    pg.addColorStop(0, 'rgba(255,253,247,.94)');
    pg.addColorStop(0.55, 'rgba(255,253,247,.8)');
    pg.addColorStop(1, 'rgba(255,253,247,0)');
    c.fillStyle = pg;
    c.beginPath();
    c.arc(0, 0, rq * 1.62, 0, Math.PI * 2);
    c.fill();
  }

  const painter = boss ? BOSS_PAINTERS[kind] : PAINTERS[kind];
  if (painter) painter(c, rq, C, seed);
  else {
    c.fillStyle = C.body;
    blob(c, 0, 0, rq, rq, seed, 0.12, 12);
    c.fill();
    eyes(c, 0, 0, rq * 0.32, rq * 0.17);
  }

  const s = { cv, half };
  cache.set(key, s);
  return s;
}

/** 供绘制层直接用：贴图 + 返回半宽，调用方按 half 定位 */
export function paintEnemy(ctx: CanvasRenderingContext2D, kind: string, r: number, flash: boolean, boss: boolean): void {
  const s = getSprite(kind, r, flash, boss);
  ctx.drawImage(s.cv, -s.half, -s.half, s.half * 2, s.half * 2);
}

export function clearInkCache(): void { cache.clear() }
