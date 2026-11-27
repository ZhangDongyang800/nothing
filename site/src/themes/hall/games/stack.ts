/* 08 垒塔：时序堆叠，晃动的砖落下去对齐；重叠留下、切出掉下，全错开塌。
 * 第二轮精品化：真实中心判定 + 阈值可视化、可预测的节奏段落、特殊砖、分层反馈、
 * 镜头平滑跟随；键盘 / 指针两条输入路径同函数落砖，无重复触发。 */
// @ts-nocheck
import '../games/stack.css';

export function mountStack(ctx){
  const {
    on, FX, SFX, MHINT, BEST, fitBox,
    hudSet, showVerdict
  } = ctx;
  /* syncLoops 由引擎在挂载之后回填：这里走 ctx 实时取值，不解构快照
     （否则拿到初始空函数，关闭后 window.__loops 清不掉）。 */
  function syncLoops(){ if (ctx.syncLoops) ctx.syncLoops(); }

  var STK = document.getElementById('stackCanvas');
  var STK_START = document.getElementById('stackStart');
  var STK_GO = document.getElementById('stackGo');
  var STK_PAUSE = document.getElementById('stackPause');
  var STK_H = document.getElementById('stackH');
  var STK_BEST = document.getElementById('stackBest');
  var STK_SCORE = document.getElementById('stackScore');
  var STK_COMBO = document.getElementById('stackCombo');
  var STK_V = document.getElementById('stackVerdict');
  var STK_VT = document.getElementById('stackVText');
  var STK_VS = document.getElementById('stackVSeal');
  var STK_PANE = document.getElementById('pane-stack');

  /* ---------- 逻辑坐标常量（与显示尺寸无关） ---------- */
  var SW = 480, SH = 600, SBH = 30, SBASE = 244, SGND = 500;

  /* ---------- 节奏段落：高度进档 → 角速度 / 摆幅平滑靠拢，不做随机抽签 ----------
     周期 = 2π / ω；入门 2.42s → 高空 1.53s。档位只随高度走，砖本身没有随机速度。 */
  var TIERS = [
    { upTo: 5,  omega: 2.6, amp: 150, label: '入门' },
    { upTo: 11, omega: 3.1, amp: 138, label: '渐起' },
    { upTo: 17, omega: 3.6, amp: 126, label: '紧凑' },
    { upTo: 99, omega: 4.1, amp: 112, label: '高空' }
  ];
  function tierFor(h){
    for (var i = 0; i < TIERS.length; i++) if (h <= TIERS[i].upTo) return i;
    return TIERS.length - 1;
  }

  /* ---------- 特殊砖：固定排期（按层号算），不是随机发牌 ----------
     窄砖：摆动中更难对准；宽砖：容错大，落准奖励更宽。 */
  function brickKind(n){
    if (n > 0 && n % 9 === 8) return 'wide';
    if (n > 0 && n % 6 === 5) return 'thin';
    return 'normal';
  }
  function pendingWidth(top, kind){
    if (kind === 'wide') return Math.min(SBASE, top.w + 26);
    if (kind === 'thin') return Math.round(top.w * 0.72);
    return top.w;
  }

  /* ---------- 真实中心判定：两块砖的中心差 vs 容差；容差跟着砖宽走 ---------- */
  function judge(mx, mw, top){
    var mcx = mx + mw / 2, tcx = top.x + top.w / 2;
    var err = Math.abs(mcx - tcx);
    var tol = Math.max(7, Math.min(16, Math.round(top.w * 0.14)));
    var l = Math.max(mx, top.x), r = Math.min(mx + mw, top.x + top.w);
    var overlap = r - l;
    return { mcx: mcx, tcx: tcx, err: err, tol: tol, overlap: overlap,
             perfect: err <= tol, side: mcx < tcx ? -1 : 1 };
  }

  var stkCtx = null, stkRaf = 0, stkLast = 0;
  var stkRunning = false, stkDone = false, stkPaused = false;
  var stkBlocks = [], stkPhase = 0, stkOmega = TIERS[0].omega, stkAmp = TIERS[0].amp, stkTier = 0;
  var stkCam = 0, stkCamT = 0;
  var stkScore = 0, stkBest = 0, stkCombo = 0, stkMaxCombo = 0;
  var stkFall = [], stkFlash = 0, stkFlashX = 0;
  var stkMoving = { x: 0, w: SBASE, kind: 'normal' };
  var stkSway = 0, stkSwayDir = 1, stkTopPulse = 0, stkCooldown = 0;
  /* 首次出现提示：窄砖 / 宽砖每局各提示一次 */
  var stkSeenThin = false, stkSeenWide = false;

  function stkFit(){
    if (!STK) return;
    fitBox(STK, SW / SH, 540);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = STK.clientWidth || SW;
    STK.width = Math.round(cw * dpr);
    STK.height = Math.round(cw * (SH / SW) * dpr);
    stkCtx = STK.getContext('2d');
    var s = STK.width / SW;
    stkCtx.setTransform(s, 0, 0, s, 0, 0);
    /* 改画布尺寸会把它清空；循环没起的时候（开局面板盖着）补一帧静态塔基。
       首次 refit 时还没开过机（没有塔），stkDraw 会去读塔顶 —— 那一帧不画。 */
    if (!stkRunning && stkBlocks.length) stkDraw();
  }

  function stkHud(){
    if (STK_H) STK_H.textContent = String(stkBlocks.length - 1);
    if (STK_BEST) STK_BEST.textContent = String(Math.max(stkBest, stkBlocks.length - 1));
    hudSet(STK_SCORE, stkScore);
    FX.combo(STK_COMBO, stkCombo);
    if (STK_PAUSE) STK_PAUSE.textContent = stkPaused ? '▶' : '⏸';
  }

  function stkReset(showOverlay){
    stkBlocks = [{ x: (SW - SBASE) / 2, w: SBASE }];
    stkPhase = 0; stkOmega = TIERS[0].omega; stkAmp = TIERS[0].amp; stkTier = 0;
    stkCam = 0; stkCamT = 0;
    stkScore = 0; stkCombo = 0; stkMaxCombo = 0;
    stkFall = []; stkFlash = 0; stkSway = 0; stkTopPulse = 0; stkCooldown = 0;
    stkSeenThin = false; stkSeenWide = false;
    var kind = brickKind(1);
    stkMoving = { x: (SW - SBASE) / 2, w: pendingWidth(stkBlocks[0], kind), kind: kind };
    stkRunning = false; stkDone = false; stkPaused = false;
    stkBest = BEST.get('stack.best');
    ctx.startBest('stackStartBest', stkBest, '层');
    STK_PANE.classList.remove('is-over');
    STK_V.classList.remove('is-on');
    STK_VS.className = 'verdict-seal';
    STK_VS.textContent = '';
    STK_START.classList.toggle('is-on', !!showOverlay);
    stkHud();
    stkFit();
    stkDraw();
    MHINT.textContent = showOverlay ? '空格 / 点画面落砖 · 按开始' : '空格 / 点画面落砖 · 对准了算「准」';
    if (!showOverlay) stkGo();
  }

  function stkGo(){
    if (!STK) return;
    STK_START.classList.remove('is-on');
    stkRunning = true; stkDone = false; stkPaused = false;
    stkLast = 0; stkCooldown = 0;
    /* 开局后顶栏提示切到游玩口径 */
    MHINT.textContent = '空格 / 点画面落砖 · 对准了算「准」';
    if (stkRaf) cancelAnimationFrame(stkRaf);
    stkRaf = requestAnimationFrame(stkFrame);
    syncLoops();
  }

  function stkStop(){
    stkRunning = false;
    if (stkRaf){ cancelAnimationFrame(stkRaf); stkRaf = 0; }
    syncLoops();
  }

  /* ---------- 落砖：指针与键盘两条路径都进这一个函数 ---------- */
  function stkDrop(){
    if (!stkRunning || stkDone || stkPaused) return;
    if (stkCooldown > 0) return;                 /* 防连点 / 长按重复触发 */
    var top = stkBlocks[stkBlocks.length - 1];
    var mx = stkMoving.x, mw = stkMoving.w, kind = stkMoving.kind;
    var j = judge(mx, mw, top);
    var prevCombo = stkCombo;

    /* 完全错开 = 塌：整块掉下去，画面读起来是"塔倒了" */
    if (j.overlap <= 0){
      stkFall.push({ x: mx, w: mw, y: SGND - stkBlocks.length * SBH,
        vx: j.side * 70, vy: -70, rot: 0, vr: j.side * 3.4, c: '#f4b9b3', whole: true });
      stkEnd();
      return;
    }

    var l = Math.max(mx, top.x), r = Math.min(mx + mw, top.x + top.w);
    var w = r - l, newW, cutW, bonus = 0;
    var perfect = j.perfect;

    if (perfect){
      stkCombo++;
      stkMaxCombo = Math.max(stkMaxCombo, stkCombo);
      bonus = kind === 'wide' ? 12 : 8;           /* 连准补宽 +8；宽砖落准多 +4 */
      newW = Math.min(SBASE, top.w + bonus);
      l = j.tcx - newW / 2;                       /* 准 → 中心吸附对齐 */
      cutW = 0;
    } else {
      stkCombo = 0;
      newW = w; cutW = mw - w;
    }

    /* 外露部分真实掉落：≥14px 切成两片，读起来更像"被削下来的一刀" */
    if (!perfect && cutW > 4){
      var cutX = mx < l ? mx : r;
      var halves = cutW >= 14
        ? [{ w: Math.round(cutW / 2), dx: 0 }, { w: cutW - Math.round(cutW / 2), dx: Math.round(cutW / 2) }]
        : [{ w: cutW, dx: 0 }];
      for (var fi = 0; fi < halves.length; fi++){
        var fr = halves[fi];
        stkFall.push({
          x: mx < l ? cutX + fr.dx : cutX - fr.dx - fr.w, w: fr.w,
          y: SGND - stkBlocks.length * SBH,
          vx: mx < l ? -85 : 85, vy: -40, rot: 0, vr: mx < l ? -4 : 4,
          c: '#cdc6b8', whole: false
        });
      }
    }

    stkBlocks.push({ x: l, w: newW });
    var hN = stkBlocks.length - 1;
    stkScore += 90 + hN * 8 + stkCombo * 40;

    /* 节奏进档：只随高度平滑迁移，不在砖上掷随机 */
    stkTier = tierFor(hN);

    /* 镜头目标：高出 6 层之后才开始抬 */
    stkCamT = Math.max(0, (hN - 6) * SBH);

    /* 下一块：固定排期发特殊砖 */
    var nextKind = brickKind(hN + 1);
    var nextTop = stkBlocks[stkBlocks.length - 1];
    stkMoving = { x: SW / 2 - nextTop.w / 2, w: pendingWidth(nextTop, nextKind), kind: nextKind };
    stkPhase = 0;
    /* 特殊砖首次登场说清楚它是什么 */
    if (nextKind === 'thin' && !stkSeenThin){
      stkSeenThin = true;
      MHINT.textContent = '窄砖来了 · 更窄，更难对准';
    } else if (nextKind === 'wide' && !stkSeenWide){
      stkSeenWide = true;
      MHINT.textContent = '宽砖来了 · 更宽更好搭，落准奖励更多';
    }

    var rc = STK.getBoundingClientRect();
    var sx = rc.width / SW, sy = rc.height / SH;
    var contactY = SGND - (stkBlocks.length - 1) * SBH + stkCam;
    var cx = rc.left + (l + newW / 2) * sx, cy = rc.top + contactY * sy;

    if (perfect){
      stkFlash = 1; stkFlashX = l + newW / 2;
      stkTopPulse = 1;
      /* 重要档：中心黄环收紧 + 向心聚合 + 宽度奖励飘字 */
      FX.converge(cx, cy, { count: 12, radius: 34,
        colors: ['#ffd166', '#fff8e8', '#f28b82'], ringColor: '#ffd166' });
      FX.sparks({ left: cx - 10, top: cy - 8, width: 20, height: 16 }, 5, '#fff8e8');
      FX.pop(cx, cy - 14, '+' + bonus, 'is-gold');
      if (stkCombo >= 2) FX.pop(cx, cy - 36, '准 ×' + stkCombo, 'is-gold');
      FX.freeze(45);
      FX.shake(STK, 2);
      SFX.play('stack.perfect', { rate: 1 + Math.min(0.4, stkCombo * 0.06) });
      /* 重大档：每 5 连 → 金粉上扬 + 塔体轻摇 */
      if (stkCombo % 5 === 0){
        FX.rise(cx, cy, 12, ['#ffd166', '#fff8e8']);
        FX.shake(STK, 3);
      }
    } else {
      stkSway = Math.min(1, stkSway + 0.5); stkSwayDir = j.side;
      if (prevCombo >= 3) FX.pop(cx, cy - 14, '断', 'is-bad');
      if (cutW > 4){
        SFX.play('stack.slice', { gain: Math.min(1, 0.5 + cutW / mw) });
        FX.sparks({ left: cx - 12, top: cy - 6, width: 24, height: 14 }, 4, '#cdc6b8');
      } else {
        SFX.play('stack.drop', { gain: 0.85 });
      }
      FX.shake(STK, 2);
    }

    /* 高度里程碑：每 10 层一拍 */
    if (hN % 10 === 0 && hN > 0){
      FX.ring(cx, cy, 10, 60, 3, '#9cc7f5');
      FX.pop(cx, cy - 30, hN + ' 层', '');
    }

    stkCooldown = 0.07;
    stkHud();
  }

  function stkUpdate(dt){
    var T = TIERS[stkTier];
    /* 角速度 / 摆幅向目标平滑靠拢：进档不顿挫、不突变 */
    stkOmega += (T.omega - stkOmega) * Math.min(1, dt * 1.5);
    stkAmp += (T.amp - stkAmp) * Math.min(1, dt * 1.5);
    stkPhase += stkOmega * dt;
    var w = stkMoving.w;
    stkMoving.x = SW / 2 - w / 2 + Math.sin(stkPhase) * stkAmp * 0.9;
    stkCam += (stkCamT - stkCam) * Math.min(1, dt * 8);
    stkFlash = Math.max(0, stkFlash - dt * 3.2);
    stkTopPulse = Math.max(0, stkTopPulse - dt * 2.4);
    stkSway = Math.max(0, stkSway - dt * 1.8);
    stkCooldown = Math.max(0, stkCooldown - dt);
    for (var i = stkFall.length - 1; i >= 0; i--){
      var f = stkFall[i];
      f.vy += 1200 * dt;
      f.y += f.vy * dt;
      f.x += f.vx * dt;
      f.rot += f.vr * dt;
      if (f.y > SH + 80) stkFall.splice(i, 1);
    }
  }

  /* ---------- 绘制 ---------- */
  function stkBlock(g, x, y, w, h, fill, label, pulse){
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#252525';
    g.lineWidth = pulse > 0 ? 4 : 3;
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    if (pulse > 0){
      g.globalAlpha = pulse * 0.35;
      g.strokeStyle = '#ffd166';
      g.strokeRect(x - 3, y - 3, w + 6, h + 6);
      g.globalAlpha = 1;
    }
    if (label && w > 46){
      g.fillStyle = 'rgba(37,37,37,.5)';
      g.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(label, x + 7, y + h / 2);
    }
  }

  function stkDraw(){
    if (!stkCtx) return;
    var g = stkCtx;
    g.clearRect(0, 0, SW, SH);
    var bgGrad = g.createLinearGradient(0, 0, 0, SH);
    bgGrad.addColorStop(0, '#fbf4e6');
    bgGrad.addColorStop(1, '#f0e6d2');
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, SW, SH);

    /* 背景刻度线：塔升多高，看这条线在动就知道 */
    g.strokeStyle = 'rgba(37,37,37,.12)';
    g.lineWidth = 1;
    for (var y0 = -(stkCam % SBH); y0 < SH; y0 += SBH){
      g.beginPath(); g.moveTo(0, Math.round(y0)); g.lineTo(SW, Math.round(y0)); g.stroke();
    }
    /* 天上三朵淡云 */
    g.strokeStyle = 'rgba(37,37,37,.10)';
    g.lineWidth = 2;
    for (var cl = 0; cl < 3; cl++){
      var cx0 = 90 + cl * 150, cy0 = 90 + (cl % 2) * 46 + (stkCam % 260) * 0.04;
      g.beginPath();
      g.arc(cx0, cy0, 26 + cl * 6, Math.PI * 1.05, Math.PI * 1.95);
      g.arc(cx0 + 34, cy0 - 6, 20, Math.PI * 1.1, Math.PI * 2);
      g.stroke();
    }
    /* 左侧标尺：每 5 层一道 */
    var pil = SGND + stkCam;
    for (var lb = 0; lb < 60; lb++){
      var ly = pil - lb * SBH;
      if (ly < 0 || ly > SH + 20) continue;
      var big = lb % 5 === 0 && lb > 0;
      g.fillStyle = big ? 'rgba(37,37,37,.34)' : 'rgba(37,37,37,.14)';
      g.fillRect(SW - (big ? 26 : 14), Math.round(ly) - 1, big ? 20 : 8, big ? 2 : 1.5);
      if (big){
        g.fillStyle = 'rgba(37,37,37,.32)';
        g.font = '9px ui-monospace, Menlo, monospace';
        g.textAlign = 'right'; g.textBaseline = 'middle';
        g.fillText(String(lb), SW - 30, Math.round(ly));
      }
    }
    /* 地面墨线 */
    g.fillStyle = '#252525';
    g.fillRect(0, SGND + stkCam + SBH, SW, 3);

    /* 只画看得见的十几层 */
    var from = Math.max(0, stkBlocks.length - 16);
    var topIdx = stkBlocks.length - 1;
    for (var i = from; i < stkBlocks.length; i++){
      var b = stkBlocks[i];
      var by = SGND - i * SBH + stkCam;
      var off = i >= topIdx - 1 ? stkSway * stkSwayDir * 4 : 0;
      var fill = i % 2 ? '#fff8e8' : '#f7efdd';
      stkBlock(g, b.x + off, by, b.w, SBH, fill, i === 0 ? '础' : String(i + 1), i === topIdx ? stkTopPulse : 0);
    }

    /* 顶层判定带：±容差涂黄，玩家能直接看出"落在哪算准" */
    if (stkBlocks.length){
      var top = stkBlocks[topIdx];
      var tolTop = Math.max(7, Math.min(16, Math.round(top.w * 0.14)));
      var tcy = SGND - topIdx * SBH + stkCam;
      g.fillStyle = 'rgba(255,209,102,.22)';
      g.fillRect(top.x + top.w / 2 - tolTop, tcy, tolTop * 2, SBH);
      g.strokeStyle = 'rgba(37,37,37,.4)';
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(top.x + top.w / 2, tcy); g.lineTo(top.x + top.w / 2, tcy + SBH); g.stroke();
      g.setLineDash([]);
    }

    /* 正在晃的那块：硬偏移影子 + 本体 */
    var my = SGND - stkBlocks.length * SBH + stkCam;
    g.fillStyle = 'rgba(37,37,37,.14)';
    g.fillRect(stkMoving.x + 5, my + 5, stkMoving.w, SBH);
    var mFill = stkMoving.kind === 'thin' ? '#dfeaf7'
      : stkMoving.kind === 'wide' ? '#e3efd9' : '#ffd166';
    var mLabel = stkMoving.kind === 'thin' ? '窄'
      : stkMoving.kind === 'wide' ? '宽' : String(stkBlocks.length + 1);
    stkBlock(g, stkMoving.x, my, stkMoving.w, SBH, mFill, mLabel, 0);

    /* 摆动砖中心刻度 + 实时误差读数 */
    var mj = judge(stkMoving.x, stkMoving.w, stkBlocks[topIdx]);
    g.strokeStyle = '#252525'; g.lineWidth = 2;
    g.beginPath();
    g.moveTo(mj.mcx, my + 5); g.lineTo(mj.mcx, my + SBH - 5);
    g.stroke();
    if (mj.err <= mj.tol * 2){
      g.fillStyle = mj.perfect ? '#252525' : '#b5342b';
      g.font = '10px ui-monospace, Menlo, monospace';
      g.textAlign = 'center'; g.textBaseline = 'bottom';
      var label = mj.perfect ? '准' : (mj.side < 0 ? '偏左' : '偏右');
      g.fillText(label, mj.mcx, my - 4);
    }

    /* 掉落碎片 */
    for (var k = 0; k < stkFall.length; k++){
      var f = stkFall[k];
      g.save();
      g.translate(f.x + f.w / 2, f.y);
      g.rotate(f.rot);
      g.fillStyle = f.c;
      g.fillRect(-f.w / 2, 0, f.w, SBH);
      g.strokeStyle = '#252525'; g.lineWidth = 2;
      g.strokeRect(-f.w / 2 + 1, 1, f.w - 2, SBH - 2);
      g.restore();
    }

    if (stkFlash > 0){
      g.globalAlpha = stkFlash;
      g.strokeStyle = '#ffd166'; g.lineWidth = 4;
      g.beginPath(); g.arc(stkFlashX, SGND - (stkBlocks.length - 1) * SBH + stkCam,
        22 + (1 - stkFlash) * 24, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }

    if (stkPaused && stkRunning){
      g.fillStyle = 'rgba(255,248,232,.88)';
      g.fillRect(0, SH / 2 - 30, SW, 60);
      g.fillStyle = '#252525';
      g.font = '900 26px var(--font-heavy, Georgia, serif)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('暂停 · 点 ▶ 继续', SW / 2, SH / 2);
    }
  }

  function stkEnd(){
    stkDone = true;
    stkRunning = false;
    if (stkRaf){ cancelAnimationFrame(stkRaf); stkRaf = 0; }
    var hN = stkBlocks.length - 1;
    var prevBest = Math.max(stkBest, BEST.get('stack.best'));
    var isBest = hN > prevBest;
    BEST.set('stack.best', hN);
    var r = STK.getBoundingClientRect();
    FX.burst({ left: r.left + r.width * 0.2, top: r.top + r.height * 0.55, width: r.width * 0.6, height: r.height * 0.3 },
      { count: 30, dust: 16, power: 520, size: 10, colors: ['#cdc6b8', '#252525', '#fff8e8'], ringColor: '#f28b82' });
    FX.shake(STK, 7);
    FX.freeze(100);
    SFX.play('stack.fail');
    if (isBest && hN > 0){
      FX.converge(r.left + r.width / 2, r.top + r.height * 0.4,
        { count: 16, radius: 50, colors: ['#ffd166', '#fff8e8'], ringColor: '#ffd166' });
    }
    STK_PANE.classList.add('is-over');
    showVerdict(STK_V, STK_VT, STK_VS, 'v-bad',
      '垒到 ' + hN + ' 层 · ' + stkScore + ' 分' + (isBest ? ' · 新纪录' : '') + ' · 连续对准最多 ' + stkMaxCombo + ' 次', '散');
    MHINT.textContent = '塌了 · 完全没搭上下层 · 对准了砖会变宽';
    stkHud();
    syncLoops();
  }

  function stkFrame(ts){
    if (!stkRunning) return;
    var dt = stkLast ? Math.min(0.05, (ts - stkLast) / 1000) : 0.016;
    stkLast = ts;
    if (!stkPaused && !stkDone && !FX.frozen()) stkUpdate(dt);
    stkDraw();
    stkRaf = requestAnimationFrame(stkFrame);
  }

  /* ---------- 输入：指针 / 键盘同一入口 ---------- */
  function stkPress(){
    if (STK_START.classList.contains('is-on')){ stkGo(); return; }
    stkDrop();
  }

  if (STK_GO) on(STK_GO, 'click', stkGo);
  if (STK_PAUSE) on(STK_PAUSE, 'click', function(){
    if (!stkRunning || stkDone) return;
    stkPaused = !stkPaused;
    MHINT.textContent = stkPaused ? '已暂停 · 点 ▶ 接着垒' : '接着垒 · 空格落砖';
    stkHud(); stkDraw();
  });
  if (STK){
    on(STK, 'pointerdown', function(e){ e.preventDefault(); stkPress(); });
    on(window, 'keydown', function(e){
      if (ctx.current !== 'stack') return;
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (e.repeat) return;                       /* 长按空格不连落 */
      stkPress();
    });

    STK.__probe = function(){
      var top = stkBlocks[stkBlocks.length - 1];
      var j = judge(stkMoving.x, stkMoving.w, top);
      return {
        h: stkBlocks.length - 1, score: stkScore, best: stkBest, combo: stkCombo, maxCombo: stkMaxCombo,
        moving: { x: Math.round(stkMoving.x), w: Math.round(stkMoving.w), center: Math.round(j.mcx), kind: stkMoving.kind },
        top: { x: Math.round(top.x), w: Math.round(top.w), center: Math.round(j.tcx) },
        cam: Math.round(stkCam), camT: Math.round(stkCamT),
        run: stkRunning, paused: stkPaused, done: stkDone,
        tier: stkTier, tierLabel: TIERS[stkTier].label,
        omega: Math.round(stkOmega * 100) / 100,
        periodMs: Math.round(2 * Math.PI / stkOmega * 1000),
        amp: Math.round(stkAmp), tol: j.tol, err: Math.round(j.err * 10) / 10,
        drops: stkFall.map(function(f){
          return { x: Math.round(f.x), w: Math.round(f.w), y: Math.round(f.y), whole: !!f.whole };
        })
      };
    };
    /* 验收用：离线判定阈值映射（不参与玩法） */
    STK.__judge = function(errPx, topW){
      var tol = Math.max(7, Math.min(16, Math.round(topW * 0.14)));
      return { tol: tol, perfect: Math.abs(errPx) <= tol, near: Math.abs(errPx) <= tol * 1.8 };
    };
    /* 验收用：节奏 / 特殊砖排期表（不参与玩法） */
    STK.__schedule = function(n){
      var t = tierFor(Math.max(0, n - 1));
      return { kind: brickKind(n), tier: t, omega: TIERS[t].omega, periodMs: Math.round(2 * Math.PI / TIERS[t].omega * 1000) };
    };
  }

  return {
    open(){ stkReset(true); },
    stop: stkStop,
    close: stkStop,
    fit: stkFit,
    replay(){ stkReset(false); },
    loops(){ return stkRunning ? ['stack'] : []; },
    suspend(){
      if (!stkRunning) return null;
      stkStop();
      return function(){ stkRunning = true; stkLast = 0; stkRaf = requestAnimationFrame(stkFrame); };
    }
  };
}
