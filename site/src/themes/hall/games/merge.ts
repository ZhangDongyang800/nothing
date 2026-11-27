/* 09 叠山：汉字版 2048。同字相撞长一级，回退一步，推不动收场。
 *
 * 第二轮精品化要点（红线见 docs/game-polish-spec.md §7）：
 *  · 合并演出：两源先向心聚合 → 中心印章浮起 → 新字落定；不再是两格文字突然替换。
 *  · 连锁反馈：同一手多组合错综峰两拍；连击逐级抬环、音阶上扬。
 *  · 输入可靠性：动画期间只留一槽「最新方向」，解锁后续接；一次滑动只处理一次。
 *  · 规则原样保留：十一级字序、同级才合、基础分 2^(级+1)、到「天」获胜、无合法移动失败。
 */
// @ts-nocheck
import '../games/merge.css';

export function mountMerge(ctx){
  const {
    on, FX, SFX, MHINT, mReplayLabel, BEST, bindPad,
    comboState, comboAdd, comboMult, comboBreak, showVerdict
  } = ctx;

  var MG_CH = ['尘', '沙', '石', '岩', '山', '岭', '峰', '岳', '峦', '云', '天'];
  /* 与 MG_CH 一一对位的象形记号 */
  var MG_ICONS = ['dust', 'sand', 'stone', 'rock', 'peak', 'peak', 'peak', 'peak', 'peak', 'cloud', 'sky'];
  var MG_STAGE = document.getElementById('mergeStage');
  var MG_CELLS = document.getElementById('mergeCells');
  var MG_TILES = document.getElementById('mergeTiles');
  var MG_SCORE = document.getElementById('mergeScore');
  var MG_BEST = document.getElementById('mergeBest');
  var MG_TOP = document.getElementById('mergeTop');
  var MG_V = document.getElementById('mergeVerdict');
  var MG_VT = document.getElementById('mergeVText');
  var MG_VS = document.getElementById('mergeVSeal');
  var MG_PANE = document.getElementById('pane-merge');
  var MG_COMBO = document.getElementById('mergeCombo');
  var MG_UNDO_BTN = document.getElementById('mergeUndo');

  var mgBoard = [], mgEls = {}, mgFade = {}, mgId = 1;
  var mgScore = 0, mgBest = 0, mgDone = false, mgWin = false, mgLock = false;
  var mgSwipe = null, mgQueue = null;
  var mgTimers = [];
  /* 包一层 later：自己登记定时器，重置/收场/关闭时清掉，杜绝旧回调改新盘 */
  function later(fn, ms){
    var id = ctx.later(fn, ms);
    mgTimers.push(id);
    return id;
  }
  function clearTimers(){
    mgTimers.forEach(function(id){ try{ clearTimeout(id); }catch(e){} });
    mgTimers = [];
  }
  /* 动画节拍：聚合 130ms → 浮起落定 220ms → 解锁续接 */
  var MG_ANIM = 230;
  var mgCombo = comboState(6000, 6), mgComboMax = 0;
  var mgUndo = 3, mgSnap = null;

  /* 先清空再建 16 个底格：热更新会把模块重跑一遍，不清就是 32 个格子 */
  if (MG_CELLS){
    MG_CELLS.textContent = '';
    for (var mgc = 0; mgc < 16; mgc++){
      var mc = document.createElement('div');
      mc.className = 'mcell';
      MG_CELLS.appendChild(mc);
    }
  }

  function mgFit(){
    if (!MG_STAGE) return;
    var host = MG_STAGE.parentElement;
    var aw = host.clientWidth, ah = host.clientHeight;
    if (aw < 80 || ah < 80) return;
    var side = Math.floor(Math.min(aw, ah));
    MG_STAGE.style.width = side + 'px';
    mgRender();
  }

  function mgMetrics(){
    var w = MG_STAGE.clientWidth || 320;
    var gap = Math.max(7, Math.round(w * 0.022));
    var pad = gap;
    MG_STAGE.style.setProperty('--mg-gap', gap + 'px');
    MG_STAGE.style.setProperty('--mg-pad', pad + 'px');
    return { pad: pad, gap: gap, size: (w - pad * 2 - gap * 3) / 4 };
  }

  function mgPos(i, m){
    var r = Math.floor(i / 4), c = i % 4;
    return { x: m.pad + c * (m.size + m.gap), y: m.pad + r * (m.size + m.gap) };
  }

  function mgTileEl(t, m, i, fresh){
    var el = mgEls[t.id];
    if (!el){
      el = document.createElement('div');
      MG_TILES.appendChild(el);
      mgEls[t.id] = el;
      fresh = true;
    }
    el.className = 'mtile l' + Math.min(t.lvl, MG_CH.length);
    el.textContent = MG_CH[Math.min(t.lvl, MG_CH.length) - 1];
    el.setAttribute('data-ic', MG_ICONS[Math.min(t.lvl, MG_CH.length) - 1]);
    el.style.width = Math.floor(m.size) + 'px';
    el.style.height = Math.floor(m.size) + 'px';
    el.style.fontSize = Math.round(m.size * (t.lvl >= 8 ? 0.3 : 0.38)) + 'px';
    var p = mgPos(i, m);
    var tf = 'translate(' + Math.round(p.x) + 'px,' + Math.round(p.y) + 'px)';
    el.style.transform = tf;
    el.style.setProperty('--tf', tf);
    if (fresh) el.classList.add('is-new');
    if (t.merged) el.classList.add('mg-bloom');
    return el;
  }

  /* 同字相邻可合的对子： idle 时描一圈黄边，机会不用逐格心算 */
  function mgMarkPairs(){
    var seen = {};
    for (var i = 0; i < 16; i++){
      var t = mgBoard[i];
      if (!t) continue;
      var r = Math.floor(i / 4), c = i % 4;
      var neigh = [];
      if (c < 3 && mgBoard[i + 1] && mgBoard[i + 1].lvl === t.lvl) neigh.push(i + 1);
      if (r < 3 && mgBoard[i + 4] && mgBoard[i + 4].lvl === t.lvl) neigh.push(i + 4);
      neigh.forEach(function(j){
        var a = Math.min(i, j), b = Math.max(i, j), key = a + '-' + b;
        if (seen[key]) return;
        seen[key] = 1;
        [i, j].forEach(function(k){
          var el = mgEls[mgBoard[k].id];
          if (el) el.classList.add('is-pair');
        });
      });
    }
  }

  function mgRender(keepIds){
    if (!MG_STAGE || !MG_TILES) return;
    var m = mgMetrics();
    var alive = {};
    for (var i = 0; i < 16; i++){
      var t = mgBoard[i];
      if (!t) continue;
      alive[t.id] = 1;
      mgTileEl(t, m, i, false);
    }
    Object.keys(mgEls).forEach(function(id){
      if (alive[id]) return;
      if (keepIds && keepIds[id]) return;
      var el = mgEls[id];
      el.classList.add('is-gone');
      delete mgEls[id];
      later(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 190);
    });
    if (!mgLock && !mgDone) mgMarkPairs();
  }

  function mgAdd(lvl){
    var free = [];
    for (var i = 0; i < 16; i++) if (!mgBoard[i]) free.push(i);
    if (!free.length) return null;
    var at = free[Math.floor(Math.random() * free.length)];
    var t = { id: mgId++, lvl: lvl };
    mgBoard[at] = t;
    return t;
  }

  function mgHud(){
    if (MG_SCORE) MG_SCORE.textContent = String(mgScore);
    if (MG_BEST) MG_BEST.textContent = String(mgBest);
    var top = 1;
    for (var i = 0; i < 16; i++) if (mgBoard[i] && mgBoard[i].lvl > top) top = mgBoard[i].lvl;
    if (MG_TOP) MG_TOP.textContent = MG_CH[Math.min(top, MG_CH.length) - 1];
    FX.combo(MG_COMBO, mgCombo.n);
    if (MG_UNDO_BTN){
      MG_UNDO_BTN.textContent = '回退 ' + mgUndo;
      MG_UNDO_BTN.disabled = mgUndo <= 0 || !mgSnap || mgDone || mgLock;
    }
  }

  function mgRestore(){
    if (!mgSnap || mgUndo <= 0 || mgDone || mgLock) return;
    mgUndo--;
    mgLock = true; mgQueue = null;
    mgBoard = mgSnap.board.map(function(t){ return t ? { id: t.id, lvl: t.lvl } : null; });
    mgScore = mgSnap.score;
    mgSnap = null;
    comboBreak(mgCombo);
    mgRender();
    mgHud();
    MHINT.textContent = '回退一步 · 还剩 ' + mgUndo + ' 次';
    later(function(){ mgLock = false; mgHud(); }, 160);
  }

  function mgCanMove(){
    var i;
    for (i = 0; i < 16; i++) if (!mgBoard[i]) return true;
    for (i = 0; i < 16; i++){
      var r = Math.floor(i / 4), c = i % 4;
      if (c < 3 && mgBoard[i].lvl === mgBoard[i + 1].lvl) return true;
      if (r < 3 && mgBoard[i].lvl === mgBoard[i + 4].lvl) return true;
    }
    return false;
  }

  /* 纯计算：推一手。返回新盘、合并事件、是否推动、基础分（未乘连击）。 */
  function mgCompute(dir){
    var next = new Array(16).fill(null);
    var merges = [], moved = false, base = 0;
    var i, j, rr, cc;
    for (i = 0; i < 4; i++){
      var line = [];
      for (j = 0; j < 4; j++){
        if (dir === 'l'){ rr = i; cc = j; }
        else if (dir === 'r'){ rr = i; cc = 3 - j; }
        else if (dir === 'u'){ rr = j; cc = i; }
        else { rr = 3 - j; cc = i; }
        line.push({ idx: rr * 4 + cc, t: mgBoard[rr * 4 + cc] });
      }
      var ts = line.filter(function(x){ return x.t; }).map(function(x){ return { idx: x.idx, tile: x.t }; });
      var out = [], k = 0;
      while (k < ts.length){
        if (k + 1 < ts.length && ts[k].tile.lvl === ts[k + 1].tile.lvl && ts[k].tile.lvl < MG_CH.length){
          var nl = ts[k].tile.lvl + 1;
          var dst = line[out.length].idx;
          merges.push({ dst: dst, a: ts[k], b: ts[k + 1], nl: nl });
          base += Math.pow(2, nl + 1);
          out.push({ merge: true, lvl: nl });
          k += 2;
        } else {
          out.push({ tile: ts[k].tile, ref: ts[k] });
          k++;
        }
      }
      for (var q = 0; q < 4; q++){
        var item = out[q];
        if (!item) continue;
        if (item.merge) next[line[q].idx] = { id: mgId++, lvl: item.lvl, merged: true, chain: merges.length - 1 };
        else next[line[q].idx] = item.tile;
      }
    }
    for (i = 0; i < 16; i++){
      var ot = mgBoard[i], nt = next[i];
      if ((ot ? ot.id : null) !== (nt ? nt.id : null)){ moved = true; break; }
    }
    return { next: next, merges: merges, moved: moved, base: base };
  }

  /* 一记合并的分镜：向心聚合 → 印章浮起 → 余韵。oi 为同一手内的次序，错峰两拍。 */
  function mgPlayMerge(ev, oi, m, mult){
    var p = mgPos(ev.dst, m);
    var cx = p.x + m.size / 2, cy = p.y + m.size / 2;
    var nl = ev.nl;
    var hot = mgCombo.n >= 2;
    /* mgPos 给的是台面内的坐标；FX 层画在视口上，必须加上台面左上角。
       少了这一步，向心聚合 / 印章 / 飘分会全落到页面最左边（台面之外）。 */
    var sr = MG_STAGE.getBoundingClientRect();
    cx += sr.left;
    cy += sr.top;
    var colors = nl >= 8
      ? ['#ffd166', '#fff8e8', '#252525']
      : ['#ffd166', '#f28b82', '#efe9da'];

    /* 第一拍：两源之外的尘粒向内收到新字落点 */
    FX.converge(cx, cy, {
      count: 10 + Math.min(6, nl) + oi,
      radius: Math.max(30, m.size * (0.5 + oi * 0.06)),
      colors: colors
    });
    /* 石响：级别越低音越高越脆，越高越闷越厚；连击再半音上扬 */
    SFX.play('merge.hit', {
      rate: Math.max(0.55, 1.35 - nl * 0.1) * (hot ? 1.06 : 1),
      gain: 0.8 + Math.min(0.5, nl * 0.05)
    });
    /* 中心印章浮起：新字落成一方小印，字号随级别长大 */
    FX.stamp(cx, cy, MG_CH[nl - 1], {
      size: Math.round(m.size * (0.26 + nl * 0.012)),
      color: nl >= 8 ? '#b5342b' : '#252525'
    });
    var gain = Math.round(Math.pow(2, nl + 1) * mult);
    FX.pop(cx, cy - m.size * 0.22, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 3 ? 'is-gold' : '');

    /* 岭以上：震一下 + 短停顿；岳以上：金环 + 上升余烬 */
    if (nl >= 6){ FX.shake(MG_STAGE, 4); FX.freeze(50); SFX.play('merge.big'); }
    if (nl >= 8){
      FX.ring(cx, cy, 12, m.size * (0.82 + oi * 0.08), 4, '#ffd166');
      FX.rise(cx, cy, 8 + nl, ['#ffd166', '#fff8e8']);
    }
  }

  function mgMove(dir){
    if (mgDone) return;
    /* 动画期间：只留一槽最新方向，旧的排队覆盖；解锁后续接，不吞连续操作 */
    if (mgLock){ mgQueue = dir; return; }

    var res = mgCompute(dir);
    if (!res.moved){ SFX.play('merge.move'); return; }

    /* 推之前记一份局面（回退用）。只留最近一步，回退一次用掉一次机会。 */
    mgSnap = {
      board: mgBoard.map(function(t){ return t ? { id: t.id, lvl: t.lvl } : null; }),
      score: mgScore
    };
    mgLock = true; mgQueue = null;

    var mult = 1;
    if (res.base){
      comboAdd(mgCombo);
      mgComboMax = Math.max(mgComboMax, mgCombo.n);
      mult = comboMult(mgCombo);
    } else {
      comboBreak(mgCombo);
    }
    var gained = res.base * mult;
    mgScore += gained;
    if (gained) BEST.set('merge.score', mgScore);
    mgBest = Math.max(mgBest, BEST.get('merge.score'));

    var m = mgMetrics();
    /* 换盘前先记下两源的元素，聚合阶段保留它们走到一起 */
    var srcEls = {}, keep = {};
    res.merges.forEach(function(ev){
      [ev.a, ev.b].forEach(function(s){
        var el = mgEls[s.tile.id];
        if (el){ srcEls[s.tile.id] = el; keep[s.tile.id] = 1; }
      });
    });

    mgBoard = res.next;
    mgRender(keep);

    res.merges.forEach(function(ev, oi){
      var p = mgPos(ev.dst, m);
      [ev.a, ev.b].forEach(function(s){
        var el = srcEls[s.tile.id];
        if (!el) return;
        el.classList.add('mg-conv');
        el.style.transform = 'translate(' + Math.round(p.x + m.size * 0.12) + 'px,' + Math.round(p.y + m.size * 0.12) + 'px)';
      });
      later(function(){ mgPlayMerge(ev, oi, m, mult); }, oi * 55);
    });

    mgHud();
    later(function(){
      /* 聚合拍完：两源退场，落新子，解锁续接 */
      res.merges.forEach(function(ev){
        [ev.a, ev.b].forEach(function(s){
          var el = srcEls[s.tile.id];
          if (el && el.parentNode) el.parentNode.removeChild(el);
          delete mgEls[s.tile.id];
        });
      });
      mgAdd(1);
      mgRender();
      mgHud();
      mgLock = false;

      var top = 0;
      for (var i = 0; i < 16; i++) if (mgBoard[i] && mgBoard[i].lvl > top) top = mgBoard[i].lvl;
      if (top >= MG_CH.length) mgEnd(true);
      else if (!mgCanMove()) mgEnd(false);
      else MHINT.textContent = '方向键推 · 同字相撞升一级';
      mgHud();

      if (mgQueue && !mgDone){
        var q = mgQueue; mgQueue = null;
        mgMove(q);
      }
    }, MG_ANIM);
  }

  function mgReset(){
    clearTimers();
    MG_TILES.textContent = '';
    mgEls = {}; mgFade = {};
    mgBoard = new Array(16).fill(null);
    mgId = 1; mgScore = 0; mgDone = false; mgWin = false; mgLock = false; mgQueue = null;
    mgBest = BEST.get('merge.score');
    mgUndo = 3; mgSnap = null; mgComboMax = 0;
    mgCombo = comboState(6000, 6);
    MG_PANE.classList.remove('is-over');
    MG_V.classList.remove('is-on');
    MG_VS.className = 'verdict-seal';
    MG_VS.textContent = '';
    mgAdd(1); mgAdd(1);
    mgRender();
    mgHud();
    MHINT.textContent = '方向键 / WASD 或滑动 · 同字相撞升一级 · 合出「天」获胜';
  }

  function mgEnd(win){
    mgDone = true; mgWin = win; mgLock = false; mgQueue = null;
    MG_PANE.classList.add('is-over');
    if (win){
      showVerdict(MG_V, MG_VT, MG_VS, 'v-ok', '叠到「天」· ' + mgScore + ' 分 · 最高 ' + mgComboMax + ' 连击', '成');
      MHINT.textContent = '垒到天了 · 再来一次还能更高';
    } else {
      showVerdict(MG_V, MG_VT, MG_VS, 'v-bad', '推不动了 · ' + mgScore + ' 分 / ' + mgTopText(), '散');
      MHINT.textContent = '散了 · 棋盘满了，没有能合成的同字';
      SFX.play('merge.bad');
    }
    mReplayLabel('再来一次');
    BEST.set('merge.best', mgScore);
    mgBest = Math.max(mgBest, BEST.get('merge.best'));
    mgHud();
  }

  function mgTopText(){
    var top = 1;
    for (var i = 0; i < 16; i++) if (mgBoard[i] && mgBoard[i].lvl > top) top = mgBoard[i].lvl;
    return '最高一枚「' + MG_CH[Math.min(top, MG_CH.length) - 1] + '」';
  }

  on(window, 'keydown', function(e){
    if (ctx.current !== 'merge') return;
    var d = null;
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') d = 'u';
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') d = 'd';
    else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') d = 'l';
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') d = 'r';
    if (!d) return;
    e.preventDefault();
    mgMove(d);
  });

  if (MG_STAGE){
    on(MG_STAGE, 'pointerdown', function(e){ mgSwipe = { x: e.clientX, y: e.clientY }; });
    /* 滑动越过阈值当场推一次，并把起点挪到手指当前位置：一次拖动可连推，
       旧版只在抬手时判，手机上"划一下要等抬手"就是那个迟钝感。 */
    on(MG_STAGE, 'pointermove', function(e){
      if (!mgSwipe || mgDone) return;
      var dx = e.clientX - mgSwipe.x, dy = e.clientY - mgSwipe.y;
      var m = mgMetrics();
      var th = Math.max(18, Math.round(m.size * 0.16));
      if (Math.abs(dx) < th && Math.abs(dy) < th) return;
      if (Math.abs(dx) > Math.abs(dy)) mgMove(dx > 0 ? 'r' : 'l');
      else mgMove(dy > 0 ? 'd' : 'u');
      mgSwipe = { x: e.clientX, y: e.clientY };
    });
    on(MG_STAGE, 'pointerup', function(){ mgSwipe = null; });
    on(MG_STAGE, 'pointercancel', function(){ mgSwipe = null; });

    MG_STAGE.__probe = function(){
      return {
        cells: mgBoard.map(function(t){ return t ? t.lvl : 0; }),
        score: mgScore, best: mgBest, done: mgDone, win: mgWin, can: mgCanMove(),
        combo: mgCombo.n, undo: mgUndo
      };
    };

    /* ===================== 验收自测钩子（不参与玩法） ===================== */
    MG_STAGE.__r2 = {
      levels: MG_CH.slice(),
      /* QA 铺盘：arr 为 16 格等级（0 空）；可选 score 直接置分 */
      setBoard: function(arr, opt){
        opt = opt || {};
        clearTimers();
        MG_TILES.textContent = '';
        mgEls = {}; mgFade = {};
        mgBoard = new Array(16).fill(null);
        arr.forEach(function(lv, i){ if (lv > 0) mgBoard[i] = { id: mgId++, lvl: lv }; });
        mgScore = opt.score || 0;
        mgDone = false; mgWin = false; mgLock = false; mgQueue = null;
        comboBreak(mgCombo);
        mgRender(); mgHud();
      },
      move: function(dir){ mgMove(dir); },
      queue: function(){ return mgQueue; },
      lock: function(){ return mgLock; },
      snapshot: function(){ return { score: mgScore, board: mgBoard.map(function(t){ return t ? t.lvl : 0; }) }; },
      /* 与收场判定同一口径，供失败场景探针直接核对 */
      endCheck: function(){
        var top = 0;
        for (var i = 0; i < 16; i++) if (mgBoard[i] && mgBoard[i].lvl > top) top = mgBoard[i].lvl;
        return { top: top, win: top >= MG_CH.length, can: mgCanMove() };
      },
      /* QA 专用：按当前盘面走一次收场判定（无合法移动即判负），仅用于验收截图 */
      failNow: function(){ mgEnd(false); }
    };
  }
  bindPad('mergePad', function(key){ if (!mgDone) mgMove(key); });
  if (MG_UNDO_BTN) on(MG_UNDO_BTN, 'click', mgRestore);

  function cleanup(){
    clearTimers();
    mgQueue = null; mgSwipe = null;
    mgBoard = new Array(16).fill(null);
    mgEls = {}; mgFade = {};
    mgLock = false; mgDone = true;
  }

  return {
    open: mgReset,
    stop: cleanup,
    close: cleanup,
    fit: mgFit,
    replay: mgReset
  };
}
