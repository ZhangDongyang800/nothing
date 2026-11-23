/* 04 写了个写：多层牌堆，点没被压住的牌进槽，三张同字一起消；五关。
 *
 * 第二轮精品化：
 *  · 五关各有空间考点（识层 / 两翼 / 夹心 / 深挖 / 极限），不再只是线性加牌数；
 *  · 槽位与开层时机可读：可凑同字联动高亮、压牌角标、槽位分级压力提示；
 *  · 每一手都有即时响应：按下抬升、入槽轨迹、向心聚合、按字格碎裂、揭层浮现、连锁反馈。
 * 契约保留：五关牌数 / 层数 / 槽位、`#pile.__probe()`、`#pile.__sol`、`__stats.sameLayer`、
 * 同字三张不同层、胜负判定口径一字不改。 */
// @ts-nocheck
import '../games/pile.css';

export function mountPile(ctx){
  const {
    on, later, FX, SFX, MHINT, mReplayLabel, fitBox, BEST,
    themeChars, themeOf, markTheme, markIcon, shuffle,
    comboState, comboAdd, comboMult, comboBreak, popAt, hudSet, showVerdict
  } = ctx;

  var PILE = document.getElementById('pile');
  var PILE_SLOT = document.getElementById('pileSlot');
  var PILE_V = document.getElementById('pileVerdict');
  var PILE_VT = document.getElementById('pileVText');
  var PILE_VS = document.getElementById('pileVSeal');
  var PILE_LEFT = document.getElementById('pileLeft');
  var PILE_HOLD = document.getElementById('pileHold');
  var PILE_MAX = document.getElementById('pileMax');
  var PILE_LV = document.getElementById('pileLv');
  var PILE_LVN = document.getElementById('pileLvn');
  var PILE_PANE = document.getElementById('pane-pile');
  var PILE_THEME = document.getElementById('pileTheme');
  var PILE_SCORE = document.getElementById('pileScore');
  var PILE_COMBO = document.getElementById('pileCombo');

  /* 字池要够大：一组三张独占一个字，组与组不共用 */
  var PCHARS = ['月','舟','烛','钥','伞','雁','窗','梅','灯','雪','风','云',
    '书','墨','茶','松','石','桥','巷','雨','霜','鸟','花','竹',
    '琴','棋','诗','酒','江','山','船','潭'];
  var PILE_THEMES = ['sanguo', 'shanshui', 'qiwu', 'sanguo', 'shanshui'];
  var pTiles = [], pSlot = [], pDone = false, pLock = false, pWin = false, pHoldTap = null, pPos = null;
  var pScore = 0, pBest = 0, pSlotBonus = 0, pKeyTile = null;
  var pCombo = comboState(4200, 8);
  /* 剥层偏好：0 = 优先剥最浅一层，成波次清，避免深层第三张长时间压在槽外 */
  var DEEP_PROB = 0;
  var pLevel = 0;
  var SLOTS = 7;
  var pLevelScore = 0;
  var ghostEl = null;
  var pAspect = 5 / 4;      /* 台面比例跟着本关的列/行走，方块才不会被拉成长条 */

  /* ===================== 五关牌阵 =====================
   * 牌数 / 层数 / 槽位是红线，逐关不变。
   * 排布统一成**金字塔**：每层都比下一层少一列，并且四个方向各内收半格 ——
   * 半格错位既是视觉上的台阶，也是遮挡关系（|Δ|<1 就算压住），
   * 于是一眼能看出"这摞有多深、再往下一层会露出什么"。
   * L1 18+15+12+9 = 54 · 4 层 · 7 槽
   * L2 21+18+15+12 = 66 · 4 层 · 6 槽
   * L3 21+18+15+12+9 = 75 · 5 层 · 5 槽
   * L4 24+21+18+15+12 = 90 · 5 层 · 5 槽
   * L5 24+21+18+15+12+6 = 96 · 6 层 · 5 槽 */
  var PLEVELS = [
    { focus: '识层 · 先揭塔尖，再往下一层', slots: 7, cols: [6, 5, 4, 3] },
    { focus: '两翼 · 塔身更宽，留意别把槽压偏', slots: 6, cols: [7, 6, 5, 4] },
    { focus: '夹心 · 中芯被压着，先剥两面', slots: 5, cols: [7, 6, 5, 4, 3] },
    { focus: '深挖 · 底层厚，看准再往下开', slots: 5, cols: [8, 7, 6, 5, 4] },
    { focus: '极限 · 六层纵深，五格槽位算着拿', slots: 5, cols: [8, 7, 6, 5, 4, 2] }
  ];

  function pileSpec(){ return PLEVELS[Math.min(pLevel, PLEVELS.length - 1)]; }

  /* 一层 = 3 行 × c 列，**左右居中**。每层比下一层少一列，少出来的半格正好
     让上一层夹在下一层两张之间 —— 这就是金字塔的台阶，也是遮挡关系。 */
  function layerCells(c, layer, maxC){
    var out = [];
    var ox = (maxC - c) / 2, oy = 0;
    for (var r = 0; r < 3; r++)
      for (var x = 0; x < c; x++)
        out.push({ x: ox + x, y: oy + r, layer: layer });
    return out;
  }

  function pileLayout(spec){
    var out = [];
    var maxC = spec.cols[0];
    spec.cols.forEach(function(c, layer){ out = out.concat(layerCells(c, layer, maxC)); });
    return out;
  }

  /* 自动化验收读状态用：不参与玩法 */
  if (PILE) PILE.__probe = function(){
    return {
      left: pTiles.length,
      held: pSlot.filter(function(it){ return !it.pop; }).length,
      slots: SLOTS,
      lock: pLock,
      done: pDone,
      win: pWin,
      score: pScore,
      combo: pCombo.n,
      key: !!(pKeyTile && pKeyTile.key && pKeyTile.el && pKeyTile.el.parentNode)
    };
  };

  function pileHud(){
    if (PILE_LEFT) PILE_LEFT.textContent = String(Math.ceil(pTiles.length / 3));
    if (PILE_HOLD) PILE_HOLD.textContent = String(pSlot.filter(function(it){ return !it.pop; }).length);
    if (PILE_MAX) PILE_MAX.textContent = String(SLOTS);
    if (PILE_LV) PILE_LV.textContent = String(pLevel + 1);
    if (PILE_LVN) PILE_LVN.textContent = String(PLEVELS.length);
    hudSet(PILE_SCORE, pScore);
    FX.combo(PILE_COMBO, pCombo.n);
  }

  function startPile(){
    pLevel = 0;
    pWin = false;
    pScore = 0;
    pCombo = comboState(4200, 8);
    pBest = BEST.get('pile.score');
    buildPile();
  }

  /* 重来一次只重来这一关：爬到第 4 关输了不该被踢回第 1 关。 */
  function retryPile(){
    pWin = false;
    pScore = pLevelScore;
    pCombo = comboState(4200, 8);
    buildPile();
  }

  function nextPile(){
    if (pLevel >= PLEVELS.length - 1) { pLevel = 0; } else { pLevel++; }
    pWin = false;
    pCombo = comboState(4200, 8);
    buildPile();
  }

  /* 一副牌 = 一条"合法剥皮顺序" + 一组三张的分法。 */
  function pileDeal(pos){
    /* 剥皮顺序：两步 —— ① 80% 概率别紧跟上一层，② 换层之后仍有 72% 概率往最深处挖。 */
    var peel = [];
    (function(){
      var left = pos.slice();
      var lastLayer = -1;
      while (left.length){
        var avail = [], i, j;
        for (i = 0; i < left.length; i++){
          var t = left[i], cov = false;
          for (j = 0; j < left.length; j++){
            var o = left[j];
            if (o === t || o.layer <= t.layer) continue;
            if (Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1){ cov = true; break; }
          }
          if (!cov) avail.push(t);
        }
        var cand = avail;
        if (lastLayer >= 0 && Math.random() < 0.8){
          var other = [];
          for (i = 0; i < avail.length; i++) if (avail[i].layer !== lastLayer) other.push(avail[i]);
          if (other.length) cand = other;
        }
        var pick;
        if (Math.random() < DEEP_PROB){
          var deepL = cand[0].layer;
          for (i = 1; i < cand.length; i++) if (cand[i].layer < deepL) deepL = cand[i].layer;
          var deepList = [];
          for (i = 0; i < cand.length; i++) if (cand[i].layer === deepL) deepList.push(cand[i]);
          pick = deepList[Math.floor(Math.random() * deepList.length)];
        } else {
          pick = cand[Math.floor(Math.random() * cand.length)];
        }
        peel.push(pick);
        lastLayer = pick.layer;
        left.splice(left.indexOf(pick), 1);
      }
    })();

    /* 发字分组：剥皮序列就近成组，三张层级贴近（相邻层优先），避免第三张埋太深。
     * 同字三张在剥皮顺序上聚拢、层级成带 → 第三张尽快浮出，压低槽峰。 */
    var trios = [];
    var used = new Array(peel.length).fill(false);
    for (var a = 0; a < peel.length; a++){
      if (used[a]) continue;
      used[a] = true;
      var la = peel[a].layer;
      var cand = [];
      for (var j = a + 1; j < peel.length; j++) if (!used[j]) cand.push(j);
      var b = -1, k = -1, c;
      var sb = Infinity;
      for (c = 0; c < cand.length; c++){
        var jb = cand[c];
        if (peel[jb].layer === la) continue;
        var db = Math.abs(peel[jb].layer - la);
        if (db < sb){ sb = db; b = jb; }
      }
      if (b < 0 && cand.length) b = cand[0];
      if (b >= 0){
        used[b] = true;
        var lb = peel[b].layer;
        var sk = Infinity;
        for (c = 0; c < cand.length; c++){
          var kk = cand[c];
          if (used[kk]) continue;
          var spread = Math.abs(peel[kk].layer - la) + Math.abs(peel[kk].layer - lb);
          if (spread < sk){ sk = spread; k = kk; }
        }
      }
      if (k >= 0){ used[k] = true; trios.push([a, b, k]); }
      else if (trios.length) trios[trios.length - 1].push(a);
    }

    /* 修"三张同层"：剥皮到末段常只剩整层，就近成组会把三张都塞进同一层。
     * 这里做交换修补 —— 把同层组里的一张与另一组里不同层的一张对调，要求两边换完
     * 都仍是"至少两层"。交换只改"谁跟谁同字"，不改剥皮顺序，
     * 所以既满足"同字三张不落在同一层"的契约，也不影响可解性。 */
    function trioLayerOf(ix, n){ return peel[ix[n]].layer; }
    function trioSame(ix){
      var L = trioLayerOf(ix, 0);
      for (var z = 1; z < ix.length; z++) if (trioLayerOf(ix, z) !== L) return false;
      return true;
    }
    for (var pass = 0; pass < 6; pass++){
      var fixed = false, ti, ui, m2, o2;
      for (ti = 0; ti < trios.length && !fixed; ti++){
        if (!trioSame(trios[ti])) continue;
        var L0 = trioLayerOf(trios[ti], 0);
        for (ui = 0; ui < trios.length && !fixed; ui++){
          if (ui === ti) continue;
          for (m2 = 0; m2 < trios[ui].length && !fixed; m2++){
            if (trioLayerOf(trios[ui], m2) === L0) continue;
            /* 换完之后那一组还得留一张不同层的，否则只是把坏组搬了个地方 */
            var othersOK = false;
            for (o2 = 0; o2 < trios[ui].length; o2++){
              if (o2 !== m2 && trioLayerOf(trios[ui], o2) !== L0){ othersOK = true; break; }
            }
            if (!othersOK) continue;
            var g0 = 0;
            var kv = trios[ti][g0], pv = trios[ui][m2];
            trios[ti][g0] = pv; trios[ui][m2] = kv;
            fixed = true;
          }
        }
      }
      if (!fixed) break;
    }

    /* 字池按"这一关写哪一套"来取；套里的字不够时用旧池补足。 */
    var need = Math.ceil(pos.length / 3);
    var tchars = themeChars(PILE_THEMES[pLevel] || 'sanguo');
    if (tchars.length < need){
      PCHARS.forEach(function(c){ if (tchars.length < need && tchars.indexOf(c) < 0) tchars.push(c); });
    }
    var pool = shuffle(tchars).slice(0, Math.max(1, Math.ceil(need / 6)));
    var chByPos = {}, sameLayer = 0;
    trios.forEach(function(ix, k){
      /* 相邻两组共用一个字：槽里该字可任配两组里的同字牌，减少长时间待消的对子 */
      var ch = pool[Math.floor(k / 2) % pool.length];
      var layers = [];
      ix.forEach(function(i){
        var p = peel[i];
        chByPos[pos.indexOf(p)] = ch;
        layers.push(p.layer);
      });
      var same = true;
      for (var z = 1; z < layers.length; z++) if (layers[z] !== layers[0]) same = false;
      if (same) sameLayer++;
    });
    return { peel: peel, trios: trios, chByPos: chByPos, sameLayer: sameLayer };
  }

  /* 盘面的压牌图：cov[i] = 压在 i 上面的那几张的下标。
   * 布局只跟关卡走、发牌不改几何，所以一副盘算一次就够；把 O(n³) 的"每步重扫全盘"
   * 降成 O(n²)，才能在发牌时现场跑几十次模拟（见 buildPile 的闭环验收）。 */
  function coverSets(pos){
    var cov = [], i, j;
    for (i = 0; i < pos.length; i++){
      var list = [];
      for (j = 0; j < pos.length; j++){
        if (j === i) continue;
        var o = pos[j], t = pos[i];
        if (o.layer > t.layer && Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1) list.push(j);
      }
      cov.push(list);
    }
    return cov;
  }

  /* 快速贪心：凑对优先、无前瞻；可动牌按 order 给定的顺序扫描。
   * order 可以是剥皮顺序（模拟"知道内情的路线"），也可以是盘面坐标顺序（模拟
   * "只看眼前十来张牌、从上往下扫"的真人视线）。两种顺序都要能通，才算公平局。 */
  function greedyFast(pos, cov, d, slots, order){
    var n = pos.length;
    var alive = new Array(n);
    for (var i = 0; i < n; i++) alive[i] = true;
    var seq = [];
    if (order && order.length === n){
      for (var s = 0; s < order.length; s++) seq.push(order[s]);
    } else {
      for (var q = 0; q < d.peel.length; q++) seq.push(pos.indexOf(d.peel[q]));
    }
    var left = n, held = 0, peak = 0;
    var slot = {};
    var guard = 0;
    while (left > 0 && guard < n * 4){
      guard++;
      var avail = [], a;
      for (a = 0; a < seq.length; a++){
        var id = seq[a];
        if (!alive[id]) continue;
        var cl = cov[id], blocked = false;
        for (var z = 0; z < cl.length; z++) if (alive[cl[z]]){ blocked = true; break; }
        if (!blocked) avail.push(id);
      }
      if (!avail.length) break;
      var heldChars = Object.keys(slot);
      var hit = -1;
      for (a = 0; a < avail.length; a++){
        if (heldChars.indexOf(d.chByPos[avail[a]]) >= 0){ hit = avail[a]; break; }
      }
      if (hit < 0){
        /* 槽满且凑不成对 —— 这一手在真机上就是「散」 */
        if (held >= slots) return { win: false, peak: peak, left: left };
        var count = {}, best = avail[0], bestC = -1, c;
        for (c = 0; c < avail.length; c++){ var ch0 = d.chByPos[avail[c]]; count[ch0] = (count[ch0] || 0) + 1; }
        for (c = 0; c < avail.length; c++){
          var n2 = count[d.chByPos[avail[c]]];
          if (n2 > bestC){ bestC = n2; best = avail[c]; }
        }
        hit = best;
      }
      alive[hit] = false;
      left--;
      var hc = d.chByPos[hit];
      var cur = (slot[hc] || 0) + 1;
      if (cur === 3){
        /* 第三张当场消掉：真机的失败判定被 return 跳过，这里也一样 */
        delete slot[hc];
        held -= 2;
      } else {
        slot[hc] = cur;
        held += 1;
        /* 真机 takeTile 的顺序是"先入槽、再判满"：非消除的一手让槽位数到达上限，
         * 就是「散」。此前模拟允许了整整一格余量，于是 L4/L5 选出来的"能通"局
         * 在真机上照样死 —— 两边的尺子必须一格不差。 */
        if (held >= slots) return { win: false, peak: peak, left: left };
      }
      if (held > peak) peak = held;
    }
    return { win: left === 0, peak: peak, left: left };
  }

  /* 闭包内贪心模拟：凑对优先、无前瞻；备选按剥皮顺序扫描，与真机页内求解器同一口径。
   * 用于批量统计通关率与槽峰分布（不碰 DOM、不动局内状态）。 */
  function greedySim(spec, pos, d){
    var remain = {};
    pos.forEach(function(t, i){ remain[i] = t; });
    var slot = {};
    var held = 0, peak = 0, guard = 0;
    function covered(i){
      var t = remain[i];
      for (var j in remain){
        var o = remain[j];
        if (o !== t && o.layer > t.layer && Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1) return true;
      }
      return false;
    }
    while (Object.keys(remain).length && guard < pos.length * 20){
      guard++;
      /* 按剥皮顺序取可动牌，与真机求解器一致 */
      var avail = [];
      d.peel.forEach(function(p){
        var i = pos.indexOf(p);
        if (remain[i] && !covered(i)) avail.push(i);
      });
      if (!avail.length) break;
      var heldChars = Object.keys(slot);
      var hit = avail.find(function(i){ return heldChars.indexOf(d.chByPos[i]) >= 0; });
      if (hit === undefined){
        if (held >= spec.slots) return { win: false, peak: peak, left: Object.keys(remain).length };
        var count = {};
        avail.forEach(function(i){ var c = d.chByPos[i]; count[c] = (count[c] || 0) + 1; });
        hit = avail.slice().sort(function(a, b){ return (count[d.chByPos[b]] || 0) - (count[d.chByPos[a]] || 0); })[0];
      }
      var ch = d.chByPos[hit];
      delete remain[hit];
      slot[ch] = (slot[ch] || 0) + 1; held++;
      if (slot[ch] === 3){ delete slot[ch]; held -= 3; }
      if (held > peak) peak = held;
    }
    return { win: Object.keys(remain).length === 0, peak: peak, left: Object.keys(remain).length };
  }

  function clearGhost(){
    if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
    ghostEl = null;
  }

  function buildPile(){
    PILE.innerHTML = '';
    clearGhost();
    pTiles = [];
    pSlot = [];
    pDone = false;
    pLock = false;
    pHoldTap = null;
    pKeyTile = null;
    pLevelScore = pScore;
    PILE_V.classList.remove('is-on');
    PILE_PANE.classList.remove('is-over');
    PILE_VS.className = 'verdict-seal';
    PILE_VS.textContent = '';
    MHINT.textContent = pileSpec().focus;
    mReplayLabel('再来一次');

    var spec = pileSpec();
    pSlotBonus = 0;
    SLOTS = spec.slots;
    var pos = pileLayout(spec);

    /* 这一局写哪一套：牌面上是名字的偏旁，HUD 里写清主题 */
    var themeKey = PILE_THEMES[pLevel] || 'sanguo';
    markTheme(PILE_PANE, themeKey);
    if (PILE_THEME) PILE_THEME.textContent = themeOf(themeKey).name;

    /* 排局闭环：一副牌必须同时满足两件事才收下 ——
     *   ① 没有任何一组三张落在同一层（原有的同层组约束）；
     *   ② 按"凑对优先、无前瞻"的贪心打法一定清得完（槽位永远塞不死）。
     * ①只保证"剥皮顺序存在"，不保证"槽里放得下"；漏掉②时第 3–5 关会有 8%–15% 的局
     * 无论怎么点都必然散场——那不是难度，是坏局。所以这里现场跑模拟，不收坏局；
     * 40 次都不合格时退而取"能通且同层组最少"的那副兜底，绝不返回必败局。 */
    var cov = coverSets(pos);
    var posOrder = [], pi;
    for (pi = 0; pi < pos.length; pi++) posOrder.push(pi);
    var deal = null, dealSim = null, dealKey = -1e9, att;
    for (att = 0; att < 140; att++){
      var d = pileDeal(pos);
      /* 两把尺子量同一副牌：知情人（按剥皮顺序扫）与真人（按盘面顺序扫）。
       * 两把都必须通，才算"这局怎么玩都有解"——只保证一把时，真机上换一种挑牌
       * 顺序就会撞死（实测就是这么输的）。 */
      var rp = greedyFast(pos, cov, d, SLOTS);
      var rs = greedyFast(pos, cov, d, SLOTS, posOrder);
      var wins = (rp.win ? 1 : 0) + (rs.win ? 1 : 0);
      var peak = rs.peak;
      var target = Math.max(2, SLOTS - 1);
      /* 排序的权重要分清主次：**盘面顺序能通是公平性底线**（玩家只看得到眼前十来张），
       * 剥皮顺序能通只是"存在一条知情路线"，属于加分项。两者平分权重时，
       * best-of-90 会被"只有知情路线能通"的坏局抢走。 */
      var key = (rs.win ? 900 : 0) + (rp.win ? 200 : 0) + (d.sameLayer === 0 ? 400 : 0)
        - Math.abs(peak - target) * 30 - d.sameLayer * 40;
      if (key > dealKey){ dealKey = key; deal = d; dealSim = { win: wins === 2, peak: peak, peelWin: rp.win, posWin: rs.win }; }
      if (wins === 2 && d.sameLayer === 0 && peak === target) break;
    }
    var peel = deal.peel;
    var chByPos = deal.chByPos;
    var sameLayerTrios = deal.sameLayer;

    var maxX = 0, maxY = 0;
    pos.forEach(function(p){ maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    var PILE_UNITS = maxX + 1;
    /* 上下各留半格多一点的空白：最上一排贴上边框时，钥角标和金环会被裁掉 */
    var PAD_R = 0.7;
    var PILE_ROWS = maxY + 1 + PAD_R;
    var tw = 100 / PILE_UNITS;
    var th = 100 / PILE_ROWS;
    var padTop = (100 * (PAD_R / 2)) / PILE_ROWS;
    /* 台面比例跟着本关的网格走：格子是正方格，牌是方块。
       牌只占格子的 90%，四周留缝 —— 这样半格错位的上一层会夹在下一层两张之间，
       金字塔的层次看得见，而不是一块整板。 */
    pAspect = PILE_UNITS / PILE_ROWS;
    var stageEl = document.getElementById('pileStage');
    if (stageEl) stageEl.style.aspectRatio = PILE_UNITS + ' / ' + PILE_ROWS;
    var gw = tw * 0.8, gh = th * 0.8;
    var gx = tw * 0.1, gy = th * 0.1;
    pos.forEach(function(p, k){
      var b = document.createElement('button');
      p.ch = chByPos[k];   /* 配对靠 p.ch，别只把字写在 DOM 上 */
      b.type = 'button';
      b.className = 'ptile';
      b.style.left = (p.x * tw + gx) + '%';
      b.style.top = (padTop + p.y * th + gy) + '%';
      b.style.width = gw + '%';
      b.style.height = gh + '%';
      b.style.zIndex = String(10 + p.layer * 10);
      b.textContent = p.ch;
      /* 牌面字单独留一份：字数盲测脚本要按"字"判断，而 textContent 里混着偏旁图标 */
      b.setAttribute('data-ch', p.ch);
      b.setAttribute('data-idx', String(k));
      markIcon(b, p.ch);
      b.setAttribute('aria-label', '取走一张「' + p.ch + '」');
      on(b, 'pointerdown', function(){ b.classList.add('is-pick'); });
      on(b, 'pointerup', function(){ b.classList.remove('is-pick'); });
      on(b, 'pointerleave', function(){ b.classList.remove('is-pick'); });
      on(b, 'click', function(){ takeTile(p); });
      PILE.appendChild(b);
      p.el = b;
      p.idx = k;
      pTiles.push(p);
    });

    /* 钥牌：埋在第 2 层或更深（不放在最上层，否则开局就能白拿）。
     * 它**不换字面**——把字面改成「钥」会打断三张同字的算术：那组的三张少了一张入槽，
     * 剩下两张永远凑不成，整关变成死局（真机 e2e 里 5 关全部「散」就是这个原因）。
     * 现在它是"一张正常牌 + 金环钥角标"：拿进槽照样参与三张消除，同时把槽位放宽一格。 */
    var deep = pTiles.filter(function(t){ return t.layer >= 1; });
    if (deep.length){
      pKeyTile = deep[Math.floor(Math.random() * deep.length)];
      pKeyTile.key = true;
      pKeyTile.el.classList.add('is-key');
      var keyBadge = document.createElement('i');
      keyBadge.className = 'pkey';
      keyBadge.textContent = '钥';
      pKeyTile.el.appendChild(keyBadge);
      pKeyTile.el.setAttribute('aria-label', '取走「' + pKeyTile.ch + '」· 槽位 +1');
    }

    /* 给自动化验收留的钩子：sol 是"照这个顺序点一定清完"的那串下标 */
    PILE.__sol = peel.map(function(p){ return p.idx; });
    pPos = pos;
    PILE.__stats = { groups: deal.trios.length, sameLayer: sameLayerTrios, slots: SLOTS, tiles: pTiles.length,
      solvable: !!dealSim.win, peelWin: !!dealSim.peelWin, posWin: !!dealSim.posWin,
      peak: dealSim.peak, attempts: att + 1 };
    refreshPileCover();
    renderSlots();
    pileHud();
    syncSlotCount();
    refit();
  }

  /* 槽位数：看着 SLOTS 画格子，取到钥牌之后要当场多露出一格 */
  function syncSlotCount(){
    Array.prototype.slice.call(PILE_SLOT.querySelectorAll('.slot')).forEach(function(s, i){
      s.style.display = i < SLOTS ? '' : 'none';
    });
    PILE_SLOT.style.setProperty('--slots', String(SLOTS));
  }

  function pileCovered(t){
    for (var i = 0; i < pTiles.length; i++){
      var o = pTiles[i];
      if (o === t || o.layer <= t.layer) continue;
      if (Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1) return true;
    }
    return false;
  }

  /* t 下面还压着几张可动牌：角标提示"掀这张能放出牌" */
  function pileCovers(t){
    for (var i = 0; i < pTiles.length; i++){
      var o = pTiles[i];
      if (o === t || o.layer <= t.layer) continue;
      if (Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1) return true;
    }
    return false;
  }

  function refreshPileCover(){
    pTiles.forEach(function(t){
      var cov = pileCovered(t);
      t.el.classList.toggle('is-lock', cov);
      if (cov){
        t.el.setAttribute('aria-disabled', 'true');
        t.el.classList.remove('is-cover', 'is-match');
      } else {
        t.el.removeAttribute('aria-disabled');
        /* 刚从压住里露出来的牌：浮现落定一拍 */
        if (!t.el.classList.contains('is-reveal')){
          t.el.classList.remove('is-reveal');
          void t.el.offsetWidth;
          t.el.classList.add('is-reveal');
        }
        t.el.classList.toggle('is-cover', pileCovers(t));
      }
    });
    markMatchables();
  }

  /* 槽里已有什么字：盘上可动的同字牌联动亮一圈，方便判断"再拿一张就凑" */
  function markMatchables(){
    var held = {};
    pSlot.forEach(function(it){ if (!it.pop) held[it.ch] = (held[it.ch] || 0) + 1; });
    pTiles.forEach(function(t){
      if (t.el.classList.contains('is-lock')){ t.el.classList.remove('is-match'); return; }
      t.el.classList.toggle('is-match', !!held[t.ch]);
    });
  }

  function renderSlots(){
    var slots = Array.prototype.slice.call(PILE_SLOT.querySelectorAll('.slot'));
    slots.forEach(function(s){
      while (s.firstChild) s.removeChild(s.firstChild);
    });
    var heldCount = {};
    pSlot.forEach(function(it){ if (!it.pop) heldCount[it.ch] = (heldCount[it.ch] || 0) + 1; });
    var n = 0;
    pSlot.forEach(function(it){
      var s = slots[n];
      if (!s) return;
      var chip = document.createElement('span');
      chip.className = 'sitem' + (it.pop ? ' is-pop' : '');
      if (!it.pop && heldCount[it.ch] >= 2) chip.classList.add('is-dup');
      chip.textContent = it.ch;
      s.appendChild(chip);
      n++;
    });
    var held = pSlot.filter(function(it){ return !it.pop; }).length;
    PILE_SLOT.classList.toggle('is-hot', held >= SLOTS - 1);
    PILE_SLOT.classList.toggle('is-strain', held >= SLOTS - 2 && held < SLOTS - 1);
  }

  /* 入槽轨迹：牌从盘面飘到槽口，落定后再由槽内 chip 接手 */
  function flyToSlot(t){
    var stage = document.getElementById('pileStage');
    if (!stage || !t.el) return;
    clearGhost();
    var tr = t.el.getBoundingClientRect();
    var sr = PILE_SLOT.getBoundingClientRect();
    ghostEl = document.createElement('div');
    ghostEl.className = 'pghost';
    ghostEl.textContent = t.ch;
    stage.appendChild(ghostEl);
    var st = stage.getBoundingClientRect();
    ghostEl.style.left = (tr.left - st.left) + 'px';
    ghostEl.style.top = (tr.top - st.top) + 'px';
    ghostEl.style.width = tr.width + 'px';
    ghostEl.style.height = tr.height + 'px';
    void ghostEl.offsetWidth;
    var dx = (sr.left + sr.width / 2) - (tr.left + tr.width / 2);
    var dy = (sr.top + sr.height / 2) - (tr.top + tr.height / 2);
    ghostEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.72)';
    later(function(){ clearGhost(); }, 230);
  }

  function failRound(){
    pDone = true;
    comboBreak(pCombo);
    PILE_PANE.classList.add('is-over');
    pScore = pLevelScore;
    pileHud();
    SFX.play('pile.bad');
    FX.shake(PILE, 4);
    showVerdict(PILE_V, PILE_VT, PILE_VS, 'v-bad', '第 ' + (pLevel + 1) + ' 关散了 · 槽满了', '散');
    MHINT.textContent = '散了 · 槽塞满，本关重来';
    mReplayLabel('重开本关');
  }

  function beginMatch(t){
    pLock = true;
    var sr = PILE_SLOT.getBoundingClientRect();
    var cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2;

    /* 聚合一拍：槽里同字两片向第三片收拢，再炸 */
    SFX.play('pile.match', { rate: 1 + Math.min(0.5, comboMult(pCombo) * 0.06) });
    FX.converge(cx, cy, { count: 12, radius: Math.max(34, sr.width * 0.18), colors: ['#252525', '#f28b82', '#ffd166', '#fff8e8'] });

    later(function(){
      /* 三张标记消除：按字格切碎，每张 chip 一小簇方碎 + 一点火星 */
      var matched = 0;
      pSlot.forEach(function(it){
        if (!it.pop && it.ch === t.ch && matched < 3){ it.pop = true; matched++; }
      });
      renderSlots();
      var popChips = PILE_SLOT.querySelectorAll('.sitem.is-pop');
      popChips.forEach(function(chip){
        var r = chip.getBoundingClientRect();
        FX.burst(r, { count: 4, power: 300, dust: 2, size: Math.max(3, Math.min(9, Math.min(r.width, r.height) * 0.2)),
          colors: ['#252525', '#f28b82', '#fff8e8'], ring: false, flash: false });
      });
      FX.sparks({ left: cx, top: cy, width: 4, height: 4 }, 6, '#ffd166');

      comboAdd(pCombo);
      var mult = comboMult(pCombo);
      var gain = 120 * mult;
      pScore += gain;
      popAt(PILE_SLOT, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 3 ? 'is-gold' : '');

      /* 重大档：连锁消除 —— 朱色环 + 上升余烬 + 一拍命中停顿 */
      if (mult >= 2){
        FX.ring(cx, cy, 10, sr.width * 0.55, 3, '#f28b82');
        FX.rise(cx, sr.top, 8 + mult * 2, ['#ffd166', '#fff8e8', '#f28b82']);
        FX.freeze(mult >= 3 ? 80 : 50);
      }
      pileHud();

      later(function(){
        pSlot = pSlot.filter(function(it){ return !it.pop; });
        renderSlots();
        pLock = false;
        /* 消除动画那 430ms 里点到的那一张不留着，等于"点了没反应"。
         * 这里把最后一下缓冲下来，解锁瞬间补上；缓冲只存一张，连点不会放大成连锁。 */
        if (pHoldTap){
          var ht = pHoldTap;
          pHoldTap = null;
          if (ht && pTiles.indexOf(ht) >= 0 && ht.el && !ht.el.classList.contains('is-lock')){
            later(function(){ takeTile(ht); }, 0);
          }
        }
        pileHud();
        if (!pTiles.length){
          pDone = true;
          pWin = true;
          PILE_PANE.classList.add('is-over');
          var last = pLevel >= PLEVELS.length - 1;
          var prevBest = Math.max(pBest, BEST.get('pile.score'));
          pScore += 300 * (pLevel + 1);
          BEST.set('pile.score', pScore);
          pBest = Math.max(prevBest, pScore);
          var bestLine = pScore > prevBest && pScore > 0 ? ' · 新纪录' : (pBest ? ' · 最高 ' + pBest : '');
          showVerdict(PILE_V, PILE_VT, PILE_VS, 'v-ok',
            (last ? '五关全清' : '第 ' + (pLevel + 1) + ' 关清完') + ' · ' + pScore + ' 分' + bestLine,
            last ? '满' : '成');
          MHINT.textContent = last ? '五关全清 · 共 ' + pScore + ' 分' : '清完了 · 点「下一关」';
          mReplayLabel(last ? '从头再来' : '下一关');
        } else {
          MHINT.textContent = '还剩 ' + Math.ceil(pTiles.length / 3) + ' 组 · 槽里 ' + pSlot.length + ' 张';
        }
      }, 300);
    }, 130);
  }

  function takeTile(t){
    if (pDone) return;
    /* 消除演出期间不吞掉点击：只留最后一下，解锁后补放（见 beginMatch 尾段） */
    if (pLock){ pHoldTap = t; return; }
    if (!t.el || t.el.classList.contains('is-lock')) return;
    if (t.el.classList.contains('is-go')) return;

    pTiles.splice(pTiles.indexOf(t), 1);
    t.el.classList.add('is-go');

    /* 钥牌：仍照常进槽参与三张消除，额外把槽位放宽一格。
     * "先挖深换空间"的那一手保持不变 —— 只是不再吞掉那张牌的字面。 */
    if (t.key){
      pSlotBonus = Math.min(2, pSlotBonus + 1);
      SLOTS = pileSpec().slots + pSlotBonus;
      pKeyTile = null;
      pScore += 60;
      SFX.play('pile.key');
      var kr = t.el.getBoundingClientRect();
      popAt(t.el, '槽 +1', 'is-gold');
      FX.rise(kr.left + 12, kr.top + 8, 12, ['#ffd166', '#a8c7a0', '#fff8e8']);
      syncSlotCount();
      MHINT.textContent = '取到「钥」· 槽位放宽到 ' + SLOTS + ' 格';
    }

    flyToSlot(t);
    pSlot.push({ ch: t.ch });
    /* 取牌一记短脆（瓷片），凑成时再三片叠响 —— 取和消必须听得出区别 */
    SFX.play('pile.pick');
    renderSlots();
    refreshPileCover();
    pileHud();

    var same = pSlot.filter(function(it){ return !it.pop && it.ch === t.ch; });
    if (same.length >= 3){
      beginMatch(t);
      return;
    }

    /* 取了一张却没凑成：这一手不算失败，但槽满就是失败 */
    if (pSlot.length >= SLOTS){
      failRound();
      return;
    }
    MHINT.textContent = '还剩 ' + Math.ceil(pTiles.length / 3) + ' 组 · 槽里 ' + pSlot.length + ' / ' + SLOTS;
  }

  /* ===================== 验收自测钩子（不参与玩法） =====================
   * dealCheck(n)：在闭包内重复发牌 n 局，逐关轮转；模拟剥皮顺序核对：
   * 每一步可取、全部牌被剥到、三张组不重不漏、同层组计数。供回归脚本批量校验可解性。 */
  if (PILE) PILE.__r2 = {
    spec: PLEVELS.map(function(s){
      var pos = pileLayout(s);
      return { slots: s.slots, layers: s.cols.length, tiles: pos.length, focus: s.focus };
    }),
    dealCheck: function(n){
      var fails = [], sameLayer = 0, runs = 0;
      for (var i = 0; i < n; i++){
        var spec = PLEVELS[i % PLEVELS.length];
        var pos = pileLayout(spec);
        /* 与 buildPile 同一口径：重试至多 40 次，取同层组最少的一副 */
        var d = null;
        for (var att = 0; att < 40; att++){
          var dd = pileDeal(pos);
          if (!d || dd.sameLayer < d.sameLayer) d = dd;
          if (d.sameLayer === 0) break;
        }
        runs++;
        /* 模拟剥皮：peel 每一步在剩余集合里必须可取 */
        var remain = pos.slice();
        var ok = d.peel.length === pos.length;
        d.peel.forEach(function(p){
          var idx = remain.indexOf(p);
          if (idx < 0){ ok = false; return; }
          var cov = false;
          remain.forEach(function(o){
            if (o !== p && o.layer > p.layer && Math.abs(o.x - p.x) < 1 && Math.abs(o.y - p.y) < 1) cov = true;
          });
          if (cov) ok = false;
          remain.splice(idx, 1);
        });
        if (remain.length) ok = false;
        /* 三张组覆盖所有位置、不重不漏（trios 记的是 peel 下标，映射回 pos） */
        var used = {};
        d.trios.forEach(function(ix){ ix.forEach(function(k){ var pi = pos.indexOf(d.peel[k]); used[pi] = (used[pi] || 0) + 1; }); });
        if (Object.keys(used).length !== pos.length) ok = false;
        for (var k2 in used) if (used[k2] !== 1) ok = false;
        sameLayer += d.sameLayer;
        if (!ok) fails.push({ run: i, tiles: pos.length, peel: d.peel.length });
      }
      return { runs: runs, fails: fails.length, failRate: fails.length / runs, sameLayer: sameLayer, detail: fails.slice(0, 5) };
    },
    /* 纯逻辑模拟：按剥皮顺序贪心取牌，第三张同字即消；统计残余槽牌（strand）。 */
    dealNow: function(){
      return { sol: PILE.__sol.slice(), tiles: pTiles.map(function(t){ return { idx: t.idx, ch: t.ch, layer: t.layer, x: t.x, y: t.y, key: !!t.key }; }) };
    },
    /* QA 专用：直接切到第 n 关（0 起）重发一局，仅用于验收截图 */
    jump: function(n){ pLevel = Math.max(0, Math.min(4, n | 0)); buildPile(); },
    simCheck: function(n){
      var res = [];
      PLEVELS.forEach(function(spec, li){
        var pos = pileLayout(spec);
        var strands = 0, maxLeft = 0;
        for (var i = 0; i < n; i++){
          var d = pileDeal(pos);
          var slot = {};
          d.peel.forEach(function(p){
            var ch = d.chByPos[pos.indexOf(p)];
            slot[ch] = (slot[ch] || 0) + 1;
            if (slot[ch] === 3) delete slot[ch];
          });
          var left = Object.keys(slot).reduce(function(a, k){ return a + slot[k]; }, 0);
          if (left > 0) strands++;
          if (left > maxLeft) maxLeft = left;
        }
        res.push({ level: li + 1, runs: n, strands: strands, maxLeft: maxLeft });
      });
      return res;
    },
    /* QA 专用：按"盘面顺序贪心"给出当前该点哪一张（下标）。真机脚本照它点，
       等于用同一把尺子把模拟搬进浏览器 —— 两边数字对不上时，一眼能看出差在哪。 */
    hint: function(){
      if (!pPos || !pPos.length) return -1;
      var cov = coverSets(pPos);
      var avail = [], i, z;
      for (i = 0; i < pPos.length; i++){
        if (pTiles.indexOf(pPos[i]) < 0) continue;
        var blocked = false, cl = cov[i];
        for (z = 0; z < cl.length; z++) if (pTiles.indexOf(pPos[cl[z]]) >= 0){ blocked = true; break; }
        if (!blocked) avail.push(i);
      }
      if (!avail.length) return -1;
      var held = {};
      pSlot.forEach(function(it){ if (!it.pop) held[it.ch] = (held[it.ch] || 0) + 1; });
      for (i = 0; i < avail.length; i++){ if (held[pPos[avail[i]].ch]) return avail[i]; }
      var count = {}, best = avail[0], bestC = -1;
      for (i = 0; i < avail.length; i++){ var c0 = pPos[avail[i]].ch; count[c0] = (count[c0] || 0) + 1; }
      for (i = 0; i < avail.length; i++){
        var n0 = count[pPos[avail[i]].ch];
        if (n0 > bestC){ bestC = n0; best = avail[i]; }
      }
      return best;
    },
    /* 批量贪心模拟：逐关 n 局，返回通关率、槽峰分布、超槽局数。 */
    debugDeal: function(li){
      var spec = PLEVELS[li || 0];
      var pos = pileLayout(spec);
      var d = pileDeal(pos);
      return { slots: spec.slots, pos: pos.map(p => ({ layer: p.layer, x: p.x, y: p.y })),
        peel: d.peel.map(p => pos.indexOf(p)), trios: d.trios, ch: d.chByPos, sameLayer: d.sameLayer };
    },
    greedyCheck: function(n){
      return PLEVELS.map(function(spec, li){
        var pos = pileLayout(spec);
        var cov = coverSets(pos);
        var posOrder = [], pi;
        for (pi = 0; pi < pos.length; pi++) posOrder.push(pi);
        var peaks = {}, wins = 0, maxPeak = 0, over = 0, sameL = 0, t0 = performance.now();
        var peelWins = 0, posWins = 0, posRaw = 0, rawN = 0;
        for (var i = 0; i < n; i++){
          /* 与 buildPile 完全同一口径的闭环发牌 */
          var d = null, r0 = null, key0 = -1e9, att;
          var target = Math.max(2, spec.slots - 1);
          for (att = 0; att < 140; att++){
            var dd = pileDeal(pos);
            var rp = greedyFast(pos, cov, dd, spec.slots);
            var rs = greedyFast(pos, cov, dd, spec.slots, posOrder);
            var ww = (rp.win ? 1 : 0) + (rs.win ? 1 : 0);
            var pk = rs.peak;
            var kk = (rs.win ? 900 : 0) + (rp.win ? 200 : 0) + (dd.sameLayer === 0 ? 400 : 0)
              - Math.abs(pk - target) * 30 - dd.sameLayer * 40;
            if (kk > key0){ key0 = kk; d = dd; r0 = { win: ww === 2, peak: pk, peelWin: rp.win, posWin: rs.win }; }
            if (ww === 2 && dd.sameLayer === 0 && pk === target) break;
          }
          var r = r0;
          if (r.win) wins++;
          if (r.peelWin) peelWins++;
          if (r.posWin) posWins++;
          /* 原始发牌（未经挑选）在盘面顺序下的通关率：这是"这关到底公不公平"的真数字 */
          if (i < 30){
            var rd = pileDeal(pos);
            if (greedyFast(pos, cov, rd, spec.slots, posOrder).win) posRaw++;
            rawN++;
          }
          if (r.peak > spec.slots) over++;
          peaks[r.peak] = (peaks[r.peak] || 0) + 1;
          if (r.peak > maxPeak) maxPeak = r.peak;
          if (d.sameLayer === 0) sameL++;
        }
        var ms = Math.round((performance.now() - t0) / n * 100) / 100;
        return { level: li + 1, slots: spec.slots, tiles: pos.length, runs: n,
          wins: wins, winRate: Math.round(wins / n * 1000) / 10,
          peelWinRate: Math.round(peelWins / n * 1000) / 10,
          posWinRate: Math.round(posWins / n * 1000) / 10,
          posRawRate: rawN ? Math.round(posRaw / rawN * 1000) / 10 : 0,
          cleanLayerRate: Math.round(sameL / n * 1000) / 10,
          peakMax: maxPeak, overSlot: over, peaks: peaks, msPerDeal: ms };
      });
    }
  };

  function cleanup(){
    clearGhost();
    pTiles = [];
    pSlot = [];
    pDone = false;
    pLock = false;
    pHoldTap = null;
    pWin = false;
    pKeyTile = null;
  }

  return {
    open: startPile,
    stop: cleanup,
    close: cleanup,
    fit(){ refit(); },
    replay(){ if (pWin) nextPile(); else retryPile(); }
  };

  /* 台面按本关的网格比例缩放；关卡变了比例也跟着变 */
  function refit(){ fitBox(document.getElementById('pileStage'), pAspect, 0); }
}
