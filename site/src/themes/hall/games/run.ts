/* 10 走墨：无尽跑，跳石吃字；二段跳补一次，踩空有缓冲。
   第二轮精品化：跳跃缓冲 / 土狼时间 / 可变跳高 / 空中微调；编排式障碍组合 + 离线可达性不等式；
   阶梯速度曲线；§4 专属视觉签名（落地墨点 / 二段跳双环向心 / 铜钱上升 / 连跳拖尾加厚）。 */
// @ts-nocheck
import '../games/run.css';

export function mountRun(ctx){
  const {
    on, FX, SFX, MHINT, BEST, fitBox,
    comboState, comboAdd, comboMult, hudSet, showVerdict
  } = ctx;
  /* syncLoops 由引擎在挂载之后回填，这里走 ctx 实时取值，不解构快照（同 break.ts） */
  function syncLoops(){ if (ctx.syncLoops) ctx.syncLoops(); }

  var RUN = document.getElementById('runCanvas');
  var RUN_START = document.getElementById('runStart');
  var RUN_GO = document.getElementById('runGo');
  var RUN_PAUSE = document.getElementById('runPause');
  var RUN_DIST = document.getElementById('runDist');
  var RUN_BEST = document.getElementById('runBest');
  var RUN_CHARS = document.getElementById('runChars');
  var RUN_COMBO = document.getElementById('runCombo');
  var RUN_V = document.getElementById('runVerdict');
  var RUN_VT = document.getElementById('runVText');
  var RUN_VS = document.getElementById('runVSeal');
  var RUN_PANE = document.getElementById('pane-run');

  var RW = 960, RH = 420, RGROUND = 336;

  /* ================= 物理参数（探针与离线可达性检查共用同一组常数） ================= */
  var PHYS = {
    g: 1520,          // 重力 px/s²
    v1: 650,          // 一段跳初速
    v2: 560,          // 二段跳初速
    coyote: 0.10,     // 土狼时间 s（离地后仍可起跳）
    buffer: 0.15,     // 跳跃缓冲 s（落地前按下的跳被记住）
    jumpCut: 300,     // 松手截断：上升速度高于此值才被砍短（可变跳高）
    recover: 0.18,    // 障碍间落地→再跳的最短恢复时间 s
    clear: 6,         // 脚底高出障碍顶的安全余量 px
    edge: 10          // 障碍两侧水平余量 px
  };
  PHYS.H1 = PHYS.v1 * PHYS.v1 / (2 * PHYS.g);            // 一段跳最高点 px
  PHYS.H2 = PHYS.H1 + PHYS.v2 * PHYS.v2 / (2 * PHYS.g);  // 二段跳累计最高点 px
  PHYS.T1 = 2 * PHYS.v1 / PHYS.g;
  PHYS.T2 = 2 * PHYS.v2 / PHYS.g;

  var runCtx = null, runRaf = 0, runLast = 0, runAcc = 0;
  var runRunning = false, runDone = false, runPaused = false;
  var runDist = 0, runSpeed = 300, runChars = 0, runScore = 0, runBest = 0, runMaxCombo = 0;
  var runObstacles = [], runCoins = [];
  var runNextGroup = 420, runReach = null;
  var runP = { x: 168, y: RGROUND - 54, vy: 0, w: 38, h: 54, jumps: 0, on: true };
  var runCoyote = 0, runBuf = 0, runGhost = [], runT = 0;
  var runStreak = 0, runLandT = 0, runTrim = 0, runTrimL = false, runTrimR = false;
  var runJumpHeld = false, runJumpCount = 0;
  var runCombo = comboState(2200, 8);
  var runBgFar = null, runBgNear = null;

  /* ================= 难度阶梯：米数区间 → 目标速度 / 组间隔时间 / 解锁组合 ================= */
  var TIERS = [
    { max: 60,  v: 340, gap: 0.62, names: ['low', 'pair', 'coins'] },
    { max: 160, v: 430, gap: 0.58, names: ['low', 'pair', 'high', 'step', 'coins'] },
    { max: 300, v: 520, gap: 0.54, names: ['high', 'step', 'wall2', 'stagger', 'coins'] },
    { max: 480, v: 610, gap: 0.50, names: ['high', 'wall2', 'risk', 'stagger', 'step'] },
    { max: 1e9, v: 700, gap: 0.46, names: ['wall2', 'risk', 'stagger', 'high'] }
  ];
  function tierOf(d){
    for (var i = 0; i < TIERS.length; i++) if (d < TIERS[i].max) return i;
    return TIERS.length - 1;
  }

  /* ================= 障碍组合编排（相对偏移，原点 = 组生成 x） =================
     每个组合在 spawn 时用 checkGroup() 拿物理不等式逐条验过；离线探针在 Node 里复算同一张表。 */
  var GROUP_DEFS = {
    low: { tier: 1, obs: [ { dx: 0,  w: 30, h: 28, ch: '石' } ], coins: 'low-arc' },
    pair: { tier: 1, obs: [ { dx: 0,   w: 30, h: 28, ch: '石' },
                            { dx: 160, w: 30, h: 28, ch: '木' } ], coins: 'low-arc' },
    high: { tier: 2, obs: [ { dx: 0, w: 34, h: 54, ch: '岩' } ], coins: 'high-arc' },
    step: { tier: 2, obs: [ { dx: 0,   w: 28, h: 26, ch: '木' },
                            { dx: 138, w: 30, h: 40, ch: '石' },
                            { dx: 276, w: 32, h: 52, ch: '岩' } ], coins: 'step' },
    coins: { tier: 1, obs: [], coins: 'sky-arc' },
    wall2: { tier: 3, obs: [ { dx: 0, w: 26, h: 126, ch: '岩', req: 'double' } ], coins: 'wall-top' },
    risk: { tier: 4, obs: [ { dx: 0,   w: 30, h: 56, ch: '石' },
                            { dx: 150, w: 30, h: 56, ch: '岩' } ], coins: 'risk-top' },
    stagger: { tier: 3, obs: [ { dx: 0,   w: 34, h: 54, ch: '岩' },
                               { dx: 146, w: 28, h: 26, ch: '木' },
                               { dx: 282, w: 34, h: 54, ch: '石' } ], coins: 'high-arc' }
  };

  /* ---------- 可达性不等式 ----------
     高度：一段跳可过 rise ≤ H1-8；二段跳累计可过 rise ≤ H2-10。
     水平：跳跃弧线高出障碍顶的停留时间 tw = 2·√(v1²-2g·rise)/g，
           期间水平位移 v·tw 必须 ≥ 障碍宽 + 2·edge。
     组内间距：相邻障碍边到边 ≥ v·recover（落地→再跳的恢复距离）。 */
  function checkGroup(def, v, phys){
    var items = def.obs.map(function(o){
      var rise = o.h + phys.clear;
      var disc = phys.v1 * phys.v1 - 2 * phys.g * rise;
      var win = disc < 0 ? 0 : 2 * Math.sqrt(disc) / phys.g;
      var horiz = v * win;
      var single = rise <= phys.H1 - 8 && horiz >= o.w + 2 * phys.edge;
      var double = rise <= phys.H2 - 10;
      var need = o.req || 'single';
      return { ch: o.ch, h: o.h, w: o.w, rise: Math.round(rise), need: need,
               single: single, double: double, horiz: Math.round(horiz),
               pass: need === 'double' ? double : (single || double) };
    });
    var gaps = [];
    for (var i = 1; i < def.obs.length; i++){
      var prev = def.obs[i - 1], cur = def.obs[i];
      var gap = cur.dx - (prev.dx + prev.w);
      var need = v * phys.recover;
      gaps.push({ gap: Math.round(gap), need: Math.round(need), ok: gap >= need });
    }
    var pass = items.every(function(x){ return x.pass; }) && gaps.every(function(x){ return x.ok; });
    return { v: Math.round(v), items: items, gaps: gaps, pass: pass };
  }

  function runFit(){
    if (!RUN) return;
    fitBox(RUN, RW / RH, 1180);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = RUN.clientWidth || RW;
    RUN.width = Math.round(cw * dpr);
    RUN.height = Math.round(cw * (RH / RW) * dpr);
    runCtx = RUN.getContext('2d');
    var s = RUN.width / RW;
    runCtx.setTransform(s, 0, 0, s, 0, 0);
    if (!runBgFar) runBgFar = document.createElement('canvas');
    if (!runBgNear) runBgNear = document.createElement('canvas');
    runBgFar.width = RW; runBgFar.height = RH;
    runBgNear.width = RW; runBgNear.height = RH;
    runPaintBg(runBgFar.getContext('2d'), 0);
    runPaintBg(runBgNear.getContext('2d'), 1);
  }

  /* 两层山各自画进一张离屏画布，每帧只贴图 + 平移 —— 每帧重画 40 个点的山脊线没必要。 */
  function runPaintBg(c, layer){
    c.clearRect(0, 0, RW, RH);
    var base = RGROUND - 4;
    var amp = layer ? 62 : 112;
    c.fillStyle = layer ? '#e2d7bf' : '#f0e7d4';
    c.beginPath();
    c.moveTo(0, base);
    for (var x = 0; x <= RW; x += 24){
      var y = base - Math.abs(Math.sin(x * 0.0042 + layer * 1.7)) * amp - (layer ? 0 : 20);
      c.lineTo(x, y);
    }
    c.lineTo(RW, base);
    c.closePath();
    c.fill();
    c.strokeStyle = layer ? 'rgba(37,37,37,.5)' : 'rgba(37,37,37,.16)';
    c.lineWidth = layer ? 2.4 : 1.6;
    c.beginPath();
    for (var x2 = 0; x2 <= RW; x2 += 24){
      var y2 = base - Math.abs(Math.sin(x2 * 0.0042 + layer * 1.7)) * amp - (layer ? 0 : 20);
      if (x2 === 0) c.moveTo(x2, y2); else c.lineTo(x2, y2);
    }
    c.stroke();
    if (!layer){
      c.fillStyle = 'rgba(37,37,37,.07)';
      c.font = '900 96px Georgia, serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      ['云', '山', '风'].forEach(function(ch, i){ c.fillText(ch, 180 + i * 300, 96 + (i % 2) * 34); });
    }
    if (layer){
      c.strokeStyle = 'rgba(37,37,37,.14)';
      c.lineWidth = 1.4;
      for (var hx = -RH; hx < RW + RH; hx += 22){
        c.beginPath();
        c.moveTo(hx, RGROUND);
        c.lineTo(hx + (RH - RGROUND) * 1.4, RH);
        c.stroke();
      }
    }
  }

  function runReset(showOverlay){
    runObstacles = []; runCoins = []; runGhost = [];
    runDist = 0; runSpeed = 300; runChars = 0; runScore = 0; runMaxCombo = 0;
    runNextGroup = 420; runReach = null;
    runP.y = RGROUND - runP.h; runP.vy = 0; runP.jumps = 0; runP.on = true;
    runCoyote = 0; runBuf = 0; runStreak = 0; runLandT = 0; runTrim = 0;
    runJumpHeld = false; runJumpCount = 0;
    runRunning = false; runDone = false; runPaused = false;
    runCombo = comboState(2200, 8);
    runBest = BEST.get('run.best');
    RUN_PANE.classList.remove('is-over');
    RUN_V.classList.remove('is-on');
    RUN_VS.className = 'verdict-seal';
    RUN_VS.textContent = '';
    RUN_START.classList.toggle('is-on', !!showOverlay);
    runHud();
    runFit();
    runDraw();
    MHINT.textContent = showOverlay ? '空格 / 点画面起跳 · 按开始' : '空格 / 点画面跳 · 二段跳补一次 · ← → 空中微调';
    if (!showOverlay) runGo();
  }

  function runHud(){
    var d = Math.floor(runDist);
    var b = Math.max(runBest, d);
    if (RUN_DIST && d !== runHudCache.d){ RUN_DIST.textContent = String(d); runHudCache.d = d; }
    if (RUN_BEST && b !== runHudCache.b){ RUN_BEST.textContent = String(b); runHudCache.b = b; }
    if (RUN_CHARS && runChars !== runHudCache.c){ RUN_CHARS.textContent = String(runChars); runHudCache.c = runChars; }
    if (runCombo.n !== runHudCache.n){ FX.combo(RUN_COMBO, runCombo.n); runHudCache.n = runCombo.n; }
    if (RUN_PAUSE && runPaused !== runHudCache.p){ RUN_PAUSE.textContent = runPaused ? '▶' : '⏸'; runHudCache.p = runPaused; }
  }
  var runHudCache = { d: -1, b: -1, c: -1, n: -1, p: null };

  function runGo(){
    if (!RUN) return;
    if (document.activeElement === RUN_GO) RUN_GO.blur();
    RUN_START.classList.remove('is-on');
    runRunning = true; runDone = false; runPaused = false;
    runLast = 0; runAcc = 0;
    if (runRaf) cancelAnimationFrame(runRaf);
    runRaf = requestAnimationFrame(runFrame);
    syncLoops();
  }

  function runStop(){
    runRunning = false;
    if (runRaf){ cancelAnimationFrame(runRaf); runRaf = 0; }
    syncLoops();
  }

  function toScreen(x, y){
    var r = RUN.getBoundingClientRect();
    return [r.left + x * (r.width / RW), r.top + y * (r.height / RH)];
  }

  function doJump(kind){
    runJumpCount++;
    runStreak++;
    if (kind === 1){
      runP.vy = -PHYS.v1;
      runP.on = false;
      runP.jumps = 1;
      runCoyote = 0;
      runStreak++;
      SFX.play('run.jump', { rate: 0.96 });
      var p1 = toScreen(runP.x + runP.w / 2, runP.y + runP.h);
      FX.ring(p1[0], p1[1], 4, 26, 2, 'rgba(37,37,37,.55)');
      FX.trail(p1[0], p1[1], 'rgba(37,37,37,.4)', 5);
    } else {
      runP.vy = -PHYS.v2;
      runP.jumps = 2;
      SFX.play('run.jump', { rate: 1.18 });
      var p2 = toScreen(runP.x + runP.w / 2, runP.y + runP.h);
      /* §4 重要：二段跳 = 脚下双环（墨外环 + 黄内环）+ 向心墨迹 */
      FX.ring(p2[0], p2[1], 4, 26, 2, 'rgba(37,37,37,.55)');
      FX.ring(p2[0], p2[1], 3, 20, 2, '#ffd166');
      FX.converge(p2[0], p2[1], { count: 10, radius: 30, colors: ['#252525', '#ffd166'], ring: false });
    }
    /* 连续 3 跳不断：拖尾加厚由 streak 驱动；第三跳给一小蓬金墨 */
    if (runStreak === 3){
      var p3 = toScreen(runP.x + runP.w / 2, runP.y);
      FX.rise(p3[0], p3[1], 6, ['#ffd166', '#fff8e8']);
    }
  }

  function runJump(){
    if (!runRunning || runDone || runPaused) return;
    if (runP.on || runCoyote > 0){
      doJump(1);
    } else if (runP.jumps < 2){
      doJump(2);
    } else {
      runBuf = PHYS.buffer;   /* 按早了：落地前 buffer 内按的跳会被记住 */
    }
  }

  function runJumpRelease(){
    /* 可变跳高：松手时仍在快速上升 → 砍掉一截上升速度，点按是小跳、按住是大跳 */
    if (runP.vy < -PHYS.jumpCut) runP.vy = -PHYS.jumpCut;
  }

  function pushCoins(pattern, origin){
    var i, cx, cy;
    if (pattern === 'low-arc'){
      for (i = 0; i < 3; i++) runCoins.push({ x: origin + 24 + i * 36, y: RGROUND - 74 - Math.sin(i / 2 * Math.PI) * 22, got: false });
    } else if (pattern === 'high-arc'){
      for (i = 0; i < 3; i++) runCoins.push({ x: origin + 18 + i * 36, y: RGROUND - 118 - Math.sin(i / 2 * Math.PI) * 20, got: false });
    } else if (pattern === 'sky-arc'){
      for (i = 0; i < 5; i++) runCoins.push({ x: origin + 10 + i * 34, y: RGROUND - 128 - Math.sin(i / 4 * Math.PI) * 34, got: false });
    } else if (pattern === 'step'){
      var ys = [RGROUND - 70, RGROUND - 92, RGROUND - 112];
      for (i = 0; i < 3; i++) runCoins.push({ x: origin + [14, 152, 290][i], y: ys[i], got: false });
    } else if (pattern === 'wall-top'){
      for (i = 0; i < 3; i++) runCoins.push({ x: origin - 12 + i * 26, y: RGROUND - 196, got: false });
    } else if (pattern === 'risk-top'){
      for (i = 0; i < 4; i++) runCoins.push({ x: origin + 10 + i * 38, y: RGROUND - 148, got: false });
    }
  }

  function spawnGroup(){
    var tier = tierOf(runDist);
    var defs = TIERS[tier].names;
    var name = defs[Math.floor(Math.random() * defs.length)];
    var def = GROUP_DEFS[name];
    var origin = RW + 40;
    def.obs.forEach(function(o){
      runObstacles.push({ x: origin + o.dx, y: RGROUND - o.h, w: o.w, h: o.h, ch: o.ch, req: o.req || 'single' });
    });
    pushCoins(def.coins, origin);
    /* 可达性检查：当前速度下逐条不等式，结果进探针供离线核对 */
    runReach = { name: name, tier: tier, check: checkGroup(def, runSpeed, PHYS) };
    var lastRight = def.obs.length ? origin + def.obs[def.obs.length - 1].dx + def.obs[def.obs.length - 1].w : origin + 80;
    var gap = runSpeed * TIERS[tier].gap + Math.random() * 40;
    runNextGroup = Math.max(170, lastRight + gap - RW);
  }

  function runUpdate(dt){
    runT += dt;
    runCoyote = Math.max(0, runCoyote - dt);
    runBuf = Math.max(0, runBuf - dt);
    runLandT = Math.max(0, runLandT - dt * 6);

    /* 速度曲线：按米数分五档缓坡逼近目标速度，档内平滑加，不出现陡升段 */
    var tier = tierOf(runDist);
    var target = Math.min(760, TIERS[tier].v);
    runSpeed += (target - runSpeed) * Math.min(1, dt * 0.6);
    runDist += runSpeed * dt / 40;

    /* 空中微调：←/→（或 A/D）给一点 Trim，世界速度 ±26px/s；落地回中 */
    var trimTarget = runP.on ? 0 : (runTrimL ? -26 : 0) + (runTrimR ? 26 : 0);
    runTrim += (trimTarget - runTrim) * Math.min(1, dt * 8);

    runP.vy += PHYS.g * dt;
    runP.y += runP.vy * dt;
    if (runP.y + runP.h >= RGROUND){
      if (!runP.on){
        /* §4 普通：落地墨点 2–3 团 + 压扁一下 */
        var lp = toScreen(runP.x + runP.w / 2, RGROUND);
        FX.trail(lp[0] - 6, lp[1], 'rgba(37,37,37,.5)', 6);
        FX.trail(lp[0] + 6, lp[1], 'rgba(37,37,37,.4)', 5);
        FX.trail(lp[0], lp[1], 'rgba(37,37,37,.35)', 4);
        runLandT = 1;
        runStreak = 0;
      }
      runP.y = RGROUND - runP.h;
      runP.vy = 0;
      runP.on = true;
      runP.jumps = 0;
      if (runBuf > 0){ runBuf = 0; runJump(); }
    } else if (runP.on){
      runP.on = false;
      runCoyote = PHYS.coyote;
    }

    runGhost.push({ x: runP.x + runP.w / 2, y: runP.y + runP.h / 2, a: 1 });
    if (runGhost.length > 8) runGhost.shift();

    var dx = (runSpeed + runTrim) * dt;
    runNextGroup -= dx;
    if (runNextGroup <= 0) spawnGroup();

    for (var i = runObstacles.length - 1; i >= 0; i--){
      var o = runObstacles[i];
      o.x -= dx;
      if (o.x + o.w < -20) runObstacles.splice(i, 1);
    }
    for (var j = runCoins.length - 1; j >= 0; j--){
      var co = runCoins[j];
      co.x -= dx;
      if (co.x < -30) runCoins.splice(j, 1);
      var pr = { x: runP.x + 4, y: runP.y + 4, w: runP.w - 8, h: runP.h - 8 };
      if (!co.got && co.x > pr.x - 12 && co.x < pr.x + pr.w + 12 && co.y > pr.y - 12 && co.y < pr.y + pr.h + 12){
        co.got = true;
        runChars++;
        SFX.play('run.coin', { rate: 1 + Math.min(0.6, runCombo.n * 0.07) });
        comboAdd(runCombo);
        runMaxCombo = Math.max(runMaxCombo, runCombo.n);
        runScore = Math.floor(runDist) + runChars * 8;
        var cr = RUN.getBoundingClientRect();
        /* §4 重要：拾铜钱 = 黄点上升 + 火星 */
        FX.rise(cr.left + co.x * (cr.width / RW), cr.top + co.y * (cr.height / RH), 5, ['#ffd166', '#fff8e8']);
        FX.pop(cr.left + co.x * (cr.width / RW), cr.top + co.y * (cr.height / RH),
          '+' + (8 * comboMult(runCombo)), 'is-gold');
        FX.sparks({ left: cr.left + co.x * (cr.width / RW) - 8, top: cr.top + co.y * (cr.height / RH) - 8, width: 16, height: 16 }, 3, '#ffd166');
        runHud();
      }
    }

    var hit = false;
    for (var k = 0; k < runObstacles.length; k++){
      var ob = runObstacles[k];
      if (runP.x + 6 < ob.x + ob.w && runP.x + runP.w - 6 > ob.x &&
          runP.y + 6 < ob.y + ob.h && runP.y + runP.h > ob.y){ hit = true; break; }
    }
    if (hit) runEnd();
  }

  function runEnd(){
    runDone = true;
    runRunning = false;
    if (runRaf){ cancelAnimationFrame(runRaf); runRaf = 0; }
    runScore = Math.floor(runDist) + runChars * 8;
    var prevBest = Math.max(runBest, BEST.get('run.best'));
    var isBest = Math.floor(runDist) > prevBest;
    BEST.set('run.best', Math.floor(runDist));
    runBest = Math.max(prevBest, Math.floor(runDist));
    var cr = RUN.getBoundingClientRect();
    SFX.play('run.dead');
    FX.burst({ left: cr.left + runP.x * (cr.width / RW), top: cr.top + runP.y * (cr.height / RH), width: 40, height: 54 },
      { count: 26, dust: 14, power: 520, size: 9, colors: ['#252525', '#f28b82', '#fff8e8'], ringColor: '#f28b82' });
    FX.shake(RUN, 7);
    FX.freeze(90);
    if (isBest){
      /* §4 重大：破纪录 = 向心聚合 + 金墨上升 + 印章 */
      var bc = toScreen(runP.x + runP.w / 2, runP.y + runP.h / 2);
      FX.converge(bc[0], bc[1], { count: 18, radius: 52, colors: ['#ffd166', '#fff8e8', '#f28b82'], ringColor: '#f28b82' });
      FX.rise(bc[0], bc[1] - 20, 12, ['#ffd166', '#fff8e8']);
      FX.stamp(bc[0], bc[1] - 46, '新纪录', { color: '#b5342b' });
    }
    RUN_PANE.classList.add('is-over');
    showVerdict(RUN_V, RUN_VT, RUN_VS, 'v-bad',
      '止步 ' + Math.floor(runDist) + ' 米 · 收字 ' + runChars + ' · ' + runScore + ' 分' + (isBest ? ' · 新纪录' : ''), '散');
    MHINT.textContent = '止步了 · 最多 ' + runMaxCombo + ' 连 · 再跑一次';
    runHud();
    syncLoops();
  }

  function runDraw(){
    if (!runCtx) return;
    var g = runCtx;
    g.clearRect(0, 0, RW, RH);
    g.fillStyle = '#f7efdd';
    g.fillRect(0, 0, RW, RH);
    /* 两层山：远层慢、近层快；近层随速度再加一档视差，高速时背景拉开 */
    var speedK = runSpeed / 760;
    var offFar = (runDist * 3.4) % RW;
    var offNear = (runDist * (7.2 + speedK * 4)) % RW;
    g.globalAlpha = 1;
    g.drawImage(runBgFar, -offFar, 0);
    g.drawImage(runBgFar, RW - offFar, 0);
    g.drawImage(runBgNear, -offNear, 0);
    g.drawImage(runBgNear, RW - offNear, 0);

    /* 高速速度线：靠背景层差与细线传达速度，不糊屏 */
    if (runSpeed > 520){
      var nLines = Math.round((runSpeed - 520) / 60);
      g.strokeStyle = 'rgba(37,37,37,.10)';
      g.lineWidth = 1.4;
      for (var s = 0; s < nLines; s++){
        var sy = 60 + ((s * 71) % 200);
        var sx = RW - ((runDist * 22 + s * 260) % (RW + 160)) + 80;
        g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 46 + speedK * 30, sy); g.stroke();
      }
    }

    g.fillStyle = '#252525';
    g.fillRect(0, RGROUND, RW, 3);
    var d0 = (runDist * 12) % 44;
    g.fillStyle = 'rgba(37,37,37,.32)';
    for (var x = -d0; x < RW; x += 44) g.fillRect(x, RGROUND + 9, 16, 3);

    for (var i = 0; i < runCoins.length; i++){
      var co = runCoins[i];
      if (co.got) continue;
      g.beginPath(); g.arc(co.x, co.y, 11, 0, Math.PI * 2);
      g.fillStyle = '#ffd166'; g.fill();
      g.strokeStyle = '#252525'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#252525';
      g.font = 'bold 12px ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('字', co.x, co.y + 1);
    }

    for (var k = 0; k < runObstacles.length; k++){
      var o = runObstacles[k];
      if (o.x > RW + 40) continue;
      g.fillStyle = o.req === 'double' ? '#2f2f2f' : '#3b3b3b';
      g.fillRect(o.x, o.y, o.w, o.h);
      g.strokeStyle = '#252525'; g.lineWidth = 2;
      g.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      /* 必须二段跳的高墙：顶部一道朱色标记，读得出"这道得补一下" */
      if (o.req === 'double'){
        g.fillStyle = '#f28b82';
        g.fillRect(o.x + 3, o.y + 3, o.w - 6, 5);
      }
      g.fillStyle = 'rgba(255,248,232,.42)';
      g.font = 'bold 13px ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(o.ch, o.x + o.w / 2, o.y + o.h / 2);
    }

    /* 墨迹拖尾：连跳 streak≥3 加厚；高速再加宽 */
    var trailMul = 1 + Math.min(1, Math.max(0, runStreak - 2) * 0.5) + speedK * 0.25;
    for (var gi = 0; gi < runGhost.length; gi++){
      var gg = runGhost[gi];
      var a = (gi + 1) / runGhost.length;
      g.globalAlpha = a * 0.14;
      g.beginPath();
      g.ellipse(gg.x - 6, gg.y, 16 * a * trailMul, 11 * a * trailMul, 0, 0, Math.PI * 2);
      g.fillStyle = '#252525';
      g.fill();
    }
    g.globalAlpha = 1;

    var px = runP.x, py = runP.y;
    var tilt = runP.on ? 0 : Math.max(-0.3, Math.min(0.35, runP.vy / 900));
    var squashY = 1 - 0.18 * runLandT;
    var squashX = 1 + 0.16 * runLandT;
    g.save();
    g.translate(px + runP.w / 2, py + runP.h / 2);
    g.rotate(tilt);
    g.scale(squashX, squashY);
    g.fillStyle = '#252525';
    g.beginPath();
    g.ellipse(0, 4, 14, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-2, -16); g.lineTo(10, -30); g.lineTo(3, -9);
    g.fill();
    g.fillStyle = '#fff8e8';
    g.beginPath(); g.arc(2, 0, 3.2, 0, Math.PI * 2); g.fill();
    g.restore();

    if (runPaused && runRunning){
      g.fillStyle = 'rgba(255,248,232,.88)';
      g.fillRect(0, RH / 2 - 30, RW, 60);
      g.fillStyle = '#252525';
      g.font = '900 26px Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('暂停 · 点 ▶ 继续', RW / 2, RH / 2);
    }
  }

  /* 固定步长：物理按 120Hz 算，渲染按屏幕刷新率画。 */
  var RSTEP = 1 / 120;
  function runFrame(ts){
    if (!runRunning) return;
    var raw = runLast ? Math.min(120, ts - runLast) : 16;
    runLast = ts;
    if (!runPaused && !runDone && !FX.frozen()){
      runAcc += raw / 1000;
      var guard = 0;
      while (runAcc >= RSTEP && guard++ < 6){ runUpdate(RSTEP); runAcc -= RSTEP; if (runDone) break; }
    }
    runDraw();
    runHud();
    runRaf = requestAnimationFrame(runFrame);
  }

  function jumpKeyDown(e){
    if (ctx.current !== 'run') return;
    if (e.repeat) return;
    e.preventDefault();
    runJumpHeld = true;
    runJump();
  }
  function jumpKeyUp(e){
    if (ctx.current !== 'run') return;
    runJumpHeld = false;
    runJumpRelease();
  }

  if (RUN_GO) on(RUN_GO, 'click', runGo);
  if (RUN_PAUSE) on(RUN_PAUSE, 'click', function(){
    if (!runRunning || runDone) return;
    runPaused = !runPaused;
    MHINT.textContent = runPaused ? '已暂停 · 点 ▶ 接着跑' : '接着跑 · 空格跳';
    runHud(); runDraw();
  });
  /* 键盘：空格 / ↑ / W 起跳，松开截断跳高；←/→ 或 A/D 空中微调 */
  on(window, 'keydown', function(e){
    if (ctx.current !== 'run') return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') jumpKeyDown(e);
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') runTrimL = true;
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') runTrimR = true;
  });
  on(window, 'keyup', function(e){
    if (ctx.current !== 'run') return;
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') jumpKeyUp(e);
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') runTrimL = false;
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') runTrimR = false;
  });
  if (RUN){
    on(RUN, 'pointerdown', function(e){ e.preventDefault(); runJumpHeld = true; RUN.classList.add('is-pressed'); runJump(); });
    on(RUN, 'pointerup', function(){ runJumpHeld = false; RUN.classList.remove('is-pressed'); runJumpRelease(); });
    on(RUN, 'pointercancel', function(){ runJumpHeld = false; RUN.classList.remove('is-pressed'); runJumpRelease(); });
    RUN.__probe = function(){
      return {
        dist: Math.round(runDist * 10) / 10, speed: Math.round(runSpeed), chars: runChars,
        score: runScore, best: runBest, combo: runCombo.n,
        y: Math.round(runP.y), vy: Math.round(runP.vy), on: runP.on, jumps: runP.jumps,
        obstacles: runObstacles.map(function(o){ return { x: Math.round(o.x), w: o.w, h: o.h, req: o.req }; }),
        coins: runCoins.filter(function(c){ return !c.got; }).length,
        run: runRunning, paused: runPaused, done: runDone,
        current: ctx.current,
        /* 新增验收字段：不改动既有键语义 */
        coyote: Math.round(runCoyote * 1000), buf: Math.round(runBuf * 1000),
        streak: runStreak, tier: tierOf(runDist) + 1, trim: Math.round(runTrim),
        jumpsUsed: runJumpCount, reach: runReach,
        phys: { g: PHYS.g, v1: PHYS.v1, v2: PHYS.v2, H1: Math.round(PHYS.H1 * 10) / 10,
                H2: Math.round(PHYS.H2 * 10) / 10, coyote: PHYS.coyote, buffer: PHYS.buffer }
      };
    };
  }

  return {
    open(){ runReset(true); },
    stop: runStop,
    close: runStop,
    fit: runFit,
    replay(){ runReset(false); },
    loops(){ return runRunning ? ['run'] : []; },
    suspend(){
      if (!runRunning) return null;
      runStop();
      return function(){ runRunning = true; runLast = 0; runAcc = 0; runRaf = requestAnimationFrame(runFrame); };
    }
  };
}
