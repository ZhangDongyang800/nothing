/* 画面层。
 *
 * 视觉口径：纸是底，墨是形，朱红只用来指"危险 / 稀有"。
 * 造型全部是路径画的，没有一张外部贴图 —— 一是包体不涨，
 * 二是同一种墨在不同体型下能拉伸而不糊。
 *
 * 四条性能约定：
 *   ① 纸底、网格、污渍每帧只画一次（一次 fillRect + 几十条线）；
 *   ② 屏幕外的东西不画（每个实体先做一次矩形剔除）；
 *   ③ 粒子上限由 game 控制，这里不再加预算；
 *   ④ 敌人与 Boss 的复杂造型预渲染进 ink.ts 的离屏 sprite，
 *      每帧只 drawImage + 少量动态层，造型复杂度不吃帧时间。
 */
import type { Game } from './game';
import type { Enemy } from './types';
import { paintEnemy } from './ink';

const INK = '#26221e';
const RED = '#b5342b';
const GOLD = '#c0922f';

let vigKey = '';
let vigGrad: CanvasGradient | null = null;

function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function drawGame(g: Game): void {
  const ctx = g.ctx;
  const { w, h, dpr } = g.view;
  const zoom = g.zoom;
  /* 世界视口：画面按 zoom 缩小，能看到的范围就变成 w/zoom × h/zoom。
     剔除必须用这个范围，否则只是"把画面缩小"，屏幕边上会缺一块。 */
  const vw = w / zoom;
  const vh = h / zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  /* ---------- 纸底 ---------- */
  ctx.fillStyle = '#f7f0df';
  ctx.fillRect(0, 0, w, h);
  const shakeX = g.shake > 0 ? (Math.random() - 0.5) * g.shake : 0;
  const shakeY = g.shake > 0 ? (Math.random() - 0.5) * g.shake : 0;
  ctx.save();
  ctx.translate(w / 2 + shakeX, h / 2 + shakeY);
  ctx.scale(zoom, zoom);
  ctx.translate(-g.camX, -g.camY);

  const step = 64;
  const lx = Math.floor((g.camX - vw / 2) / step) * step;
  const ty = Math.floor((g.camY - vh / 2) / step) * step;
  /* 背景网格再压淡一档：它是纸的纹理，不是路标。 */
  ctx.strokeStyle = 'rgba(38,34,30,.028)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = lx; x < g.camX + vw / 2 + step; x += step) {
    ctx.moveTo(x, g.camY - vh / 2 - step);
    ctx.lineTo(x, g.camY + vh / 2 + step);
  }
  for (let y = ty; y < g.camY + vh / 2 + step; y += step) {
    ctx.moveTo(g.camX - vw / 2 - step, y);
    ctx.lineTo(g.camX + vw / 2 + step, y);
  }
  ctx.stroke();

  /* 纸上的旧墨渍：按格子哈希，走到哪都在同一处 —— 像一张真的旧纸。
     格子放大、透明度压低，装饰退到背景层，不和敌人抢注意力。 */
  const cell = 500;
  const cx0 = Math.floor((g.camX - vw / 2) / cell) - 1;
  const cx1 = Math.floor((g.camX + vw / 2) / cell) + 1;
  const cy0 = Math.floor((g.camY - vh / 2) / cell) - 1;
  const cy1 = Math.floor((g.camY + vh / 2) / cell) + 1;
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const a = hash2(cx, cy);
      const b = hash2(cx + 11, cy - 7);
      ctx.fillStyle = `rgba(38,34,30,${0.012 + a * 0.014})`;
      ctx.beginPath();
      ctx.ellipse(cx * cell + a * cell, cy * cell + b * cell, 24 + a * 40, 10 + b * 20, a * 3, 0, Math.PI * 2);
      ctx.fill();
      if (b > 0.62) {
        ctx.strokeStyle = 'rgba(38,34,30,.022)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx * cell + 40, cy * cell + 30);
        ctx.quadraticCurveTo(cx * cell + 120, cy * cell + 65, cx * cell + 200, cy * cell + 40);
        ctx.stroke();
      }
    }
  }

  /* ---------- 地面区域 ---------- */
  for (const z of g.zones) {
    if (!z.active) continue;
    const left = g.camX - vw / 2 - z.r, right = g.camX + vw / 2 + z.r;
    const top = g.camY - vh / 2 - z.r, bot = g.camY + vh / 2 + z.r;
    if (z.x < left || z.x > right || z.y < top || z.y > bot) continue;
    drawZone(ctx, z.x, z.y, z.r, z.life, z.age, z.type, z.color);
  }

  /* ---------- 掉落 ---------- */
  for (const gem of g.gems) {
    if (!gem.active) continue;
    if (gem.x < g.camX - vw / 2 - 30 || gem.x > g.camX + vw / 2 + 30) continue;
    if (gem.y < g.camY - vh / 2 - 30 || gem.y > g.camY + vh / 2 + 30) continue;
    /* 每颗掉落先垫一块纸：压在墨渍/网格上也能一眼看见 */
    const pulse = gem.kind === 'heal' ? 1 + Math.sin(g.time * 5 + gem.x) * 0.12 : 1;
    ctx.fillStyle = 'rgba(255,253,247,.94)';
    ctx.beginPath(); ctx.arc(gem.x, gem.y, (gem.kind === 'heal' ? 11 : 9) * pulse, 0, Math.PI * 2); ctx.fill();
    if (gem.kind === 'heal') {
      ctx.strokeStyle = 'rgba(79,119,87,.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gem.x, gem.y, 11 + Math.sin(g.time * 4) * 2, 0, Math.PI * 2); ctx.stroke();
    }
    if (gem.kind === 'gold') {
      ctx.fillStyle = GOLD;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gem.x, gem.y, 6, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillRect(gem.x - 1.8, gem.y - 3, 3.6, 6);
    } else if (gem.kind === 'heal') {
      ctx.fillStyle = '#4f7757';
      ctx.fillRect(gem.x - 7, gem.y - 2.5, 14, 5);
      ctx.fillRect(gem.x - 2.5, gem.y - 7, 5, 14);
    } else {
      const a = gem.age * 2.2;
      ctx.save();
      ctx.translate(gem.x, gem.y);
      ctx.rotate(a);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(0, -6.5); ctx.lineTo(5, 0); ctx.lineTo(0, 6.5); ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  /* ---------- 宝箱 / 商人 ---------- */
  for (const it of g.pickups) {
    if (!it.active) continue;
    if (it.kind === 'chest') {
      const bob = Math.sin(it.age * 2.2) * 3;
      ctx.save();
      ctx.translate(it.x, it.y + bob);
      ctx.fillStyle = '#8a6a3a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.fillRect(-15, -10, 30, 22);
      ctx.strokeRect(-15, -10, 30, 22);
      ctx.fillStyle = RED;
      ctx.fillRect(-3, -10, 6, 22);
      ctx.fillStyle = '#fff8e8';
      ctx.fillRect(-3, -2, 6, 5);
      ctx.restore();
      ctx.fillStyle = 'rgba(38,34,30,.62)';
      ctx.font = `700 ${Math.round(12 / zoom)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(255,253,247,.9)';
      ctx.lineWidth = 3 / zoom;
      ctx.strokeText('宝箱', it.x, it.y + 32);
      ctx.fillText('宝箱', it.x, it.y + 32);
    } else {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.fillStyle = GOLD;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-28, -6); ctx.lineTo(0, -26); ctx.lineTo(28, -6);
      ctx.lineTo(20, -6); ctx.lineTo(20, 22); ctx.lineTo(-20, 22); ctx.lineTo(-20, -6);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = 'bold 16px "Microsoft YaHei"';
      ctx.textAlign = 'center';
      ctx.fillText('商', 0, 14);
      ctx.restore();
      ctx.fillStyle = 'rgba(38,34,30,.62)';
      ctx.font = `700 ${Math.round(12 / zoom)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(255,253,247,.9)';
      ctx.lineWidth = 3 / zoom;
      ctx.strokeText('墨商', it.x, it.y + 40);
      ctx.fillText('墨商', it.x, it.y + 40);
    }
  }

  /* ---------- 敌人 ---------- */
  for (let i = 0; i < g.enemies.length; i++) {
    const e = g.enemies[i];
    if (!e.active) continue;
    if (e.x < g.camX - vw / 2 - e.r - 40 || e.x > g.camX + vw / 2 + e.r + 40) continue;
    if (e.y < g.camY - vh / 2 - e.r - 40 || e.y > g.camY + vh / 2 + e.r + 40) continue;
    if (e.spawnT > 0 && Math.floor(e.spawnT * 30) % 2 === 0) continue;
    drawEnemy(ctx, e, g.time);
  }

  /* ---------- 玩家的召唤物 / 环绕刃 ---------- */
  for (const t of g.turrets) {
    if (!t.active) continue;
    ctx.save();
    ctx.translate(t.x, t.y);
    if (t.kind === 'clone') {
      ctx.globalAlpha = 0.55 + Math.sin(g.time * 3 + t.x) * 0.12;
      ctx.fillStyle = '#3a3a3a';
      ctx.beginPath();
      ctx.arc(0, -2, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26221e';
      ctx.beginPath();
      ctx.moveTo(-9, 10); ctx.quadraticCurveTo(0, 2, 9, 10); ctx.lineTo(0, 16);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#8a6a3a';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.fillRect(-8, -4, 16, 14);
      ctx.strokeRect(-8, -4, 16, 14);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(0, -8, 7, 0, Math.PI * 2);
      ctx.fill();
      if (t.double) {
        ctx.fillRect(-8, -8, 3, 6);
        ctx.fillRect(5, -8, 3, 6);
      }
    }
    ctx.restore();
  }

  const p = g.player;
  for (const w of g.weapons) {
    if (!w.orbit) continue;
    const o = w.orbit;
    for (let i = 0; i < o.n; i++) {
      const a = o.ang + (i / Math.max(1, o.n)) * Math.PI * 2;
      const bx = p.x + Math.cos(a) * o.r;
      const by = p.y + Math.sin(a) * o.r;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = w.evolved ? '#3f6f47' : '#4f7757';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 15, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- 玩家 ---------- */
  drawPlayer(ctx, p, g);

  /* ---------- 弹体 ---------- */
  for (const s of g.shots) {
    if (!s.active) continue;
    drawShot(ctx, s);
  }
  for (const s of g.eshots) {
    if (!s.active) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(s.vy, s.vx));
    /* 敌弹是"必须躲"的东西：先垫纸、再压墨边，纸底上永远看得见 */
    ctx.fillStyle = 'rgba(255,253,247,.92)';
    ctx.beginPath();
    ctx.ellipse(-s.r * 0.2, 0, s.r * 2.35, s.r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s.r * 2, s.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(38,34,30,.62)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, s.r * 2, s.r * 0.7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- 光柱 / 链 / 陨石 / 冲击波 ----------
   * 每一种都有自己的生命周期曲线：光柱是"劈下—驻留—收锋"，
   * 链是"跳击—分叉—节点炸"，陨石是"预警—坠落—着地"，冲击波是"薄锋在前、余波在后"。
   */
  for (const b of g.beams) {
    if (!b.active) continue;
    const k = Math.max(0, Math.min(1, b.life / 0.32));
    /* 前 15% 劈开（宽度冲上去），之后收锋 */
    const grow = k > 0.85 ? (1 - k) / 0.15 : 1;
    const w = b.width * grow;
    const dx = b.x2 - b.x1, dy = b.y2 - b.y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    ctx.lineCap = 'round';
    /* 外晕 */
    ctx.globalAlpha = 0.16 * k;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = w * 1.5;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    /* 主体：两端收锋的墨带，不是一根等宽直线 */
    ctx.globalAlpha = 0.72 * k;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.quadraticCurveTo(b.x1 + dx * 0.5 + nx * w * 0.5, b.y1 + dy * 0.5 + ny * w * 0.5, b.x2, b.y2);
    ctx.quadraticCurveTo(b.x1 + dx * 0.5 - nx * w * 0.5, b.y1 + dy * 0.5 - ny * w * 0.5, b.x1, b.y1);
    ctx.fill();
    /* 亮芯 */
    ctx.globalAlpha = Math.min(1, k * 1.2);
    ctx.strokeStyle = b.kind === 'light' ? '#fffdf7' : '#ffe9c9';
    ctx.lineWidth = Math.max(1.4, w * 0.2);
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    /* 命中端的光斑 */
    ctx.globalAlpha = 0.5 * k;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x2, b.y2, w * 0.85, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9 * k;
    ctx.fillStyle = '#fffdf7';
    ctx.beginPath(); ctx.arc(b.x2, b.y2, w * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const c of g.chains) {
    if (!c.active) continue;
    const k = Math.max(0, c.life / 0.28);
    const n = c.points.length / 2;
    ctx.lineCap = 'round';
    /* 主干：每段中点法向抖一下，折线才像跳击而不是画好的折线 */
    for (const pass of [0, 1]) {
      ctx.globalAlpha = pass ? k : k * 0.28;
      ctx.strokeStyle = pass ? '#fff6e0' : c.color;
      ctx.lineWidth = pass ? 1.6 : 6;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = c.points[i * 2], y = c.points[i * 2 + 1];
        if (i === 0) { ctx.moveTo(x, y); continue }
        const px = c.points[(i - 1) * 2], py = c.points[(i - 1) * 2 + 1];
        const mx = (px + x) / 2, my = (py + y) / 2;
        const j = (hash2(i * 31, Math.floor(g.time * 30)) - 0.5) * 14;
        const dd = Math.hypot(x - px, y - py) || 1;
        ctx.lineTo(mx - (y - py) / dd * j, my + (x - px) / dd * j);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    /* 节点：每一跳落点炸一小团 */
    ctx.fillStyle = c.color;
    for (let i = 1; i < n; i++) {
      const x = c.points[i * 2], y = c.points[i * 2 + 1];
      ctx.globalAlpha = k * 0.5;
      ctx.beginPath(); ctx.arc(x, y, 7 * k, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = k;
      ctx.fillStyle = '#fffdf7';
      ctx.beginPath(); ctx.arc(x, y, 2.6 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c.color;
    }
    ctx.globalAlpha = 1;
  }

  for (const m of g.meteors) {
    if (!m.active) continue;
    const k = 1 - m.t / m.delay;
    ctx.save();
    /* 落点预警：外圈收拢 + 内圈填色随倒计时变浓 */
    ctx.globalAlpha = 0.16 + k * 0.22;
    ctx.fillStyle = m.color;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = -g.time * 26;
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * (0.35 + (1 - k) * 0.65), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    /* 十字准星 */
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(m.x - m.r * 0.5, m.y); ctx.lineTo(m.x + m.r * 0.5, m.y);
    ctx.moveTo(m.x, m.y - m.r * 0.5); ctx.lineTo(m.x, m.y + m.r * 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    /* 落体：墨石 + 上方的火尾，越接近地面尾越短 */
    const fy = m.y - (1 - k) * 300;
    const tail = 40 + (1 - k) * 90;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#e07b3c';
    ctx.beginPath();
    ctx.moveTo(m.x - 7, fy - 14); ctx.lineTo(m.x, fy - tail); ctx.lineTo(m.x + 7, fy - 14);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(m.x - 9, fy - 18);
    ctx.lineTo(m.x + 8, fy - 24);
    ctx.lineTo(m.x + 10, fy + 8);
    ctx.lineTo(m.x - 4, fy + 14);
    ctx.lineTo(m.x - 10, fy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,253,247,.35)';
    ctx.beginPath();
    ctx.moveTo(m.x - 9, fy - 18); ctx.lineTo(m.x + 8, fy - 24); ctx.lineTo(m.x + 2, fy - 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  for (const s of g.shockwaves) {
    if (!s.active) continue;
    const k = s.age / s.life;
    const rr = s.r * (0.3 + k * 0.9);
    /* 余波：宽而淡，跟在锋后面 */
    ctx.globalAlpha = Math.max(0, (1 - k) * 0.22);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * 3.2 * (1 - k * 0.5);
    ctx.beginPath(); ctx.arc(s.x, s.y, rr * 0.88, 0, Math.PI * 2); ctx.stroke();
    /* 主锋：薄、亮、跑在最前 */
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.lineWidth = Math.max(1, s.width * (1 - k * 0.7));
    ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, Math.PI * 2); ctx.stroke();
    /* 锋上的放射短线：冲击有方向，不是一个匀速放大的圈 */
    if (k < 0.6) {
      ctx.globalAlpha = (1 - k / 0.6) * 0.6;
      ctx.lineWidth = Math.max(1, s.width * 0.5);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + s.x * 0.01;
        const r0 = rr * 0.94, r1 = rr * (1.06 + (1 - k) * 0.12);
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * r0, s.y + Math.sin(a) * r0);
        ctx.lineTo(s.x + Math.cos(a) * r1, s.y + Math.sin(a) * r1);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- 警告：Boss 出手前的那一下 ---------- */
  drawTelegraphs(ctx, g);

  /* ---------- 粒子 / 数字 ----------
   * 六种材质各有画法：墨溅会沿速度拉长、飞白是收锋的短线、
   * 碎片翻转、火星带光晕、烟是越散越淡的软团。
   */
  for (const pt of g.particles) {
    if (!pt.active) continue;
    const k = 1 - pt.age / pt.life;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = pt.color;
    if (pt.kind === 'splat') {
      /* 墨溅：飞行方向拉长，落地前压扁，边不规则 */
      const sp = Math.hypot(pt.vx, pt.vy);
      const stretch = 1 + Math.min(1.4, sp / 260);
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(Math.atan2(pt.vy, pt.vx));
      ctx.beginPath();
      ctx.ellipse(0, 0, pt.size * k * stretch, pt.size * 0.66 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (pt.kind === 'line') {
      ctx.strokeStyle = pt.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, pt.size * 0.34 * k);
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x - pt.vx * 0.035, pt.y - pt.vy * 0.035);
      ctx.stroke();
    } else if (pt.kind === 'shard') {
      /* 碎片：翻转的四边形，一面受光 */
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.rot);
      const sz = pt.size * (0.5 + k * 0.5);
      ctx.beginPath();
      ctx.moveTo(-sz, sz * 0.6); ctx.lineTo(-sz * 0.2, -sz);
      ctx.lineTo(sz, sz * 0.3); ctx.lineTo(sz * 0.2, sz);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,253,247,.4)';
      ctx.beginPath();
      ctx.moveTo(-sz * 0.2, -sz); ctx.lineTo(sz * 0.3, sz * 0.1); ctx.lineTo(-sz * 0.5, sz * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    } else if (pt.kind === 'spark') {
      /* 火星：亮芯 + 外晕 + 短尾 */
      ctx.globalAlpha = Math.max(0, k * 0.4);
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * 2.2 * k, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = Math.max(0, k);
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = Math.max(1, pt.size * 0.6);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x - pt.vx * 0.02, pt.y - pt.vy * 0.02);
      ctx.stroke();
      ctx.fillStyle = '#fff3d0';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * 0.5 * k, 0, Math.PI * 2); ctx.fill();
    } else if (pt.kind === 'smoke') {
      /* 烟：越散越大越淡 */
      ctx.globalAlpha = Math.max(0, k * 0.32);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (2.4 - k * 1.4), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  if (g.save.settings.dmgNumbers) {
    /* 伤害数字按屏幕像素写，不跟 world 缩放一起变小；
       外面套一圈纸色描边，压在敌人、墨渍、弹幕上都还是能读。 */
    const z = zoom
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    for (const t of g.texts) {
      if (!t.active) continue;
      const k = t.age / t.life
      /* 前 2/3 的寿命保持满不透明，最后一段才淡出 —— 伤害数字不是装饰，得读完 */
      const alpha = k < 0.66 ? 1 : Math.max(0, (1 - k) / 0.34)
      if (alpha <= 0) continue
      const size = (t.kind === 'crit' ? t.size * 1.35 : t.size) / z
      ctx.globalAlpha = alpha
      ctx.font = `900 ${size}px "Microsoft YaHei", "Noto Sans SC", sans-serif`
      /* 不用 strokeText：3px 描边会把 17px 的字芯一起吃进去，看起来发灰。
         改成在八个方向各印一层纸色，字芯完整，纸底上也永远有边。 */
      const halo = (t.kind === 'crit' ? 2.4 : 2) / z
      ctx.fillStyle = 'rgba(255,253,247,.98)'
      for (let hx = -1; hx <= 1; hx++) {
        for (let hy = -1; hy <= 1; hy++) {
          if (hx === 0 && hy === 0) continue
          ctx.fillText(t.text, t.x + hx * halo, t.y + hy * halo)
        }
      }
      ctx.fillStyle = t.kind === 'crit' ? RED : t.kind === 'heal' ? '#4f7757' : t.kind === 'bad' ? RED : t.kind === 'info' ? GOLD : INK
      ctx.fillText(t.text, t.x, t.y)
    }
    ctx.globalAlpha = 1
  }

  ctx.restore();

  /* ---------- 进化重大档演出（屏幕空间，纯视觉） ---------- */
  if (g.evoAnim > 0) drawEvoCeremony(ctx, g, w, h, zoom);

  /* ---------- 雨 ---------- */
  if (g.rain > 0) {
    ctx.strokeStyle = 'rgba(38,34,30,.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const x = ((i * 137 + g.time * 210) % (w + 160)) - 80;
      const y = ((i * 73 + g.time * 320) % (h + 120)) - 60;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 8, y + 26);
      ctx.stroke();
    }
  }

  /* ---------- 屏幕边上的暗角 ---------- */
  const key = w + 'x' + h;
  if (vigKey !== key) {
    vigKey = key;
    vigGrad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.78);
    vigGrad.addColorStop(0, 'rgba(38,34,30,0)');
    vigGrad.addColorStop(1, 'rgba(38,34,30,.16)');
  }
  if (vigGrad) { ctx.fillStyle = vigGrad; ctx.fillRect(0, 0, w, h) }

  /* ---------- 屏幕外的 Boss 指示 ---------- */
  const boss = g.boss;
  if (boss && boss.active) {
    const dx = boss.x - g.camX, dy = boss.y - g.camY;
    if (Math.abs(dx) > vw / 2 - 40 || Math.abs(dy) > vh / 2 - 40) {
      const a = Math.atan2(dy, dx);
      const ex = w / 2 + Math.cos(a) * (w / 2 - 30);
      const ey = h / 2 + Math.sin(a) * (h / 2 - 30);
      ctx.save();
      ctx.translate(Math.max(24, Math.min(w - 24, ex)), Math.max(24, Math.min(h - 24, ey)));
      ctx.rotate(a);
      ctx.fillStyle = RED;
      ctx.beginPath();
      ctx.moveTo(12, 0); ctx.lineTo(-8, 8); ctx.lineTo(-8, -8);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}

/* ===================== 地面 ===================== */
function drawZone(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, life: number, age: number, type: string, color: string): void {
  const pulse = 0.5 + 0.5 * Math.sin(age * 3.2)
  if (type === 'poison' || type === 'fire') {
    ctx.globalAlpha = 0.16 + pulse * 0.08
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.38
    ctx.setLineDash([4, 5])
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(x, y, r * (0.96 + pulse * 0.04), 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    for (let i = 0; i < 3; i++) {
      const a = age * (1.4 + i) + i * 2.1
      const rr = r * 0.55
      ctx.fillStyle = color
      ctx.globalAlpha = 0.12 + pulse * 0.06
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, r * 0.26, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  } else if (type === 'web') {
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.2
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + age * 0.1
      ctx.beginPath()
      ctx.moveTo(x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.15)
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
      ctx.stroke()
    }
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath()
      ctx.arc(x, y, r * (k / 4), 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  } else if (type === 'buff') {
    ctx.globalAlpha = 0.14 + pulse * 0.1
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.setLineDash([10, 8])
    ctx.beginPath(); ctx.arc(x, y, r * 0.94, age * 0.4, age * 0.4 + Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    for (let i = 0; i < 4; i++) {
      const a = age * 1.2 + i * 1.57
      ctx.fillStyle = '#4f7757'
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * r * 0.65, y + Math.sin(a) * r * 0.65, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  } else if (type === 'hazard') {
    ctx.globalAlpha = 0.13
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.45
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
    for (let i = 0; i < 5; i++) {
      const a = hash2(i, Math.floor(x)) * 6.28
      const d = r * 0.55 * hash2(i + 3, Math.floor(y))
      ctx.fillStyle = '#26221e'
      ctx.globalAlpha = 0.12
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 8, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  } else {
    ctx.globalAlpha = 0.18
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 0.5
    ctx.strokeStyle = color
    ctx.setLineDash([8, 6])
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(x, y, r, age * 0.8, age * 0.8 + Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  if (life < 1.2) {
    ctx.globalAlpha = Math.max(0, life / 1.2) * 0.25
    ctx.fillStyle = '#f7f0df'
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
  }
}

/* ===================== 玩家 ===================== */
function drawPlayer(ctx: CanvasRenderingContext2D, p: Game['player'], g: Game): void {
  const moving = Math.hypot(p.vx, p.vy) > 5
  if (p.dashT > 0) {
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.14 * (4 - i)
      ctx.fillStyle = INK
      ctx.beginPath()
      ctx.arc(p.x - p.vx * 0.03 * i, p.y - p.vy * 0.03 * i, p.r * (1 - i * 0.12), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
  ctx.save()
  ctx.translate(p.x, p.y)
  /* 一圈纸色垫底 + 墨边：几十个墨点围上来时，玩家不能"融进"敌群里。
     朱砂色整圈 + 头顶的小三角是"你在哪"的固定记号，敌人只垫白纸不描红。 */
  ctx.fillStyle = 'rgba(255,253,247,.97)'
  ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = 'rgba(232,84,63,.72)'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(0, 0, p.r + 12, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = 'rgba(232,84,63,.92)'
  ctx.beginPath()
  ctx.moveTo(0, -p.r - 10)
  ctx.lineTo(-5, -p.r - 19)
  ctx.lineTo(5, -p.r - 19)
  ctx.closePath(); ctx.fill()
  const face = moving ? Math.atan2(p.vy, p.vx) : p.face
  ctx.rotate(face)
  /* 玩家是一管活过来的笔：木杆在后、铜箍居中、墨锋在前。
     原来是个黑圆加一根线，跟敌人的圆分不开；现在轮廓自己就说明"我是写字的那个"。 */
  const bob = moving ? Math.sin(g.time * 14) * p.r * 0.05 : Math.sin(g.time * 2.4) * p.r * 0.03
  ctx.translate(0, bob)
  /* 笔杆 */
  ctx.strokeStyle = '#6b5436'
  ctx.lineWidth = Math.max(3.5, p.r * 0.34)
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(-p.r * 2.15, 0)
  ctx.lineTo(-p.r * 0.45, 0)
  ctx.stroke()
  ctx.strokeStyle = '#8a6a3a'
  ctx.lineWidth = Math.max(1.2, p.r * 0.1)
  ctx.beginPath()
  ctx.moveTo(-p.r * 2.1, -p.r * 0.09)
  ctx.lineTo(-p.r * 0.5, -p.r * 0.09)
  ctx.stroke()
  /* 铜箍 */
  ctx.fillStyle = '#c0922f'
  ctx.fillRect(-p.r * 0.72, -p.r * 0.3, p.r * 0.3, p.r * 0.6)
  /* 墨锋：前尖后钝的一滴 */
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.moveTo(p.r * 1.25, 0)
  ctx.bezierCurveTo(p.r * 0.55, -p.r * 0.82, -p.r * 0.3, -p.r * 0.98, -p.r * 0.45, -p.r * 0.4)
  ctx.bezierCurveTo(-p.r * 0.56, -p.r * 0.14, -p.r * 0.56, p.r * 0.14, -p.r * 0.45, p.r * 0.4)
  ctx.bezierCurveTo(-p.r * 0.3, p.r * 0.98, p.r * 0.55, p.r * 0.82, p.r * 1.25, 0)
  ctx.closePath()
  ctx.fill()
  /* 锋上的飞白 */
  ctx.fillStyle = 'rgba(255,253,247,.22)'
  ctx.beginPath()
  ctx.moveTo(p.r * 0.9, -p.r * 0.12)
  ctx.quadraticCurveTo(p.r * 0.1, -p.r * 0.6, -p.r * 0.34, -p.r * 0.3)
  ctx.quadraticCurveTo(p.r * 0.1, -p.r * 0.28, p.r * 0.9, -p.r * 0.12)
  ctx.fill()
  /* 两只眼 */
  ctx.fillStyle = '#fff8e8'
  ctx.beginPath()
  ctx.arc(p.r * 0.3, -p.r * 0.34, p.r * 0.19, 0, Math.PI * 2)
  ctx.arc(p.r * 0.3, p.r * 0.34, p.r * 0.19, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.arc(p.r * 0.36, -p.r * 0.34, p.r * 0.08, 0, Math.PI * 2)
  ctx.arc(p.r * 0.36, p.r * 0.34, p.r * 0.08, 0, Math.PI * 2)
  ctx.fill()
  /* 笔尖上的一点朱砂 */
  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.arc(p.r * 1.12, 0, Math.max(2, p.r * 0.13), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  if (p.shield > 0) {
    ctx.strokeStyle = '#c7a45a'
    ctx.globalAlpha = 0.55 + Math.sin(g.time * 4) * 0.15
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 14, 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (p.buffDmg > 0) {
    ctx.strokeStyle = '#4f7757'
    ctx.globalAlpha = 0.4
    ctx.setLineDash([5, 7])
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 18, g.time * 1.2, g.time * 1.2 + Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  if (p.invuln > 0) {
    ctx.strokeStyle = 'rgba(255,248,232,.8)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5 + Math.sin(g.time * 20) * 2, 0, Math.PI * 2); ctx.stroke()
  }
}

/* ===================== 敌人 =====================
 * 造型在 ink.ts 里预渲染成 sprite，这里只负责"活起来"：
 * 呼吸、朝向倾斜、受击挤压、按类型分化的死亡。每帧每只不超过十次绘制调用。
 */
function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const flash = e.hitT > 0
  const dying = e.dieT > 0
  const dieMax = e.boss ? 1.6 : 0.3
  const k = dying ? Math.min(1, 1 - e.dieT / dieMax) : 0
  ctx.save()
  ctx.translate(e.x, e.y)

  /* 死亡按材质分化：幽影/咒者向上散，重墨/裂墨/碎墨翻滚坠，其余压扁洇开 */
  if (dying) {
    if (e.kind === 'phantom' || e.kind === 'chanter') {
      ctx.translate(0, -k * e.r * 1.4)
      ctx.scale(1 + k * 0.35, 1 + k * 0.5)
      ctx.globalAlpha = (1 - k) * 0.9
    } else if (e.kind === 'heavy' || e.kind === 'shard' || e.kind === 'splitter') {
      ctx.translate(0, k * e.r * 0.5)
      ctx.rotate(k * 0.7 * (e.id % 2 ? 1 : -1))
      ctx.scale(1 - k * 0.45, 1 - k * 0.45)
      ctx.globalAlpha = 1 - k * 0.95
    } else {
      ctx.scale(1 + k * 0.55, Math.max(0.12, 1 - k * 0.9))
      ctx.globalAlpha = 1 - k * 0.9
    }
  } else {
    ctx.globalAlpha = e.spawnT > 0 ? 0.55 : 1
  }
  /* 精英：朱虚线环 + 三根朱刺，压在造型之外，不遮身体 */
  if (e.elite) {
    ctx.strokeStyle = 'rgba(181,52,43,.55)'
    ctx.lineWidth = 2
    ctx.setLineDash([5, 6])
    ctx.beginPath(); ctx.arc(0, 0, e.r + 9 + Math.sin(time * 4 + e.id) * 2, time * 0.8, time * 0.8 + Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = RED
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.5
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * (e.r + 3), Math.sin(a) * (e.r + 3) - 2)
      ctx.lineTo(Math.cos(a) * (e.r + 12), Math.sin(a) * (e.r + 12) - 8)
      ctx.lineTo(Math.cos(a + 0.22) * (e.r + 3), Math.sin(a + 0.22) * (e.r + 3) - 2)
      ctx.closePath(); ctx.fill()
    }
  }
  if (e.boss) {
    drawBoss(ctx, e, time)
    ctx.restore()
    return
  }

  const r = e.r
  /* 朝向：疾影整只顺着速度转；其余只做小幅倾斜，脸始终朝玩家读得出 */
  const moving = Math.abs(e.hx) + Math.abs(e.hy) > 0.01
  if (e.kind === 'streak') {
    ctx.rotate(Math.atan2(e.hy, e.hx))
  } else if (moving && !dying) {
    ctx.rotate(Math.max(-0.22, Math.min(0.22, e.hx * 0.16)))
  }

  /* 呼吸 / 步态：每种有自己的节律，一屏墨点不会齐刷刷同一个频率 */
  let sx = 1, sy = 1
  if (!dying) {
    const ph = time * (e.kind === 'bomber' ? 8 : e.kind === 'streak' ? 6 : 2.6) + e.id
    if (e.kind === 'bomber') {
      const p = 1 + Math.sin(ph) * 0.09
      sx = p; sy = 2 - p
    } else if (e.kind === 'heavy') {
      sy = 1 + Math.sin(ph * 0.7) * 0.03; sx = 2 - sy
    } else if (e.kind === 'streak') {
      sx = 1 + Math.sin(ph) * 0.07; sy = 2 - sx
    } else {
      sy = 1 + Math.sin(ph) * 0.055; sx = 1 - Math.sin(ph) * 0.035
    }
    /* 受击挤压：沿受击方向压扁再弹回，比换个填充色读得快得多 */
    if (flash) {
      const q = e.hitT / 0.1
      sx *= 1 + q * 0.26
      sy *= 1 - q * 0.2
    }
  }
  ctx.scale(sx, sy)

  if (e.kind === 'phantom') ctx.globalAlpha *= 0.62 + Math.sin(time * 3 + e.id) * 0.2

  paintEnemy(ctx, e.kind, r, flash, false)

  /* 动态外挂：只画会随状态变的那几件 */
  if (e.kind === 'warder' && e.shield > 0) {
    const k2 = e.shield / Math.max(1, e.shieldMax)
    ctx.strokeStyle = '#c7a45a'
    ctx.lineWidth = Math.max(2, r * 0.2)
    ctx.globalAlpha = 0.4 + k2 * 0.55
    ctx.beginPath()
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2
      const rr = r * 1.24
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (e.kind === 'chanter') {
    ctx.fillStyle = '#7c4a63'
    for (let i = 0; i < 3; i++) {
      const a = time * 1.4 + i * 2.1
      ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.5, -r * 0.9 + Math.sin(a) * r * 0.5, r * 0.14, 0, Math.PI * 2); ctx.fill()
    }
  }
  if (e.kind === 'bomber') {
    /* 引线火星：越接近自爆跳得越急 */
    const hot = 1 + Math.sin(time * 22 + e.id) * 0.5
    ctx.fillStyle = '#ffd166'
    ctx.globalAlpha = 0.85
    ctx.beginPath(); ctx.arc(r * 0.16, -r * 1.9, r * 0.16 * hot, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

/* ===================== Boss 剪影 =====================
 * 造型同样走 sprite；这里只加"压迫感"的动态层：
 * 蓄力抖动、墨龙甩身、阶段二的朱砂环、脚下投影。
 */
function drawBoss(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const r = e.r
  const id = e.bossId || 'zhibi'

  /* 蓄力：冲锋前整只高频颤，玩家不用看血条也知道要来了 */
  if (e.pattern === 1) {
    const q = 1 + Math.sin(time * 40) * 0.035
    ctx.scale(q, 2 - q)
    ctx.translate(Math.sin(time * 53) * r * 0.03, 0)
  } else {
    const b = 1 + Math.sin(time * 1.6 + e.id) * 0.022
    ctx.scale(b, 2 - b)
  }

  /* 墨龙的身段：八节墨团甩在头后面，先画身再画头 */
  if (id === 'molong') {
    ctx.fillStyle = e.hitT > 0 ? '#ffd9c9' : '#2f2a25'
    for (let i = 7; i >= 1; i--) {
      const a = time * 0.9 - i * 0.32
      const px = -Math.cos(a) * i * r * 0.42
      const py = Math.sin(a * 0.8) * i * r * 0.18
      const rr = r * (0.52 - i * 0.045)
      ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = i % 2 ? '#26221e' : '#3a332c'
    }
  }

  /* 执笔人的巨笔：跟着朝向甩，笔尖一点朱 */
  if (id === 'zhibi') {
    const a = Math.atan2(e.hy, e.hx)
    ctx.save()
    ctx.rotate(a)
    ctx.strokeStyle = '#6b5436'; ctx.lineWidth = Math.max(4, r * 0.16)
    ctx.beginPath(); ctx.moveTo(-r * 0.3, 0); ctx.lineTo(r * 1.5, 0); ctx.stroke()
    ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = Math.max(1.5, r * 0.05)
    ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.05); ctx.lineTo(r * 1.5, -r * 0.05); ctx.stroke()
    ctx.fillStyle = RED
    ctx.beginPath(); ctx.moveTo(r * 1.72, 0); ctx.lineTo(r * 1.4, -r * 0.17); ctx.lineTo(r * 1.4, r * 0.17); ctx.closePath(); ctx.fill()
    ctx.restore()
  }

  if (id === 'zhiyuan') ctx.rotate(Math.sin(time * 0.6) * 0.25)

  paintEnemy(ctx, id, r, e.hitT > 0, true)

  /* 阶段 2 的朱砂环 */
  if (e.enrage) {
    ctx.strokeStyle = 'rgba(181,52,43,.6)'
    ctx.lineWidth = 2.5
    ctx.setLineDash([9, 7])
    ctx.beginPath(); ctx.arc(0, 0, r + 16, -time * 1.1, -time * 1.1 + Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(181,52,43,.18)'
    ctx.lineWidth = 9
    ctx.beginPath(); ctx.arc(0, 0, r + 16, 0, Math.PI * 2); ctx.stroke()
  }
}

/* ===================== 弹体 =====================
 * 每种弹体有自己的形与尾：笔锋拖墨、针带羽、刃旋月牙、火吐焰。
 * 尾迹用三段递减的残影而不是渐变对象——每帧每发都新建 gradient 太贵。
 */
function drawShot(ctx: CanvasRenderingContext2D, s: Game['shots'][number]): void {
  const a = Math.atan2(s.vy, s.vx)
  const spd = Math.hypot(s.vx, s.vy)
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate(a)

  /* 尾迹：越快拖得越长，静止的弹不拖 */
  const tl = Math.min(3.4, spd / 150) * s.r
  if (tl > s.r * 0.4) {
    ctx.fillStyle = s.color
    for (let i = 1; i <= 3; i++) {
      ctx.globalAlpha = 0.2 / i
      const k = 1 - i * 0.22
      ctx.beginPath()
      ctx.ellipse(-tl * i * 0.8, 0, s.r * 1.5 * k, s.r * 0.72 * k, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  /* 玩家弹体先垫一圈纸：压在深色敌群上也不会融进墨团里 */
  ctx.fillStyle = 'rgba(255,253,247,.72)'
  ctx.beginPath(); ctx.arc(0, 0, s.r * 1.7, 0, Math.PI * 2); ctx.fill()
  if (s.kind === 'stroke' || s.kind === 'stroke-e') {
    /* 笔锋：起笔钝、行笔鼓、收笔尖 */
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.moveTo(s.r * 1.9, 0)
    ctx.quadraticCurveTo(s.r * 0.4, -s.r * 0.78, -s.r * 1.9, 0)
    ctx.quadraticCurveTo(s.r * 0.4, s.r * 0.78, s.r * 1.9, 0)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,253,247,.5)'
    ctx.beginPath()
    ctx.moveTo(s.r * 1.2, -s.r * 0.1)
    ctx.quadraticCurveTo(s.r * 0.2, -s.r * 0.4, -s.r * 0.7, -s.r * 0.08)
    ctx.quadraticCurveTo(s.r * 0.2, -s.r * 0.16, s.r * 1.2, -s.r * 0.1)
    ctx.fill()
    if (s.kind === 'stroke-e') {
      ctx.fillStyle = 'rgba(38,34,30,.25)'
      ctx.beginPath(); ctx.arc(-s.r * 2.1, 0, s.r * 0.8, 0, Math.PI * 2); ctx.fill()
    }
  } else if (s.kind === 'needle') {
    /* 针：细杆 + 尾羽 + 纸白锋 */
    ctx.strokeStyle = s.color
    ctx.lineWidth = Math.max(1.6, s.r * 0.5)
    ctx.beginPath(); ctx.moveTo(-s.r * 2.2, 0); ctx.lineTo(s.r * 1.5, 0); ctx.stroke()
    ctx.lineWidth = Math.max(1, s.r * 0.28)
    ctx.beginPath()
    ctx.moveTo(-s.r * 2.2, 0); ctx.lineTo(-s.r * 2.9, -s.r * 0.6)
    ctx.moveTo(-s.r * 2.2, 0); ctx.lineTo(-s.r * 2.9, s.r * 0.6)
    ctx.stroke()
    ctx.fillStyle = '#fffdf7'
    ctx.beginPath()
    ctx.moveTo(s.r * 2.1, 0); ctx.lineTo(s.r * 1.2, -s.r * 0.42); ctx.lineTo(s.r * 1.2, s.r * 0.42)
    ctx.closePath(); ctx.fill()
  } else if (s.kind === 'blade') {
    /* 月牙刃：自旋 + 外缘一道飞白 */
    ctx.rotate(s.spin || s.age * 9)
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(0, 0, s.r * 1.25, -0.75, 0.75)
    ctx.arc(-s.r * 0.45, 0, s.r * 1.05, 0.75, -0.75, true)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = 'rgba(255,253,247,.6)'
    ctx.lineWidth = Math.max(1, s.r * 0.16)
    ctx.beginPath(); ctx.arc(0, 0, s.r * 1.12, -0.6, 0.6); ctx.stroke()
  } else if (s.kind === 'fan') {
    ctx.fillStyle = s.color
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, s.r * 1.5, -0.55, 0.55)
    ctx.closePath(); ctx.fill()
    ctx.strokeStyle = '#f7f0df'
    ctx.lineWidth = 1
    for (let i = -2; i <= 2; i++) {
      const aa = i * 0.22
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(aa) * s.r * 1.45, Math.sin(aa) * s.r * 1.45); ctx.stroke()
    }
    ctx.globalAlpha = 1
  } else if (s.kind === 'ember' || s.kind === 'ember-e') {
    /* 火：外焰舌 + 内芯，随时间舔动 */
    const k = 0.85 + Math.sin(s.age * 20) * 0.16
    ctx.fillStyle = '#7a1f1a'
    ctx.beginPath()
    ctx.moveTo(-s.r * 2.1 * k, 0)
    ctx.quadraticCurveTo(-s.r * 0.4, -s.r * 1.15 * k, s.r * 0.95, 0)
    ctx.quadraticCurveTo(-s.r * 0.4, s.r * 1.15 * k, -s.r * 2.1 * k, 0)
    ctx.fill()
    ctx.fillStyle = '#e07b3c'
    ctx.beginPath(); ctx.arc(s.r * 0.1, 0, s.r * 0.7 * k, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffd166'
    ctx.beginPath(); ctx.arc(s.r * 0.28, 0, s.r * 0.34 * k, 0, Math.PI * 2); ctx.fill()
  } else {
    ctx.fillStyle = s.color
    ctx.beginPath(); ctx.arc(0, 0, s.r, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,253,247,.45)'
    ctx.beginPath(); ctx.arc(-s.r * 0.28, -s.r * 0.28, s.r * 0.34, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/* ===================== 进化演出 ===================== */
function drawEvoCeremony(ctx: CanvasRenderingContext2D, g: Game, w: number, h: number, zoom: number): void {
  const p = g.player;
  const sx = (p.x - g.camX) * zoom + w / 2;
  const sy = (p.y - g.camY) * zoom + h / 2;
  const t = g.evoAnim;
  /* 档一：外圈虚线向心收拢 */
  if (t > 0.63) {
    const k = 1 - (0.95 - t) / 0.32;
    const R = 150 * (1 - k * 0.8) + 20;
    ctx.save();
    ctx.globalAlpha = 0.5 * (1 - k * 0.5);
    ctx.strokeStyle = g.evoColor || RED;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath(); ctx.arc(sx, sy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  /* 档三：居中朱框印章，落地后稍停再淡出 */
  if (t <= 0.4 && g.evoName) {
    const k = 1 - t / 0.4;
    const alpha = t < 0.12 ? t / 0.12 : 1;
    const scale = 1.5 - 0.5 * Math.min(1, k * 1.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w / 2, h * 0.34);
    ctx.scale(scale, scale);
    ctx.font = '900 34px "Songti SC","SimSun",serif';
    const tw = ctx.measureText(g.evoName).width;
    ctx.fillStyle = 'rgba(255,248,232,.88)';
    ctx.fillRect(-tw / 2 - 18, -28, tw + 36, 56);
    ctx.strokeStyle = RED;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-tw / 2 - 18, -28, tw + 36, 56);
    ctx.fillStyle = RED;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.evoName, 0, 1);
    ctx.restore();
  }
}

/* ===================== 预警 ===================== */
function drawTelegraphs(ctx: CanvasRenderingContext2D, g: Game): void {
  const b = g.boss
  if (!b || !b.active || b.dead) return
  /* 预警进行中：Boss 头顶挂朱色感叹号，先于伤害判定提示走位 */
  if (b.teleT > 0) {
    const wy = b.y - b.r - 26
    ctx.save()
    ctx.globalAlpha = 0.85 + Math.sin(g.time * 14) * 0.15
    ctx.fillStyle = '#fffdf7'
    ctx.beginPath(); ctx.arc(b.x, wy, 11, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = RED; ctx.lineWidth = 2; ctx.stroke()
    ctx.fillStyle = RED
    ctx.font = '900 15px "Microsoft YaHei", sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('!', b.x, wy + 1)
    ctx.restore()
  }
  ctx.save()
  ctx.globalAlpha = 0.62 + Math.sin(g.time * 12) * 0.2
  if (b.bossId === 'niu') {
    if (b.pattern === 0) {
      ctx.strokeStyle = RED
      ctx.lineWidth = 4
      ctx.setLineDash([10, 8])
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.hx * 460, b.y + b.hy * 460); ctx.stroke()
      ctx.setLineDash([])
    } else if (b.pattern === 3) {
      ctx.strokeStyle = RED
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(b.x, b.y, 175, 0, Math.PI * 2); ctx.stroke()
    }
  } else if (b.bossId === 'zhiyuan' && b.pattern === 0) {
    ctx.strokeStyle = RED
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.arc(b.x, b.y, 380, Math.atan2(b.hy, b.hx) - 0.55, Math.atan2(b.hy, b.hx) + 0.55)
    ctx.stroke()
  } else if (b.bossId === 'beiling') {
    const r = b.pattern === 1 ? 130 : b.pattern === 2 ? 200 : b.pattern === 3 ? 275 : 0
    if (r) {
      ctx.strokeStyle = RED
      ctx.lineWidth = 3
      ctx.setLineDash([9, 7])
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
    }
  } else if (b.bossId === 'molong' && b.pattern === 1) {
    ctx.strokeStyle = RED
    ctx.lineWidth = 4
    ctx.setLineDash([14, 10])
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.hx * 1200, b.y + b.hy * 1200); ctx.stroke()
    ctx.setLineDash([])
  } else if (b.bossId === 'zhibi') {
    if (b.pattern === 1) {
      ctx.strokeStyle = RED
      ctx.lineWidth = 4
      ctx.setLineDash([12, 9])
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.hx * 900, b.y + b.hy * 900); ctx.stroke()
      ctx.setLineDash([])
    } else if (b.pattern === 2) {
      ctx.strokeStyle = 'rgba(181,52,43,.7)'
      ctx.lineWidth = 2
      for (let k = 0; k < 4; k++) {
        const aa = b.phaseT * 0.4 + k * Math.PI / 2
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(aa) * 700, b.y + Math.sin(aa) * 700); ctx.stroke()
      }
    }
  }
  ctx.restore()
  ctx.globalAlpha = 1
}
