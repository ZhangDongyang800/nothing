/* 画面层。
 *
 * 视觉口径：纸是底，墨是形，朱红只用来指"危险 / 稀有"。
 * 所有敌人、武器、Boss 都是路径画的，没有一张贴图 —— 一是包体不涨，
 * 二是同一种墨在不同体型下能拉伸而不糊。
 *
 * 三条性能约定：
 *   ① 纸底、网格、污渍每帧只画一次（一次 fillRect + 几十条线）；
 *   ② 屏幕外的东西不画（每个实体先做一次矩形剔除）；
 *   ③ 粒子上限由 game 控制，这里不再加预算。
 */
import type { Game } from './game';
import type { Enemy } from './types';

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
  ctx.strokeStyle = 'rgba(38,34,30,.055)';
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

  /* 纸上的旧墨渍：按格子哈希，走到哪都在同一处 —— 像一张真的旧纸 */
  const cell = 420;
  const cx0 = Math.floor((g.camX - vw / 2) / cell) - 1;
  const cx1 = Math.floor((g.camX + vw / 2) / cell) + 1;
  const cy0 = Math.floor((g.camY - vh / 2) / cell) - 1;
  const cy1 = Math.floor((g.camY + vh / 2) / cell) + 1;
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const a = hash2(cx, cy);
      const b = hash2(cx + 11, cy - 7);
      ctx.fillStyle = `rgba(38,34,30,${0.02 + a * 0.02})`;
      ctx.beginPath();
      ctx.ellipse(cx * cell + a * cell, cy * cell + b * cell, 24 + a * 40, 10 + b * 20, a * 3, 0, Math.PI * 2);
      ctx.fill();
      if (b > 0.62) {
        ctx.strokeStyle = 'rgba(38,34,30,.035)';
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
    if (gem.kind === 'gold') {
      ctx.fillStyle = GOLD;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(gem.x, gem.y, 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillRect(gem.x - 1.5, gem.y - 2.5, 3, 5);
    } else if (gem.kind === 'heal') {
      ctx.fillStyle = '#4f7757';
      ctx.fillRect(gem.x - 6, gem.y - 2, 12, 4);
      ctx.fillRect(gem.x - 2, gem.y - 6, 4, 12);
    } else {
      const a = gem.age * 2.2;
      ctx.save();
      ctx.translate(gem.x, gem.y);
      ctx.rotate(a);
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(4, 0); ctx.lineTo(0, 5); ctx.lineTo(-4, 0);
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
      ctx.fillStyle = 'rgba(38,34,30,.5)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('宝箱', it.x, it.y + 30);
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
      ctx.fillStyle = 'rgba(38,34,30,.5)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('墨商', it.x, it.y + 38);
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
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, s.r * 2, s.r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- 光柱 / 链 / 陨石 ---------- */
  for (const b of g.beams) {
    if (!b.active) continue;
    const a = Math.max(0, b.life / 0.32);
    ctx.globalAlpha = Math.min(1, a);
    ctx.strokeStyle = b.color;
    ctx.lineCap = 'round';
    ctx.lineWidth = b.width * (b.kind === 'light' ? 0.9 : 0.5);
    ctx.globalAlpha = Math.min(0.25, a * 0.3);
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = Math.min(1, a);
    ctx.lineWidth = Math.max(2, b.width * 0.16);
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const c of g.chains) {
    if (!c.active) continue;
    ctx.globalAlpha = Math.max(0, c.life / 0.28);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < c.points.length; i += 2) {
      if (i === 0) ctx.moveTo(c.points[i], c.points[i + 1]);
      else ctx.lineTo(c.points[i], c.points[i + 1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const m of g.meteors) {
    if (!m.active) continue;
    const k = 1 - m.t / m.delay;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * (0.4 + k * 0.6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = m.color;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const fy = m.y - (1 - k) * 300;
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.moveTo(m.x - 8, fy - 20);
    ctx.lineTo(m.x + 8, fy - 26);
    ctx.lineTo(m.x + 6, fy + 12);
    ctx.lineTo(m.x - 6, fy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  for (const s of g.shockwaves) {
    if (!s.active) continue;
    const k = s.age / s.life;
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * (1 - k * 0.6);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * (0.3 + k * 0.9), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* ---------- 警告：Boss 出手前的那一下 ---------- */
  drawTelegraphs(ctx, g);

  /* ---------- 粒子 / 数字 ---------- */
  for (const pt of g.particles) {
    if (!pt.active) continue;
    const k = 1 - pt.age / pt.life;
    ctx.globalAlpha = Math.max(0, k);
    ctx.fillStyle = pt.color;
    if (pt.kind === 'splat') {
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y, pt.size * k, pt.size * 0.7 * k, pt.rot, 0, Math.PI * 2);
      ctx.fill();
    } else if (pt.kind === 'line') {
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = Math.max(1, pt.size * 0.3);
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x - pt.vx * 0.03, pt.y - pt.vy * 0.03);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  if (g.save.settings.dmgNumbers) {
    for (const t of g.texts) {
      if (!t.active) continue;
      const k = t.age / t.life;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.fillStyle = t.kind === 'crit' ? RED : t.kind === 'heal' ? '#4f7757' : t.kind === 'bad' ? RED : t.kind === 'info' ? GOLD : INK;
      ctx.font = `bold ${t.kind === 'crit' ? t.size * 1.35 : t.size}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(t.text, t.x, t.y);
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();

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
  /* 一圈纸色垫底：几十个墨点围上来时，玩家不能"融进"敌群里 */
  ctx.fillStyle = 'rgba(255,253,247,.95)'
  ctx.beginPath(); ctx.arc(0, 0, p.r + 4.5, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.arc(0, 0, p.r + 4.5, 0, Math.PI * 2); ctx.stroke()
  const face = moving ? Math.atan2(p.vy, p.vx) : p.face
  ctx.rotate(face)
  /* 笔杆 */
  ctx.strokeStyle = '#6b5436'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(-2, 0)
  ctx.lineTo(p.r * 1.7, 0)
  ctx.stroke()
  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.moveTo(p.r * 1.7, 0)
  ctx.lineTo(p.r * 1.2, -4)
  ctx.lineTo(p.r * 1.2, 4)
  ctx.closePath()
  ctx.fill()
  /* 笔头（墨身） */
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.arc(0, 0, p.r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff8e8'
  ctx.beginPath()
  ctx.arc(p.r * 0.32, -p.r * 0.34, p.r * 0.19, 0, Math.PI * 2)
  ctx.arc(p.r * 0.32, p.r * 0.34, p.r * 0.19, 0, Math.PI * 2)
  ctx.fill()
  /* 笔尖上的一点朱砂 */
  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.arc(-p.r * 0.9, 0, 2.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  if (p.shield > 0) {
    ctx.strokeStyle = '#c7a45a'
    ctx.globalAlpha = 0.55 + Math.sin(g.time * 4) * 0.15
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 9, 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
  }
  if (p.buffDmg > 0) {
    ctx.strokeStyle = '#4f7757'
    ctx.globalAlpha = 0.4
    ctx.setLineDash([5, 7])
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 15, g.time * 1.2, g.time * 1.2 + Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  if (p.invuln > 0) {
    ctx.strokeStyle = 'rgba(255,248,232,.8)'
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5 + Math.sin(g.time * 20) * 2, 0, Math.PI * 2); ctx.stroke()
  }
}

/* ===================== 敌人 ===================== */
function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const flash = e.hitT > 0
  const dying = e.dieT > 0
  const scale = dying ? Math.max(0.2, e.dieT / (e.boss ? 1.2 : 0.3)) : 1
  ctx.save()
  ctx.translate(e.x, e.y)
  ctx.scale(scale, scale)
  ctx.globalAlpha = (e.spawnT > 0 ? 0.5 : 1) * (dying ? 0.7 : 1)
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
  const col = flash ? '#fff8e8' : e.kind === 'bomber' ? RED : e.kind === 'caster' ? '#3f5c86' : e.kind === 'weaver' ? '#4f7757' : e.kind === 'chanter' ? '#7c4a63' : e.kind === 'warder' ? '#5b5751' : INK
  const r = e.r
  ctx.fillStyle = col
  ctx.strokeStyle = flash ? '#fff8e8' : INK
  ctx.lineWidth = 1.2
  switch (e.kind) {
    case 'streak': {
      ctx.rotate(Math.atan2(e.hy, e.hx))
      ctx.beginPath()
      ctx.ellipse(0, 0, r * 1.7, r * 0.7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#f7f0df'
      ctx.beginPath(); ctx.arc(r * 0.7, 0, 1.8, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'caster': {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = INK; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, -r * 2.2); ctx.stroke()
      ctx.fillStyle = RED
      ctx.beginPath(); ctx.arc(0, -r * 2.3, 2.4, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'heavy': {
      ctx.beginPath()
      ctx.moveTo(-r, -r * 0.9); ctx.lineTo(r * 0.9, -r * 0.9)
      ctx.lineTo(r * 1.05, r); ctx.lineTo(-r * 1.05, r)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#f7f0df'
      ctx.fillRect(-r * 0.45, -r * 0.35, r * 0.28, r * 0.2)
      ctx.fillRect(r * 0.17, -r * 0.35, r * 0.28, r * 0.2)
      break
    }
    case 'bomber': {
      const pulse = 1 + Math.sin(time * 8 + e.id) * 0.1
      ctx.beginPath(); ctx.arc(0, 0, r * pulse, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#7a1f1a'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = '#f7f0df'
      ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'splitter': {
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        const rr = r * (1 + Math.sin(i * 2.1) * 0.14)
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = '#f7f0df'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(r * 0.4, 0); ctx.stroke()
      break
    }
    case 'weaver': {
      ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + time * 0.6
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7)
        ctx.lineTo(Math.cos(a + 0.25) * r * 1.6, Math.sin(a + 0.25) * r * 1.6)
        ctx.stroke()
      }
      break
    }
    case 'warder': {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
      if (e.shield > 0) {
        ctx.strokeStyle = '#c7a45a'; ctx.lineWidth = 3
        ctx.globalAlpha = 0.45 + (e.shield / Math.max(1, e.shieldMax)) * 0.5
        ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = 1
      }
      break
    }
    case 'phantom': {
      ctx.globalAlpha *= 0.6 + Math.sin(time * 3 + e.id) * 0.2
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#f7f0df'; ctx.lineWidth = 1.4
      ctx.setLineDash([3, 5])
      ctx.beginPath(); ctx.arc(0, 0, r + 4, time, time + Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
      break
    }
    case 'chanter': {
      ctx.beginPath()
      ctx.moveTo(0, -r * 1.25); ctx.lineTo(r, r); ctx.lineTo(-r, r)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#f7f0df'
      ctx.beginPath(); ctx.arc(0, r * 0.1, 2.6, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#7c4a63'
      for (let i = 0; i < 3; i++) {
        const a = time * 1.4 + i * 2.1
        ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.4, -r + Math.sin(a) * r * 0.6, 2.2, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    case 'shard': {
      ctx.beginPath()
      ctx.moveTo(-r, r * 0.6); ctx.lineTo(0, -r); ctx.lineTo(r, r * 0.6)
      ctx.closePath(); ctx.fill()
      break
    }
    default: {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = flash ? INK : '#f7f0df'
      ctx.beginPath()
      ctx.arc(-r * 0.32, -r * 0.1, r * 0.17, 0, Math.PI * 2)
      ctx.arc(r * 0.32, -r * 0.1, r * 0.17, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/* ===================== Boss 剪影 ===================== */
function drawBoss(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const r = e.r
  const col = e.bossId === 'zhibi' ? '#7c2a24' : e.bossId === 'zhiyuan' ? '#3f5c86' : e.bossId === 'beiling' ? '#5b5751' : INK
  ctx.fillStyle = e.hitT > 0 ? '#fff8e8' : col
  ctx.strokeStyle = INK
  ctx.lineWidth = 3
  switch (e.bossId) {
    case 'niu': {
      const charge = e.pattern === 1 ? 1 + Math.sin(time * 40) * 0.04 : 1
      ctx.scale(charge, charge)
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.95, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = '#fff8e8'; ctx.lineWidth = 5
      ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.55); ctx.quadraticCurveTo(-r * 1.25, -r * 1.25, -r * 0.45, -r * 1.05); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(r * 0.7, -r * 0.55); ctx.quadraticCurveTo(r * 1.25, -r * 1.25, r * 0.45, -r * 1.05); ctx.stroke()
      /* 牛角在纸底上必须是墨线压朱线，否则白角出到体外就"消失"了 */
      ctx.strokeStyle = INK; ctx.lineWidth = 9
      ctx.beginPath(); ctx.moveTo(-r * 0.68, -r * 0.58); ctx.quadraticCurveTo(-r * 1.3, -r * 1.32, -r * 0.42, -r * 1.1); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(r * 0.68, -r * 0.58); ctx.quadraticCurveTo(r * 1.3, -r * 1.32, r * 0.42, -r * 1.1); ctx.stroke()
      ctx.strokeStyle = RED; ctx.lineWidth = 4
      ctx.beginPath(); ctx.moveTo(-r * 0.68, -r * 0.58); ctx.quadraticCurveTo(-r * 1.3, -r * 1.32, -r * 0.42, -r * 1.1); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(r * 0.68, -r * 0.58); ctx.quadraticCurveTo(r * 1.3, -r * 1.32, r * 0.42, -r * 1.1); ctx.stroke()
      ctx.fillStyle = RED
      ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.15, 5, 0, Math.PI * 2); ctx.arc(r * 0.36, -r * 0.15, 5, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'zhiyuan': {
      ctx.rotate(time * 0.35)
      ctx.beginPath()
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.strokeStyle = '#fff8e8'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke()
      ctx.fillStyle = RED
      ctx.beginPath(); ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'beiling': {
      ctx.fillRect(-r * 0.7, -r * 1.15, r * 1.4, r * 2.1)
      ctx.strokeRect(-r * 0.7, -r * 1.15, r * 1.4, r * 2.1)
      ctx.fillStyle = '#f7f0df'
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(-r * 0.35, -r * 0.8 + i * r * 0.42, r * 0.7, 3)
      }
      ctx.fillStyle = RED
      ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.18, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'molong': {
      ctx.fillStyle = e.hitT > 0 ? '#fff8e8' : '#26221e'
      for (let i = 7; i >= 0; i--) {
        const a = time * 0.9 - i * 0.32
        const px = -Math.cos(a) * i * r * 0.42
        const py = Math.sin(a * 0.8) * i * r * 0.18
        ctx.beginPath()
        ctx.arc(px, py, r * (0.5 - i * 0.045), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = col
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = RED
      ctx.beginPath(); ctx.arc(r * 0.32, -r * 0.2, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#f7f0df'
      ctx.beginPath(); ctx.arc(r * 0.4, r * 0.2, 3, 0, Math.PI * 2); ctx.fill()
      break
    }
    default: {
      /* 执笔人：一个高高的身影 + 一管比自己还长的笔 */
      const a = Math.atan2(e.hy, e.hx)
      ctx.rotate(a)
      ctx.fillStyle = e.hitT > 0 ? '#fff8e8' : '#26221e'
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 6
      ctx.beginPath(); ctx.moveTo(-r * 0.3, 0); ctx.lineTo(r * 1.4, 0); ctx.stroke()
      ctx.fillStyle = RED
      ctx.beginPath(); ctx.moveTo(r * 1.4, 0); ctx.lineTo(r * 1.05, -6); ctx.lineTo(r * 1.05, 6); ctx.closePath(); ctx.fill()
      ctx.rotate(-a)
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.75, r * 1.2); ctx.lineTo(-r * 0.75, r * 1.2)
      ctx.closePath(); ctx.fill(); ctx.stroke()
      ctx.fillStyle = '#f7f0df'
      ctx.fillRect(-r * 0.3, -r * 0.55, r * 0.6, r * 0.14)
      break
    }
  }
  /* 阶段 2 的朱砂环 */
  if (e.enrage) {
    ctx.strokeStyle = 'rgba(181,52,43,.6)'
    ctx.lineWidth = 2
    ctx.setLineDash([9, 7])
    ctx.beginPath(); ctx.arc(0, 0, r + 16, -time * 1.1, -time * 1.1 + Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
  }
}

/* ===================== 弹体 ===================== */
function drawShot(ctx: CanvasRenderingContext2D, s: Game['shots'][number]): void {
  const a = Math.atan2(s.vy, s.vx)
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate(a)
  if (s.kind === 'stroke' || s.kind === 'stroke-e') {
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.moveTo(s.r * 1.7, 0)
    ctx.quadraticCurveTo(s.r * 0.4, -s.r * 0.7, -s.r * 1.9, 0)
    ctx.quadraticCurveTo(s.r * 0.4, s.r * 0.7, s.r * 1.7, 0)
    ctx.fill()
    if (s.kind === 'stroke-e') {
      ctx.fillStyle = 'rgba(38,34,30,.25)'
      ctx.beginPath(); ctx.arc(-s.r * 2.1, 0, s.r * 0.8, 0, Math.PI * 2); ctx.fill()
    }
  } else if (s.kind === 'needle') {
    ctx.strokeStyle = s.color
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(-s.r * 2, 0); ctx.lineTo(s.r * 1.6, 0); ctx.stroke()
    ctx.fillStyle = '#f7f0df'
    ctx.beginPath(); ctx.arc(s.r * 1.6, 0, 1.6, 0, Math.PI * 2); ctx.fill()
  } else if (s.kind === 'blade') {
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(0, 0, s.r * 1.2, -0.7, 0.7)
    ctx.arc(-s.r * 0.4, 0, s.r * 1.0, 0.7, -0.7, true)
    ctx.closePath(); ctx.fill()
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
    const k = 0.8 + Math.sin(s.age * 20) * 0.15
    ctx.fillStyle = '#7a1f1a'
    ctx.beginPath(); ctx.arc(0, 0, s.r * 1.1 * k, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#e07b3c'
    ctx.beginPath(); ctx.arc(s.r * 0.2, 0, s.r * 0.62, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#ffd166'
    ctx.beginPath(); ctx.arc(s.r * 0.35, 0, s.r * 0.3, 0, Math.PI * 2); ctx.fill()
  } else {
    ctx.fillStyle = s.color
    ctx.beginPath(); ctx.arc(0, 0, s.r, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/* ===================== 预警 ===================== */
function drawTelegraphs(ctx: CanvasRenderingContext2D, g: Game): void {
  const b = g.boss
  if (!b || !b.active || b.dead) return
  ctx.save()
  ctx.globalAlpha = 0.5 + Math.sin(g.time * 12) * 0.2
  if (b.bossId === 'niu') {
    if (b.pattern === 0) {
      ctx.strokeStyle = RED
      ctx.lineWidth = 3
      ctx.setLineDash([10, 8])
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.hx * 460, b.y + b.hy * 460); ctx.stroke()
      ctx.setLineDash([])
    } else if (b.pattern === 3) {
      ctx.strokeStyle = RED
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(b.x, b.y, 175, 0, Math.PI * 2); ctx.stroke()
    }
  } else if (b.bossId === 'zhiyuan' && b.pattern === 0) {
    ctx.strokeStyle = RED
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.arc(b.x, b.y, 380, Math.atan2(b.hy, b.hx) - 0.55, Math.atan2(b.hy, b.hx) + 0.55)
    ctx.stroke()
  } else if (b.bossId === 'beiling') {
    const r = b.pattern === 1 ? 130 : b.pattern === 2 ? 200 : b.pattern === 3 ? 275 : 0
    if (r) {
      ctx.strokeStyle = RED
      ctx.lineWidth = 2
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
