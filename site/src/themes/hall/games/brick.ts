/* 07 砖块：八乘八空盘，每次发三块；整行整列填满就消，消满十行成，三块放不下散。
 *
 * 本轮品质升级（只动本文件 + 同目录 brick.css）：
 *  - 链路单一数据源：预览与落子共用同一个 canPlace(shape,r,c)，锚点同为所点格子；
 *    触屏点到不可落点时给红闪 + bad 音，不再静默无反应。
 *  - 策略深度：形状花名册扩充（T/S/Z/L/P/U 等）、十字双消加成、连击乘区按"连消手"
 *    累计、每清 4 行落一颗障碍石（占格、随线一起消），改变落子规划。
 *  - 消行演出分层：单行按格碎 + 轨道闪；双消/三消错峰两拍，第二拍才震屏；
 *    粒子对每个格子单独取 rect 错峰撒，不对整行调一次 burst。
 *  - 探针钩子：#brkBoard.__probe / __place / __seed / __setPieces。
 *
 * 规则红线未动：8×8、每轮三块、整行整列消除、双消三消判定、十行获胜、三块放不下失败。 */
// @ts-nocheck
import '../games/brick.css';

export function mountBrick(ctx){
  const {
    on, later, FX, SFX, MHINT, BEST,
    comboState, comboBump, comboBreak, comboMult,
    hudSet, showVerdict, fmtStars
  } = ctx;

  var BOARD = document.getElementById('brkBoard');
  var TRAY = document.getElementById('brkTray');
  var BRK_ROWS = document.getElementById('brkRows');
  var BRK_GOAL = document.getElementById('brkGoal');
  var BRK_HAND = document.getElementById('brkHand');
  var BRK_V = document.getElementById('brkVerdict');
  var BRK_VT = document.getElementById('brkVText');
  var BRK_VS = document.getElementById('brkVSeal');
  var BRK_PANE = document.getElementById('pane-brick');
  var BRK_SCORE = document.getElementById('brkScore');
  var BRK_COMBO = document.getElementById('brkCombo');

  var BN = 8, BGOAL = 10;

  /* 形状花名册：0/1 矩阵。探针回传矩阵本身，不依赖下标。 */
  var SHAPES = [
    [[1]],                                            // 0 单块
    [[1,1]],                                          // 1 横二
    [[1],[1]],                                        // 2 竖二
    [[1,1,1]],                                        // 3 横三
    [[1],[1],[1]],                                    // 4 竖三
    [[1,1,1,1]],                                      // 5 横四
    [[1],[1],[1],[1]],                                // 6 竖四
    [[1,1],[1,1]],                                    // 7 方块 2×2
    [[1,1,1],[1,1,1]],                                // 8 2×3 横
    [[1,1],[1,1],[1,1]],                              // 9 3×2 竖
    [[1,0],[1,0],[1,1]],                              // 10 L 竖
    [[1,1],[1,0],[1,0]],                              // 11 反 L
    [[0,1],[0,1],[1,1]],                              // 12 J 竖
    [[1,1,1],[0,1,0]],                                // 13 T
    [[1,1,1],[1,0,1]],                                // 14 U
    [[1,0],[1,1]],                                    // 15 L 二折
    [[0,1],[1,1]],                                    // 16 反二折
    [[1,1],[0,1]],                                    // 17 三折
    [[1,1,0],[0,1,1]],                                // 18 S
    [[0,1,1],[1,1,0]],                                // 19 Z
    [[1,1],[1,1],[1,0]]                               // 20 P 竖
  ];

  var bGrid = [];
  var bPieces = [];
  var bSel = -1;
  var bRows = 0, bHand = 0;
  var bDone = false, bWin = false, bLock = false, bAlive = true;
  var bHover = null;
  var bScore = 0, bBest = 0, bMaxCombo = 0;
  var bCombo = comboState(4200, 9);
  var bLinesLast = 0, bLastKind = '';
  var bLastStoneRows = -1;
  var timers = [];

  /* ---------- 共用小工具 ---------- */

  function laterSafe(fn, ms){
    var id = later(function(){ if (bAlive) fn(); }, ms);
    timers.push(id);
    return id;
  }

  function killTimers(){
    timers.forEach(function(id){ try { clearTimeout(id); } catch(e){} });
    timers = [];
  }

  function cellColor(v){
    if (v === 'k0') return '#ffd166';
    if (v === 'k1') return '#9cc7f5';
    if (v === 'k2') return '#a8c7a0';
    if (v === 'k3') return '#f4b9b3';
    return '#c9c2b0';
  }

  function countFilled(){
    var n = 0;
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++) if (bGrid[r][c].v) n++;
    return n;
  }

  /* 判定唯一入口：预览、落子、死局检测全部走这里，杜绝"预览能放、落子不行"。 */
  function canPlace(shape, r0, c0){
    for (var r = 0; r < shape.length; r++){
      for (var c = 0; c < shape[r].length; c++){
        if (!shape[r][c]) continue;
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= BN || cc < 0 || cc >= BN) return false;
        if (bGrid[rr][cc].v) return false;
      }
    }
    return true;
  }

  function anyPlace(shape){
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++){
      if (canPlace(shape, r, c)) return true;
    }
    return false;
  }

  function bHudScore(){
    hudSet(BRK_SCORE, bScore);
    FX.combo(BRK_COMBO, Math.max(1, bCombo.n));
  }

  /* ---------- 棋盘 DOM ---------- */

  function makeCell(r, c){
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'bcell';
    el.setAttribute('data-r', String(r));
    el.setAttribute('data-c', String(c));
    el.setAttribute('aria-label', '第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 格');
    on(el, 'click', function(){ dropAt(r, c); });
    on(el, 'pointerenter', function(){ bHover = { r: r, c: c }; paintPreview(); });
    BOARD.appendChild(el);
    return { v: '', el: el };
  }

  /* 盘级监听只挂一次，避免每开一局叠一层 mouseleave。 */
  on(BOARD, 'mouseleave', function(){ bHover = null; paintPreview(); });

  function clearCellDOM(cell){
    cell.v = '';
    cell.el.classList.remove('is-on', 'is-clear', 'is-track', 'is-ok', 'is-bad',
      'is-stone', 'k0', 'k1', 'k2', 'k3');
  }

  function startBrick(){
    killTimers();
    BOARD.innerHTML = '';
    TRAY.innerHTML = '';
    bGrid = []; bPieces = [];
    bSel = -1; bRows = 0; bHand = 0;
    bDone = false; bWin = false; bLock = false; bAlive = true;
    bHover = null; bScore = 0; bMaxCombo = 0;
    bCombo = comboState(4200, 9);
    bLinesLast = 0; bLastKind = ''; bLastStoneRows = -1;
    bBest = BEST.get('brick.score');
    BRK_ROWS.textContent = '0';
    BRK_GOAL.textContent = String(BGOAL);
    BRK_HAND.textContent = '0';
    hudSet(BRK_SCORE, 0);
    FX.combo(BRK_COMBO, 1);
    BRK_V.classList.remove('is-on');
    BRK_PANE.classList.remove('is-over');
    BRK_VS.className = 'verdict-seal';
    BRK_VS.textContent = '';
    MHINT.textContent = '点一块砖，再点盘上落下去';

    for (var r = 0; r < BN; r++){
      var row = [];
      for (var c = 0; c < BN; c++) row.push(makeCell(r, c));
      bGrid.push(row);
    }
    dealPieces();
    paintPreview();
  }

  /* ---------- 托盘 ---------- */

  function dealPieces(){
    bPieces = [];
    for (var i = 0; i < 3; i++){
      /* 难度靠发牌抬：前四行不给 2×3 大块；消到第 7 行之后反而多给大块。 */
      var pool = SHAPES.slice();
      if (bRows < 4) pool = pool.filter(function(_s, ix){ return ix !== 8; });
      if (bRows >= 7) pool = pool.concat([SHAPES[8], SHAPES[8], SHAPES[5]]);
      var s = pool[Math.floor(Math.random() * pool.length)];
      bPieces.push({ shape: s, used: false, k: Math.floor(Math.random() * 4) });
    }
    bSel = -1;
    renderTray();
  }

  function renderTray(){
    TRAY.innerHTML = '';
    bPieces.forEach(function(p, i){
      var wrap = document.createElement('button');
      wrap.type = 'button';
      var cls = 'bpiece' + (p.used ? ' is-used' : '') + (i === bSel ? ' is-on' : '');
      if (!p.used && !anyPlace(p.shape)) cls += ' is-stuck';
      wrap.className = cls;
      if (p.used) wrap.setAttribute('disabled', 'disabled');
      wrap.setAttribute('aria-label', '拿起第 ' + (i + 1) + ' 块砖');
      var w = p.shape[0].length, h = p.shape.length;
      wrap.style.setProperty('--w', String(w));
      wrap.style.setProperty('--h', String(h));
      var cells = [];
      for (var r = 0; r < h; r++){
        for (var c = 0; c < w; c++){
          cells.push('<i' + (p.shape[r][c] ? ' class="on"' : '') + '></i>');
        }
      }
      wrap.innerHTML = '<span class="bp-grid">' + cells.join('') + '</span>';
      on(wrap, 'click', function(){
        if (bDone || bLock || p.used) return;
        bSel = (bSel === i ? -1 : i);
        renderTray();
        paintPreview();
        MHINT.textContent = bSel < 0 ? '点一块砖，再点盘上落下去' : '现在点盘子上的格子';
      });
      TRAY.appendChild(wrap);
    });
  }

  /* ---------- 预览 ---------- */

  function paintPreview(){
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++){
      bGrid[r][c].el.classList.remove('is-ok', 'is-bad');
    }
    if (bSel < 0 || bDone || bLock) return;
    var p = bPieces[bSel];
    if (!p || p.used) return;
    var at = bHover || { r: 0, c: 0 };
    var ok = canPlace(p.shape, at.r, at.c);
    for (var r2 = 0; r2 < p.shape.length; r2++){
      for (var c2 = 0; c2 < p.shape[r2].length; c2++){
        if (!p.shape[r2][c2]) continue;
        var tr = at.r + r2, tc = at.c + c2;
        if (tr < 0 || tr >= BN || tc < 0 || tc >= BN) continue;
        var cell = bGrid[tr][tc];
        if (cell.v) continue; /* 已占格不盖预览色 */
        cell.el.classList.add(ok ? 'is-ok' : 'is-bad');
      }
    }
  }

  /* 点到不可落点：目标空格红闪一拍 + bad 音，选中保留。 */
  function flashBad(shape, r0, c0){
    var tagged = [];
    for (var r = 0; r < shape.length; r++){
      for (var c = 0; c < shape[r].length; c++){
        if (!shape[r][c]) continue;
        var tr = r0 + r, tc = c0 + c;
        if (tr < 0 || tr >= BN || tc < 0 || tc >= BN) continue;
        var cell = bGrid[tr][tc];
        if (cell.v) continue;
        cell.el.classList.remove('is-ok');
        cell.el.classList.add('is-bad');
        tagged.push(cell.el);
      }
    }
    laterSafe(function(){
      tagged.forEach(function(el){ el.classList.remove('is-bad'); });
    }, 200);
  }

  /* ---------- 落子 ---------- */

  function dropAt(r, c){
    if (bDone || bLock || bSel < 0) return;
    var p = bPieces[bSel];
    if (!p || p.used) return;
    if (!canPlace(p.shape, r, c)){
      SFX.play('brick.bad', { rate: 0.9 });
      flashBad(p.shape, r, c);
      return;
    }

    var placed = 0;
    for (var rr = 0; rr < p.shape.length; rr++){
      for (var cc = 0; cc < p.shape[rr].length; cc++){
        if (!p.shape[rr][cc]) continue;
        var cell = bGrid[r + rr][c + cc];
        cell.v = 'k' + p.k;
        cell.el.classList.add('is-on', 'k' + p.k);
        placed++;
      }
    }
    bScore += placed * 5;
    SFX.play('brick.place', { gain: Math.min(1.4, 0.55 + placed * 0.12) });
    p.used = true;
    bSel = -1;
    bHand++;
    BRK_HAND.textContent = String(bHand);
    bHudScore();
    renderTray();
    paintPreview();

    var cleared = resolveLines();

    /* 三块都放完才补新的；消行动画收尾后再做死局检测。 */
    if (bPieces.every(function(x){ return x.used; })){
      laterSafe(function(){ if (!bDone) dealPieces(); }, 90);
    }
    if (!cleared) checkStuck();
  }

  /* ---------- 消行 ---------- */

  function findLines(){
    var rows = [], cols = [];
    for (var i = 0; i < BN; i++){
      var rf = true, cf = true;
      for (var j = 0; j < BN; j++){
        if (!bGrid[i][j].v) rf = false;
        if (!bGrid[j][i].v) cf = false;
      }
      if (rf) rows.push(i);
      if (cf) cols.push(i);
    }
    return { rows: rows, cols: cols };
  }

  function resolveLines(){
    var found = findLines();
    var rows = found.rows, cols = found.cols;
    var nLines = rows.length + cols.length;
    if (!nLines){
      comboBreak(bCombo);
      bHudScore();
      bLinesLast = 0; bLastKind = '';
      return 0;
    }

    bLock = true;
    bLinesLast = nLines;
    var cross = rows.length > 0 && cols.length > 0;
    bLastKind = nLines >= 3 ? 'triple' : nLines === 2 ? (cross ? 'cross' : 'double') : 'single';

    /* 收集被消的格子（行列交叉只算一次） */
    var flag = [];
    for (var r0 = 0; r0 < BN; r0++){ flag.push(new Array(BN).fill(false)); }
    rows.forEach(function(r){ for (var c = 0; c < BN; c++) flag[r][c] = true; });
    cols.forEach(function(c){ for (var r = 0; r < BN; r++) flag[r][c] = true; });
    var cells = [];
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++){
      if (flag[r][c]) cells.push([r, c]);
    }
    cells.forEach(function(rc){
      bGrid[rc[0]][rc[1]].el.classList.add('is-clear', 'is-track');
    });

    /* 计分：单行基础 120，双行 150/行，三行及以上 180/行；十字交叉另加。 */
    comboBump(bCombo, 1);
    bMaxCombo = Math.max(bMaxCombo, bCombo.n);
    var mult = comboMult(bCombo);
    var base = nLines === 1 ? 120 : nLines === 2 ? 150 : 180;
    var gain = base * nLines * mult;
    if (cross) gain += 60 * mult;
    bScore += gain;

    /* 演出编排：单行一拍按格碎；双消/三消两拍，第二拍才震屏。 */
    var lineCols = ['#252525', '#ffd166', '#9cc7f5', '#f28b82', '#a8c7a0'];
    var groups = [];
    rows.forEach(function(r){
      var g = [];
      for (var c = 0; c < BN; c++) g.push([r, c]);
      groups.push(g);
    });
    cols.forEach(function(c){
      var g = [];
      for (var r = 0; r < BN; r++) g.push([r, c]);
      groups.push(g);
    });

    function shatterCell(rc, delay, color){
      laterSafe(function(){
        var el = bGrid[rc[0]][rc[1]].el;
        var rect = el.getBoundingClientRect();
        FX.burst(rect, {
          count: 3, dust: 1, power: 230, gravity: 880,
          size: Math.max(3, Math.min(rect.width, rect.height) * 0.22),
          ring: false, flash: false,
          colors: [color, '#252525', '#fff8e8']
        });
      }, delay);
    }

    var multi = nLines >= 2;
    groups.forEach(function(g, gi){
      var beat = multi && gi >= 1 ? 120 : 0;   /* 第二拍错峰 */
      g.forEach(function(rc, ci){
        shatterCell(rc, beat + ci * 14, cellColor(bGrid[rc[0]][rc[1]].v));
      });
    });

    var bc = BOARD.getBoundingClientRect();
    var label = '+' + gain;
    if (nLines >= 3) label = '三消 +' + gain + ' ×' + mult;
    else if (cross) label = '十字 +' + gain + ' ×' + mult;
    else if (nLines === 2) label = '双消 +' + gain + ' ×' + mult;

    SFX.play(nLines >= 2 ? 'brick.combo' : 'brick.clear',
      { rate: 1 + Math.min(0.6, (nLines - 1) * 0.12) });

    if (multi){
      /* 重大：第二拍震屏 + 环 + 余烬；三消给一记短停顿 */
      laterSafe(function(){
        FX.shake(BOARD, nLines >= 3 ? 5 : 3);
        FX.ring(bc.left + bc.width / 2, bc.top + bc.height / 2, 10, bc.width * 0.5, 4, '#ffd166');
        FX.rise(bc.left + bc.width / 2, bc.top + bc.height * 0.4, 10 + nLines * 4, ['#ffd166', '#fff8e8']);
      }, 120);
      if (nLines >= 3) FX.freeze(60);
      FX.pop(bc.left + bc.width / 2, bc.top + bc.height * 0.44, label, 'is-gold');
    } else {
      FX.shake(BOARD, 2);
      FX.pop(bc.left + bc.width / 2, bc.top + bc.height * 0.44, label, '');
    }
    bHudScore();

    var clearDelay = multi ? 420 : 320;
    laterSafe(function(){
      cells.forEach(function(rc){
        var cell = bGrid[rc[0]][rc[1]];
        cell.v = '';
        cell.el.classList.remove('is-on', 'is-clear', 'is-track', 'is-stone', 'k0', 'k1', 'k2', 'k3');
      });
      bLock = false;
      bRows += nLines;
      BEST.set('brick.rows', bRows);
      BRK_ROWS.textContent = String(bRows);

      /* 满盘：整盘清空的唯一时刻 */
      if (!countFilled()){
        bScore += 600;
        SFX.play('brick.full');
        FX.ring(bc.left + bc.width / 2, bc.top + bc.height / 2, 10, bc.width * 0.55, 4, '#ffd166');
        FX.rise(bc.left + bc.width / 2, bc.top + bc.height * 0.3, 20, ['#ffd166', '#fff8e8', '#a8c7a0']);
        FX.pop(bc.left + bc.width / 2, bc.top + bc.height * 0.42, '满盘 +600', 'is-gold');
        bHudScore();
      }

      maybeSpawnStones();

      if (bRows >= BGOAL){ winGame(); return; }

      if (nLines >= 3) MHINT.textContent = '三消 · 一手三条线，已清 ' + bRows + ' 行';
      else if (cross) MHINT.textContent = '十字 · 一行一列同消，已清 ' + bRows + ' 行';
      else if (nLines === 2) MHINT.textContent = '双消 · 一手两条线，已清 ' + bRows + ' 行';
      else MHINT.textContent = '已清 ' + bRows + ' 行 · 还差 ' + (BGOAL - bRows) + ' 行';

      checkStuck();
    }, clearDelay);

    return nLines;
  }

  /* ---------- 障碍格：每清 4 行落 1–2 颗石头 ---------- */

  function stoneCount(){
    var n = 0;
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++) if (bGrid[r][c].v === 'stone') n++;
    return n;
  }

  function maybeSpawnStones(){
    if (bRows <= 0 || bRows % 4 !== 0 || bRows === bLastStoneRows) return;
    bLastStoneRows = bRows;
    var empties = [];
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++){
      if (!bGrid[r][c].v) empties.push([r, c]);
    }
    if (!empties.length) return;
    var n = Math.min(2, empties.length, 8 - stoneCount());
    for (var i = 0; i < n; i++){
      var ix = Math.floor(Math.random() * empties.length);
      var rc = empties.splice(ix, 1)[0];
      var cell = bGrid[rc[0]][rc[1]];
      cell.v = 'stone';
      cell.el.classList.add('is-on', 'is-stone');
      var rect = cell.el.getBoundingClientRect();
      FX.burst(rect, { count: 4, dust: 2, power: 160, gravity: 620, size: 4, ring: false, flash: false, colors: ['#c9c2b0', '#252525'] });
    }
    SFX.play('brick.place', { rate: 0.7, gain: 0.5 });
    FX.pop(BOARD.getBoundingClientRect().left + BOARD.getBoundingClientRect().width / 2,
      BOARD.getBoundingClientRect().top + 20, '障碍落下 · 随线同消', '');
  }

  /* ---------- 胜负 ---------- */

  function checkStuck(){
    if (bDone) return;
    var left = bPieces.filter(function(x){ return !x.used; });
    if (!left.length) return;
    var any = left.some(function(x){ return anyPlace(x.shape); });
    renderTray();
    if (any) return;
    bDone = true; bWin = false;
    comboBreak(bCombo);
    bHudScore();
    BEST.set('brick.score', bScore);
    BRK_PANE.classList.add('is-over');
    showVerdict(BRK_V, BRK_VT, BRK_VS, 'v-bad',
      '放不下了 · ' + bRows + ' 行 / ' + bScore + ' 分收场', '散');
    MHINT.textContent = '散了 · 盘子塞满，再来一次';
  }

  function winGame(){
    bDone = true; bWin = true;
    BRK_PANE.classList.add('is-over');
    var bh = BEST.get('brick.best');
    var prevBest = Math.max(bBest, BEST.get('brick.score'));
    BEST.setMin('brick.best', bHand);
    BEST.set('brick.score', bScore);
    var stars = bHand <= 22 ? 3 : bHand <= 30 ? 2 : 1;
    showVerdict(BRK_V, BRK_VT, BRK_VS, 'v-ok',
      fmtStars(stars) + ' 清了 ' + bRows + ' 行 · ' + bHand + ' 手 · ' + bScore + ' 分'
      + (bh && bh < bHand ? '（最少 ' + bh + ' 手）' : (bScore > prevBest ? ' · 新纪录' : '')), '成');
    MHINT.textContent = '清满了 · 最多 ' + bMaxCombo + ' 连击';
  }

  /* ---------- 探针钩子 ---------- */

  function snapshot(){
    return {
      cells: BN * BN,
      grid: bGrid.map(function(row){ return row.map(function(cell){ return cell.v; }); }),
      pieces: bPieces.map(function(p){
        return { shape: p.shape, used: p.used, stuck: !p.used && !anyPlace(p.shape) };
      }),
      rows: bRows, goal: BGOAL, hand: bHand, score: bScore,
      combo: bCombo.n, maxCombo: bMaxCombo,
      done: bDone, win: bWin, lose: bDone && !bWin,
      linesLast: bLinesLast, lastKind: bLastKind,
      stones: stoneCount(), locked: bLock
    };
  }

  BOARD.__probe = function(){ return snapshot(); };

  /* 探针用：代码自身的落点判定（预览与落子共用的同一入口）。 */
  BOARD.__canPlace = function(i, r, c){
    var p = bPieces[i];
    return !!p && !p.used && canPlace(p.shape, r, c);
  };

  BOARD.__place = function(i, r, c){
    if (bDone || bLock || !bPieces[i] || bPieces[i].used) return { placed: false, ok: false };
    bSel = i;
    var ok = canPlace(bPieces[i].shape, r, c);
    dropAt(r, c);
    return { placed: ok, ok: ok };
  };

  /* 测试布阵：list = [[r, c, kind], ...]，kind 为 k0..k3 或 stone。
   * 只清棋盘格与残局态；累计行数 / 手数 / 分数不在此复位（胜利场景靠多次消行累积）。 */
  BOARD.__seed = function(list){
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++) clearCellDOM(bGrid[r][c]);
    (list || []).forEach(function(item){
      var r = item[0], c = item[1], kind = item[2];
      var cell = bGrid[r][c];
      cell.v = kind;
      cell.el.classList.add('is-on');
      if (kind === 'stone') cell.el.classList.add('is-stone');
      else cell.el.classList.add(kind);
    });
    bSel = -1; bHover = null;
    bDone = false; bWin = false; bLock = false;
    BRK_PANE.classList.remove('is-over');
    BRK_V.classList.remove('is-on');
    BRK_VS.className = 'verdict-seal';
    BRK_VS.textContent = '';
    renderTray(); paintPreview();
  };

  BOARD.__setPieces = function(shapes){
    bPieces = shapes.map(function(s){ return { shape: s, used: false, k: Math.floor(Math.random() * 4) }; });
    bSel = -1;
    renderTray(); paintPreview();
  };

  /* 探针用：按当前托盘与盘面复算死局（正常流程在落子 / 消行收尾后自动调）。 */
  BOARD.__checkStuck = function(){ checkStuck(); return snapshot(); };

  /* 探针用：整局复位（等价「再来一次」），清盘清分清连击。 */
  BOARD.__reset = function(){ startBrick(); };

  /* ---------- 尺寸适配 ---------- */

  function fit(){
    var b = document.getElementById('brkBoard');
    if (!b || !b.parentElement) return;
    var host = b.parentElement;
    var aw = host.clientWidth, ah = host.clientHeight;
    if (aw < 80 || ah < 80) return;
    var side = window.innerWidth <= 900
      ? Math.floor(Math.min(aw, ah * 0.74))
      : Math.floor(Math.min(ah, aw - 190));
    if (side < 80) return;
    b.style.width = side + 'px';
    b.style.height = side + 'px';
  }

  function stop(){ bAlive = false; }
  function close(){ bAlive = false; bHover = null; bSel = -1; killTimers(); }

  return {
    open: startBrick,
    stop: stop,
    close: close,
    replay: startBrick,
    fit: fit
  };
}
