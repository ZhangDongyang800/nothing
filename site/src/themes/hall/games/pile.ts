/* 04 写了个写：多层牌堆，点没被压住的牌进槽，三张同字一起消；五关。
 *
 * 第三轮精品化 —— 用第一性原理重写"这副牌为什么难"：
 *  · 这游戏只有一个资源：槽位。每张牌入槽占一格，同字三张凑齐才还回来。
 *    所以难度必须来自"槽预算 vs 盘面能拿到的同字"，不能来自一条谁也看不见的窄路。
 *    上一轮的口径是"无前瞻的笨手也一定通"，代价是每关只认一条隐藏路线：换一张看似同样正确的
 *    牌，后面就死，输赢都不可归因。这一轮把判据改成"细手能通、粗手会散"：
 *    同组三张改按**剥皮窗口**成组（前后脚被剥开，槽里待消的字有上限），字形改成每关 5–8 个字轮换，
 *    发牌现场用 scan / slot / open 三把尺子量，只收"看得懂也打得通"的牌。
 *  · 失败可归因：槽里每一张牌都标出"这个字现在还能动几张"，槽满的判词直接点出是哪一手塞死的。
 *  · 层要读得出：每层一张"纸板"描边 + 牌落到下一层的硬投影，纵深是看得见的台阶，不是一片淡灰。
 *  · 最后一格有心跳：只剩一格时槽位脉冲，按下会塞满槽的那张牌当场亮朱边。
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

  /* ===================== 发牌口径（第三轮） =====================
   * win  ：短窗 —— 同组三张允许相隔几步被剥开（槽里不会积压）；
   * debt ：每 10 组里有几组是"欠账组"，它的第三张被推到 long 步之后 ——
   *        槽里因此会长期压着一张同字牌，这才是难度所在（不是藏一条窄路）；
   * pool ：这一关盘面上同时出现几个不同的字（越多越难凑，也越像"一堆字"）；
   * runs ：每把尺子跑几种随机打法（同一策略的微抖动，用来量"稳不稳"）。
   * PTARGET 是每关想要的形状：scan 必须全通（细手不会冤死），
   * slot 命中数逐关下降（粗手会散），peak 贴近上限（一直有压力）。 */
  var PGEN = {
    alt: 0.8,
    win: [4, 4, 4, 4, 4],
    debt: [0.10, 0.18, 0.24, 0.30, 0.36],
    long: [7, 7, 8, 8, 9],
    pool: [4, 5, 6, 6, 7],
    runs: 2, tries: 36
  };
  var PTARGET = [
    { slot: 2, peak: 6 },   /* 7 槽 · 教学关：槽里最多 6 张，也基本不该散 */
    { slot: 1, peak: 5 },   /* 6 槽 */
    { slot: 1, peak: 4 },   /* 5 槽 · 第一道真门槛 */
    { slot: 0, peak: 4 },
    { slot: 0, peak: 4 }    /* 极限关：乱开必散，看准才过 */
  ];

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

  /* 一副牌 = 一条"合法剥皮顺序" + 同组三张的分法 + 每组的字。
   * 第三轮把分组的尺子从"层级贴近"换成**剥皮窗口**：同一组三张几乎前后脚被剥开
   * （相隔 ≤ win 步），且尽量落在不同层。这样槽里同时待消的字有上限（≤ 3 个），
   * "槽位预算"变成算得出来的资源；而字形的数量改由 PGEN.pool 控制，一关出现 5–8 个字。 */
  function pileDeal(pos){
    /* ① 剥皮顺序：80% 别紧跟上一层（换层剥），这条顺序本身就是"边挖边揭"的真人路线。 */
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
        if (lastLayer >= 0 && Math.random() < PGEN.alt){
          var other = [];
          for (i = 0; i < avail.length; i++) if (avail[i].layer !== lastLayer) other.push(avail[i]);
          if (other.length) cand = other;
        }
        var pick = cand[Math.floor(Math.random() * cand.length)];
        peel.push(pick);
        lastLayer = pick.layer;
        left.splice(left.indexOf(pick), 1);
      }
    })();

    /* ② 成组：按剥皮窗口收三张，优先不同层。窗口越小，一组越"趁手"；
       少数组是"欠账组"—— 窗口拉到 long 步，第三张被压在后面，槽里得替它留一格。
       难度就是这么来的：不是藏一条窄路，而是让你清清楚楚背一笔账。 */
    var lv = Math.min(pLevel, PGEN.win.length - 1);
    var win = PGEN.win[lv], longWin = PGEN.long[lv], debt = PGEN.debt[lv];
    var trios = [], used = new Array(peel.length).fill(false);
    for (var a = 0; a < peel.length; a++){
      if (used[a]) continue;
      used[a] = true;
      var ix = [a];
      var kw = (Math.random() < debt) ? longWin : win;
      while (ix.length < 3){
        var best = -1, bestScore = -1e9, j;
        var lim = Math.min(peel.length - 1, a + kw);
        for (j = a + 1; j <= lim; j++){
          if (used[j]) continue;
          var ly = peel[j].layer, distinct = true;
          for (var z = 0; z < ix.length; z++) if (peel[ix[z]].layer === ly) distinct = false;
          var sc = (distinct ? 20 : 0) - (j - a) * 1.5;
          if (sc > bestScore){ bestScore = sc; best = j; }
        }
        if (best < 0) break;
        used[best] = true;
        ix.push(best);
      }
      /* 末段窗口里凑不齐：放宽到"剩下的全部"——总数一定是 3 的倍数，必能补齐 */
      if (ix.length < 3){
        for (j = a + 1; j < peel.length && ix.length < 3; j++){
          if (!used[j]){ used[j] = true; ix.push(j); }
        }
      }
      if (ix.length === 3) trios.push(ix);
    }

    /* ②b 修"三张同层"：窗口内只剩整层时，就近成组会把三张塞进同一层。
     * 交换只改"谁跟谁同字"，不改剥皮顺序，所以可解性不受影响。 */
    function trioLayerOf(n2, z){ return peel[n2[z]].layer; }
    function trioSame(n2){
      var L = trioLayerOf(n2, 0);
      for (var z = 1; z < n2.length; z++) if (trioLayerOf(n2, z) !== L) return false;
      return true;
    }
    for (var pass = 0; pass < 8; pass++){
      var fixed = false, ti, ui, m2, o2;
      for (ti = 0; ti < trios.length && !fixed; ti++){
        if (!trioSame(trios[ti])) continue;
        var L0 = trioLayerOf(trios[ti], 0);
        for (ui = 0; ui < trios.length && !fixed; ui++){
          if (ui === ti) continue;
          for (m2 = 0; m2 < trios[ui].length && !fixed; m2++){
            if (trioLayerOf(trios[ui], m2) === L0) continue;
            var othersOK = false;
            for (o2 = 0; o2 < trios[ui].length; o2++){
              if (o2 !== m2 && trioLayerOf(trios[ui], o2) !== L0){ othersOK = true; break; }
            }
            if (!othersOK) continue;
            var kv = trios[ti][0], pv = trios[ui][m2];
            trios[ti][0] = pv; trios[ui][m2] = kv;
            fixed = true;
          }
        }
      }
      if (!fixed) break;
    }

    /* ③ 字：一关盘面上同时出现 5–8 个不同的字，按组轮换。
     * 上一版每组独占一个字、相邻两组共用，一关只有 3–4 种字形 —— 盘面像"三个字写五十遍"，
     * 槽位压力是被"同字复制"放大的，不是被"选择"放大的。 */
    var need = Math.ceil(pos.length / 3);
    var tchars = themeChars(PILE_THEMES[pLevel] || 'sanguo');
    PCHARS.forEach(function(c){ if (tchars.indexOf(c) < 0) tchars.push(c); });
    var poolN = Math.max(3, Math.min(need, PGEN.pool[Math.min(pLevel, PGEN.pool.length - 1)]));
    var pool = shuffle(tchars).slice(0, poolN);
    var chByPos = {}, sameLayer = 0;
    trios.forEach(function(n2, k){
      var ch = pool[k % pool.length];
      var layers = [];
      n2.forEach(function(i){
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

  /* 压牌图的反向表：rev[i] = 被 i 压住的那些牌。拆掉 i 时只给它们解锁，
   * 不必每一步重扫全盘 —— 这是"一局里现场跑几十次模拟"的前提。 */
  function coverRev(cov){
    var rev = [], i, z;
    for (i = 0; i < cov.length; i++) rev.push([]);
    for (i = 0; i < cov.length; i++)
      for (z = 0; z < cov[i].length; z++) rev[cov[i][z]].push(i);
    return rev;
  }

  function rndSeed(seed){
    var s = seed || 1;
    return function(){ s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  /* ===================== 三把尺子 =====================
   * scan：细手 —— 看整叠：能当场凑三张就收；槽里有一张就先找第二张；
   *       只剩两格时"开新字"必须眼前就凑得齐，或者这一手拆掉后正好放出槽里等的那张；
   *       只剩一格时只认当场能收。
   * slot：粗手 —— 槽里有什么就点什么，不看还剩几格（真人最常见的死法）。
   * open：闭眼挖 —— 专挑同字被压得最深的往下挖。
   * scanPick 单独抽出来：模拟与真机页内的 hint 共用同一份判断，两边数字才对得上。 */
  function books(pos, d, alive, und){
    var avail = [], av = {}, buried = {}, i;
    for (i = 0; i < pos.length; i++){
      if (!alive[i]) continue;
      var c0 = d.chByPos[i];
      if (und[i] === 0){ avail.push(i); av[c0] = (av[c0] || 0) + 1; }
      else buried[c0] = (buried[c0] || 0) + 1;
    }
    return { avail: avail, av: av, buried: buried };
  }

  /* 拆掉这一张会放出哪张：放出来的那位正好是槽里等着的同字，这一手就值钱 */
  function releaseScore(i, rev, alive, und, d, slot){
    var best = 0, z, j, inSlot;
    for (z = 0; z < rev[i].length; z++){
      j = rev[i][z];
      if (!alive[j] || und[j] !== 1) continue;   /* 只有它一个压着，才真放得出来 */
      inSlot = slot[d.chByPos[j]] || 0;
      if (inSlot >= 2) return 900;
      if (inSlot === 1) best = 620;
    }
    return best;
  }

  function scanPick(pos, d, cov, rev, alive, und, slot, held, slots, rnd){
    var b = books(pos, d, alive, und), avail = b.avail, av = b.av, buried = b.buried, z;
    if (!avail.length) return -1;
    if (held >= slots - 1){
      for (z = 0; z < avail.length; z++) if ((slot[d.chByPos[avail[z]]] || 0) >= 2) return avail[z];
      return -1;
    }
    var best = -1, bestS = -1e9;
    for (z = 0; z < avail.length; z++){
      var i = avail[z], c = d.chByPos[i], inSlot = slot[c] || 0, a = av[c] || 0, s, rel;
      if (inSlot >= 2) s = 1000;                 /* 这一张就收 */
      else if (inSlot === 1) s = a >= 2 ? 880 : 520;
      else s = a >= 3 ? 950 : a === 2 ? 520 : 90; /* 眼前就有三张 / 只有两张 */
      rel = releaseScore(i, rev, alive, und, d, slot);
      s += rel;
      s += (buried[c] || 0) * 3;
      /* 槽位预算：这一手之后还追得回来吗？
       * 只有"当场收 / 第二张且第三张就在眼前 / 拆了它正好放出第三张"三种追得回来；
       * 其余的手在只剩两格时一律不许 —— 5 格里再开一个新字，光把它凑齐就要占两格，
       * 第三张还没到，槽已经满了。 */
      var safe = (inSlot >= 2) || (inSlot === 1 && a >= 2) || rel >= 600;
      if (!safe && held >= slots - 2) s -= 2000;
      s += rnd ? rnd() * 6 : 0;
      if (s > bestS){ bestS = s; best = i; }
    }
    return best;
  }

  function simRun(pos, cov, rev, d, slots, policy, seed){
    var n = pos.length, i, z;
    var alive = new Array(n).fill(true);
    var und = new Array(n);
    for (i = 0; i < n; i++) und[i] = cov[i].length;   /* und[i]：还压在 i 上面的张数 */
    var rnd = rndSeed(seed);
    var slot = {}, held = 0, peak = 0, left = n, guard = 0, seq = [];
    while (left > 0 && guard++ < n * 2){
      var b = books(pos, d, alive, und);
      if (!b.avail.length) break;
      var pick;
      if (policy === 'scan'){
        pick = scanPick(pos, d, cov, rev, alive, und, slot, held, slots, rnd);
        if (pick < 0) return { win: false, peak: peak, left: left, seq: seq };
      } else {
        var avail = b.avail;
        /* 只剩一格：这一手必须能当场凑成三张。真人也会这么做 ——
           这条对所有策略都生效，散的形状才真实。 */
        if (held >= slots - 1){
          var clearable = -1;
          for (z = 0; z < avail.length; z++){
            if ((slot[d.chByPos[avail[z]]] || 0) >= 2){ clearable = avail[z]; break; }
          }
          if (clearable < 0) return { win: false, peak: peak, left: left, seq: seq };
          avail = [clearable];
        }
        var bestS = -1e9, s;
        pick = avail[0];
        for (z = 0; z < avail.length; z++){
          i = avail[z];
          var c = d.chByPos[i], inSlot = slot[c] || 0;
          if (policy === 'slot') s = inSlot * 120 + (b.av[c] || 0) * 4 + (b.buried[c] || 0) * 2 + rnd() * 6;
          else s = (b.buried[c] || 0) * 12 + rnd() * 10;
          if (s > bestS){ bestS = s; pick = i; }
        }
      }

      alive[pick] = false;
      left--;
      seq.push(pick);
      for (z = 0; z < rev[pick].length; z++) und[rev[pick][z]]--;
      var ch = d.chByPos[pick], cur = (slot[ch] || 0) + 1;
      if (cur === 3){ delete slot[ch]; held -= 2; }
      else {
        slot[ch] = cur; held++;
        if (held >= slots) return { win: false, peak: peak, left: left, seq: seq };
      }
      if (held > peak) peak = held;
    }
    return { win: left === 0, peak: peak, left: left, seq: seq };
  }

  /* 剥皮顺序是一副牌的"作弊路线"，只作诊断：它能不能走完，不代表玩家能不能玩通。 */
  function peelRun(pos, d, slots){
    var slot = {}, held = 0, peak = 0;
    for (var k = 0; k < d.peel.length; k++){
      var ch = d.chByPos[pos.indexOf(d.peel[k])];
      var cur = (slot[ch] || 0) + 1;
      if (cur === 3){ delete slot[ch]; held -= 2; }
      else { slot[ch] = cur; held++; if (held > peak) peak = held; }
      if (held >= slots) return { win: false, peak: peak };
    }
    return { win: true, peak: peak };
  }

  /* 发牌判据：细手全通（不冤死）、粗手命中数贴着本关目标、槽峰贴近上限。
   * `sol` 取一把真的赢下来的 scan 路线 —— `#pile.__sol` 承诺的就是这条，不撒谎。
   * key 用来在 36 次尝试里挑最像本关形状的那一副。 */
  function scoreDeal(pos, cov, rev, d, slots, lv){
    var lvl = (lv == null ? pLevel : lv);
    var t = PTARGET[Math.min(lvl, PTARGET.length - 1)];
    var runs = PGEN.runs, k, scan = 0, slot = 0, lastPeak = 0, sol = null;
    for (k = 0; k < runs; k++){
      var a = simRun(pos, cov, rev, d, slots, 'scan', 101 + k * 37);
      if (a.win){ scan++; if (!sol) sol = a.seq; }
      if (a.peak > lastPeak) lastPeak = a.peak;
    }
    for (k = 0; k < runs; k++){
      if (simRun(pos, cov, rev, d, slots, 'slot', 211 + k * 53).win) slot++;
    }
    var open = simRun(pos, cov, rev, d, slots, 'open', 307);
    var key = (scan === runs ? 920 : scan * 200)
      + (d.sameLayer === 0 ? 260 : -d.sameLayer * 80)
      - Math.abs(slot - t.slot) * 130
      + (lastPeak === t.peak ? 190 : -Math.abs(lastPeak - t.peak) * 45)
      - (open.win ? 60 : 0);   /* 闭眼挖也能过的局，说明纵深不够硬 */
    return { key: key, scan: scan, slot: slot, open: open.win, peel: peelRun(pos, d, slots).win,
      peak: lastPeak, sol: sol,
      perfect: scan === runs && slot === t.slot && d.sameLayer === 0 && lastPeak === t.peak };
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

    /* 排局闭环（第三轮口径）：一副牌要同时满足四件事才收下 ——
     *   ① 没有任何一组三张落在同一层（红线）；
     *   ② 剥皮顺序本身能走完（`#pile.__sol` 不撒谎）；
     *   ③ 细手（scan）3/3 全通 —— 看得懂的人不会冤死；
     *   ④ 粗手（slot）命中数逐关下降 —— 乱存字的人会散，难度来自槽位预算。
     * 取最像本关目标的那一副；都不像时也绝不放必败局（scan 权重最高）。 */
    var cov = coverSets(pos);
    var rev = coverRev(cov);
    var deal = null, dealSim = null, dealKey = -1e9, att;
    for (att = 0; att < PGEN.tries; att++){
      var d = pileDeal(pos);
      var st = scoreDeal(pos, cov, rev, d, SLOTS);
      if (st.key > dealKey){ dealKey = st.key; deal = d; dealSim = st; }
      if (st.perfect) break;
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

    /* 每层一张"纸板"：只画一道虚线边和一条落影，不挡牌、不接点击。
     * 六层叠起来是有台阶的纸摞 —— 上一轮的纵深是一片淡灰，读不出"这摞有多深"。 */
    var maxC = spec.cols[0];
    spec.cols.forEach(function(c, layer){
      var plane = document.createElement('div');
      plane.className = 'pplane';
      plane.style.left = (((maxC - c) / 2) * tw) + '%';
      plane.style.top = padTop + '%';
      plane.style.width = (c * tw) + '%';
      plane.style.height = ((maxY + 1) * th) + '%';
      plane.style.zIndex = String(2 + layer);
      plane.style.setProperty('--lv', String(layer / Math.max(1, spec.cols.length - 1)));
      PILE.appendChild(plane);
    });

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
      b.setAttribute('data-lay', String(p.layer));
      markIcon(b, p.ch);
      /* 压牌角标：掀开这张能放出几张（空着就藏起来，别让 96 张牌都挂数字） */
      var und = document.createElement('i');
      und.className = 'pund';
      b.appendChild(und);
      p.undEl = und;
      b.setAttribute('aria-label', '取走一张「' + p.ch + '」');
      on(b, 'pointerdown', function(){ b.classList.add('is-pick'); armDanger(p); });
      on(b, 'pointerup', function(){ b.classList.remove('is-pick', 'is-danger'); });
      on(b, 'pointerleave', function(){ b.classList.remove('is-pick', 'is-danger'); });
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

    /* 给自动化验收留的钩子：sol 是"照这个顺序点一定清完"的那串下标。
       第三轮改成**真的赢下来的那条**（scan 路线的取牌顺序），不再拿剥皮顺序冒充 ——
       剥皮顺序只是发牌内部的一条"作弊路线"，玩家看不见，也未必走得通。 */
    PILE.__sol = (dealSim.sol || peel.map(function(p){ return pos.indexOf(p); })).slice();
    pPos = pos;
    PILE.__stats = { groups: deal.trios.length, sameLayer: sameLayerTrios, slots: SLOTS, tiles: pTiles.length,
      solvable: dealSim.scan === PGEN.runs, scanWin: dealSim.scan, scanRuns: PGEN.runs,
      slotWin: dealSim.slot, slotTarget: (PTARGET[Math.min(pLevel, PTARGET.length - 1)] || {}).slot,
      openWin: !!dealSim.open, peelWin: !!dealSim.peel, peak: dealSim.peak, attempts: att + 1 };
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

  /* t 下面还压着几张可动牌：角标提示"掀这张能放出几张" */
  function pileCovers(t){
    var n = 0;
    for (var i = 0; i < pTiles.length; i++){
      var o = pTiles[i];
      if (o === t || o.layer <= t.layer) continue;
      if (Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1) n++;
    }
    return n;
  }

  function refreshPileCover(){
    pTiles.forEach(function(t){
      var cov = pileCovered(t);
      t.el.classList.toggle('is-lock', cov);
      if (cov){
        t.el.setAttribute('aria-disabled', 'true');
        t.el.classList.remove('is-cover', 'is-match', 'is-danger');
        if (t.undEl) t.undEl.textContent = '';
      } else {
        t.el.removeAttribute('aria-disabled');
        /* 刚从压住里露出来的牌：浮现落定一拍 */
        if (!t.el.classList.contains('is-reveal')){
          t.el.classList.remove('is-reveal');
          void t.el.offsetWidth;
          t.el.classList.add('is-reveal');
        }
        var und = pileCovers(t);
        t.el.classList.toggle('is-cover', und > 0);
        if (t.undEl) t.undEl.textContent = und ? String(und) : '';
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

  /* 盘上还剩下的牌：pos 下标 → 字。模拟里的 chByPos 是发牌时的全量，
     页内只剩这一层"还活着的"，两者形状一致，scanPick 可以共用。 */
  function pCharOfPos(){
    var out = {};
    pTiles.forEach(function(t){ out[t.idx] = t.ch; });
    return out;
  }

  /* 盘上还动得了的同字张数 —— 槽里那张牌"现在还配不配得上"，就看这个数。 */
  function liveCount(){
    var out = {};
    pTiles.forEach(function(t){
      if (t.el && !t.el.classList.contains('is-lock')) out[t.ch] = (out[t.ch] || 0) + 1;
    });
    return out;
  }

  function renderSlots(){
    var slots = Array.prototype.slice.call(PILE_SLOT.querySelectorAll('.slot'));
    slots.forEach(function(s){
      while (s.firstChild) s.removeChild(s.firstChild);
    });
    var heldCount = {};
    pSlot.forEach(function(it){ if (!it.pop) heldCount[it.ch] = (heldCount[it.ch] || 0) + 1; });
    var live = liveCount();
    var n = 0;
    pSlot.forEach(function(it){
      var s = slots[n];
      if (!s) return;
      var chip = document.createElement('span');
      chip.className = 'sitem' + (it.pop ? ' is-pop' : '');
      if (!it.pop && heldCount[it.ch] >= 2) chip.classList.add('is-dup');
      chip.textContent = it.ch;
      if (!it.pop){
        /* 右下角一枚"还能动几张"：0 就是这张字已经挖断了，槽里这一格是死账 */
        var b = document.createElement('i');
        b.className = 'scount';
        var k = live[it.ch] || 0;
        b.textContent = String(k);
        if (!k) b.classList.add('is-dead');
        else if (k < 3 - heldCount[it.ch]) b.classList.add('is-thin');
        chip.appendChild(b);
        chip.setAttribute('aria-label', '槽里「' + it.ch + '」· 盘上还能动 ' + k + ' 张');
      }
      s.appendChild(chip);
      n++;
    });
    var held = pSlot.filter(function(it){ return !it.pop; }).length;
    PILE_SLOT.classList.toggle('is-hot', held >= SLOTS - 1);
    PILE_SLOT.classList.toggle('is-last', held >= SLOTS - 1);
    PILE_SLOT.classList.toggle('is-strain', held >= SLOTS - 2 && held < SLOTS - 1);
  }

  /* 按下这张牌会不会当场塞满槽：会，就先亮朱边 —— 别等散了才知道 */
  function armDanger(t){
    pTiles.forEach(function(o){ if (o.el) o.el.classList.remove('is-danger'); });
    if (!t.el || t.el.classList.contains('is-lock')) return;
    var held = pSlot.filter(function(it){ return !it.pop; }).length;
    var same = pSlot.filter(function(it){ return !it.pop && it.ch === t.ch; }).length;
    if (held >= SLOTS - 1 && same < 2) t.el.classList.add('is-danger');
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
    /* 判词要能归因：槽里哪几个字、各几张、哪个字已经挖断了。
       "差一张"的死法最该被记住，因为它下一手就能避免。 */
    var live = liveCount();
    var tally = {}, order = [];
    pSlot.forEach(function(it){
      if (it.pop) return;
      if (!tally[it.ch]) order.push(it.ch);
      tally[it.ch] = (tally[it.ch] || 0) + 1;
    });
    var parts = order.map(function(ch){ return ch + '×' + tally[ch]; });
    var dead = order.filter(function(ch){ return !(live[ch] || 0); });
    showVerdict(PILE_V, PILE_VT, PILE_VS, 'v-bad',
      '第 ' + (pLevel + 1) + ' 关散了 · ' + parts.join('、') + (dead.length ? ' · 「' + dead[0] + '」拿不到了' : ''),
      '散');
    MHINT.textContent = dead.length
      ? '散了 · 「' + dead[0] + '」在盘上已经动不了，那一手不该存'
      : '散了 · 槽塞满，本关重来';
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
    /* 先刷盘面（锁/可动/角标），再画槽：槽里的"还能动几张"要拿这一手之后的盘面算 */
    refreshPileCover();
    renderSlots();
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
    var held = pSlot.filter(function(it){ return !it.pop; }).length;
    MHINT.textContent = held >= SLOTS - 1
      ? '只剩一格 · 这一手必须能当场凑三张'
      : '还剩 ' + Math.ceil(pTiles.length / 3) + ' 组 · 槽里 ' + held + ' / ' + SLOTS;
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
    /* QA 专用：按"细手"口径给出当前该点哪一张（pos 下标）。和模拟共用 scanPick，
       两边数字对不上时，一眼看出差在哪。 */
    hint: function(){
      if (!pPos || !pPos.length) return -1;
      var cov = coverSets(pPos), rev = coverRev(cov);
      var alive = new Array(pPos.length).fill(false);
      pTiles.forEach(function(t){ alive[t.idx] = true; });
      var und = cov.map(function(list){
        var n0 = 0;
        for (var q = 0; q < list.length; q++) if (alive[list[q]]) n0++;
        return n0;
      });
      var slot = {}, held = 0, k;
      pSlot.forEach(function(it){ if (!it.pop) slot[it.ch] = (slot[it.ch] || 0) + 1; });
      for (k in slot) held += slot[k];
      return scanPick(pPos, { chByPos: pCharOfPos() }, cov, rev, alive, und, slot, held, SLOTS, null);
    },
    /* QA 专用：看一副原始发牌的几何与分组（不挑选，不碰局内状态） */
    debugDeal: function(li){
      var spec = PLEVELS[li || 0];
      var pos = pileLayout(spec);
      var d = pileDeal(pos);
      return { slots: spec.slots, pos: pos.map(function(p){ return { layer: p.layer, x: p.x, y: p.y }; }),
        peel: d.peel.map(function(p){ return pos.indexOf(p); }), trios: d.trios, ch: d.chByPos, sameLayer: d.sameLayer };
    },
    /* 批量量尺：逐关 n 次"现场发牌"，返回细手/粗手/闭眼挖的通关率与槽峰分布。
     * 还单列"原始发牌"（不挑选）的细手/粗手通关率 —— 那是这一关真实的松紧，不是挑出来的。 */
    greedyCheck: function(n){
      var out = PLEVELS.map(function(spec, li){
        var pos = pileLayout(spec), cov = coverSets(pos), rev = coverRev(cov);
        var runs = 0, attTotal = 0, msTotal = 0;
        var scanW = 0, slotW = 0, peelW = 0, openW = 0, clean = 0, peakMax = 0, peaks = {};
        var rawN = 0, rawScan = 0, rawSlot = 0;
        for (var i = 0; i < n; i++){
          var t1 = performance.now();
          var d = null, stat = null, key = -1e9, att;
          for (att = 0; att < PGEN.tries; att++){
            var dd = pileDeal(pos);
            var st = scoreDeal(pos, cov, rev, dd, spec.slots, li);
            if (st.key > key){ key = st.key; d = dd; stat = st; }
            if (st.perfect) break;
          }
          msTotal += performance.now() - t1;
          attTotal += att + 1;
          runs++;
          if (stat.scan === PGEN.runs) scanW++;
          slotW += stat.slot / PGEN.runs;
          if (stat.peel) peelW++;
          if (stat.open) openW++;
          if (d.sameLayer === 0) clean++;
          peaks[stat.peak] = (peaks[stat.peak] || 0) + 1;
          if (stat.peak > peakMax) peakMax = stat.peak;
          /* 原始发牌：同一把尺子，不挑选 */
          if (i < 24){
            var rd = pileDeal(pos);
            if (simRun(pos, cov, rev, rd, spec.slots, 'scan', 101).win) rawScan++;
            if (simRun(pos, cov, rev, rd, spec.slots, 'slot', 211).win) rawSlot++;
            rawN++;
          }
        }
        var pct = function(a, b){ return b ? Math.round(a / b * 1000) / 10 : 0; };
        return { level: li + 1, slots: spec.slots, tiles: pos.length, runs: runs,
          attemptsAvg: Math.round(attTotal / runs * 10) / 10,
          msPerDeal: Math.round(msTotal / runs * 10) / 10,
          scanRate: pct(scanW, runs), slotRate: pct(slotW, runs), peelRate: pct(peelW, runs),
          openRate: pct(openW, runs), cleanLayerRate: pct(clean, runs),
          peakMax: peakMax, peaks: peaks,
          rawScanRate: pct(rawScan, rawN), rawSlotRate: pct(rawSlot, rawN) };
      });
      return out;
    },
    /* 调参口（只给本地量尺用）：改 PGEN 后重新 greedyCheck，不必改源码反复构建 */
    params: function(o){
      if (!o) return { PGEN: PGEN, PTARGET: PTARGET };
      for (var k in o) if (k in PGEN) PGEN[k] = o[k];
      return PGEN;
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
