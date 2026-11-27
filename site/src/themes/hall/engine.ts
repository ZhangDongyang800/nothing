/* 机台引擎：attachHall() 生命周期、机台开合 / 路由、键盘总闸。
 * 十台游戏各自在 games/*.ts（独立模块、独立样式），通过统一的 mount<Game>(ctx) 形状挂载；
 * 共用上下文在 core/ctx.ts。本文件只做：
 *   ① AbortController + timeouts 收口（StrictMode 双挂载仍然安全）；
 *   ② 开机台 / 关弹层 / 再来一次 / Esc 的路由；
 *   ③ 汇总各台动画循环（window.__loops）与尺寸重算（refitAll）。
 *
 * 沿用工程现状：关闭类型检查，交互以站点实际表现为准。结构在 Hall.tsx，样式在 hall.css。
 */
// @ts-nocheck
import { createCtx } from './core/ctx';
import { mountPaper } from './games/paper';
import { mountWord } from './games/word';
import { mountBrick } from './games/brick';
import { mountBreak } from './games/break';
import { mountMerge } from './games/merge';
import { mountTap } from './games/tap';
import { mountRun } from './games/run';
import { mountStack } from './games/stack';
/* 「墨潮」是独立模块：它自己建 DOM、自己算、自己存档，不接这台 engine 的状态机。 */
import { mountRogue } from './rogue';
import { mountLegion } from './legion';

export function attachHall() {
  const ctx = createCtx();
  const { ac, timeouts, on, FX, SFX, FINEPOINTER, PANES, MNO, MNAME, MTAG, MHINT, MCOUNT, MREPLAY, MSEAL, MCLEAR, INPUT, MODAL } = ctx;

  /* 挂载前清场：动态生成的格子 / 牌 / 行 / 卡都不进 JSX，重挂时先抹掉 */
  (function resetDynamic() {
    ['cols', 'ticks', 'pairGrid', 'brkBoard', 'brkTray', 'mergeTiles'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    ['pairVerdict', 'brkVerdict', 'bkVerdict'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('is-on');
    });
    ['pairCount', 'pairVText', 'pairVSeal', 'brkVText', 'brkVSeal', 'bkVText', 'bkVSeal'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    const pairGrid0 = document.getElementById('pairGrid');
    if (pairGrid0) pairGrid0.classList.remove('is-live');
    const paneWord0 = document.getElementById('pane-word');
    if (paneWord0) paneWord0.classList.remove('is-idle');
    const paneBreak0 = document.getElementById('pane-break');
    if (paneBreak0) paneBreak0.classList.remove('is-over');
    const paper = document.getElementById('paper');
    if (paper) paper.querySelectorAll('.seal').forEach(function (n) { n.remove(); });
  })();

  /* 挂载八台机器（纸上军团 / 墨潮自建 DOM，不在这张表里） */
  const machines = {
    paper: mountPaper(ctx),
    word: mountWord(ctx),
    brick: mountBrick(ctx),
    break: mountBreak(ctx),
    merge: mountMerge(ctx),
    tap: mountTap(ctx),
    run: mountRun(ctx),
    stack: mountStack(ctx)
  };

  /* 三个画布循环的名字：性能探针要知道"现在有几个动画在跑"，关掉弹层之后必须是空数组 */
  function syncLoops() {
    /* 口径与拆分前一致：__loops 只上报 break/run/stack 三台画布循环；
       tap 的 RAF 虽在后台被取消，但原本就不列入 __loops，这里保持原样。 */
    var a = [];
    Object.keys(machines).forEach(function(k){
      if (k === 'tap') return;
      var m = machines[k];
      if (m && m.loops) a = a.concat(m.loops());
    });
    window.__loops = a;
  }
  ctx.syncLoops = syncLoops;

  var LAST_FIT = 0;
  function refitAll(){
    if (Date.now() - LAST_FIT < 40) return;
    LAST_FIT = Date.now();
    Object.keys(machines).forEach(function(k){
      var m = machines[k];
      if (m && m.fit) m.fit();
    });
  }

  /* ================= 机台信息与页脚提示渲染 ================= */
  var INFO = {
    legion: { no:'01', name:'纸上军团', tag:'无尽守卫 · 招募 · 合成 · 自动战斗', hint:'拖卡上阵 · 同名合成 · 异兵融合 · Q 英雄技 · 空格暂停', idx:'01 / 10' },
    paper: { no:'08', name:'稿纸', tag:'A4 · 竖排', hint:'点纸就写，回车换列', idx:'08 / 10' },
    word: { no:'09', name:'抽词', tag:'翻卡 · 三档成双 · 星级', hint:'选个难度 · 按开始', idx:'09 / 10' },
    brick: { no:'05', name:'砖块', tag:'8×8 · 填满一行或一列就消 · 连击', hint:'点一块砖，再点盘上落下去', idx:'05 / 10' },
    break: { no:'04', name:'破砖', tag:'七关 · 板子接球 · 宽板', hint:'拖动板子接球 · 点一下发球（接球的位置决定角度）', idx:'04 / 10' },
    merge: { no:'07', name:'叠山', tag:'一粒尘，垒到天 · 回退', hint:'方向键 / WASD 或滑动 · 同字相撞升一级 · 合出「天」获胜', idx:'07 / 10' },
    tap: { no:'10', name:'敲印', tag:'反应 · 越来越快 · 别点墨印', hint:'点掉冒出来的印 · 墨印别点', idx:'10 / 10' },
    run: { no:'03', name:'走墨', tag:'无尽跑 · 空中可再跳一次', hint:'空格 / 点画面跳 · 空中还能再跳一次', idx:'03 / 10' },
    stack: { no:'06', name:'垒塔', tag:'看准时机落砖 · 对准算「准」', hint:'空格 / 点画面落砖 · 对准了算「准」', idx:'06 / 10' },
    rogue: { no:'02', name:'墨潮', tag:'无尽 · 肉鸽 · 自动出手', hint:'WASD / 拖动走位 · 空格冲刺 · P 暂停 · 武器自动出手', idx:'02 / 10' }
  };

  /* 页脚提示不只是开局那一句：各台会边玩边改写（"还剩 18 组 · 槽里 0 张"）。
     观察文本变化，把键位（WASD / 空格 / Enter / 方向键 / 拖动…）包成键帽、
     把分隔点退成留白。文本本身一个字不动，所以对读屏与复制都没有副作用。 */
  var hintPrev = '';
  var hintMo = new MutationObserver(function(){
    var raw = MHINT.textContent || '';
    if (!raw || raw === hintPrev) return;
    hintPrev = raw;
    var html = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\b(WASD|Enter|Esc|Q|P)\b|(1-3)|空格|方向键|拖动|回车/g, '<b>$&</b>');
    html = html.replace(/·/g, '<i>·</i>');
    MHINT.innerHTML = html;
  });
  hintMo.observe(MHINT, { childList: true, characterData: true, subtree: true });

  /* 墨潮自建 DOM 与状态机，这里只拿一个句柄 */
  var ROGUE = mountRogue(document.getElementById('rogueRoot'));
  /* 纸上军团同理：自建 canvas 与一整套 DOM，这里只保留 open/close/replay/escape */
  var LEGION = mountLegion(document.getElementById('legionRoot'));

  function startGame(name){
    machines.paper.stop();
    machines.break.stop();
    machines.run.stop();
    machines.stack.stop();
    /* 音色按机器切：同一个"取一张牌"，01 是笔尖、03 是瓷片、09 是木鱼。
       切晚了会让开机的第一声还是上一台的音色。 */
    SFX.setGame(name);
    if (machines[name] && machines[name].open) machines[name].open();
    if (name === 'rogue' && ROGUE) ROGUE.open();
    if (name === 'legion' && LEGION) LEGION.open();
  }

  function openGame(name){
    if (!PANES[name]) return;
    ctx.current = name;
    var info = INFO[name];
    MNO.textContent = info.idx;
    MNAME.textContent = info.name;
    MTAG.textContent = info.tag;
    /* 墨潮的页脚提示要分组：键位单独做键帽，读起来才不是一撮细字 */
    if (name === 'rogue') {
      MHINT.innerHTML = '<b>WASD</b> 走位<i>·</i><b>空格</b> 冲刺<i>·</i><b>P</b> 暂停<i>·</i><b>1-3</b> 选升级';
    } else if (name === 'legion') {
      /* 手机上没有 Q / 空格 / 1-3，换成触屏说法 */
      MHINT.innerHTML = FINEPOINTER
        ? '<b>拖卡</b> 上阵<i>·</i><b>同名合成</b><i>·</i><b>异兵融合</b><i>·</i><b>Q</b> 英雄技<i>·</i><b>空格</b> 暂停<i>·</i><b>1-3</b> 招兵'
        : '<b>拖卡</b> 上阵<i>·</i><b>同名合成</b><i>·</i><b>异兵融合</b><i>·</i>点棋子看专精';
    } else {
      MHINT.textContent = info.hint;
    }
    MCOUNT.textContent = info.idx;
    MODAL.setAttribute('data-game', name);
    ctx.mReplayLabel('再来一次');
    MSEAL.style.display = name === 'paper' ? '' : 'none';
    MCLEAR.style.display = name === 'paper' ? '' : 'none';
    /* 横屏不再按机器分"给不给按钮"：方向一变，四台台面型机器自己变成左右两侧排布（见 hall.css），
       其余几台是分栏排版，横过来只是更宽 —— 没有按钮要显隐。 */
    Object.keys(PANES).forEach(function(k){
      PANES[k].classList.toggle('is-on', k === name);
    });
    MODAL.classList.add('is-on');
    MODAL.setAttribute('aria-hidden', 'false');
    /* 开局时把首页那八块小演示冻住：14 条 infinite 动画在后面空转，
       既抢 GPU 又没人看 —— 一条 class 就省掉。 */
    document.body.classList.add('is-playing');
    SFX.play('ui.open');
    startGame(name);
    /* 台面尺寸要等这一屏真的摆出来才量得准：一帧后、进场动画后各量一次 */
    laterRefit(30);
    laterRefit(300);
    if (name === 'paper' && FINEPOINTER){
      setTimeout(function(){ try { INPUT.focus({ preventScroll: true }); } catch(e){} }, 260);
    }
  }

  function closeMachine(){
    MODAL.classList.remove('is-on');
    MODAL.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-playing');
    machines.paper.stop();
    machines.break.stop();
    machines.run.stop();
    machines.stack.stop();
    machines.tap.stop();
    if (ROGUE) ROGUE.close();
    if (LEGION) LEGION.close();
    /* 关掉弹层就把粒子一起收掉：不收的话，离场那几百片碎屑会在看不见的地方继续算 1 秒 */
    FX.stop();
    SFX.stop();
    while (timeouts.length) clearTimeout(timeouts.pop());
    ctx.current = null;
    document.body.classList.remove('is-leaving');
    try { INPUT.blur(); } catch(e){}
  }

  function laterRefit(ms){
    var id = setTimeout(refitAll, ms);
    timeouts.push(id);
  }

  /* 横屏不再有"切换"这件事（见 hall.css 的"横屏 = 整块屏幕"）：
     没有按钮、没有全屏申请、没有方向锁 —— 手机横过来，版面自己变成整块屏幕；
     竖回去，自动回到"上读数、下按键"。
     这里只做一件必要的事：转屏之后重新算台面尺寸。
     iOS 的 orientationchange 比真正的布局重排早一步，所以补两次延迟重算。 */
  var onTurn = function(){
    refitAll();
    laterRefit(160);
    laterRefit(420);
  };
  on(window, 'orientationchange', onTurn);
  on(window, 'resize', function(){ LAST_FIT = 0; onTurn(); });

  Array.prototype.slice.call(document.querySelectorAll('[data-game]')).forEach(function(btn){
    on(btn, 'click', function(){ openGame(btn.getAttribute('data-game')); });
  });

  /* 音效开关：只做两件事 —— 静音落 localStorage、把按钮本身画成"现在是有声还是没声"。
     它不拦任何点击，所以放在最外层（首页与机台都看得见）。 */
  var SFX_BTN = document.getElementById('sfxBtn');
  if (SFX_BTN){
    var paintSfx = function(){
      var off = SFX.isMuted();
      SFX_BTN.classList.toggle('is-off', off);
      SFX_BTN.setAttribute('aria-pressed', off ? 'false' : 'true');
      SFX_BTN.setAttribute('title', off ? '音效已关 · 点开' : '音效已开 · 点关');
      var tx = SFX_BTN.querySelector('.sfx-txt');
      if (tx) tx.textContent = off ? '静音' : '音效';
      var ic = SFX_BTN.querySelector('.sfx-ico');
      if (ic) ic.textContent = off ? '×' : '♪';
    };
    paintSfx();
    on(SFX_BTN, 'click', function(){
      SFX.unlock();
      SFX.toggle();
      paintSfx();
      /* 开回来时给一声，让人确认"现在有声音了"；关的时候不给（关掉就该安静） */
      if (!SFX.isMuted()) SFX.play('ui.click');
    });
  }
  Array.prototype.slice.call(document.querySelectorAll('[data-close]')).forEach(function(el){
    on(el, 'click', closeMachine);
  });
  on(MREPLAY, 'click', function(){
    if (!ctx.current) return;
    if (ctx.current === 'break'){ machines.break.replay(); return; }
    if (ctx.current === 'merge'){ machines.merge.replay(); refitAll(); return; }
    if (ctx.current === 'tap'){ machines.tap.replay(); refitAll(); return; }
    if (ctx.current === 'run'){ machines.run.replay(); refitAll(); return; }
    if (ctx.current === 'stack'){ machines.stack.replay(); refitAll(); return; }
    if (ctx.current === 'rogue'){ if (ROGUE) ROGUE.replay(); return; }
    if (ctx.current === 'legion'){ if (LEGION) LEGION.replay(); return; }
    startGame(ctx.current);
  });

  /* 落印：写够了就按一下，纸歪一下、朱印落上去 */
  on(MSEAL, 'click', function(){
    machines.paper.seal();
  });

  /* 清空：清完之后就是一张白纸，直接自己写 */
  on(MCLEAR, 'click', function(){
    if (ctx.current === 'paper'){
      machines.paper.clear();
      try { INPUT.focus({ preventScroll: true }); } catch(e){}
    }
  });

  /* 标签页切到后台时把画布循环停掉：浏览器会把 rAF 降到 1fps 甚至冻结，
     但定时器、粒子与 canvas 仍然在记账；切回来按原状态接上（不重置 bkLast，避免一帧跳很远）。 */
  var hiddenResumes = [];
  on(document, 'visibilitychange', function(){
    if (document.hidden){
      hiddenResumes = [];
      Object.keys(machines).forEach(function(k){
        var m = machines[k];
        if (m && m.suspend){
          var r = m.suspend();
          if (r) hiddenResumes.push(r);
        }
      });
      syncLoops();
      FX.stop();
      return;
    }
    hiddenResumes.forEach(function(r){ r(); });
    hiddenResumes = [];
    syncLoops();
  });

  // 键盘：Esc 关掉机台
  on(document, 'keydown', function(e){
    if (e.key === 'Escape' && MODAL.classList.contains('is-on')){
      if (ctx.current === 'rogue' && ROGUE && ROGUE.escape()) return;
      if (ctx.current === 'legion' && LEGION && LEGION.escape()) return;
      closeMachine();
    }
  });

  return function cleanup() {
    ac.abort();
    hintMo.disconnect();
    if (ROGUE && ROGUE.game) ROGUE.game.destroy();
    if (LEGION) LEGION.destroy();
    Object.keys(machines).forEach(function(k){
      var m = machines[k];
      if (m && m.stop) m.stop();
      if (m && m.close) m.close();
    });
    FX.stop();
    if (FX.canvas && FX.canvas.parentNode) FX.canvas.parentNode.removeChild(FX.canvas);
    while (timeouts.length) clearTimeout(timeouts.pop());
  };
}
