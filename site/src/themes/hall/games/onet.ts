/* 08 连字：两张同字之间 ≤2 拐的空路连通即收；三关，每关两次洗牌、两次提示。
 *
 * 本轮精品化：
 *  · 连线走「真实走出来的折线」：FX.flashPath 沿路径逐段点亮，先亮路、再收牌；
 *    走外圈留白绕行的路线用另一色区分；拐角落在空路格中心，不穿牌。
 *  · 三关不同思考重点：L1 开阔直连；L2 局部墙障回廊；L3 两厢隔墙 + 门边/外圈连接。
 *  · 反馈分层：选中=普通；配对=重要（折线 + 两端碎裂）；连击/成词=重大（环 / 词条印章）。
 *  · 边界加固：所有盘面访问都做行/列存在性校验，不再读 undefined[1]。
 * 规则红线：最多两拐、外圈留白、三关牌数 8×6 / 8×8 / 10×8、无解兜底（洗牌 + 拆对开洞）。 */
// @ts-nocheck
import '../games/onet.css';

export function mountOnet(ctx){
  const {
    on, later, FX, SFX, MHINT, mReplayLabel, BEST, WORDS,
    themeOf, themeChars, markTheme, markIcon, shuffle,
    comboState, comboAdd, comboMult, hudSet, showVerdict
  } = ctx;

  /* 本地整词挑选：只取两字词（三国名里夹着「太史慈」三字词，混进来会凑不齐成对字数）。
     凑不满 pairCount 个字就返回 null，交回单字循环兜底。 */
  function pickThemeWords(key, pairCount){
    var t = WORDS[key] || WORDS.sanguo;
    var words = (t.words || []).filter(function(w){ return w.length === 2; });
    var out = [], pick = [];
    for (var i = 0; i < words.length; i++){
      if (out.length + words[i].length > pairCount) continue;
      pick.push(words[i]);
      for (var k = 0; k < words[i].length; k++) out.push(words[i].charAt(k));
      if (out.length === pairCount) return { words: pick, chars: out };
    }
    return null;
  }

  /* 三关：格子数是红线；walls 是本关固定的不可用格（内坐标 1..cols / 1..rows）。
     L2 中心方块 + 右侧竖缝，逼玩家绕空处；L3 中缝隔墙，只留上下门边与外圈可跨厢。 */
  var ONET_LV = [
    { cols: 8, rows: 6, name: '暖场', theme: 'shanshui', hint: '点两张相同的字 · 两拐之内能连通才收走', walls: [] },
    { cols: 8, rows: 8, name: '回廊', theme: 'qiwu', hint: '回廊有墙挡路 · 绕空处走，最多两拐',
      walls: [[4,4],[4,5],[5,4],[5,5],[2,7],[3,7],[4,7],[5,7]] },
    { cols: 10, rows: 8, name: '满盘', theme: 'sanguo', hint: '两厢隔一道墙 · 走门边或外圈连通',
      walls: [[2,6],[3,6],[4,6],[5,6],[6,6],[7,6],[4,3],[5,8]] }
  ];

  var ONET_GRID = document.getElementById('onetGrid');
  var ONET_STAGE = document.getElementById('onetStage');
  var ONET_SVG = document.getElementById('onetPath');
  var ONET_LINE = document.getElementById('onetLine');
  var ONET_LEFT = document.getElementById('onetLeft');
  var ONET_LV_EL = document.getElementById('onetLv');
  var ONET_LVN = document.getElementById('onetLvn');
  var ONET_SH = document.getElementById('onetShuffle');
  var ONET_SH_BTN = document.getElementById('onetShuffleBtn');
  var ONET_V = document.getElementById('onetVerdict');
  var ONET_VT = document.getElementById('onetVText');
  var ONET_VS = document.getElementById('onetVSeal');
  var ONET_PANE = document.getElementById('pane-onet');
  var ONET_THEME = document.getElementById('onetTheme');
  var ONET_WORDS = document.getElementById('onetWords');
  var ONET_WORDS_WRAP = document.getElementById('onetWordsWrap');
  var ONET_SCORE = document.getElementById('onetScore');
  var ONET_COMBO = document.getElementById('onetCombo');
  var ONET_HINTS = document.getElementById('onetHints');
  var ONET_HINT_BTN = document.getElementById('onetHintBtn');

  var oWords = [], oWordsDone = 0, oRemain = {};

  var oCols = 8, oRows = 6, oLv = 0, oPairs = 0, oShuffles = 2;
  var oBoard = [], oWall = [], oTiles = [], oSel = null, oLock = false, oBusy = false, oDone = false, oWin = false;
  /* 分数 / 连击 / 提示：连击窗口 5 秒（连字是慢游戏，窗口不能跟抽词一样短）；
     提示每关 2 次，只"点出一对能连的"，不动手也不改盘。 */
  var oScore = 0, oBest = 0, oHints = 2, oMaxCombo = 0, oStartPairs = 0;
  var oCombo = comboState(5000, 8);
  if (ONET_LVN) ONET_LVN.textContent = String(ONET_LV.length);

  var CORAL = '#f28b82', BLUE = '#5b7fa8', GOLD = '#ffd166', INK = '#252525';

  function onetFit(){
    if (!ONET_STAGE) return;
    var host = ONET_STAGE.parentElement;
    var aw = host.clientWidth, ah = host.clientHeight;
    if (aw < 80 || ah < 80) return;
    /* 外圈留白只是"能绕边走线"的通道，不该占掉半张牌的位置：
       padding 那一列只给半格，比例按 (cols+1)/(rows+1) 算，牌能大一圈 */
    var ratio = (oCols + 1) / (oRows + 1);
    ONET_STAGE.style.aspectRatio = String(ratio);
    ONET_STAGE.style.width = Math.floor(Math.min(aw, ah * ratio)) + 'px';
  }

  function onetHud(){
    if (ONET_LEFT) ONET_LEFT.textContent = String(oPairs);
    if (ONET_SH) ONET_SH.textContent = String(oShuffles);
    if (ONET_HINTS) ONET_HINTS.textContent = String(oHints);
    if (ONET_LV_EL) ONET_LV_EL.textContent = String(oLv + 1);
    if (ONET_SH_BTN) ONET_SH_BTN.disabled = oShuffles <= 0 || oDone;
    if (ONET_HINT_BTN) ONET_HINT_BTN.disabled = oHints <= 0 || oDone || oLock;
    hudSet(ONET_SCORE, oScore);
    FX.combo(ONET_COMBO, oCombo.n);
  }

  /* ---------- 盘面安全访问：行/列缺失一律按空墙处理，杜绝 undefined[1] ---------- */
  function rowAt(r){ return (oBoard && oBoard[r]) || null; }
  function isWall(r, c){
    var wr = oWall && oWall[r];
    return !!(wr && wr[c]);
  }
  function cellCh(r, c){
    var row = rowAt(r);
    return row ? row[c] : '';
  }

  function onetRender(){
    ONET_GRID.innerHTML = '';
    ONET_GRID.style.gridTemplateColumns = '0.5fr repeat(' + oCols + ', 1fr) 0.5fr';
    ONET_GRID.style.gridTemplateRows = '0.5fr repeat(' + oRows + ', 1fr) 0.5fr';
    oTiles = [];
    for (var r = 0; r < oRows + 2; r++){
      var row = [];
      for (var c = 0; c < oCols + 2; c++){
        var cell = document.createElement('div');
        var wall = isWall(r, c);
        var ch = wall ? '' : cellCh(r, c);
        cell.className = 'o-cell' + (wall ? ' o-wall-cell' : (ch ? '' : ' o-blank'));
        if (ch){
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'o-tile';
          b.textContent = ch;
          markIcon(b, ch);
          b.setAttribute('aria-label', '第 ' + r + ' 行第 ' + c + ' 列的「' + ch + '」');
          b._r = r; b._c = c;
          b.setAttribute('data-r', String(r));
          b.setAttribute('data-c', String(c));
          on(b, 'click', function(){ oPick(this._r, this._c); });
          cell.appendChild(b);
          row.push(b);
        } else {
          row.push(null);
        }
        ONET_GRID.appendChild(cell);
      }
      oTiles.push(row);
    }
  }

  function onetLevel(n){
    oLv = Math.max(0, Math.min(ONET_LV.length - 1, n));
    var spec = ONET_LV[oLv];
    oCols = spec.cols; oRows = spec.rows;
    oShuffles = 2; oHints = 2; oLock = false; oBusy = false; oDone = false; oWin = false; oSel = null;
    oCombo = comboState(5000, 8);
    ONET_PANE.classList.remove('is-over');
    ONET_V.classList.remove('is-on');
    ONET_VS.className = 'verdict-seal';
    ONET_VS.textContent = '';
    ONET_LINE.classList.remove('is-on');
    ONET_LINE.setAttribute('points', '');

    /* 墙格表：外圈留白恒为空路，墙只画在内部 */
    oWall = [];
    for (var wr = 0; wr < oRows + 2; wr++){
      var wrow = [];
      for (var wc = 0; wc < oCols + 2; wc++) wrow.push(false);
      oWall.push(wrow);
    }
    (spec.walls || []).forEach(function(w){
      if (w[0] >= 1 && w[0] <= oRows && w[1] >= 1 && w[1] <= oCols) oWall[w[0]][w[1]] = true;
    });

    /* 可填牌的内部格（排除墙），行-major 收牌；牌数 = 可填格 / 2，保证成对 */
    var fillCells = [];
    for (var r = 1; r <= oRows; r++) for (var c = 1; c <= oCols; c++){
      if (!oWall[r][c]) fillCells.push({ r: r, c: c });
    }
    var pairs = Math.floor(fillCells.length / 2);

    /* 优先按"整词"发牌：清完一对等于拼回一个名字；凑不满才退化成单字循环。 */
    var chars = [], picked = pickThemeWords(spec.theme, pairs);
    oWords = [];
    if (picked){
      oWords = picked.words.map(function(w){
        var cs = [];
        for (var k = 0; k < w.length; k++) cs.push(w.charAt(k));
        return { word: w, chars: cs, done: false };
      });
      chars = picked.chars.slice();
    } else {
      var src = themeChars(spec.theme);
      for (var i0 = 0; i0 < pairs; i0++) chars.push(src[i0 % src.length]);
    }
    oWordsDone = 0;
    oRemain = {};
    chars.forEach(function(c){ oRemain[c] = (oRemain[c] || 0) + 2; });
    markTheme(ONET_PANE, spec.theme);
    if (ONET_THEME) ONET_THEME.textContent = themeOf(spec.theme).name;
    if (ONET_WORDS) ONET_WORDS.textContent = oWords.length ? '0/' + oWords.length : '';
    if (ONET_WORDS_WRAP) ONET_WORDS_WRAP.style.display = oWords.length ? '' : 'none';

    var tiles = [];
    chars.forEach(function(c){ tiles.push(c, c); });
    shuffle(tiles);
    oBoard = [];
    for (var r2 = 0; r2 < oRows + 2; r2++){
      var row2 = [];
      for (var c2 = 0; c2 < oCols + 2; c2++) row2.push('');
      oBoard.push(row2);
    }
    fillCells.forEach(function(cell, i){ oBoard[cell.r][cell.c] = tiles[i]; });
    oPairs = pairs;
    oStartPairs = pairs;
    onetRender();
    onetFit();
    onetHud();
    MHINT.textContent = spec.hint;
    if (!onetHasPair()) onetReshuffle(true);
  }

  /* 两点之间找一条 ≤2 拐的空路（padded 坐标，绕边也在范围内）；
     返回经过的格序列（含两端），找不到返回 null。 */
  function oFind(a, b){
    var W = oCols + 2, H = oRows + 2;
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var seen = new Int8Array(W * H * 4);
    for (var i = 0; i < seen.length; i++) seen[i] = 9;
    var out = null;
    function blocked(r, c){ return isWall(r, c) || !!cellCh(r, c); }
    function walk(r, c, dir, turns, path){
      if (out) return;
      if (r < 0 || c < 0 || r >= H || c >= W) return;
      if (r === b.r && c === b.c){ out = path.concat([{ r: r, c: c }]); return; }
      if (blocked(r, c)) return;
      var idx = (r * W + c) * 4 + dir;
      if (seen[idx] <= turns) return;
      seen[idx] = turns;
      var p2 = path.concat([{ r: r, c: c }]);
      walk(r + dirs[dir][0], c + dirs[dir][1], dir, turns, p2);
      if (turns < 2){
        for (var d = 0; d < 4; d++){
          if (d === dir) continue;
          var nr = r + dirs[d][0], nc = c + dirs[d][1];
          if (nr === b.r && nc === b.c){ out = p2.concat([{ r: nr, c: nc }]); return; }
          if (nr < 0 || nc < 0 || nr >= H || nc >= W || blocked(nr, nc)) continue;
          walk(nr, nc, d, turns + 1, p2);
          if (out) return;
        }
      }
    }
    for (var d2 = 0; d2 < 4; d2++){
      var r0 = a.r + dirs[d2][0], c0 = a.c + dirs[d2][1];
      if (r0 === b.r && c0 === b.c) return [{ r: a.r, c: a.c }, { r: b.r, c: b.c }];
      if (r0 < 0 || c0 < 0 || r0 >= H || c0 >= W || blocked(r0, c0)) continue;
      walk(r0, c0, d2, 0, [{ r: a.r, c: a.c }]);
      if (out) return out;
    }
    return out;
  }

  function pathTurns(path){
    var t = 0;
    for (var i = 2; i < path.length; i++){
      var d1r = path[i-1].r - path[i-2].r, d1c = path[i-1].c - path[i-2].c;
      var d2r = path[i].r - path[i-1].r, d2c = path[i].c - path[i-1].c;
      if (d1r !== d2r || d1c !== d2c) t++;
    }
    return t;
  }
  function pathOuter(path){
    return path.some(function(p){ return p.r === 0 || p.r === oRows + 1 || p.c === 0 || p.c === oCols + 1; });
  }

  function onetCells(){
    var list = [];
    for (var r = 1; r <= oRows; r++){
      var row = rowAt(r);
      if (!row) continue;
      for (var c = 1; c <= oCols; c++){
        if (!oWall[r][c] && row[c]) list.push({ r: r, c: c });
      }
    }
    return list;
  }

  /* 同字才可能连上，先按字分组再两两试路 —— 按字分组后每组通常只有两张，
     oFind 的调用数掉到"对数"这一级。 */
  function onetFindPair(){
    var by = {};
    for (var r = 1; r <= oRows; r++){
      var row = rowAt(r);
      if (!row) continue;
      for (var c = 1; c <= oCols; c++){
        var ch = row[c];
        if (!ch || oWall[r][c]) continue;
        (by[ch] || (by[ch] = [])).push({ r: r, c: c });
      }
    }
    for (var k in by){
      var g = by[k];
      for (var i = 0; i < g.length; i++){
        for (var j = i + 1; j < g.length; j++){
          if (oFind(g[i], g[j])) return [g[i], g[j]];
        }
      }
    }
    return null;
  }

  function onetHasPair(){
    return !!onetFindPair();
  }

  /* 死锁兜底：剩下的牌挤成一块实心矩形时，怎么洗都连不上 —— 洗牌只换字、不换位置。
     此时拆掉"同一字的两张"（任意位置，不算玩家出手），在实心块上开一个洞，
     后面的牌就有路了。拆的是一对，所以字数奇偶不乱。 */
  function onetUnblock(){
    var cells = onetCells();
    for (var i = 0; i < cells.length; i++){
      for (var j = i + 1; j < cells.length; j++){
        var ch = cellCh(cells[i].r, cells[i].c);
        if (ch !== cellCh(cells[j].r, cells[j].c)) continue;
        var a = cells[i], b = cells[j];
        [oTiles[a.r] && oTiles[a.r][a.c], oTiles[b.r] && oTiles[b.r][b.c]].forEach(function(t){
          if (!t) return;
          t.classList.add('is-go');
          FX.burst(t.getBoundingClientRect(), { count: 9, power: 380, colors: [INK, CORAL, '#fff8e8'] });
        });
        oBoard[a.r][a.c] = '';
        oBoard[b.r][b.c] = '';
        oPairs--;
        if (oRemain[ch] != null) oRemain[ch] = Math.max(0, oRemain[ch] - 2);
        oWords.forEach(function(wd){
          if (wd.done) return;
          var all = true;
          for (var k = 0; k < wd.chars.length; k++){ if ((oRemain[wd.chars[k]] || 0) > 0) { all = false; break; } }
          if (all){ wd.done = true; oWordsDone++; }
        });
        if (ONET_WORDS) ONET_WORDS.textContent = oWordsDone + '/' + oWords.length;
        MHINT.textContent = '这块挤住了 · 拆开一对给你让路';
        onetRender();
        onetHud();
        return true;
      }
    }
    return false;
  }

  function onetReshuffle(auto){
    if (oDone || oLock || oBusy) return;
    var cells = onetCells();
    if (!cells.length) return;
    oBusy = true;
    var chars = cells.map(function(p){ return oBoard[p.r][p.c]; });
    var tries = 0;
    do {
      shuffle(chars);
      for (var i = 0; i < cells.length; i++) oBoard[cells[i].r][cells[i].c] = chars[i];
      tries++;
    } while (!onetHasPair() && tries < 40);
    onetRender();
    if (!auto){
      MHINT.textContent = '洗过了 · 还剩 ' + oShuffles + ' 次';
    }
    onetHud();
    var guard = 0;
    while (!onetHasPair() && guard++ < 10){ if (!onetUnblock()) break; }
    oBusy = false;
    if (!onetHasPair()){
      onetEnd(false);
    }
  }

  /* 格中心（视口坐标）：有牌取牌矩形，空路格按舞台格宽折算。 */
  function cellCenter(r, c){
    var t = oTiles[r] && oTiles[r][c];
    var s = ONET_STAGE.getBoundingClientRect();
    if (t){
      var rc = t.getBoundingClientRect();
      return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
    }
    var cw = s.width / (oCols + 2), chh = s.height / (oRows + 2);
    return { x: s.left + (c + 0.5) * cw, y: s.top + (r + 0.5) * chh };
  }

  function oPick(r, c){
    if (oLock || oDone || oBusy) return;
    var ch = cellCh(r, c);
    if (!ch) return;
    if (!oSel){ oSel = { r: r, c: c }; oPaint(); SFX.play('onet.pick'); return; }
    if (oSel.r === r && oSel.c === c){ oSel = null; oPaint(); return; }
    if (cellCh(oSel.r, oSel.c) !== ch){
      oSel = { r: r, c: c };
      oPaint();
      MHINT.textContent = '这两张不是同一个字';
      return;
    }
    var a = oSel, b = { r: r, c: c };
    var path = oFind(a, b);
    if (!path){
      var t1 = oTiles[a.r] && oTiles[a.r][a.c], t2 = oTiles[b.r] && oTiles[b.r][b.c];
      [t1, t2].forEach(function(t){ if (t){ t.classList.add('is-bad'); later(function(){ t.classList.remove('is-bad'); }, 340); } });
      MHINT.textContent = '连不上 · 拐弯超过两次';
      return;
    }
    oLock = true;
    oSel = null;
    oPaint();

    /* 第一拍：沿真实折线把路点亮（外圈绕行用蓝，内部连通用朱）。
       路线先亮起来，牌晚一拍再碎，不糊成一团。 */
    var outer = pathOuter(path);
    var pts = path.map(function(p){ var q = cellCenter(p.r, p.c); return [q.x, q.y]; });
    FX.flashPath(pts, { color: outer ? BLUE : CORAL, width: outer ? 4 : 3, dur: 230, hold: 150 });

    var e1 = oTiles[a.r] && oTiles[a.r][a.c], e2 = oTiles[b.r] && oTiles[b.r][b.c];

    /* 第二拍（路亮出来之后）：两端碎裂、收牌、记账。 */
    later(function(){
      var justWords = [];
      oBoard[a.r][a.c] = '';
      oBoard[b.r][b.c] = '';
      oPairs--;
      if (oRemain[ch] != null) oRemain[ch] = Math.max(0, oRemain[ch] - 2);
      oWords.forEach(function(wd){
        if (wd.done) return;
        var all = true;
        for (var i = 0; i < wd.chars.length; i++){ if ((oRemain[wd.chars[i]] || 0) > 0) { all = false; break; } }
        if (all){ wd.done = true; oWordsDone++; justWords.push(wd.word); }
      });
      [e1, e2].forEach(function(t){ if (t) t.classList.add('is-go'); });
      SFX.play(justWords.length ? 'onet.word' : 'onet.link', { rate: 1 + Math.min(0.4, oCombo.n * 0.05) });
      var burstN = justWords.length ? 12 : 9;
      if (e1) FX.burst(e1.getBoundingClientRect(), { count: burstN, power: 420, colors: [INK, CORAL, '#fff8e8'] });
      if (e2) FX.burst(e2.getBoundingClientRect(), { count: burstN, power: 420, colors: [INK, CORAL, '#fff8e8'] });
      if (oWords.length && ONET_WORDS){
        ONET_WORDS.textContent = oWordsDone + '/' + oWords.length;
        MHINT.textContent = justWords.length
          ? '拼成「' + justWords.join('」「') + '」· 已 ' + oWordsDone + '/' + oWords.length + ' 个'
          : '拼成 ' + oWordsDone + ' / ' + oWords.length + ' 个 · 还剩 ' + oPairs + ' 对';
      }
      comboAdd(oCombo);
      oMaxCombo = Math.max(oMaxCombo, oCombo.n);
      var mult = comboMult(oCombo);
      var gain = 200 * mult + justWords.length * 300;
      oScore += gain;

      var midX = e1 && e2 ? (e1.getBoundingClientRect().left + e2.getBoundingClientRect().right) / 2 : (ONET_STAGE ? ONET_STAGE.getBoundingClientRect().left + ONET_STAGE.clientWidth / 2 : 200);
      var midY = e1 && e2 ? Math.min(e1.getBoundingClientRect().top, e2.getBoundingClientRect().top) - 8 : 120;

      /* 反馈分层：成词才落印章 + 金粉；普通连击到 3 以上补一道金环；不每对都炸。 */
      if (justWords.length){
        justWords.forEach(function(w, wi){
          FX.stamp(midX + (wi - (justWords.length - 1) / 2) * 70, midY, '「' + w + '」', { size: 22 });
        });
        FX.rise(midX, midY, 8, [GOLD, '#fff8e8']);
      } else if (oCombo.n >= 3){
        FX.ring(midX, midY, 10, 64, 2.4, GOLD);
      }
      FX.pop(midX, midY + 14, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 4 ? 'is-gold' : '');
      onetHud();
    }, 150);

    /* 第三拍：落盘重绘，判过关 / 死锁兜底。 */
    later(function(){
      oLock = false;
      ONET_LINE.classList.remove('is-on');
      onetRender();
      if (oPairs <= 0){
        oScore += 500 * (oLv + 1);
        if (oLv >= ONET_LV.length - 1){
          onetEnd(true, '满');
        } else {
          oWin = true; oDone = true;
          ONET_PANE.classList.add('is-over');
          showVerdict(ONET_V, ONET_VT, ONET_VS, 'v-ok',
            '第 ' + (oLv + 1) + ' 关连光 · 洗牌还剩 ' + oShuffles + ' 次 · ' + oScore + ' 分', '成');
          MHINT.textContent = '连光了 · 下一关牌更多';
          mReplayLabel('下一关');
        }
      } else if (!onetHasPair()){
        /* 连不动了不罚玩家：先免费自动洗一次（洗牌只换字不换位置，
           挤成实心块时 onetReshuffle 会接着"拆一对"开洞），永远不给"必输"局面。 */
        if (oShuffles > 0) oShuffles--;
        MHINT.textContent = '连不动了 · 自动洗一次';
        onetHud();
        later(function(){ onetReshuffle(true); }, 420);
      }
    }, 430);
  }

  function oPaint(){
    for (var r = 0; r < oRows + 2; r++) for (var c = 0; c < oCols + 2; c++){
      var el = oTiles[r] && oTiles[r][c];
      if (!el) continue;
      el.classList.toggle('is-sel', !!(oSel && oSel.r === r && oSel.c === c));
    }
  }

  function onetEnd(win, glyph){
    oDone = true; oWin = win; oLock = false; oBusy = false;
    var cells = onetCells();
    var prevBest = Math.max(oBest, BEST.get('onet.score'));
    var bestLine = oScore > prevBest && oScore > 0 ? ' · 新纪录' : (prevBest ? ' · 最高 ' + prevBest : '');
    BEST.set('onet.score', Math.max(prevBest, oScore));
    if (win){
      ONET_PANE.classList.add('is-over');
      showVerdict(ONET_V, ONET_VT, ONET_VS, 'v-ok',
        '三关连光 · 牌清了 ' + (oStartPairs * 2) + ' 张 · ' + oScore + ' 分' + bestLine, glyph || '满');
      MHINT.textContent = '连光了 · 最多 ' + oMaxCombo + ' 连击';
      mReplayLabel('从头再来');
    } else {
      ONET_PANE.classList.add('is-over');
      showVerdict(ONET_V, ONET_VT, ONET_VS, 'v-bad',
        '第 ' + (oLv + 1) + ' 关连不动了 · 还剩 ' + oPairs + ' 对 · ' + oScore + ' 分', '散');
      MHINT.textContent = '散了 · 洗牌用完了，本关重来';
      mReplayLabel('重开本关');
    }
    onetHud();
  }

  function onetStart(){
    oScore = 0;
    oMaxCombo = 0;
    oBest = BEST.get('onet.score');
    oCombo = comboState(5000, 8);
    onetLevel(0);
  }
  function onetNext(){ onetLevel(oLv + 1); }

  if (ONET_SH_BTN) on(ONET_SH_BTN, 'click', function(){
    if (oDone || oLock || oBusy || oShuffles <= 0) return;
    oShuffles--;
    onetReshuffle(false);
  });

  /* 提示：点出一对能连的牌，亮 1.4 秒。每关两次 */
  if (ONET_HINT_BTN) on(ONET_HINT_BTN, 'click', function(){
    if (oDone || oLock || oBusy || oHints <= 0) return;
    var pair = onetFindPair();
    if (!pair) { MHINT.textContent = '这盘现在没有能连的一对'; return; }
    oHints--;
    oLock = true;
    SFX.play('onet.hint');
    onetHud();
    var t1 = oTiles[pair[0].r] && oTiles[pair[0].r][pair[0].c], t2 = oTiles[pair[1].r] && oTiles[pair[1].r][pair[1].c];
    [t1, t2].forEach(function(t){ if (t) t.classList.add('is-hint'); });
    var r1 = t1 && t1.getBoundingClientRect(), r2 = t2 && t2.getBoundingClientRect();
    if (r1 && r2) FX.ring((r1.left + r1.width / 2 + r2.left + r2.width / 2) / 2, (r1.top + r1.height / 2 + r2.top + r2.height / 2) / 2, 10, 90, 2, GOLD);
    MHINT.textContent = '提示 · 这两张能连（还剩 ' + oHints + ' 次）';
    later(function(){
      [t1, t2].forEach(function(t){ if (t) t.classList.remove('is-hint'); });
      oLock = false;
      onetHud();
    }, 1400);
  });

  /* ---------- 验收钩子：语义保留 ---------- */
  if (ONET_STAGE) ONET_STAGE.__link = function(r1, c1, r2, c2){
    var path = oFind({ r: r1, c: c1 }, { r: r2, c: c2 });
    /* 拒绝时返回 falsy（兼容旧探针的真值判断）；可连时返回带路径/拐点数/外圈标记的对象 */
    if (!path) return false;
    return { ok: true, path: path, turns: pathTurns(path), outer: pathOuter(path) };
  };
  if (ONET_STAGE) ONET_STAGE.__tiles = function(){
    return onetCells().map(function(p){ return { r: p.r, c: p.c, ch: oBoard[p.r][p.c] }; });
  };
  /* 验收用：在当前关重新随机发一手 / 直接跳到指定关（不影响 __probe/__tiles/__link 语义） */
  if (ONET_STAGE) ONET_STAGE.__deal = function(){ onetLevel(oLv); };
  if (ONET_STAGE) ONET_STAGE.__goto = function(n){ onetLevel(n); };
  if (ONET_STAGE) ONET_STAGE.__probe = function(){
    return {
      level: oLv + 1, levels: ONET_LV.length, pairs: oPairs, left: onetCells().length,
      shuffles: oShuffles, sel: oSel ? [oSel.r, oSel.c] : null,
      live: onetHasPair(), done: oDone, win: oWin,
      /* 拼成多少个词（只给验收看） */
      wordsDone: oWordsDone, wordsTotal: oWords.length
    };
  };

  function resetState(){
    oSel = null; oLock = false; oBusy = false;
    if (ONET_LINE){ ONET_LINE.classList.remove('is-on'); ONET_LINE.setAttribute('points', ''); }
  }

  return {
    open: onetStart,
    stop: resetState,
    close: resetState,
    fit: onetFit,
    replay(){ if (oWin && oLv < ONET_LV.length - 1) onetNext(); else onetLevel(oLv); }
  };
}
