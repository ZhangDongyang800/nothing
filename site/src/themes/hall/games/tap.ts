/* 13 敲印：反应速度挑战。点掉冒出来的印；金印加命（上限 5）；墨印别点。
 *
 * 本轮精品化（只动本文件 + games/tap.css；共享特效调 fx.ts，共享音效调 sfx.ts，
 * 不新建画布 / 不新增音色 / 不新增依赖）：
 *   · 阶段参数表取代旧的两条线性公式：间隔、停留、墨/金/急闪概率、双印开关按段排期；
 *   · 新增「急闪印」（虚线蓝边 + ×2 角标，停留 0.7×、分值 2×，第 5 段起出现）；
 *   · 三档反馈落地：普通命中（下压 + 8 片碎）/ 重要（金印黄环金粉、墨印警示）/
 *     重大（阶段突破：整盘换气 + 阶段牌 + 金粉环）；
 *   · 修掉旧版「空点不断连击」的口径问题：空点只断连击、不罚命；
 *   · 出印节拍保留余数，帧抖动不掉拍；关闭/暂停/收场全部正确收口。
 *
 * 规则红线（与上一轮一致，不得回退）：
 *   4×3 十二格 · 金印加命上限 5 · 墨印第二段起 · 误点扣命 · 每 12 命中进一段 ·
 *   第四段起可能同帧双印 · 空点只断连击 · TAP_BOARD.__probe 钩子语义保留。 */
// @ts-nocheck
import '../games/tap.css';

export function mountTap(ctx){
  const {
    on, FX, SFX, MHINT, BEST, syncLoops, later,
    comboState, comboAdd, comboMult, comboBreak, hudSet, showVerdict
  } = ctx;

  var TAP_BOARD = document.getElementById('tapBoard');
  var TAP_START = document.getElementById('tapStart');
  var TAP_GO = document.getElementById('tapGo');
  var TAP_PAUSE = document.getElementById('tapPause');
  var TAP_LIVES = document.getElementById('tapLives');
  var TAP_SCORE = document.getElementById('tapScore');
  var TAP_COMBO = document.getElementById('tapCombo');
  var TAP_LV = document.getElementById('tapLv');
  var TAP_V = document.getElementById('tapVerdict');
  var TAP_VT = document.getElementById('tapVText');
  var TAP_VS = document.getElementById('tapVSeal');
  var TAP_PANE = document.getElementById('pane-tap');

  /* ---------- 阶段参数表 ----------
   * gap   出印间隔 ms；life 普通印停留 ms；
   * ink/gold/quick 各类型概率（quick = 急闪印，仅第 5 段起）；
   * double 是否允许同帧再出一枚（红线：第 4 段起）。
   * 反应余量 = life − 反应时：普通人 RT 250–400ms，表内每段余量都 >0，
   * 高段对慢手只是"有压力"，不是"无解窗口"。 */
  var STAGES = [
    { gap: 620, life: 1080, ink: 0.00, gold: 0.10, quick: 0.00, double: false },
    { gap: 560, life:  980, ink: 0.08, gold: 0.11, quick: 0.00, double: false },
    { gap: 500, life:  900, ink: 0.10, gold: 0.12, quick: 0.00, double: false },
    { gap: 440, life:  820, ink: 0.12, gold: 0.13, quick: 0.00, double: true  },
    { gap: 390, life:  750, ink: 0.14, gold: 0.14, quick: 0.16, double: true  },
    { gap: 350, life:  690, ink: 0.15, gold: 0.15, quick: 0.16, double: true  },
    { gap: 320, life:  640, ink: 0.16, gold: 0.15, quick: 0.16, double: true  },
    { gap: 300, life:  600, ink: 0.17, gold: 0.15, quick: 0.16, double: true  }
  ];
  function stageOf(level){
    var i = Math.min(STAGES.length, Math.max(1, level)) - 1;
    return STAGES[i];
  }

  /* 印章类型：0 普通字印 · 1 金印 · 2 墨印（陷阱）· 3 急闪印 */
  var KIND_PLAIN = 0, KIND_GOLD = 1, KIND_INK = 2, KIND_QUICK = 3;
  var QUICK_LIFE = 0.7;      /* 急闪印停留系数 */
  var QUICK_BASE = 200;      /* 急闪印基础分（普通 100 / 金印 300） */

  var tapCells = [], tapLive = [], tapRaf = 0, tapLast = 0;
  var tapRunning = false, tapDone = false, tapPaused = false;
  var tapScore = 0, tapBest = 0, tapLivesN = 3, tapHits = 0, tapLevel = 1;
  var tapMaxCombo = 0, tapSpawnAcc = 0;
  var tapCombo = comboState(2400, 10);
  /* 普通字字池不放「墨」：避免与墨印陷阱的字撞脸，颜色之外再少一层歧义 */
  var TAP_CH = ['云', '月', '灯', '舟', '雪', '松', '竹', '茶', '花', '山'];

  if (TAP_BOARD){
    /* 先清空再建：开发热更新会重跑模块，不清空就是 12 + 12 = 24 格。 */
    TAP_BOARD.textContent = '';
    tapCells = [];
    for (var tc = 0; tc < 12; tc++){
      (function(i){
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tap-cell';
        b.setAttribute('aria-label', '第 ' + (i + 1) + ' 格');
        b.innerHTML = '<span class="tap-seal"><span class="tap-char"></span><span class="tap-badge"></span></span>';
        b._seal = b.querySelector('.tap-seal');
        b._mark = b.querySelector('.tap-char');
        b._badge = b.querySelector('.tap-badge');
        b._live = null;
        on(b, 'pointerdown', function(e){
          e.preventDefault();       /* 按下即判，不等 click：移动端 click 有 300ms 延迟 */
          tapHit(b);
        });
        TAP_BOARD.appendChild(b);
        tapCells.push(b);
      })(tc);
    }
  }

  function tapHud(){
    hudSet(TAP_SCORE, tapScore);
    FX.combo(TAP_COMBO, tapCombo.n);
    if (TAP_LV) TAP_LV.textContent = String(tapLevel);
    if (TAP_LIVES) TAP_LIVES.textContent = '印'.repeat(Math.max(0, tapLivesN));
    if (TAP_PAUSE) TAP_PAUSE.textContent = tapPaused ? '▶' : '⏸';
  }

  function tapClearCells(){
    tapCells.forEach(function(c){
      c._live = null;
      c.classList.remove('is-live', 'is-gold', 'is-ink', 'is-quick', 'is-hit');
      c._seal.classList.remove('is-quick');
      c._seal.style.removeProperty('--p');
      if (c._badge) c._badge.textContent = '';
    });
    tapLive = [];
  }

  function tapStartRun(showOverlay){
    tapClearCells();
    tapRunning = false; tapDone = false; tapPaused = false;
    tapScore = 0; tapLivesN = 3; tapHits = 0; tapLevel = 1;
    tapMaxCombo = 0; tapSpawnAcc = 0;
    tapCombo = comboState(2400, 10);
    tapBest = BEST.get('tap.score');
    TAP_PANE.classList.remove('is-over');
    TAP_V.classList.remove('is-on');
    TAP_VS.className = 'verdict-seal';
    TAP_VS.textContent = '';
    TAP_START.classList.toggle('is-on', !!showOverlay);
    tapHud();
    MHINT.textContent = showOverlay ? '三枚印，别点墨印 · 按开始' : '点掉冒出来的印 · 墨印别点 · 急闪印分值翻倍';
    if (!showOverlay) tapGo();
  }

  function tapGo(){
    if (!TAP_BOARD) return;
    TAP_START.classList.remove('is-on');
    tapRunning = true; tapDone = false; tapPaused = false;
    tapLast = 0;
    if (tapRaf) cancelAnimationFrame(tapRaf);
    tapRaf = requestAnimationFrame(tapFrame);
    syncLoops();
  }

  function tapStop(){
    tapRunning = false;
    if (tapRaf){ cancelAnimationFrame(tapRaf); tapRaf = 0; }
    syncLoops();
  }

  function tapSpawn(forceKind, forceIdx){
    var free = tapCells.filter(function(c){ return !c._live; });
    if (!free.length) return null;
    var st = stageOf(tapLevel);
    var cell = (forceIdx != null) ? tapCells[forceIdx] : free[Math.floor(Math.random() * free.length)];
    if (!cell || cell._live) return null;

    var kind = KIND_PLAIN;
    if (forceKind != null){
      kind = forceKind;
    } else {
      var r = Math.random();
      if (st.ink > 0 && r < st.ink) kind = KIND_INK;
      else if (r < st.ink + st.gold) kind = KIND_GOLD;
      else if (st.quick > 0 && r < st.ink + st.gold + st.quick) kind = KIND_QUICK;
    }

    var life = st.life * (kind === KIND_INK ? 1.15 : kind === KIND_QUICK ? QUICK_LIFE : 1);
    var seal = cell._seal;
    var label = kind === KIND_INK ? '墨'
      : kind === KIND_GOLD ? '金'
      : kind === KIND_QUICK ? '急'
      : TAP_CH[Math.floor(Math.random() * TAP_CH.length)];
    cell._mark.textContent = label;
    cell.classList.toggle('is-gold', kind === KIND_GOLD);
    cell.classList.toggle('is-ink', kind === KIND_INK);
    cell.classList.toggle('is-quick', kind === KIND_QUICK);
    seal.classList.toggle('is-quick', kind === KIND_QUICK);
    if (cell._badge) cell._badge.textContent = kind === KIND_QUICK ? '×2' : '';
    cell.classList.add('is-live');
    cell._live = { kind: kind, until: performance.now() + life, life: life };
    tapLive.push(cell);
    return cell;
  }

  function tapDrop(cell){
    cell._live = null;
    cell.classList.remove('is-live', 'is-gold', 'is-ink', 'is-quick', 'is-hit');
    cell._seal.classList.remove('is-quick');
    cell._seal.style.removeProperty('--p');
    if (cell._badge) cell._badge.textContent = '';
    var k = tapLive.indexOf(cell);
    if (k >= 0) tapLive.splice(k, 1);
  }

  function tapHit(cell){
    if (!tapRunning || tapDone || tapPaused) return;
    var live = cell._live;
    if (!live){
      /* 空点：只断连击，不罚命（红线）。给一记极轻的灰尘，确认这一下点空了。 */
      if (tapCombo.n > 0){
        comboBreak(tapCombo);
        FX.sparks(cell.getBoundingClientRect(), 2, '#b5aea0');
      }
      tapHud();
      return;
    }
    var kind = live.kind;
    tapDrop(cell);
    var r = cell.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    if (kind === KIND_INK){
      /* 重要 · 墨印警示：墨点碎 + 朱环 + 短震（二选一取震屏，不并停顿），让人记住这个颜色 */
      tapLivesN--;
      comboBreak(tapCombo);
      SFX.play('tap.bad');
      FX.burst(r, { count: 12, dust: 6, power: 400, size: 8,
        colors: ['#252525', '#454545', '#fff8e8'], ringColor: '#b5342b' });
      FX.shake(TAP_BOARD, 4);
      FX.pop(cx, r.top + 10, '墨 · -1', 'is-bad');
      tapHud();
      if (tapLivesN <= 0) tapEnd();
      return;
    }

    comboAdd(tapCombo);
    tapMaxCombo = Math.max(tapMaxCombo, tapCombo.n);
    var base = kind === KIND_GOLD ? 300 : kind === KIND_QUICK ? QUICK_BASE : 100;
    var mult = comboMult(tapCombo);
    /* 木鱼一记：普通字是"笃"，金印是更亮一档的"咚"；连击越高 rate 越上扬 */
    SFX.play(kind === KIND_GOLD ? 'tap.gold' : 'tap.hit', { rate: 1 + Math.min(0.35, tapCombo.n * 0.03) });
    tapScore += base * mult;
    tapHits++;

    if (kind === KIND_GOLD){
      /* 重要 · 金印：黄环收紧 + 金粉上升 + 命 +1 飘字（上限 5） */
      tapLivesN = Math.min(5, tapLivesN + 1);
      FX.ring(cx, cy, 8, 40, 2.5, '#ffd166');
      FX.rise(cx, r.top, 10, ['#ffd166', '#fff8e8']);
      FX.pop(cx, r.top - 4, '+' + (base * mult) + ' · 命+1', 'is-gold');
    } else {
      /* 普通 · 命中：印章下压 + 8 片碎（≤260ms，不停顿、不震屏） */
      cell.classList.add('is-hit');
      later(function(){ cell.classList.remove('is-hit'); }, 160);
      FX.burst(r, { count: 8, dust: 0, power: 320, size: 7,
        colors: ['#b5342b', '#fff8e8', '#252525'], ringColor: '#fff8e8' });
      FX.pop(cx, r.top - 4, '+' + (base * mult) + (mult > 1 ? ' ×' + mult : ''),
        kind === KIND_QUICK ? 'is-gold' : '');
      /* 连击上跳 ≥5：补一记金环（重要档边缘，不另停顿） */
      if (tapCombo.n >= 5) FX.ring(cx, cy, 10, 36, 2, '#ffd166');
    }

    var prevLv = tapLevel;
    tapLevel = 1 + Math.floor(tapHits / 12);
    if (tapLevel > prevLv) tapStageUp();
    tapHud();
  }

  function tapStageUp(){
    /* 重大 · 阶段突破：整盘换气（底色一闪）+ 阶段牌 + 金粉环，至多两拍 */
    SFX.play('tap.up');
    var br = TAP_BOARD.getBoundingClientRect();
    var cx = br.left + br.width / 2, cy = br.top + br.height / 2;
    TAP_BOARD.classList.remove('is-stageup');
    void TAP_BOARD.offsetWidth;
    TAP_BOARD.classList.add('is-stageup');
    FX.stamp(cx, cy, '第 ' + tapLevel + ' 段', { size: 30, color: '#b5342b' });
    FX.ring(cx, cy, 16, Math.min(br.width, br.height) * 0.42, 3, '#ffd166');
    FX.rise(cx, cy, 12, ['#ffd166', '#fff8e8', '#f28b82']);
    FX.freeze(70);
    FX.shake(TAP_BOARD, 3);
  }

  function tapUpdate(dt){
    var st = stageOf(tapLevel);
    tapSpawnAcc += dt;
    if (tapSpawnAcc >= st.gap){
      tapSpawnAcc -= st.gap;          /* 保留余数：帧抖动不掉拍 */
      tapSpawn();
      /* 第四段起：一次节拍可能再冒一枚，两枚同屏才需要"先点哪个"的判断 */
      if (st.double && tapLive.length < 2 && Math.random() < 0.5) tapSpawn();
    }
    for (var i = tapLive.length - 1; i >= 0; i--){
      var cell = tapLive[i];
      var live = cell._live;
      if (!live) continue;
      var left = live.until - performance.now();
      if (left <= 0){
        tapDrop(cell);
        var r = cell.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (live.kind !== KIND_INK){
          /* 普通/金/急闪印漏接：扣命 + 断连击，朱色火星 + 漏字飘字 */
          tapLivesN--;
          comboBreak(tapCombo);
          FX.sparks(r, 3, '#f28b82');
          FX.pop(cx, r.top + 10, '漏 · -1', 'is-bad');
          tapHud();
          if (tapLivesN <= 0){ tapEnd(); return; }
        } else {
          /* 墨印自己缩回去 = 躲对了：一团淡墨痕，不奖不罚 */
          FX.trail(cx, cy, 'rgba(37,37,37,.35)', 6);
          tapHud();
        }
        continue;
      }
      cell._seal.style.setProperty('--p', String(Math.max(0, left / live.life)));
    }
  }

  function tapEnd(){
    tapDone = true;
    tapRunning = false;
    if (tapRaf){ cancelAnimationFrame(tapRaf); tapRaf = 0; }
    tapClearCells();
    var prevBest = Math.max(tapBest, BEST.get('tap.score'));
    var isBest = tapScore > prevBest;
    BEST.set('tap.score', tapScore);
    TAP_PANE.classList.add('is-over');
    FX.shake(TAP_BOARD, 6);
    showVerdict(TAP_V, TAP_VT, TAP_VS, 'v-bad',
      '第 ' + tapLevel + ' 段收场 · 敲中 ' + tapHits + ' 枚 · ' + tapScore + ' 分' + (isBest ? ' · 新纪录' : '') +
      ' · 最多 ' + tapMaxCombo + ' 连', '散');
    if (isBest){
      var r = TAP_V.getBoundingClientRect();
      FX.rise(r.left + r.width / 2, r.top, 14, ['#ffd166', '#fff8e8']);
    }
    MHINT.textContent = '散了 · 墨印也扣命，看准再点';
    tapHud();
    syncLoops();
  }

  function tapFrame(ts){
    if (!tapRunning) return;
    var dt = tapLast ? Math.min(50, ts - tapLast) : 16;
    tapLast = ts;
    if (!tapPaused && !tapDone && !FX.frozen()) tapUpdate(dt);
    tapRaf = requestAnimationFrame(tapFrame);
  }

  if (TAP_GO) on(TAP_GO, 'click', tapGo);
  if (TAP_PAUSE) on(TAP_PAUSE, 'click', function(){
    if (!tapRunning || tapDone) return;
    tapPaused = !tapPaused;
    MHINT.textContent = tapPaused ? '已暂停 · 点 ▶ 接着来' : '接着来 · 墨印别点';
    tapHud();
  });

  if (TAP_BOARD) TAP_BOARD.__probe = function(){
    var st = stageOf(tapLevel);
    return {
      score: tapScore, combo: tapCombo.n, level: tapLevel, lives: tapLivesN,
      hits: tapHits, live: tapLive.length, run: tapRunning, paused: tapPaused, done: tapDone,
      kinds: tapLive.map(function(c){ return c._live ? c._live.kind : -1; }),
      left: tapLive.map(function(c){ return c._live ? Math.round(c._live.until - performance.now()) : -1; }),
      /* r2 扩展字段（只读验收用，不参与玩法） */
      maxCombo: tapMaxCombo, gapMs: st.gap, lifeMs: st.life,
      ink: st.ink, gold: st.gold, quick: st.quick, double: st.double
    };
  };
  /* 验收辅助：取某段参数表 / 强制出印 / 直接设段（仅探针调用） */
  if (TAP_BOARD){
    TAP_BOARD.__params = function(level){ return stageOf(level); };
    TAP_BOARD.__force = function(kind, idx){ return tapSpawn(kind, idx); };
    TAP_BOARD.__setLevel = function(lv){ tapLevel = lv; tapHits = (lv - 1) * 12; tapHud(); };
    TAP_BOARD.__clear = function(){ tapClearCells(); };
  }

  return {
    open(){ tapStartRun(true); },
    stop: tapStop,
    close: tapStop,
    replay(){ tapStartRun(false); },
    loops(){ return tapRunning ? ['tap'] : []; },
    suspend(){
      if (!tapRunning) return null;
      tapStop();
      return function(){ tapRunning = true; tapLast = 0; tapRaf = requestAnimationFrame(tapFrame); };
    }
  };
}
