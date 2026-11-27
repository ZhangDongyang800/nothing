/* 06 抽词：翻卡成双，十对为满；三档记忆负担分层，反馈链完整。
 * 独占文件：本文件 + games/word.css。音效键沿用 sfx.ts 既有 pair.*，特效只调 fx.ts 既有原语。 */
// @ts-nocheck
import '../games/word.css';

export function mountWord(ctx){
  const {
    on, later, FX, SFX, MHINT, BEST,
    themeOf, themeChars, markTheme, markIcon, shuffle,
    comboState, comboAdd, comboMult, comboBreak, popAt, hudSet, showVerdict, fmtStars
  } = ctx;

  var PAIR_GRID = document.getElementById('pairGrid');
  var HUD_LEFT = document.getElementById('hudLeft');
  var HUD_STEP = document.getElementById('hudStep');
  var HUD_MAX = document.getElementById('hudMax');
  var PAIR_V = document.getElementById('pairVerdict');
  var PAIR_VT = document.getElementById('pairVText');
  var PAIR_VS = document.getElementById('pairVSeal');
  var PAIR_START = document.getElementById('pairStart');
  var PAIR_TIER = document.getElementById('pairTier');
  var PAIR_GO = document.getElementById('pairGo');
  var PAIR_COUNT = document.getElementById('pairCount');
  var PAIR_PANE = document.getElementById('pane-word');
  var PAIR_THEME = document.getElementById('pairTheme');
  var PAIR_TIP = document.querySelector('#pairStart .pair-start-tip');
  var PAIR_SCORE = document.getElementById('pairScore');
  var PAIR_COMBO = document.getElementById('pairCombo');
  var PAIR_PEEK = document.getElementById('pairPeek');

  var PAIR_THEMES = ['sanguo', 'qiwu', 'shanshui', 'qiwu'];
  var pairRound = 0;
  var PAIR_THEME_KEY = 'sanguo';
  var PAPER_TONES = ['#f4e8cf', '#f6ecd2', '#eee3c9'];

  /* ---------- 近形 / 同部首簇（内部启发式，只用于牌组构造分层） ----------
   * 配对判定永远是「同字相等」，簇标签只决定牌组里放不放长得像的字；
   * 玩家记错是记忆问题，牌面不会藏字、不会错标。 */
  var LOOKALIKE = [
    ['water', '流江渡清泉法海溪池潮'],
    ['wood',  '松林竹桥木梅桃柳枝叶'],
    ['moon',  '明月晚夜阳星空星辰晴'],
    ['peak',  '山峰岭岳崖谷'],
    ['fire',  '火灯烛炎焰炉灰'],
    ['metal', '金镜锋针铁尺钉'],
    ['book',  '笔墨纸砚书册卷印'],
    ['silk',  '纸维纯纪线绳'],
    ['heart', '忠慈慎怀甘念恩']
  ];
  var LK_INDEX = {};
  LOOKALIKE.forEach(function(cl){
    for (var i = 0; i < cl[1].length; i++) LK_INDEX[cl[1].charAt(i)] = cl[0];
  });
  function lkOf(c){ return LK_INDEX[c] || c; }

  function poolFor(key){
    var t = themeOf(key), out = {}, list = [];
    t.words.forEach(function(w){
      for (var i = 0; i < w.length; i++){
        var c = w.charAt(i);
        if (!out[c]){ out[c] = 1; list.push({ g: c, n: w, lk: lkOf(c) }); }
      }
    });
    themeChars(key).forEach(function(c){
      if (!out[c]){ out[c] = 1; list.push({ g: c, n: t.name, lk: lkOf(c) }); }
    });
    return list;
  }

  /* 按档位偏好挑字：
   *  easy 每簇至多一字（字疏好认）；
   *  mid  先从成簇里成对取约一半，其余单字补足；
   *  hard 成簇近形字优先，每簇取满。
   * 轮询用稳定指针：空簇就地删除、指针不回跳，避免 splice 错位跳过整簇。 */
  function pickFrom(pool, pairs, bias){
    var by = {};
    pool.forEach(function(c){ (by[c.lk] = by[c.lk] || []).push(c); });
    var clusterKeys = Object.keys(by).filter(function(k){ return by[k].length > 1; });
    var singleKeys = Object.keys(by).filter(function(k){ return by[k].length === 1; });
    var picked = [];
    var perCluster = bias === 'cluster' ? 99 : (bias === 'mix' ? 2 : 1);

    function takeKey(k){ var g = by[k]; if (g.length){ picked.push(g.shift()); return true; } return false; }

    if (bias === 'cluster'){
      var ci = 0, guard = 0;
      while (picked.length < pairs && clusterKeys.length && guard++ < 300){
        if (ci >= clusterKeys.length) ci = 0;
        var ck = clusterKeys[ci];
        if (!by[ck].length){ clusterKeys.splice(ci, 1); continue; }
        takeKey(ck);
        if (!by[ck].length){ clusterKeys.splice(ci, 1); continue; }
        ci++;
      }
    } else if (bias === 'mix'){
      var targetCluster = Math.ceil(pairs / 2);
      var mi = 0, g2 = 0;
      while (picked.length < targetCluster && clusterKeys.length && g2++ < 300){
        if (mi >= clusterKeys.length) mi = 0;
        var mk = clusterKeys[mi];
        if (!by[mk].length){ clusterKeys.splice(mi, 1); continue; }
        takeKey(mk);
        if (by[mk].length && picked.length < targetCluster) takeKey(mk);
        if (!by[mk].length){ clusterKeys.splice(mi, 1); continue; }
        mi++;
      }
    }

    var rest = clusterKeys.concat(singleKeys);
    var ri = 0, guard2 = 0;
    while (picked.length < pairs && rest.length && guard2++ < 300){
      if (ri >= rest.length) ri = 0;
      var rk = rest[ri];
      if (!by[rk].length){ rest.splice(ri, 1); continue; }
      var used = picked.filter(function(p){ return p.lk === rk; }).length;
      if (used < perCluster) takeKey(rk);
      if (!by[rk].length){ rest.splice(ri, 1); continue; }
      ri++;
    }
    return picked.slice(0, pairs);
  }

  function makeDeck(tierKey, round){
    var t = PAIR_TIERS[tierKey];
    var key = PAIR_THEMES[round % PAIR_THEMES.length];
    var pool = poolFor(key);
    var picked = pickFrom(pool, t.pairs, t.bias);
    /* 兜底：主题字池不足时跨主题补足，保证每对都是有效同字、牌面有词注。 */
    if (picked.length < t.pairs){
      PAIR_THEMES.forEach(function(k){
        if (picked.length >= t.pairs) return;
        poolFor(k).forEach(function(c){
          if (picked.length >= t.pairs) return;
          if (!picked.some(function(p){ return p.g === c.g; })) picked.push(c);
        });
      });
    }
    var deck = [];
    picked.forEach(function(g, i){
      var tone = PAPER_TONES[i % PAPER_TONES.length];
      deck.push({ g: g.g, n: g.n, lk: g.lk, c: tone });
      deck.push({ g: g.g, n: g.n, lk: g.lk, c: tone });
    });
    shuffle(deck);
    return { key: key, deck: deck, picked: picked };
  }

  /* 三档红线：易 12 / 中 16 / 难 20 张；易/中预展、难无预展。
   * 记忆负担分层：近形簇偏好 · 预展时长 · 牌面词注有无 · 错误回翻节奏 · 连击窗口 · 看一眼次数。 */
  var PAIR_TIERS = {
    easy: { pairs: 6,  steps: 18, preview: 2200, cols: 4, peek: 2, missShow: 720, comboWin: 3800, label: true,  bias: 'spread'  },
    mid:  { pairs: 8,  steps: 20, preview: 1200, cols: 4, peek: 2, missShow: 540, comboWin: 3200, label: true,  bias: 'mix'     },
    hard: { pairs: 10, steps: 22, preview: 0,    cols: 5, peek: 1, missShow: 380, comboWin: 2600, label: false, bias: 'cluster' }
  };
  var pairTier = 'mid';
  try {
    var savedTier = localStorage.getItem('txxt-pair-tier');
    if (savedTier && PAIR_TIERS[savedTier]) pairTier = savedTier;
  } catch(e){}

  var pOpen = [], pMatched = 0, pSteps = 0, pLock = false, pPhase = 'idle';
  var pScore = 0, pBestScore = 0, pPeek = 2, pMaxCombo = 0, pMisses = 0, pDeck = [];
  var pCombo = comboState(3800, 6);

  function tier(){ return PAIR_TIERS[pairTier]; }

  function syncTierUI(){
    Array.prototype.slice.call(PAIR_TIER.querySelectorAll('[data-tier]')).forEach(function(b){
      b.classList.toggle('is-on', b.getAttribute('data-tier') === pairTier);
    });
  }

  function updatePairHud(){
    var t = tier();
    HUD_LEFT.textContent = String(t.pairs - pMatched);
    HUD_STEP.textContent = String(pSteps);
    HUD_MAX.textContent = String(t.steps);
    HUD_LEFT.parentNode.classList.toggle('is-low', t.pairs - pMatched <= 2);
    HUD_STEP.parentNode.classList.toggle('is-low', t.steps - pSteps <= 4);
    hudSet(PAIR_SCORE, pScore);
    FX.combo(PAIR_COMBO, pCombo.n);
    if (PAIR_PEEK){
      PAIR_PEEK.textContent = pPeek > 0 ? '看一眼（' + pPeek + '）· 耗 2 步' : '看一眼 · 用完了';
      PAIR_PEEK.disabled = pPeek <= 0 || pPhase !== 'play';
    }
  }

  /* 每翻一步，数字跟着抖一下——不用旁白也知道又走了一步 */
  function tickHud(){
    var n = HUD_STEP.parentNode;
    n.classList.remove('is-hit');
    void n.offsetWidth;
    n.classList.add('is-hit');
  }

  function startPair(){
    pPhase = 'idle';
    pOpen = [];
    pMatched = 0;
    pSteps = 0;
    pScore = 0;
    pMisses = 0;
    pPeek = tier().peek;
    pMaxCombo = 0;
    pCombo = comboState(tier().comboWin, 6);
    pBestScore = BEST.get('pair.score');
    ctx.startBest('pairStartBest', pBestScore, '分');
    pLock = true;
    PAIR_GRID.innerHTML = '';
    PAIR_GRID.classList.remove('is-live', 'is-flaw', 'is-dead');
    PAIR_GRID.style.removeProperty('--cols');
    PAIR_COUNT.textContent = '';
    PAIR_COUNT.classList.remove('is-beat');
    PAIR_V.classList.remove('is-on');
    PAIR_VS.className = 'verdict-seal';
    PAIR_VS.textContent = '';
    PAIR_START.classList.add('is-on');
    PAIR_GRID.parentNode.classList.add('is-idle');
    syncTierUI();
    updatePairHud();
    var next = themeOf(PAIR_THEMES[pairRound % PAIR_THEMES.length]);
    markTheme(PAIR_PANE, PAIR_THEMES[pairRound % PAIR_THEMES.length]);
    if (PAIR_TIP) PAIR_TIP.textContent = '翻开一样的两个 · 本局写「' + next.name + '」';
    if (PAIR_THEME) PAIR_THEME.textContent = next.name;
    MHINT.textContent = '选个难度 · 按开始';
  }

  /* 铺牌：背面朝上、按序落下；此时还不能点 */
  function buildPairGrid(){
    var t = tier();
    var deal = makeDeck(pairTier, pairRound++);
    PAIR_THEME_KEY = deal.key;
    pDeck = deal.deck;
    markTheme(PAIR_PANE, deal.key);
    if (PAIR_THEME) PAIR_THEME.textContent = themeOf(deal.key).name;
    PAIR_GRID.style.setProperty('--cols', String(t.cols));
    PAIR_GRID.dataset.tier = pairTier;
    PAIR_GRID.dataset.face = t.label ? 'full' : 'bare';
    PAIR_GRID.innerHTML = '';
    deal.deck.forEach(function(g, idx){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pcard';
      b.style.animationDelay = (idx * 26) + 'ms';
      b.setAttribute('aria-label', '翻开一张卡');
      b.innerHTML =
        '<span class="pcard-inner">' +
          '<span class="pback"><i>词</i></span>' +
          '<span class="pfront" style="--pc:' + g.c + '">' +
            '<span class="pg">' + g.g + '</span>' +
            '<span class="pn">' + g.n + '</span>' +
          '</span>' +
        '</span>';
      markIcon(b.querySelector('.pfront'), g.g);
      on(b, 'click', function(){ onPair(b, g); });
      PAIR_GRID.appendChild(b);
    });
    fitPair();
  }

  function beginPair(){
    if (pPhase !== 'idle') return;
    PAIR_START.classList.remove('is-on');
    PAIR_GRID.parentNode.classList.remove('is-idle');
    buildPairGrid();
    updatePairHud();
    pPhase = 'count';
    MHINT.textContent = '准备 · 三秒后开始';
    later(function(){ pairCountdown(3); }, 380);
  }

  function pairCountdown(n){
    if (pPhase !== 'count') return;
    PAIR_COUNT.textContent = n > 0 ? String(n) : '走';
    PAIR_COUNT.classList.remove('is-beat');
    void PAIR_COUNT.offsetWidth;
    PAIR_COUNT.classList.add('is-beat');
    if (n > 0){ later(function(){ pairCountdown(n - 1); }, 620); return; }
    later(function(){
      PAIR_COUNT.textContent = '';
      PAIR_COUNT.classList.remove('is-beat');
      if (tier().preview > 0) enterPreview(tier().preview);
      else enterPlay();
    }, 500);
  }

  /* 预展：整副牌亮一下，记住位置再盖上 */
  function enterPreview(ms){
    if (pPhase !== 'count') return;
    pPhase = 'preview';
    MHINT.textContent = '记住位置 · 马上盖上';
    var cards = Array.prototype.slice.call(PAIR_GRID.querySelectorAll('.pcard'));
    cards.forEach(function(c){ c.classList.add('is-up'); });
    later(function(){
      cards.forEach(function(c){ c.classList.remove('is-up'); });
      later(enterPlay, 430);
    }, ms);
  }

  function enterPlay(){
    pPhase = 'play';
    pLock = false;
    PAIR_GRID.classList.add('is-live');
    updatePairHud();
    MHINT.textContent = '还剩 ' + (tier().pairs - pMatched) + ' 对 · 翻开一样的两个';
  }

  function finishWin(){
    pPhase = 'done';
    PAIR_GRID.classList.remove('is-live');
    var flawless = pMisses === 0;
    var bs = BEST.get('pair.steps');
    BEST.setMin('pair.steps', pSteps);
    var stars = pSteps <= tier().pairs + 2 ? 3 : (pSteps <= tier().pairs + Math.ceil((tier().steps - tier().pairs) / 2) ? 2 : 1);
    var prevBest = Math.max(pBestScore, BEST.get('pair.score'));
    pScore += stars * 150 + (flawless ? 200 : 0);
    BEST.set('pair.score', pScore);
    var text = (flawless ? '零失误 · ' : '') + fmtStars(stars) + ' ' + tier().pairs + ' 对全成 · ' + pSteps + ' 步 · ' + pScore + ' 分'
      + (bs && bs < pSteps ? '（最好 ' + bs + ' 步）' : (pScore > prevBest ? ' · 新纪录' : ''));
    showVerdict(PAIR_V, PAIR_VT, PAIR_VS, 'v-ok', text, flawless ? '无瑕' : '成');
    if (flawless){
      PAIR_GRID.classList.add('is-flaw');
      PAIR_VS.classList.add('is-flawless');
      later(function(){
        var r = PAIR_GRID.getBoundingClientRect();
        FX.ring(r.left + r.width / 2, r.top + r.height / 2, r.width * 0.16, r.width * 0.5, 4, '#ffd166');
        FX.rise(r.left + r.width / 2, r.top + r.height * 0.4, 14, ['#ffd166', '#fff8e8']);
      }, 240);
    }
    MHINT.textContent = (flawless ? '零失误 · ' : '全成 · ') + '最多 ' + pMaxCombo + ' 连击';
  }

  function finishLose(){
    pPhase = 'done';
    PAIR_GRID.classList.remove('is-live');
    PAIR_GRID.classList.add('is-dead');
    showVerdict(PAIR_V, PAIR_VT, PAIR_VS, 'v-bad', '散了 · 步数用完，只成 ' + pMatched + ' 对 / ' + pScore + ' 分', '散');
    MHINT.textContent = '散了 · 只成 ' + pMatched + ' 对，再来一次';
  }

  function onPair(el, g){
    if (pPhase !== 'play' || pLock) return;
    if (el.classList.contains('is-up') || el.classList.contains('is-out')) return;
    el.classList.add('is-up');
    /* 翻牌一记纸牌"嗒"；两张不一样时低半度的一记"翻回去"，成双则由匹配音接住 */
    SFX.play('pair.flip', { rate: pOpen.length ? 0.92 : 1 });
    /* 翻牌微尘：两三点纸色碎末，普通档粒子预算 */
    FX.sparks(el.getBoundingClientRect(), 2, '#efe9da');
    pOpen.push({ el: el, g: g });
    if (pOpen.length < 2) return;

    var a = pOpen[0].el, b = pOpen[1].el;
    var same = pOpen[0].g.g === pOpen[1].g.g;
    pSteps++;
    pLock = true;
    updatePairHud();
    tickHud();

    if (same){
      /* 成双：先描金、露一个勾，金环 + 金粉卡纸两色碎，再让两张各自歪着飘走 */
      SFX.play('pair.match', { rate: 1 + Math.min(0.45, pCombo.n * 0.05) });
      later(function(){
        a.classList.add('is-match');
        b.classList.add('is-match');
        [a, b].forEach(function(card){
          var r = card.getBoundingClientRect();
          var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          FX.ring(cx, cy, Math.max(6, Math.min(r.width, r.height) * 0.28), Math.max(24, Math.max(r.width, r.height) * 0.85), 3, '#ffd166');
          FX.burst(r, { count: 10, power: 420, colors: ['#ffd166', '#fff8e8', '#252525'], dust: 5 });
        });
      }, 90);
      later(function(){
        a.style.setProperty('--tilt', '-11deg');
        b.style.setProperty('--tilt', '11deg');
        a.classList.remove('is-match');
        b.classList.remove('is-match');
        a.classList.add('is-out');
        b.classList.add('is-out');
        pMatched++;
        pOpen = [];
        pLock = false;

        /* 成双得分：100 × 连击。连击只兑现成"分数与星级"，不额外给步数。 */
        comboAdd(pCombo);
        pMaxCombo = Math.max(pMaxCombo, pCombo.n);
        var mult = comboMult(pCombo);
        var gain = 100 * mult;
        pScore += gain;
        popAt(a, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 3 ? 'is-gold' : '');
        if (mult >= 3) FX.rise(b.getBoundingClientRect().left + 12, b.getBoundingClientRect().top + 6, 10, ['#ffd166', '#fff8e8']);
        if (pCombo.n >= 2) FX.freeze(pCombo.n >= 3 ? 75 : 50);
        updatePairHud();

        if (pMatched === tier().pairs){
          finishWin();
        } else {
          MHINT.textContent = '还剩 ' + (tier().pairs - pMatched) + ' 对' + (pCombo.n >= 2 ? ' · ' + pCombo.n + ' 连击' : '');
        }
      }, 430);
      return;
    }

    /* 不一样：两牌并置比较、朱色描边，按档位节奏盖回；不做暴力震屏。 */
    pMisses++;
    if (pCombo.n >= 2) popAt(b, '断', 'is-bad');
    SFX.play('pair.miss');
    comboBreak(pCombo);
    updatePairHud();
    later(function(){
      a.classList.add('is-miss');
      b.classList.add('is-miss');
    }, 60);
    later(function(){
      a.classList.remove('is-up', 'is-miss');
      b.classList.remove('is-up', 'is-miss');
      pOpen = [];
      pLock = false;
      later(function(){
        if (pPhase === 'play' && pSteps >= tier().steps && pMatched < tier().pairs){
          finishLose();
        }
      }, 180);
    }, tier().missShow);
  }

  /* 选档：只在开局面板期（一手没出）可换 */
  on(PAIR_TIER, 'click', function(e){
    var b = e.target;
    while (b && b !== PAIR_TIER && !b.getAttribute('data-tier')) b = b.parentNode;
    if (!b || b === PAIR_TIER) return;
    var t = b.getAttribute('data-tier');
    if (!PAIR_TIERS[t] || pPhase !== 'idle') return;
    pairTier = t;
    pPeek = tier().peek;
    try { localStorage.setItem('txxt-pair-tier', t); } catch(e){}
    syncTierUI();
    updatePairHud();
    MHINT.textContent = t === 'hard' ? '难档 · 十对 · 开局不亮牌 · 长得像的字更多'
      : (t === 'easy' ? '易档 · 六对 · 开局先亮牌 · 字少好认' : '中档 · 八对 · 开局先亮牌 · 混入长得像的字');
  });
  on(PAIR_GO, 'click', beginPair);
  /* 键盘也能开局：开局面板盖着时空格 / 回车 = 开始（选中的难度照常生效） */
  on(window, 'keydown', function(e){
    if (ctx.current !== 'word') return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (!PAIR_START.classList.contains('is-on') || pPhase !== 'idle' || e.repeat) return;
    e.preventDefault();
    beginPair();
  });

  /* 看一眼：花 2 步换一次全亮。步数是硬账，值不值得由人自己判。 */
  if (PAIR_PEEK) on(PAIR_PEEK, 'click', function(){
    if (pPhase !== 'play' || pLock || pPeek <= 0) return;
    if (pSteps + 2 >= tier().steps) { MHINT.textContent = '步数不够看一眼了 · 还剩 ' + (tier().steps - pSteps) + ' 步'; return; }
    pPeek--;
    pSteps += 2;
    pLock = true;
    updatePairHud();
    tickHud();
    MHINT.textContent = '看一眼 · 记住位置（耗 2 步）';
    SFX.play('pair.peek');
    var cards = Array.prototype.slice.call(PAIR_GRID.querySelectorAll('.pcard'));
    cards.forEach(function(c){ if (!c.classList.contains('is-out')) c.classList.add('is-up'); });
    later(function(){
      cards.forEach(function(c){ if (!c.classList.contains('is-out')) c.classList.remove('is-up'); });
      later(function(){ pLock = false; updatePairHud(); }, 380);
    }, 700);
  });

  /* 04 的卡阵：先按"行数 × 卡高"反算卡宽，再看列宽够不够 */
  function fitPair(){
    var g = PAIR_GRID;
    if (!g || !g.parentElement) return;
    var host = g.parentElement;
    var aw = host.clientWidth, ah = host.clientHeight;
    if (aw < 120 || ah < 120) return;
    var cols = Number(g.style.getPropertyValue('--cols')) || 4;
    var rows = Math.ceil((g.children.length || 16) / cols);
    var gap = 10;
    var byH = (ah - gap * (rows - 1)) / rows / 1.4;
    var byW = (aw - gap * (cols - 1)) / cols;
    var card = Math.min(byH, byW);
    var w = Math.floor(card * cols + gap * (cols - 1));
    g.style.width = Math.min(w, aw) + 'px';
  }

  /* ===================== 验收自测钩子（不参与玩法） ===================== */
  function deckStats(picked){
    var lkCount = {}, glyph = {};
    picked.forEach(function(p){ lkCount[p.lk] = (lkCount[p.lk] || 0) + 1; glyph[p.g] = 1; });
    var clustered = picked.filter(function(p){ return lkCount[p.lk] > 1; }).length;
    return {
      pairs: picked.length,
      cards: picked.length * 2,
      uniqueGlyphs: Object.keys(glyph).length,
      nearFormCards: clustered * 2,
      nearFormRatio: picked.length ? Math.round(clustered / picked.length * 1000) / 1000 : 0,
      labels: picked.filter(function(p){ return p.n && p.n.length; }).length
    };
  }

  function dealCheck(n){
    var res = { runs: 0, fails: 0, perTier: {} };
    Object.keys(PAIR_TIERS).forEach(function(tk){
      var t = PAIR_TIERS[tk];
      var agg = { runs: 0, fails: 0, cards: 0, nearFormRatio: 0, labels: 0, dupGlyph: 0, badMulti: 0 };
      for (var i = 0; i < n; i++){
        var deal = makeDeck(tk, i);
        agg.runs++; res.runs++;
        var st = deckStats(deal.picked);
        var mult = {};
        deal.deck.forEach(function(c){ mult[c.g] = (mult[c.g] || 0) + 1; });
        var ok = deal.deck.length === t.pairs * 2 && st.pairs === t.pairs &&
                 Object.keys(mult).every(function(g){ return mult[g] === 2; }) &&
                 deal.picked.every(function(p){ return p.g && p.n; });
        if (!ok){ agg.fails++; res.fails++; }
        agg.cards += deal.deck.length;
        agg.nearFormRatio += st.nearFormRatio;
        agg.labels += st.labels;
        Object.keys(mult).forEach(function(g){ if (mult[g] > 2) agg.dupGlyph++; });
      }
      agg.nearFormRatio = Math.round(agg.nearFormRatio / agg.runs * 1000) / 1000;
      agg.labelRatio = Math.round(agg.labels / (agg.runs * t.pairs) * 1000) / 1000;
      res.perTier[tk] = agg;
    });
    return res;
  }

  if (PAIR_GRID){
    PAIR_GRID.__probe = function(){
      return {
        phase: pPhase,
        lock: pLock,
        live: PAIR_GRID.classList.contains('is-live'),
        cards: PAIR_GRID.children.length,
        matched: pMatched,
        left: tier().pairs - pMatched,
        steps: pSteps,
        stepsMax: tier().steps,
        score: pScore,
        combo: pCombo.n,
        maxCombo: pMaxCombo,
        misses: pMisses,
        flawless: pMisses === 0 && pPhase === 'done' && pMatched === tier().pairs,
        win: pPhase === 'done' && pMatched === tier().pairs,
        lose: pPhase === 'done' && pMatched < tier().pairs,
        tier: pairTier,
        peek: pPeek,
        preview: tier().preview
      };
    };
    PAIR_GRID.__r2 = {
      spec: JSON.parse(JSON.stringify(PAIR_TIERS)),
      dealCheck: dealCheck,
      deckNow: function(){ return pDeck.map(function(c){ return { g: c.g, n: c.n, lk: c.lk }; }); },
      pool: function(key){ return poolFor(key).map(function(c){ return c.g + ':' + c.lk; }); },
      sample: function(tk, n){
        var arr = [];
        for (var i = 0; i < n; i++){
          var d = makeDeck(tk, i);
          arr.push(d.picked.map(function(p){ return p.g + ':' + p.lk; }));
        }
        return arr;
      },
      jump: function(t){ if (PAIR_TIERS[t]){ pairTier = t; startPair(); } }
    };
  }

  return {
    open: startPair,
    replay: startPair,
    stop: function(){},
    close: function(){},
    fit: fitPair
  };
}
