/* 全屏特效层 —— 一张只画不点的画布 + 一个只飘字不点的 DOM 层。
 *
 * 为什么是"一层视口画布"，不是各台各画各的：DOM 机器（03/04/05/07/09）与
 * canvas 机器（06/10/11）混在一起，碎片若画在各自的容器里，会被 overflow:hidden
 * 裁掉（飞出盘外就变成"被刀切掉"），z-index 也要跟着每台弹层重排。
 *
 * 三件套 + 一震（上一轮定的）之外，这一轮补三样**只跟手感有关**的东西：
 *   ① 飘分 `pop()` —— 得分必须出现在**得分的那块地方**，显示在 HUD 里只是记账；
 *   ② 连击 `combo()` —— 连击要有一个会跳的读数，安静地涨分等于没有连击；
 *   ③ 命中停顿 `freeze()` —— 重击那一瞬把模拟按住 50–90ms，比多撒 20 片碎屑更"疼"。
 *
 * 性能上的四条硬约束：
 *   · 粒子对象**全部走对象池**（`pool`），一局下来 parts 数组反复复用，不再每秒制造几百个对象；
 *   · 上限按当前帧耗时自适应（`budget`/`cap`）：掉到 50fps 就少撒，回到 60fps 再涨回去；
 *   · 画布按 1.5 倍像素密度封顶 —— 3–13px 的碎渣不需要 Retina 级别的填充率；
 *   · 没有任何粒子在跑时立刻 cancelAnimationFrame 并清一次画布，不留空转循环。
 *
 * 全部 `pointer-events:none`，不参与任何判定；prefers-reduced-motion 下粒子减半、
 * 震屏与命中停顿关掉。 */
// @ts-nocheck
export function createFx(signal) {
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal });

  /* ---------- 画布 ---------- */
  const cv = document.createElement('canvas');
  cv.className = 'fx-layer';
  cv.setAttribute('aria-hidden', 'true');
  /* 空闲时彻底隐身：这张 fixed 全屏画布只要"在用"，就会把整页拉进一个合成层，
     首页那几块小演示会因此掉帧（4× 降速实测 60 → 50.7）。没粒子就不该占着这一层。 */
  cv.style.visibility = 'hidden';
  document.body.appendChild(cv);
  const g = cv.getContext('2d');

  /* ---------- 飘分层 ---------- */
  const ui = document.createElement('div');
  ui.className = 'fx-ui';
  ui.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ui);
  const popNodes = [];
  const popFree = [];

  let reduced = false;
  try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

  const PAPER = '#fff8e8';
  const PALETTE = ['#252525', '#f28b82', '#ffd166', '#9cc7f5', '#efe9da'];

  /* ---------- 对象池 ---------- */
  const BASE_CAP = 420;
  const parts = [];
  const pool = [];
  let cap = BASE_CAP;
  let budget = 1;
  let raf = 0;
  let last = 0;
  let smoothDt = 16.7;
  let fCount = 0;
  let fWorst = 0;
  let fWork = 0;

  function take(kind) {
    const p = pool.pop() || {};
    p.k = kind;
    p.t = 0;
    p.max = 1;
    p.vx = 0; p.vy = 0; p.g = 0; p.drag = 1;
    p.r0 = 0; p.r1 = 0; p.lw = 0;
    p.rot = 0; p.vr = 0;
    p.c = PAPER;
    return p;
  }
  function recycle(p) {
    if (pool.length < 560) pool.push(p);
  }
  function push(p) {
    if (parts.length >= cap) recycle(parts.shift());
    parts.push(p);
  }

  function fit() {
    /* 粒子是 3–13px 的碎渣、存活不到 1 秒，给 2 倍像素密度纯属浪费：
       整屏画布在 dpr 2 时要 4 倍显存与填充率，1.5 已经看不出差别。 */
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    cv.width = Math.max(1, Math.floor(w * dpr));
    cv.height = Math.max(1, Math.floor(h * dpr));
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  fit();
  on(window, 'resize', fit);

  function kick() {
    if (raf) return;
    last = 0;
    cv.style.visibility = 'visible';
    raf = requestAnimationFrame(loop);
  }

  function draw(p, k) {
    g.globalAlpha = Math.max(0, 1 - k * k * 0.9 - k * 0.1);
    if (p.k === 'shard') {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillStyle = p.c;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.strokeStyle = 'rgba(37,37,37,.45)';
      g.lineWidth = 1;
      g.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    } else if (p.k === 'dot') {
      g.beginPath();
      g.arc(p.x, p.y, Math.max(0.6, p.w * (1 - k * 0.45)), 0, Math.PI * 2);
      g.fillStyle = p.c;
      g.fill();
    } else if (p.k === 'spark') {
      g.strokeStyle = p.c;
      g.lineWidth = p.w;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028);
      g.stroke();
    } else if (p.k === 'ring') {
      const r = p.r0 + (p.r1 - p.r0) * k;
      g.strokeStyle = p.c;
      g.lineWidth = Math.max(1, p.lw * (1 - k));
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.stroke();
    } else if (p.k === 'flash') {
      /* 爆点的高光：没有这一下，碎片只是"飞走"，不像"炸开" */
      const rad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w * (0.55 + k));
      rad.addColorStop(0, 'rgba(255,255,255,.92)');
      rad.addColorStop(0.45, 'rgba(255,248,232,.55)');
      rad.addColorStop(1, 'rgba(255,248,232,0)');
      g.fillStyle = rad;
      g.beginPath();
      g.arc(p.x, p.y, p.w * (0.55 + k), 0, Math.PI * 2);
      g.fill();
    } else if (p.k === 'blot') {
      /* 一记墨点：跑酷里的落地、垒塔的接缝用它，不是几何碎片而是一团墨 */
      g.beginPath();
      g.ellipse(p.x, p.y, p.w * (1 - k * 0.3), p.w * 0.55 * (1 - k * 0.3), p.rot, 0, Math.PI * 2);
      g.fillStyle = p.c;
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function update(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.t += dt;
      if (p.t >= p.max) { recycle(parts.splice(i, 1)[0]); continue; }
      if (p.k !== 'ring') {
        p.vy += p.g * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.vr) p.rot += p.vr * dt;
      }
    }
  }

  function drawAll() {
    const w = window.innerWidth, h = window.innerHeight;
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < parts.length; i++) draw(parts[i], parts[i].t / parts[i].max);
  }

  function loop(ts) {
    const t0 = performance.now();
    let dt = last ? Math.min((ts - last) / 1000, 0.05) : 0.016;
    last = ts;
    /* 自适应预算：只认"最近 30 帧的中位感觉"。掉帧越久，撒得越少；
       回到 60fps 之后一帧涨 2%，大约 20 帧回满。 */
    smoothDt = smoothDt * 0.9 + dt * 1000 * 0.1;
    if (smoothDt > 20) budget = Math.max(0.5, budget - 0.05);
    else if (smoothDt < 18.5) budget = Math.min(1, budget + 0.02);
    cap = Math.round(BASE_CAP * budget);

    if (!phaseFreeze()) update(dt);
    drawAll();
    fCount++;
    fWorst = Math.max(fWorst, smoothDt);
    fWork = fWork * 0.92 + (performance.now() - t0) * 0.08;

    if (parts.length) raf = requestAnimationFrame(loop);
    else {
      raf = 0;
      g.clearRect(0, 0, w0(), h0());
      cv.style.visibility = 'hidden';
    }
  }
  function w0() { return window.innerWidth; }
  function h0() { return window.innerHeight; }

  /* ---------- 命中停顿 ---------- */
  let freezeUntil = 0;
  function freeze(ms) {
    if (reduced) return;
    freezeUntil = Math.max(freezeUntil, performance.now() + (ms || 70));
  }
  function phaseFreeze() {
    return performance.now() < freezeUntil;
  }

  /* ---------- 一块矩形整体炸开 ---------- */
  function burst(rect, opt) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    opt = opt || {};
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const power = opt.power == null ? 430 : opt.power;
    const grav = opt.gravity == null ? 760 : opt.gravity;
    const colors = opt.colors || PALETTE;
    const n = Math.round((opt.count == null ? 11 : opt.count) * (reduced ? 0.45 : 1) * budget);
    /* 碎片的大小跟主体成正比：一块 118×43 的砖，碎成 4px 的渣是"掉漆"不是"碎了"。
       上下限 3–13px 是拿手感试出来的：再小看不清旋转，再大像贴纸。 */
    const size = opt.size || Math.max(3, Math.min(13, Math.min(rect.width, rect.height) * 0.2));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = power * (0.4 + Math.random() * 0.85);
      const p = take('shard');
      p.x = cx + (Math.random() - 0.5) * rect.width * 0.86;
      p.y = cy + (Math.random() - 0.5) * rect.height * 0.86;
      p.vx = Math.cos(ang) * sp + (opt.vx || 0);
      p.vy = Math.sin(ang) * sp * 0.78 - 64 + (opt.vy || 0);
      p.g = grav; p.drag = 0.986;
      p.w = size + Math.random() * size * 1.25;
      p.h = 2.4 + Math.random() * size * 1.05;
      p.rot = Math.random() * 6.283;
      p.vr = (Math.random() - 0.5) * 15;
      p.c = colors[i % colors.length];
      p.t = 0; p.max = 0.62 + Math.random() * 0.5;
      push(p);
    }
    const dust = Math.round((opt.dust == null ? 7 : opt.dust) * (reduced ? 0.4 : 1) * budget);
    for (let d = 0; d < dust; d++) {
      const da = Math.random() * Math.PI * 2, ds = power * (0.16 + Math.random() * 0.36);
      const p = take('dot');
      p.x = cx + (Math.random() - 0.5) * rect.width * 0.7;
      p.y = cy + (Math.random() - 0.5) * rect.height * 0.7;
      p.vx = Math.cos(da) * ds; p.vy = Math.sin(da) * ds - 30;
      p.g = 260; p.drag = 0.94;
      p.w = 2.2 + Math.random() * 3.4;
      p.c = colors[(d + 1) % colors.length];
      p.t = 0; p.max = 0.75 + Math.random() * 0.5;
      push(p);
    }
    if (opt.ring !== false) ringAt(cx, cy, Math.max(6, Math.min(rect.width, rect.height) * 0.3),
      Math.max(26, Math.max(rect.width, rect.height) * 0.8), 3, opt.ringColor || PAPER);
    if (opt.flash !== false && !reduced) {
      const p = take('flash');
      p.x = cx; p.y = cy; p.w = Math.max(rect.width, rect.height) * 0.55; p.c = '#ffffff';
      p.t = 0; p.max = 0.16;
      push(p);
    }
    kick();
  }

  /* 视口坐标的"一点炸开"：canvas 机器把逻辑坐标换好再交进来 */
  function burstAt(x, y, opt) {
    opt = opt || {};
    const size = opt.size || 10;
    burst({ left: x - size * 2, top: y - size * 2, width: size * 4, height: size * 4 }, opt);
  }

  /* 只撒火星：球撞砖、牌点错这种"碰上了但没碎"的场合 */
  function sparks(rect, n, color) {
    if (!rect) return;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const k = Math.round((n || 3) * (reduced ? 0.4 : 1) * budget);
    for (let i = 0; i < k; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 180 + Math.random() * 220;
      const p = take('spark');
      p.x = cx; p.y = cy;
      p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
      p.g = 240; p.drag = 0.9; p.w = 1.4;
      p.c = color || PAPER;
      p.t = 0; p.max = 0.26 + Math.random() * 0.2;
      push(p);
    }
    kick();
  }

  function ringAt(x, y, r0, r1, lw, color) {
    if (reduced) return;
    const p = take('ring');
    p.x = x; p.y = y; p.r0 = r0; p.r1 = r1; p.lw = lw || 2.4;
    p.c = color || PAPER; p.t = 0; p.max = 0.34;
    push(p);
    kick();
  }

  /* 拖尾：跑酷的墨迹、垒塔的落块影子。每帧最多撒 2–3 个，不靠数量靠"连着" */
  function trail(x, y, color, size) {
    if (reduced && (parts.length & 1)) return;
    const p = take('blot');
    p.x = x; p.y = y;
    p.vx = (Math.random() - 0.5) * 26; p.vy = (Math.random() - 0.5) * 26;
    p.g = 0; p.drag = 0.9; p.w = size || 5; p.rot = Math.random() * 3;
    p.c = color || 'rgba(37,37,37,.55)';
    p.t = 0; p.max = 0.3;
    push(p);
    kick();
  }

  /* 往上一蓬"余烬"：连击达成、升级那一瞬用它，方向明确（朝上） */
  function rise(x, y, n, colors) {
    if (reduced) n = Math.round(n * 0.4);
    n = Math.round((n || 10) * budget);
    const cols = colors || ['#ffd166', '#fff8e8', '#f28b82'];
    for (let i = 0; i < n; i++) {
      const p = take('dot');
      p.x = x + (Math.random() - 0.5) * 70;
      p.y = y + (Math.random() - 0.5) * 12;
      p.vx = (Math.random() - 0.5) * 120;
      p.vy = -140 - Math.random() * 220;
      p.g = 180; p.drag = 0.95;
      p.w = 1.8 + Math.random() * 3;
      p.c = cols[i % cols.length];
      p.t = 0; p.max = 0.62 + Math.random() * 0.4;
      push(p);
    }
    kick();
  }

  function shake(el, amp) {
    if (!el || reduced) return;
    el.style.setProperty('--fx-amp', String(amp || 3) + 'px');
    el.classList.remove('fx-shake');
    void el.offsetWidth;
    el.classList.add('fx-shake');
    window.setTimeout(function () { if (el) el.classList.remove('fx-shake'); }, 330);
  }

  /* ---------- 飘分 ---------- */
  function pop(x, y, text, opt) {
    opt = opt || {};
    let n = popFree.pop();
    if (!n) {
      n = document.createElement('span');
      n.addEventListener('animationend', function () {
        n.classList.remove('is-live');
        n.style.display = 'none';
        if (!n._free) { n._free = 1; popFree.push(n); }
      });
      ui.appendChild(n);
      popNodes.push(n);
      if (popNodes.length > 30) {
        const old = popNodes.shift();
        if (old && old.parentNode) old.parentNode.removeChild(old);
      }
    }
    n._free = 0;
    n.style.display = '';
    n.className = 'fx-pop' + (opt.cls ? ' ' + opt.cls : '');
    n.textContent = text;
    n.style.left = Math.round(x) + 'px';
    n.style.top = Math.round(y) + 'px';
    n.style.setProperty('--rot', (opt.rot == null ? (Math.random() * 9 - 4.5) : opt.rot) + 'deg');
    n.style.setProperty('--life', (opt.life || 0.8) + 's');
    n.style.fontSize = opt.size ? opt.size + 'px' : '';
    void n.offsetWidth;
    n.classList.add('is-live');
  }

  /* 连击读数：传进来的是 HUD 里那个 `b`（数字），外套的 .hud-combo 负责显隐与跳动 */
  function combo(el, n, label) {
    if (!el) return;
    const wrap = el.closest ? (el.closest('.hud-combo') || el.parentNode) : null;
    el.textContent = '×' + n;
    if (label) {
      const lab = wrap && wrap.querySelector('.combo-lab');
      if (lab) lab.textContent = label;
    }
    if (!wrap) return;
    wrap.classList.toggle('is-on', n >= 2);
    wrap.classList.remove('is-beat');
    void wrap.offsetWidth;
    wrap.classList.add('is-beat');
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    parts.length = 0;
    pool.length = 0;
    if (g) g.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (cv) cv.style.visibility = 'hidden';
  }

  /* ---------- 验收口径 ---------- */
  function perf() {
    return {
      parts: parts.length,
      pool: pool.length,
      budget: Math.round(budget * 100) / 100,
      cap: cap,
      avgMs: Math.round(fWork * 100) / 100,
      frames: fCount,
      worstMs: Math.round(fWorst * 10) / 10,
      loops: window.__loops || []
    };
  }

  /* 单测粒子成本：200 个碎屑跑 n 帧的 update / draw 平均值（只在验收脚本里调） */
  function bench(n) {
    n = n || 40;
    stop();
    for (let i = 0; i < 200; i++) {
      const p = take('shard');
      p.x = Math.random() * 1200; p.y = Math.random() * 700;
      p.vx = (Math.random() - 0.5) * 400; p.vy = (Math.random() - 0.5) * 400;
      p.g = 700; p.drag = 0.98; p.w = 8; p.h = 4; p.rot = Math.random() * 6; p.vr = 3;
      p.c = '#252525'; p.t = 0; p.max = 3;
      push(p);
    }
    let t0 = performance.now();
    for (let i = 0; i < n; i++) update(1 / 60);
    const updateMs = (performance.now() - t0) / n;
    t0 = performance.now();
    for (let i = 0; i < n; i++) drawAll();
    const drawMs = (performance.now() - t0) / n;
    stop();
    return {
      particles: 200,
      updateMs: Math.round(updateMs * 1000) / 1000,
      drawMs: Math.round(drawMs * 1000) / 1000,
      totalMs: Math.round((updateMs + drawMs) * 1000) / 1000
    };
  }

  return {
    burst, burstAt, sparks, ring: ringAt, trail, rise, shake, pop, combo,
    freeze, frozen: phaseFreeze, stop, canvas: cv, perf, bench,
    budget: function () { return budget; }
  };
}
