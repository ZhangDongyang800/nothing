/* 11 专注：逐行阅读，一次一句。自动逐行推完一首诗；也可点行跳转、自己落笔。
   本台只写本文件与 games/focus.css；共享特效调 fx.ts，共享音效调 sfx.ts，
   不新建画布、不新增音色、不挂全局监听（监听一律走 ctx.on，随 AbortController 收口）。 */
// @ts-nocheck
import '../games/focus.css';

export function mountFocus(ctx){
  const { on, FX, SFX, MHINT, FOCUS_IN, pickPoem, splitLines } = ctx;

  var FBLOCK = document.getElementById('focusBlock');
  var FSRC = null;
  var FLINES = [];
  var focusIndex = -1;
  var advanceTimer = null;   // 逐行推进的 setTimeout（按句长给节奏）
  var endTimer = null;       // 末行落定到终印之间的停顿
  var focusManual = false;
  var ended = false;

  /* ---------- 定时器收口：stop / close 同一条路，离场不留残钟 ---------- */
  function stopTimers(){
    if (advanceTimer){ clearTimeout(advanceTimer); advanceTimer = null; }
    if (endTimer){ clearTimeout(endTimer); endTimer = null; }
  }

  function clearEnd(){
    var old = FBLOCK.querySelector('.focus-end');
    if (old) old.remove();
    FBLOCK.classList.remove('is-ended');
    var pane = document.getElementById('pane-focus');
    if (pane) pane.classList.remove('is-ended');
  }

  function makeLine(i, text){
    var p = document.createElement('p');
    p.className = 'fline';
    p.setAttribute('data-i', String(i));
    p.innerHTML = '<i>' + ('0' + (i + 1)).slice(-2) + '</i><span class="txt"></span>';
    p.querySelector('.txt').textContent = text || '';
    on(p, 'click', function(){
      stopTimers();
      focusManual = true;
      ended = false;
      setFocus(Number(p.getAttribute('data-i')));
    });
    return p;
  }

  function buildFocus(lines, from){
    stopTimers();
    clearEnd();
    while (FBLOCK.firstChild) FBLOCK.removeChild(FBLOCK.firstChild);
    FLINES = [];
    lines.forEach(function(t, i){
      var p = makeLine(i, t);
      FBLOCK.appendChild(p);
      FLINES.push(p);
    });
    FSRC = document.createElement('div');
    FSRC.className = 'focus-source';
    FSRC.textContent = from || '';
    FBLOCK.appendChild(FSRC);
    focusIndex = -1;
    ended = false;
  }

  /* 行状态三档：未读（安静灰）/ 当前（点亮）/ 已读（落定，留一道淡痕） */
  function paintLines(){
    for (var k = 0; k < FLINES.length; k++){
      var el = FLINES[k];
      el.classList.toggle('is-live', k === focusIndex);
      el.classList.toggle('is-done', k < focusIndex);
    }
  }
  function setFocus(i){
    focusIndex = i;
    paintLines();
  }

  /* 一句读多久：按字数给节奏，短句不拖长、长句不赶；钳在安静的区间里 */
  function dwellFor(text){
    var n = (text || '').length;
    return Math.max(1900, Math.min(3200, 1400 + n * 120));
  }

  /* 上一行落定时，句读处一点墨（重要档：单颗墨点，不撒碎渣） */
  function dropInk(idx){
    if (idx < 0 || !FLINES[idx]) return;
    var el = FLINES[idx].querySelector('.txt');
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    FX.trail(r.right, r.top + r.height * 0.62, 'rgba(242,139,130,.55)', 3.5);
  }

  function scheduleAdvance(){
    stopTimers();
    if (focusManual || ended) return;
    var cur = FLINES[focusIndex];
    var dwell = dwellFor(cur ? cur.querySelector('.txt').textContent : '');
    advanceTimer = setTimeout(function(){
      advanceTimer = null;
      if (focusManual || ended) return;
      goTo(focusIndex + 1);
    }, dwell);
  }

  /* 末行读完先留一个安静的停顿，再落终印；不叫人对着末行发愣，也不抢阅读 */
  function scheduleClose(){
    stopTimers();
    if (focusManual || ended) return;
    endTimer = setTimeout(function(){
      endTimer = null;
      if (focusManual || ended) return;
      renderEnd();
    }, 900);
  }

  function goTo(i){
    setFocus(i);
    dropInk(i - 1);
    SFX.play('focus.line');
    if (i >= FLINES.length - 1) scheduleClose();
    else scheduleAdvance();
  }

  function renderEnd(){
    if (FBLOCK.querySelector('.focus-end')) return;
    ended = true;
    var end = document.createElement('div');
    end.className = 'focus-end';
    end.innerHTML = '<span class="focus-seal" aria-hidden="true">终</span>'
      + '<span class="focus-end-text"></span>';
    FBLOCK.appendChild(end);
    FBLOCK.classList.add('is-ended');
    var pane = document.getElementById('pane-focus');
    if (pane) pane.classList.add('is-ended');

    /* 终印：DOM 印面持久落定，自带压印动画（见 focus.css .focus-seal）。
       不叠 fx-stamp 浮层——与持久印面重复会叠字（与稿纸台同一结论）。
       印面是独立的朱色描边印（透明底、不填朱），与稿纸填朱方印区分开。 */
    SFX.play('focus.end');

    /* 收束文案逐字上浮：每个字一记短上浮，错峰浮现 */
    var text = '这一首读完了';
    var txt = end.querySelector('.focus-end-text');
    text.split('').forEach(function(ch, k){
      var s = document.createElement('span');
      s.className = 'fchar';
      s.style.setProperty('--d', (160 + k * 80) + 'ms');
      s.textContent = ch;
      txt.appendChild(s);
    });

    if (ctx.current === 'focus') MHINT.textContent = '这一首读完了 · 再来一次重挑';
  }

  /* ================= 自动演示：随机取一首现代诗，逐行推完 ================= */
  function playFocus(){
    stopTimers();
    focusManual = false;
    var q = pickPoem(), lines = splitLines(q.text), tries = 0;
    while (lines.length < 3 && tries < 8){
      q = pickPoem();
      lines = splitLines(q.text);
      tries++;
    }
    buildFocus(lines, q.from);
    setFocus(0);
    scheduleAdvance();
  }

  /* ================= 自己写（兼容中文输入法组词） ================= */
  function focusStartManual(){
    focusManual = true;
    buildFocus([''], '');
    setFocus(0);
  }
  function focusType(ch){
    if (!focusManual) focusStartManual();
    var i = focusIndex < 0 ? 0 : focusIndex;
    if (!FLINES[i]) return;
    FLINES[i].querySelector('.txt').textContent += ch;
    SFX.play('focus.type');
  }
  function focusEnter(){
    if (!focusManual) focusStartManual();
    var i = focusIndex < 0 ? 0 : focusIndex;
    if (i >= 5) return;
    var p = makeLine(FLINES.length, '');
    FBLOCK.insertBefore(p, FSRC);
    FLINES.push(p);
    setFocus(FLINES.length - 1);
    SFX.play('focus.line');
  }
  function focusBackspace(){
    if (!focusManual) return;
    var i = focusIndex < 0 ? 0 : focusIndex;
    var span = FLINES[i] && FLINES[i].querySelector('.txt');
    if (!span) return;
    var t = span.textContent;
    if (t.length){ span.textContent = t.slice(0, -1); }
    else if (i > 0){ FLINES[i].remove(); FLINES.pop(); setFocus(i - 1); }
  }

  var focusComposing = false;
  function commitFocus(raw){
    Array.prototype.slice.call(raw).forEach(function(c){
      if (c === '\n'){ focusEnter(); return; }
      if (!/\s/.test(c)) focusType(c);
    });
  }
  on(FOCUS_IN, 'compositionstart', function(){ focusComposing = true; });
  on(FOCUS_IN, 'compositionend', function(){
    focusComposing = false;
    var v = FOCUS_IN.value;
    FOCUS_IN.value = '';
    commitFocus(v);
  });
  on(FOCUS_IN, 'input', function(e){
    if (focusComposing || e.isComposing) return;
    var v = FOCUS_IN.value;
    FOCUS_IN.value = '';
    commitFocus(v);
  });
  on(FOCUS_IN, 'keydown', function(e){
    if (e.isComposing || focusComposing) return;
    if (e.key === 'Enter'){
      e.preventDefault();
      focusEnter();
    } else if (e.key === 'Backspace'){
      e.preventDefault();
      focusBackspace();
    }
  });
  on(document.getElementById('pane-focus'), 'click', function(e){
    if (e.target.closest('.fline')) return;
    try { FOCUS_IN.focus({ preventScroll: true }); } catch(err){}
  });

  return {
    open: playFocus,
    stop: stopTimers,
    close: stopTimers,
    clear: focusStartManual
  };
}
