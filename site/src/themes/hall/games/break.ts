/* 06 破砖：拖板接球、点一下发球；碎砖得分，金砖加球、蓝砖分裂、绿砖加宽、装甲多血、连锁引燃。七关。 */
// @ts-nocheck
import '../games/break.css';

export function mountBreak(ctx){
  const {
    on, later, FX, SFX, MHINT, mReplayLabel, BEST, bindPad, FINEPOINTER,
    comboState, comboAdd, comboMult, comboBreak, hudSet, showVerdict
  } = ctx;
  /* syncLoops 由引擎在挂载之后回填，这里走 ctx 实时取值，不解构快照 */
  function syncLoops(){ if (ctx.syncLoops) ctx.syncLoops(); }

  var BK = document.getElementById('bkCanvas');
  var BK_STAGE = document.getElementById('bkStage');
  var BK_NAIL = document.getElementById('bkLeft');
  var BK_TOTAL = document.getElementById('bkTotal');
  var BK_LIFE = document.getElementById('bkLife');
  var BK_LV = document.getElementById('bkLv');
  var BK_LVN = document.getElementById('bkLvn');
  var BK_V = document.getElementById('bkVerdict');
  var BK_VT = document.getElementById('bkVText');
  var BK_VS = document.getElementById('bkVSeal');
  var BK_PANE = document.getElementById('pane-break');
  var BK_SCORE = document.getElementById('bkScore');
  var BK_COMBO = document.getElementById('bkCombo');

  /* ---------- 逻辑坐标常量（与显示尺寸无关） ---------- */
  var BW = 480, BH = 430;
  var BK_COLS = 13;
  var BK_PAD_W = 76, BK_PAD_H = 12;
  var BK_PAD_Y = BH - 24;
  var bkPadW = BK_PAD_W, bkWideT = 0;
  function padMin(){ return bkPadW / 2 - 4; }
  function padMax(){ return BW - bkPadW / 2 + 4; }
  var BK_BRICK_GAP = 2, BK_BRICK_TOP = 24, BK_BRICK_H = 16;
  var BK_BRICK_PITCH = BK_BRICK_H + BK_BRICK_GAP;
  var BK_BALL_R = 5.5;
  var BK_MAXAIM = 0.55;          // 发球最大倾角（rad）
  /* 接球点出射角：板心 0° → 板边 ±0.95 rad（约 54°）。角度仍由接球点决定，
     这里只负责把"撞砖侧面被打成水平"的死球拉回来（见 enforceVertical）。 */
  var PAD_MAX_ANG = 0.95;
  var MIN_VY_RATIO = 0.30;       // 反弹后最小纵向分量比例，低于即判为贴地死球
  var BK_MAX_BALLS = 6;
  /* 子步上限：每帧位移切成不超过 6px 的小段（砖高 16、球半径 5.5），
     高速帧也不会整段跳过一块砖。 */
  var SUBSTEP_MAX = 6;

  /* ---------- 七关：map 十三字符一行（1 有砖、0 空） ----------
     armorRows 底部几行装甲；armorHp 装甲血量；gold/split/wide/chain 特殊砖数量；
     balls 初始库存。难度递增靠空隙结构与特殊砖布局，不是单纯堆密。 */
  var BKLEVELS = [
    { name: '入门实墙', /* 满墙普通砖，熟悉反弹与接球 */
      map: ['1111111111111','1111111111111','1111111111111','1111111111111','1111111111111','1111111111111','1111111111111','1111111111111'],
      armorRows: 0, armorHp: 0, gold: 1, split: 0, wide: 0, chain: 0, balls: 11 },
    { name: '双眼镂空', /* 上下对称两个菱形孔，练斜线落位 */
      map: ['1111111111111','1111111111111','1111101011111','1111111111111','1111011101111','1111111111111','1111101011111','1111111111111'],
      armorRows: 0, armorHp: 0, gold: 2, split: 1, wide: 0, chain: 0, balls: 11 },
    { name: '拱门', /* 上宽下窄的中央通道，底部一行装甲拦路 */
      map: ['1111111111111','1111111111111','1111100011111','1111110111111','1111111111111','1111110111111','1111101011111','1111111111111'],
      armorRows: 1, armorHp: 2, gold: 2, split: 1, wide: 1, chain: 0, balls: 12 },
    { name: '棋盘', /* 交错镂空，散放连锁砖，第一次体验引燃 */
      map: ['1111111111111','1101101101101','1111111111111','1011011011011','1111111111111','1101101101101','1111111111111','1011011011011','1111111111111'],
      armorRows: 1, armorHp: 2, gold: 2, split: 2, wide: 1, chain: 3, balls: 12 },
    { name: '三竖道', /* 三条纵向贯通缝，中间一簇连锁砖，底部三血装甲 */
      map: ['1111111111111','1111111111111','1110011100111','1110011100111','1111101011111','1110011100111','1110011100111','1111111111111','1111111111111'],
      armorRows: 1, armorHp: 3, gold: 3, split: 2, wide: 0, chain: 4, balls: 14 },
    { name: '堡垒', /* 两侧翼墙 + 中轴窄廊，两行三血装甲守底 */
      map: ['1111111111111','1111111111111','1101111111011','1101111111011','1101101011011','1101111111011','1101111111011','1111111111111','1111111111111'],
      armorRows: 2, armorHp: 3, gold: 3, split: 2, wide: 1, chain: 3, balls: 13 },
    { name: '终局', /* 上下镜像密墙 + 中央十字孔，全砖种混合 */
      map: ['1111111111111','1110011100111','1111111111111','1111101011111','1110011100111','1111101011111','1111111111111','1110011100111','1111111111111'],
      armorRows: 2, armorHp: 3, gold: 3, split: 2, wide: 1, chain: 4, balls: 14 }
  ];

  /* 砖种：0 普通 / 1 金砖(+1球) / 2 分裂(蓝,×3) / 3 宽板(绿) / 4 装甲 / 5 连锁 */
  var KIND = { PLAIN: 0, GOLD: 1, SPLIT: 2, WIDE: 3, ARMOR: 4, CHAIN: 5 };

  var bkCtx = null, bkWallCv = null, bkWallCtx = null, bkWallDirty = true;
  var bkRaf = 0, bkLast = 0, bkRunning = false, bkDone = false, bkWin = false;
  var bkKeys = { left: false, right: false };
  var bkPx = BW / 2, bkPxPrev = BW / 2, bkPadV = 0, bkAim = 0;
  var bkBalls = [], bkBricks = [], bkItems = [];
  var bkLeft = 0, bkTotal = 0, bkStock = 0, bkLv = 0, bkHitT = 0, bkNote = '', bkShots = 0;
  var bkScore = 0, bkBest = 0, bkMaxCombo = 0;
  var bkCombo = comboState(4000, 10);
  var bkTimers = [];
  var bkBrickSeq = 0;

  function bkHudScore(){
    hudSet(BK_SCORE, bkScore);
    FX.combo(BK_COMBO, bkCombo.n);
  }

  function laterTrack(fn, ms){
    var id = later(fn, ms);
    bkTimers.push(id);
    return id;
  }
  function clearTimers(){
    while (bkTimers.length){ clearTimeout(bkTimers.pop()); }
  }

  /* ---------- 尺寸适配 ---------- */
  function bkFitBreak(){
    var st = BK_STAGE;
    if (!st || !st.parentElement) return;
    var host = st.parentElement;
    var pane = host.closest ? host.closest('.pane') : null;
    var aw = host.clientWidth || (pane || host).clientWidth;
    var ah = (pane || host).clientHeight;
    if (pane){
      var used = 0;
      Array.prototype.forEach.call(pane.children, function(ch){
        if (ch === host) return;
        var cs = window.getComputedStyle(ch);
        if (cs.position === 'absolute' || cs.display === 'none') return;
        used += ch.getBoundingClientRect().height + 8;
      });
      ah -= used + 8;
    }
    if (aw < 80 || ah < 80) return;
    st.style.width = Math.floor(Math.min(aw, ah * (BW / BH))) + 'px';
  }

  function bkFit(){
    if (!BK) return;
    bkFitBreak();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = BK.clientWidth || BW;
    BK.width = Math.round(cw * dpr);
    BK.height = Math.round(cw * (BH / BW) * dpr);
    bkCtx = BK.getContext('2d');
    var s = BK.width / BW;
    bkCtx.setTransform(s, 0, 0, s, 0, 0);
    bkWallCv = bkWallCv || document.createElement('canvas');
    bkWallCv.width = BK.width;
    bkWallCv.height = BK.height;
    bkWallCtx = bkWallCv.getContext('2d');
    if (bkWallCtx) bkWallCtx.setTransform(s, 0, 0, s, 0, 0);
    bkWallDirty = true;
    /* 改画布尺寸会把它清空。循环停着的时候（已收场 / 刚开机）没人重画，
       窗口一变台面就成一张白纸 —— 这里补一帧。 */
    if (!bkRunning) bkDraw();
  }

  function bkHud(){
    if (BK_NAIL) BK_NAIL.textContent = String(bkLeft);
    if (BK_TOTAL) BK_TOTAL.textContent = String(bkTotal);
    if (BK_LIFE) BK_LIFE.textContent = String(bkStock);
    if (BK_LV) BK_LV.textContent = String(bkLv + 1);
    if (BK_LVN) BK_LVN.textContent = String(BKLEVELS.length);
    bkHudScore();
  }

  /* ---------- 排墙 ---------- */
  function bkDeck(){
    var spec = BKLEVELS[bkLv];
    bkBricks = [];
    bkItems = [];
    bkBalls = [];
    bkAim = 0;
    bkPx = BW / 2;
    bkPxPrev = BW / 2;
    bkPadV = 0;
    bkPadW = BK_PAD_W;
    bkWideT = 0;
    var map = spec.map;
    var rows = map.length;
    var gp = BK_BRICK_GAP, top = BK_BRICK_TOP, h = BK_BRICK_H;
    var cw = (BW - gp * (BK_COLS + 1)) / BK_COLS;
    var r, c;
    for (r = 0; r < rows; r++){
      var isArmor = r >= rows - spec.armorRows;
      for (c = 0; c < BK_COLS; c++){
        if (map[r].charAt(c) !== '1') continue;
        var kind = isArmor ? KIND.ARMOR : KIND.PLAIN;
        bkBricks.push({
          id: ++bkBrickSeq,
          x: gp + c * (cw + gp),
          y: top + r * (h + gp),
          w: cw, h: h,
          hp: isArmor ? spec.armorHp : 1,
          maxHp: isArmor ? spec.armorHp : 1,
          kind: kind,
          row: r, col: c,
          on: true, flash: 0
        });
      }
    }
    /* 特殊砖等距定点撒在非装甲砖上（不随机，关卡难度才可比） */
    var plain = [];
    for (var i = 0; i < bkBricks.length; i++) if (bkBricks[i].kind !== KIND.ARMOR) plain.push(i);
    function pickSlots(n){
      var out = [];
      for (var k = 0; k < n; k++) out.push(plain[Math.floor((k + 1) * plain.length / (n + 1))]);
      return out;
    }
    var gi = 0;
    var gold = pickSlots(Math.min(spec.gold, plain.length));
    var rest = plain.filter(function(idx){ return gold.indexOf(idx) < 0; });
    var split = [], wide = [], chain = [];
    function take(list, n, src){
      for (var k = 0; k < Math.min(n, src.length); k++) list.push(src.shift());
    }
    take(split, Math.min(spec.split, rest.length), rest);
    take(wide, Math.min(spec.wide, rest.length), rest);
    take(chain, Math.min(spec.chain, rest.length), rest);
    gold.forEach(function(idx){ bkBricks[idx].kind = KIND.GOLD; });
    split.forEach(function(idx){ bkBricks[idx].kind = KIND.SPLIT; });
    wide.forEach(function(idx){ bkBricks[idx].kind = KIND.WIDE; });
    chain.forEach(function(idx){ bkBricks[idx].kind = KIND.CHAIN; });

    bkTotal = bkBricks.length;
    bkLeft = bkTotal;
    bkStock = spec.balls;
    bkHitT = 0;
    bkWallDirty = true;
    bkHud();
  }

  function bkSpeed(){
    return Math.min(450 + bkLv * 11, 540);
  }

  /* ---------- 发球 ---------- */
  function bkFire(){
    if (bkDone || bkStock <= 0 || bkBalls.length >= BK_MAX_BALLS) return;
    bkStock--;
    bkHud();
    var sp = bkSpeed();
    var tilt = bkAim;
    if (Math.abs(tilt) < 0.05) tilt = (bkShots++ % 2 ? 0.14 : -0.14);
    bkBalls.push({
      x: bkPx, y: BK_PAD_Y - BK_PAD_H / 2 - 7,
      vx: Math.sin(tilt) * sp, vy: -Math.cos(tilt) * sp,
      sp: sp, r: BK_BALL_R, idle: 0, lastBrick: 0
    });
    MHINT.textContent = bkNote = '球出去了 · 还剩 ' + bkStock + ' 颗';
    SFX.play('break.fire');
  }

  function spawnBall(x, y, vx, vy){
    if (bkBalls.length >= BK_MAX_BALLS) return false;
    var sp = bkSpeed();
    var m = Math.hypot(vx, vy) || 1;
    bkBalls.push({ x: x, y: y, vx: vx / m * sp, vy: vy / m * sp, sp: sp, r: BK_BALL_R, idle: 0, lastBrick: 0 });
    return true;
  }

  /* ---------- 砖色与视口矩形 ---------- */
  function bkFill(br){
    switch (br.kind){
      case KIND.GOLD: return '#ffd166';
      case KIND.SPLIT: return '#f28b82';
      case KIND.WIDE: return '#e3dcc8';
      case KIND.CHAIN: return '#fff8e8';
      case KIND.ARMOR: return br.maxHp >= 3 ? '#b5aa95' : '#cdc6b8';
      /* 普通砖用站内那支蓝：原来那抹薄荷绿是全站唯一一处绿，整面墙一片绿，
         跟纸黄 / 墨黑 / 朱砂的调子对不上，看着像另一个游戏。 */
      /* 同一面蓝墙按行分深浅：顶行最深、越靠下越浅。一整面 104 块同一个蓝读起来是一块色板，
         有了这 8% 的明暗阶，墙才有"厚度"，打穿时缺口也一眼能认出来。 */
      default: return bkRowTone(br.row);
    }
  }
  var BK_TONE_TOP = [132, 182, 238], BK_TONE_BOT = [170, 208, 248];
  function bkRowTone(row){
    var t = Math.max(0, Math.min(1, row / 8));
    return 'rgb(' + Math.round(BK_TONE_TOP[0] + (BK_TONE_BOT[0] - BK_TONE_TOP[0]) * t) + ',' +
      Math.round(BK_TONE_TOP[1] + (BK_TONE_BOT[1] - BK_TONE_TOP[1]) * t) + ',' +
      Math.round(BK_TONE_TOP[2] + (BK_TONE_BOT[2] - BK_TONE_TOP[2]) * t) + ')';
  }
  function bkLabel(br){
    switch (br.kind){
      case KIND.GOLD: return '+1';
      case KIND.SPLIT: return '×3';
      case KIND.WIDE: return '宽';
      case KIND.CHAIN: return '链';
      /* 一滴血的砖不必在脸上写个「1」：整面墙几百个 1 全是噪声，只有要打好几下的才配数字 */
      default: return br.maxHp > 1 ? String(br.hp) : '';
    }
  }

  function bkRect(br){
    if (!BK) return null;
    var r = BK.getBoundingClientRect();
    var sx = r.width / BW, sy = r.height / BH;
    return { left: r.left + br.x * sx, top: r.top + br.y * sy, width: br.w * sx, height: br.h * sy };
  }
  function ballRect(b){
    if (!BK) return null;
    var r = BK.getBoundingClientRect();
    var sx = r.width / BW, sy = r.height / BH;
    return { left: r.left + (b.x - b.r) * sx, top: r.top + (b.y - b.r) * sy, width: b.r * 2 * sx, height: b.r * 2 * sy };
  }

  /* ---------- 碎砖 / 连锁 / 掉落 ---------- */
  function bkDropItem(br){
    if (br.kind === KIND.GOLD) bkItems.push({ x: br.x + br.w / 2, y: br.y + br.h / 2, kind: 1 });
    else if (br.kind === KIND.SPLIT) bkItems.push({ x: br.x + br.w / 2, y: br.y + br.h / 2, kind: 2 });
    else if (br.kind === KIND.WIDE) bkItems.push({ x: br.x + br.w / 2, y: br.y + br.h / 2, kind: 3 });
  }

  /* 一次碎砖的反馈档位：普通=火花；重要=条状碎块+飘分；重大=错峰两拍+环+拖尾 */
  function smashVisual(br, wave){
    var col = bkFill(br);
    var rect = bkRect(br);
    var armor = br.kind === KIND.ARMOR;
    var major = wave >= 3;
    if (major){
      /* 重大：环 + 主体碎 + 飘字，错峰两拍交给 chainWave */
      FX.burst(rect, {
        count: 22, dust: 10, power: 500, gravity: 760,
        colors: [col, col, '#252525', '#fff8e8'], ring: true
      });
      FX.ring(rect.left + rect.width / 2, rect.top + rect.height / 2,
        Math.max(8, rect.width * 0.3), rect.width * 1.1, 3, '#ffd166');
    } else {
      FX.burst(rect, {
        count: armor ? 18 : 13, dust: armor ? 8 : 5, power: 460, gravity: 780,
        colors: [col, col, '#252525', '#fff8e8'], ring: armor
      });
    }
    if (armor){ FX.shake(BK, 3); FX.freeze(55); }
  }

  function damageBrick(br, depth, wave){
    if (!br.on) return false;
    br.hp--;
    br.flash = 1;
    bkHitT = 1;
    bkWallDirty = true;
    comboAdd(bkCombo);
    bkMaxCombo = Math.max(bkMaxCombo, bkCombo.n);

    if (br.hp > 0){
      /* 没打穿：只擦火星，不给碎块 */
      SFX.play('break.hit', { rate: 1.06 });
      FX.sparks(bkRect(br), 4, '#fff8e8');
      bkHudScore();
      return false;
    }

    /* 打穿 */
    var armor = br.kind === KIND.ARMOR;
    SFX.play(armor ? 'break.stone' : 'break.smash', { rate: 1 + Math.min(0.5, bkCombo.n * 0.05) });
    smashVisual(br, wave);

    var base = armor ? 250 : (br.kind === KIND.CHAIN ? 180 : br.kind === KIND.SPLIT ? 150 : 100);
    var mult = comboMult(bkCombo);
    var gain = base * mult;
    bkScore += gain;
    var rect = bkRect(br);
    if (rect) FX.pop(rect.left + rect.width / 2, rect.top - 2, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 4 ? 'is-gold' : '');

    br.on = false;
    bkLeft--;
    bkHud();
    bkDropItem(br);

    /* 分裂砖：击碎当场再裂出一颗球（库存上限内），×3 道具仍掉落 */
    if (br.kind === KIND.SPLIT){
      spawnBall(br.x + br.w / 2, br.y + br.h / 2, (br.col % 2 ? -0.55 : 0.55), -0.85);
    }

    /* 连锁砖：引燃四邻，深度封顶 2 层，避免一砖扫光整墙 */
    if (br.kind === KIND.CHAIN && depth < 2){
      var neighbors = bkBricks.filter(function(o){
        return o.on && (o.row === br.row && Math.abs(o.col - br.col) === 1 || o.col === br.col && Math.abs(o.row - br.row) === 1);
      });
      neighbors.forEach(function(o, k){
        laterTrack(function(){ damageBrick(o, depth + 1, wave + 1); }, 60 + k * 55);
      });
    }
    return true;
  }

  function bkCatch(kind){
    SFX.play('break.item', { rate: kind === 1 ? 1.18 : (kind === 3 ? 0.92 : 1.06) });
    var r = BK.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.bottom - 26;
    if (kind === 1){
      bkStock++;
      bkNote = '接住一颗球 · 现在 ' + bkStock + ' 颗';
      FX.rise(cx, cy, 10, ['#ffd166', '#fff8e8']);
      FX.pop(cx, cy - 18, '+1 球', 'is-gold');
    } else if (kind === 3){
      bkPadW = Math.min(126, bkPadW + 28);
      bkWideT = 9;
      bkNote = '接住宽板 · 板子加宽 9 秒';
      FX.rise(cx, cy, 10, ['#b7d3a8', '#fff8e8']);
      FX.pop(cx, cy - 18, '宽板', '');
    } else {
      bkNote = '接住 ×3 · 裂出两颗';
      var sp = bkSpeed();
      spawnBall(bkPx, BK_PAD_Y - BK_PAD_H / 2 - 7, -0.42, -0.91);
      spawnBall(bkPx, BK_PAD_Y - BK_PAD_H / 2 - 7, 0.42, -0.91);
      FX.rise(cx, cy, 12, ['#f28b82', '#fff8e8']);
      FX.pop(cx, cy - 18, '×3 分裂', '');
    }
    bkHud();
    MHINT.textContent = bkNote;
  }

  /* ---------- 物理 ---------- */
  /* 圆 vs 矩形：返回最近点法向与穿透深度；未接触返回 null */
  function circleRect(b, br){
    var nx = Math.max(br.x, Math.min(b.x, br.x + br.w));
    var ny = Math.max(br.y, Math.min(b.y, br.y + br.h));
    var dx = b.x - nx, dy = b.y - ny;
    var d2 = dx * dx + dy * dy;
    if (d2 > b.r * b.r) return null;
    if (dx !== 0 || dy !== 0){
      var d = Math.sqrt(d2) || 0.0001;
      return { nx: dx / d, ny: dy / d, depth: b.r - d };
    }
    /* 球心在砖内：按最小穿透轴弹出 */
    var pL = b.x - br.x + b.r, pR = br.x + br.w - b.x + b.r;
    var pT = b.y - br.y + b.r, pB = br.y + br.h - b.y + b.r;
    var m = Math.min(pL, pR, pT, pB);
    if (m === pL) return { nx: -1, ny: 0, depth: pL };
    if (m === pR) return { nx: 1, ny: 0, depth: pR };
    if (m === pT) return { nx: 0, ny: -1, depth: pT };
    return { nx: 0, ny: 1, depth: pB };
  }

  /* 反弹后保证最小纵向分量：方向被压平到接近水平时，按原水平符号抬回阈值，
     不改速度大小，也不改接球点决定的出射角（这里只修砖/墙反弹造成的水平化）。 */
  function enforceVertical(b){
    var minVy = b.sp * MIN_VY_RATIO;
    if (Math.abs(b.vy) >= minVy) return;
    var sy = b.vy < 0 ? -1 : 1;
    if (b.vy === 0) sy = -1;
    b.vy = sy * minVy;
    var vx = Math.sqrt(Math.max(0, b.sp * b.sp - b.vy * b.vy));
    b.vx = (b.vx < 0 ? -1 : 1) * vx;
  }

  function normalizeSpeed(b){
    var cur = Math.hypot(b.vx, b.vy) || 0.0001;
    b.vx = b.vx / cur * b.sp;
    b.vy = b.vy / cur * b.sp;
  }

  function bounceBrick(b, br, hit){
    b.x += hit.nx * (hit.depth + 0.4);
    b.y += hit.ny * (hit.depth + 0.4);
    var vn = b.vx * hit.nx + b.vy * hit.ny;
    if (vn < 0){
      b.vx -= 2 * vn * hit.nx;
      b.vy -= 2 * vn * hit.ny;
    }
    enforceVertical(b);
    normalizeSpeed(b);
    b.lastBrick = br.id;
    damageBrick(br, 0, 1);
    b.idle = 0;
  }

  function collideBricks(b){
    for (var i = 0; i < bkBricks.length; i++){
      var br = bkBricks[i];
      if (!br.on || br.id === b.lastBrick) continue;
      var hit = circleRect(b, br);
      if (hit){ bounceBrick(b, br, hit); return; }
    }
  }

  function collidePad(b){
    if (b.vy <= 0) return;
    var px = bkPx - bkPadW / 2, py = BK_PAD_Y - BK_PAD_H / 2;
    if (b.x + b.r < px || b.x - b.r > px + bkPadW) return;
    if (b.y + b.r < py || b.y - b.r > py + BK_PAD_H) return;
    var off = (b.x - bkPx) / (bkPadW / 2);
    off = Math.max(-1, Math.min(1, off));
    if (Math.abs(off) < 0.26) off = (off < 0 ? -0.26 : 0.26);
    var ang = off * PAD_MAX_ANG;
    b.vx = Math.sin(ang) * b.sp;
    b.vy = -Math.cos(ang) * b.sp;
    b.y = py - b.r - 0.6;
    b.idle = 0;
    SFX.play('break.pad', { rate: 1 + Math.abs(off) * 0.1, gain: 0.9 - Math.abs(off) * 0.25 });
  }

  function bkStep(ms){
    /* 宽板到期：缓缓收回标准宽度 */
    if (bkWideT > 0){
      bkWideT -= ms;
      if (bkWideT <= 0 && bkPadW > BK_PAD_W) bkPadW = Math.max(BK_PAD_W, bkPadW - 60 * ms);
      if (bkWideT < 0){ bkWideT = 0; bkPadW = BK_PAD_W; }
    }
    if (bkKeys.left) bkPx -= 300 * ms;
    if (bkKeys.right) bkPx += 300 * ms;
    bkPx = Math.max(padMin(), Math.min(padMax(), bkPx));
    bkPadV = (bkPx - bkPxPrev) / (ms || 0.016);
    bkPxPrev = bkPx;
    var tilt = Math.max(-BK_MAXAIM, Math.min(BK_MAXAIM, bkPadV * 0.0026));
    bkAim = bkAim * 0.82 + tilt * 0.18;

    /* 掉落物 */
    for (var i = bkItems.length - 1; i >= 0; i--){
      var it = bkItems[i];
      it.y += 5.6 * (ms * 1000 / 16.7);
      if (it.y >= BK_PAD_Y - BK_PAD_H / 2 - 9 && it.y <= BK_PAD_Y + BK_PAD_H && Math.abs(it.x - bkPx) <= bkPadW / 2 + 8){
        bkCatch(it.kind);
        bkItems.splice(i, 1);
        continue;
      }
      if (it.y > BH) bkItems.splice(i, 1);
    }

    for (var bi = bkBalls.length - 1; bi >= 0; bi--){
      var b = bkBalls[bi];
      var stepx = b.vx * ms, stepy = b.vy * ms;
      var sub = Math.max(1, Math.ceil(Math.max(Math.abs(stepx), Math.abs(stepy)) / SUBSTEP_MAX));
      if (sub > 12) sub = 12;
      b.idle += ms;
      var dead = false;
      for (var k = 0; k < sub; k++){
        b.x += stepx / sub;
        b.y += stepy / sub;

        /* 三面墙 */
        if (b.x - b.r < 0){ b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x + b.r > BW){ b.x = BW - b.r; b.vx = -Math.abs(b.vx); }
        if (b.y - b.r < 0){ b.y = b.r; b.vy = Math.abs(b.vy); }

        collideBricks(b);
        collidePad(b);

        if (b.y - b.r > BH){ dead = true; break; }
      }
      if (b.lastBrick && b.idle > 0.25) b.lastBrick = 0;

      /* 拖尾：连击抬高时加长球拖尾（重大档反馈）。
         FX 层认视口坐标：球的位置是 480×430 的逻辑坐标，先换算再交给它，
         否则拖尾会画在台面左上角之外的页面上。 */
      if (bkCombo.n >= 3 && bkRunning){
        var tr = BK.getBoundingClientRect();
        FX.trail(tr.left + b.x * (tr.width / BW), tr.top + b.y * (tr.height / BH),
          bkCombo.n >= 5 ? 'rgba(242,139,130,.5)' : 'rgba(37,37,37,.4)', bkCombo.n >= 5 ? 6 : 4);
      }

      if (b.idle > 12) dead = true;
      if (dead){
        bkBalls.splice(bi, 1);
        bkHitT = 1;
        comboBreak(bkCombo);
        bkHudScore();
        if (!bkDone) MHINT.textContent = '漏了一颗 · 还剩 ' + bkStock + ' 颗';
      }
    }

    if (!bkLeft){ bkEnd(true); return; }
    if (!bkBalls.length && !bkStock) bkEnd(false);
  }

  /* ---------- 绘制 ---------- */
  function bkPaintBrick(c, br){
    var fill = bkFill(br);
    c.fillStyle = fill;
    c.fillRect(br.x, br.y, br.w, br.h);
    if (br.flash > 0){
      c.fillStyle = 'rgba(255,248,232,.5)';
      c.fillRect(br.x, br.y, br.w, br.h);
    }
    c.strokeStyle = '#252525';
    c.lineWidth = 1.5;
    c.strokeRect(br.x + 0.75, br.y + 0.75, br.w - 1.5, br.h - 1.5);
    /* 装甲裂纹：按剩余血量画 1–2 道折线 */
    if (br.kind === KIND.ARMOR && br.hp < br.maxHp){
      c.strokeStyle = 'rgba(37,37,37,.65)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(br.x + br.w * 0.2, br.y + br.h * 0.25);
      c.lineTo(br.x + br.w * 0.5, br.y + br.h * 0.55);
      if (br.hp === 1){ c.lineTo(br.x + br.w * 0.75, br.y + br.h * 0.3); }
      c.stroke();
    }
    c.fillStyle = '#252525';
    c.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(bkLabel(br), br.x + br.w / 2, br.y + br.h / 2 + 1);
  }

  function bkPaintWall(){
    if (!bkWallCtx) return;
    bkWallCtx.clearRect(0, 0, BW, BH);
    for (var i = 0; i < bkBricks.length; i++) if (bkBricks[i].on) bkPaintBrick(bkWallCtx, bkBricks[i]);
    bkWallDirty = false;
  }

  function bkDrawPaddle(){
    var x = bkPx - bkPadW / 2, y = BK_PAD_Y - BK_PAD_H / 2;
    bkCtx.fillStyle = bkWideT > 0 ? '#3f6b3a' : '#252525';
    bkCtx.fillRect(x, y, bkPadW, BK_PAD_H);
    bkCtx.fillStyle = '#fff8e8';
    bkCtx.fillRect(x + 4, y + 4, bkPadW - 8, BK_PAD_H - 8);
    bkCtx.fillStyle = '#252525';
    bkCtx.fillRect(bkPx - 1, y + 5, 2, BK_PAD_H - 10);
    if (bkWideT > 0){
      bkCtx.fillStyle = '#b7d3a8';
      bkCtx.fillRect(x + 4, y + BK_PAD_H - 4, (bkPadW - 8) * Math.min(1, bkWideT / 9), 2);
    }
  }

  function bkDraw(){
    if (!bkCtx) return;
    bkCtx.clearRect(0, 0, BW, BH);
    if (bkWallCv){
      if (bkWallDirty) bkPaintWall();
      bkCtx.drawImage(bkWallCv, 0, 0, BW, BH);
    } else {
      for (var w0 = 0; w0 < bkBricks.length; w0++) if (bkBricks[w0].on) bkPaintBrick(bkCtx, bkBricks[w0]);
    }
    for (var i = 0; i < bkItems.length; i++){
      var it = bkItems[i];
      bkCtx.beginPath();
      bkCtx.arc(it.x, it.y, 9, 0, Math.PI * 2);
      bkCtx.fillStyle = it.kind === 1 ? '#ffd166' : (it.kind === 3 ? '#b7d3a8' : '#f28b82');
      bkCtx.fill();
      bkCtx.strokeStyle = '#252525';
      bkCtx.lineWidth = 2;
      bkCtx.stroke();
      bkCtx.fillStyle = '#252525';
      bkCtx.font = 'bold 10px ui-monospace, monospace';
      bkCtx.textAlign = 'center';
      bkCtx.textBaseline = 'middle';
      bkCtx.fillText(it.kind === 1 ? '+1' : (it.kind === 3 ? '宽' : '×3'), it.x, it.y + 1);
    }

    if (!bkDone && bkStock > 0 && !bkBalls.length){
      bkCtx.strokeStyle = 'rgba(37,37,37,.45)';
      bkCtx.lineWidth = 2;
      bkCtx.setLineDash([5, 7]);
      bkCtx.beginPath();
      bkCtx.moveTo(bkPx, BK_PAD_Y - BK_PAD_H / 2 - 8);
      bkCtx.lineTo(bkPx + Math.sin(bkAim) * 90, BK_PAD_Y - BK_PAD_H / 2 - 8 - Math.cos(bkAim) * 90);
      bkCtx.stroke();
      bkCtx.setLineDash([]);
    }

    bkDrawPaddle();

    for (i = 0; i < bkBalls.length; i++){
      var b = bkBalls[i];
      bkCtx.beginPath();
      bkCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      bkCtx.fillStyle = bkHitT > 0.7 ? '#ffffff' : '#252525';
      bkCtx.fill();
      bkCtx.strokeStyle = '#252525';
      bkCtx.lineWidth = 2;
      bkCtx.stroke();
    }

    bkCtx.strokeStyle = 'rgba(37,37,37,.22)';
    bkCtx.lineWidth = 1;
    bkCtx.setLineDash([6, 6]);
    bkCtx.beginPath();
    bkCtx.moveTo(0, BH - 2);
    bkCtx.lineTo(BW, BH - 2);
    bkCtx.stroke();
    bkCtx.setLineDash([]);
  }

  function bkFrame(ts){
    if (!bkRunning) return;
    if (!bkLast) bkLast = ts;
    var dt = Math.min(ts - bkLast, 40);
    bkLast = ts;
    if (bkHitT > 0) bkHitT = Math.max(0, bkHitT - dt / 90);
    /* 砖面闪光衰减：闪光未退完期间墙层每帧重画，淡出才看得见 */
    for (var i = 0; i < bkBricks.length; i++){
      var br = bkBricks[i];
      if (br.flash > 0){ br.flash = Math.max(0, br.flash - dt / 120); bkWallDirty = true; }
    }
    if (!bkDone) bkStep(dt / 1000);
    bkDraw();
    bkRaf = requestAnimationFrame(bkFrame);
  }

  /* ---------- 关卡 / 生命周期 ---------- */
  function bkStage(){
    if (!BK) return;
    bkDone = false;
    bkWin = false;
    bkRunning = true;
    bkNote = '';
    bkHitT = 0;
    clearTimers();
    BK_PANE.classList.remove('is-over');
    BK_V.classList.remove('is-on');
    BK_VS.className = 'verdict-seal';
    BK_VS.textContent = '';
    MHINT.textContent = '拖动板子接球 · 点一下发球（接球的位置决定角度）';
    bkFit();
    bkDeck();
    bkDraw();
    bkLast = 0;
    if (bkRaf) cancelAnimationFrame(bkRaf);
    bkRaf = requestAnimationFrame(bkFrame);
    if (syncLoops) syncLoops();
    laterTrack(function(){ if (bkRunning && BK && BK.clientWidth) bkFit(); }, 140);
    /* 关卡开场印章：关名 + 第几关。七关的墙形各有名字（拱门 / 棋盘 / 堡垒……），
       以前只写在代码注释里，玩家看不到 —— 盖在墙正中，等弹层的入场动画走完再落。 */
    laterTrack(function(){
      if (!bkRunning || bkDone || !BK) return;
      var r = BK.getBoundingClientRect();
      FX.stamp(r.left + r.width / 2, r.top + r.height * 0.56,
        '第 ' + (bkLv + 1) + ' 关 · ' + BKLEVELS[bkLv].name,
        { size: Math.max(22, Math.min(34, r.width / 14)), color: '#b5342b', hold: 1300, rot: -4 });
    }, 300);
  }

  function bkStart(){
    bkLv = 0;
    bkScore = 0;
    bkMaxCombo = 0;
    bkBest = BEST.get('break.score');
    bkCombo = comboState(4000, 10);
    bkHudScore();
    bkStage();
  }
  function bkNext(){ bkLv = (bkLv >= BKLEVELS.length - 1) ? 0 : bkLv + 1; bkStage(); }

  function bkStop(){
    bkRunning = false;
    clearTimers();
    if (bkRaf){ cancelAnimationFrame(bkRaf); bkRaf = 0; }
    if (syncLoops) syncLoops();
  }

  function bkEnd(win){
    bkDone = true;
    bkWin = win;
    bkRunning = false;
    bkBalls = [];
    bkItems = [];
    clearTimers();
    if (bkRaf){ cancelAnimationFrame(bkRaf); bkRaf = 0; }
    BK_PANE.classList.add('is-over');
    var last = bkLv >= BKLEVELS.length - 1;
    var prevBest = Math.max(bkBest, BEST.get('break.score'));
    if (bkScore > prevBest) BEST.set('break.score', bkScore);
    var scoreLine = ' · ' + bkScore + ' 分' + (bkScore > prevBest && bkScore > 0 ? '（新纪录）' : '');
    if (win){
      if (last){
        showVerdict(BK_V, BK_VT, BK_VS, 'v-ok', '七关全清 · 还剩 ' + bkStock + ' 颗球' + scoreLine, '满');
        MHINT.textContent = '七关全清 · ' + bkMaxCombo + ' 最高连击';
        mReplayLabel('从头再来');
      } else {
        showVerdict(BK_V, BK_VT, BK_VS, 'v-ok', '第 ' + (bkLv + 1) + ' 关打光 · 剩 ' + bkStock + ' 颗球' + scoreLine, '成');
        MHINT.textContent = '打光了 · 点「下一关」';
        mReplayLabel('下一关');
      }
    } else {
      showVerdict(BK_V, BK_VT, BK_VS, 'v-bad', '第 ' + (bkLv + 1) + ' 关散了 · 还剩 ' + bkLeft + ' 块' + scoreLine, '散');
      MHINT.textContent = '散了 · 球用完了，本关重来';
      mReplayLabel('重开本关');
    }
    bkDraw();
  }

  /* ---------- 输入 ---------- */
  function pointerX(clientX){
    if (!BK) return;
    var rect = BK.getBoundingClientRect();
    var x = (clientX - rect.left) / rect.width * BW;
    bkPx = Math.max(padMin(), Math.min(padMax(), x));
  }
  var bkTouch = null, bkPtrId = null;
  on(BK, 'pointerdown', function(e){
    pointerX(e.clientX);
    bkPtrId = e.pointerId;
    try { BK.setPointerCapture(e.pointerId); } catch (_) {}
    bkTouch = { x: e.clientX, y: e.clientY, drag: false };
  });
  on(BK, 'pointermove', function(e){
    if (bkPtrId !== null && e.pointerId !== bkPtrId) return;
    if (bkPtrId === null && !FINEPOINTER) return;
    pointerX(e.clientX);
    if (bkTouch && (Math.abs(e.clientX - bkTouch.x) > 8 || Math.abs(e.clientY - bkTouch.y) > 8)) bkTouch.drag = true;
  });
  function releaseCap(e){
    try { if (BK && e.pointerId != null && BK.hasPointerCapture && BK.hasPointerCapture(e.pointerId)) BK.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  function endPointer(e){
    if (bkPtrId !== null && e.pointerId !== bkPtrId) return;
    releaseCap(e);
    if (bkTouch && !bkTouch.drag) bkFire();
    bkTouch = null;
    bkPtrId = null;
  }
  on(BK, 'pointerup', endPointer);
  on(BK, 'pointercancel', function(e){ releaseCap(e); bkTouch = null; bkPtrId = null; });

  bindPad('breakPad', function(key){
    if (key === 'fire'){ bkFire(); return; }
    bkPx = Math.max(padMin(), Math.min(padMax(), bkPx + (key === 'l' ? -34 : 34)));
  }, 60);
  on(window, 'resize', function(){ if (BK && BK.clientWidth) bkFit(); });
  on(window, 'keydown', function(e){
    if (ctx.current !== 'break') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') bkKeys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') bkKeys.right = true;
    if (e.key === ' '){ e.preventDefault(); bkFire(); }
  });
  on(window, 'keyup', function(e){
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') bkKeys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') bkKeys.right = false;
  });

  /* ---------- 验收探针（不参与玩法） ---------- */
  function probeStats(){
    var kinds = { plain: 0, gold: 0, split: 0, wide: 0, armor: 0, chain: 0 };
    bkBricks.forEach(function(br){
      if (!br.on) return;
      if (br.kind === KIND.GOLD) kinds.gold++;
      else if (br.kind === KIND.SPLIT) kinds.split++;
      else if (br.kind === KIND.WIDE) kinds.wide++;
      else if (br.kind === KIND.ARMOR) kinds.armor++;
      else if (br.kind === KIND.CHAIN) kinds.chain++;
      else kinds.plain++;
    });
    return kinds;
  }
  function bkProbe(){
    var lo = null, i;
    for (i = 0; i < bkBalls.length; i++) if (!lo || bkBalls[i].y > lo.y) lo = bkBalls[i];
    return {
      bx: lo ? lo.x : bkPx, by: lo ? lo.y : BK_PAD_Y,
      vx: lo ? lo.vx : 0, vy: lo ? lo.vy : 0,
      px: bkPx, padW: bkPadW, padY: BK_PAD_Y,
      aim: bkAim,
      left: bkLeft, total: bkTotal, lives: bkStock, level: bkLv + 1, levels: BKLEVELS.length,
      balls: bkBalls.length, items: bkItems.length,
      score: bkScore, combo: bkCombo.n, wide: Math.round(bkWideT * 10) / 10,
      kinds: probeStats(),
      drops: bkItems.map(function(it){ return { x: it.x, y: it.y, kind: it.kind }; }),
      stay: bkBricks.filter(function(br){ return br.on; }).map(function(br){
        return { x: br.x, y: br.y, w: br.w, h: br.h, hp: br.hp, stone: br.kind === KIND.ARMOR ? 1 : 0, kind: br.kind };
      }),
      stuck: bkBalls.length === 0, run: bkRunning, done: bkDone, win: bkWin
    };
  }
  if (BK) BK.__probe = bkProbe;
  if (BK_STAGE) BK_STAGE.__probe = bkProbe;
  if (BK) BK.__jump = function(n){ bkLv = Math.max(0, Math.min(BKLEVELS.length - 1, n)); bkStage(); };
  /* 验收用：直接触发一次道具接取效果（不参与玩法） */
  if (BK) BK.__reward = function(kind){ bkCatch(kind); };
  /* 验收用：直接收场（不参与玩法） */
  if (BK) BK.__finish = function(win){ bkEnd(!!win); };
  /* 验收用：在板面中央生成一个下落道具（不参与玩法） */
  if (BK) BK.__drop = function(kind){
    bkItems.push({ x: BW / 2 + (kind === 2 ? 46 : -46), y: 120 + (kind === 2 ? 34 : 0), kind: kind || 1 });
  };
  /* 验收用：真实的接球点 → 出射角映射（不参与玩法） */
  if (BK) BK.__padAngle = function(off){
    off = Math.max(-1, Math.min(1, off));
    if (Math.abs(off) < 0.26) off = off < 0 ? -0.26 : 0.26;
    var ang = off * PAD_MAX_ANG;
    var sp = bkSpeed();
    return { off: Math.round(off * 1000) / 1000, ang: Math.round(ang * 1000) / 1000,
      vx: Math.sin(ang) * sp, vy: -Math.cos(ang) * sp, sp: sp };
  };
  if (BK) BK.__bench = function(n){
    n = n || 60;
    if (!bkCtx || !bkWallCtx) return null;
    var t0, i;
    t0 = performance.now();
    for (i = 0; i < n; i++){ bkWallDirty = true; bkPaintWall(); }
    var fromScratch = (performance.now() - t0) / n;
    t0 = performance.now();
    for (i = 0; i < n; i++) bkCtx.drawImage(bkWallCv, 0, 0, BW, BH);
    var blit = (performance.now() - t0) / n;
    return { bricks: bkBricks.length, on: bkBricks.filter(function(b){ return b.on; }).length,
      fromScratch: Math.round(fromScratch * 1000) / 1000, blit: Math.round(blit * 1000) / 1000 };
  };

  return {
    open: bkStart,
    stop: bkStop,
    close: bkStop,
    fit: bkFit,
    replay(){ if (bkWin) bkNext(); else bkStage(); },
    loops(){ return bkRunning ? ['break'] : []; },
    suspend(){
      if (!bkRunning) return null;
      bkStop();
      return function(){ bkRunning = true; bkLast = 0; bkRaf = requestAnimationFrame(bkFrame); };
    }
  };
}
