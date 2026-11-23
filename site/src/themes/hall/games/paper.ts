/* 10 稿纸：A4 竖排，点纸就写，回车换列；⌘/Ctrl+回车落印。
   兼容中文输入法组词（compositionstart/end 期间不吞字符、不提前提交、整词上屏）。
   本台只写本文件与 games/paper.css；共享特效调 fx.ts，共享音效调 sfx.ts，不新建画布/音色。 */
// @ts-nocheck
import '../games/paper.css';

export function mountPaper(ctx){
  const { on, FX, SFX, MHINT, INPUT, FINEPOINTER, COLS, ROWS, pickPoem, splitLines } = ctx;

  var SHEET = document.getElementById('sheet');
  var PAPER = document.getElementById('paper');
  var COLSEL = document.getElementById('cols');
  var COUNT = document.getElementById('count');
  var TICKS = document.getElementById('ticks');
  var STATE = document.getElementById('state');
  var SOURCE = document.getElementById('source');

  /* chars 存 { ch, kind }：kind 用于回退重建时还原标点/括号样式 */
  var chars = [];
  var cols = [];
  var lines = [''];        // 一句一列：诗词按句断列，满 9 字才自然换列
  var sealed = false;
  var manual = false;
  var typingTimer = null;  // 自动演示逐字 interval
  var sealTimer = null;    // 演示收尾后延时落印 timeout（随 stop 一并清掉，不留残钟）

  for (var t = 0; t < ROWS; t++){
    var tick = document.createElement('i');
    tick.className = 'ro-tick';
    TICKS.appendChild(tick);
  }

  /* ---------- 字符分类：句读 / 括号 / 普通字 ---------- */
  var PUNCT = '，。！？；：、·…—～';
  var BRACKETS = '（）《》〈〉「」『』“”‘’';
  function classify(ch){
    if (PUNCT.indexOf(ch) >= 0) return 'punct';
    if (BRACKETS.indexOf(ch) >= 0) return 'bracket';
    return '';
  }

  function ensureCol(i){
    while (cols.length <= i){
      var c = document.createElement('div');
      c.className = 'col';
      COLSEL.appendChild(c);
      cols.push(c);
    }
    return cols[i];
  }
  function findCaret(){ return COLSEL.querySelector('.caret'); }
  function placeCaret(){
    var old = findCaret();
    if (old) old.remove();
    if (sealed || chars.length >= COLS * ROWS || lines.length > COLS) return;
    var col = ensureCol(Math.max(0, lines.length - 1));
    var c = document.createElement('div');
    c.className = 'caret';
    col.appendChild(c);
  }
  function readout(){
    COUNT.textContent = ('000' + chars.length).slice(-3);
    var on = Math.min(chars.length, ROWS);
    for (var i = 0; i < TICKS.children.length; i++){
      TICKS.children[i].classList.toggle('on', i < on);
    }
  }

  /* 确定性的手写感：按序号 + 字码取一个 0–96 的散列，给出微偏移 / 微斜 / 墨色深浅。
     不随机，重开一局同一批字的姿态一致；数值很小，只是"不像印刷体"的程度。 */
  function makeGlyph(entry, idx){
    var ch = entry.ch, kind = entry.kind || classify(ch);
    var g = document.createElement('div');
    var cls = ['glyph', 'is-land'];
    if (kind === 'punct') cls.push('is-punct');
    else if (kind === 'bracket') cls.push('is-bracket');
    g.className = cls.join(' ');
    g.textContent = ch;
    var h = (idx * 31 + ch.charCodeAt(0) * 13) % 97;
    g.style.setProperty('--jx', (((h % 5) - 2) * 0.014).toFixed(3));
    g.style.setProperty('--jy', ((((h >> 2) % 5) - 2) * 0.014).toFixed(3));
    g.style.setProperty('--jr', (((h % 7) - 3) * 0.5).toFixed(2));
    g.style.setProperty('--io', (0.88 + (h % 5) * 0.03).toFixed(2));
    return g;
  }

  /* 追加一个字到当前列（不带音效/光标挪动，回退重建复用） */
  function appendEntry(entry){
    var li = lines.length - 1;
    if (lines[li].length >= ROWS){ lines.push(''); li = lines.length - 1; }
    if (li >= COLS) return;
    var col = ensureCol(li);
    col.appendChild(makeGlyph(entry, chars.length));
    lines[li] += entry.ch;
  }

  function pushChar(ch, brk){
    if (sealed || chars.length >= COLS * ROWS) return false;
    var li = lines.length - 1;
    var liFrom = li;
    if (brk && lines[li].length > 0){ lines.push(''); li = lines.length - 1; }
    if (lines[li].length >= ROWS){ lines.push(''); li = lines.length - 1; }
    if (li >= COLS) return false;
    var col = ensureCol(li);
    var caret = findCaret();
    var entry = { ch: ch, kind: classify(ch) };
    var g = makeGlyph(entry, chars.length);
    if (caret && caret.parentNode === col) col.insertBefore(g, caret); else col.appendChild(g);
    lines[li] += ch;
    chars.push(entry);
    /* 笔尖落纸：一声很轻的沙；换列时补一下"翻过去"的轻响 */
    SFX.play(li > liFrom ? 'paper.line' : 'paper.type');
    readout();
    placeCaret();
    if (chars.length >= COLS * ROWS) sealNow();
    return true;
  }

  /* 落印是这一页的结论（重大档）：朱印压痕 + 印泥扩散 + 纸面定住，一次性两拍。 */
  function sealNow(){
    if (sealed || chars.length === 0) return;
    var old = findCaret();
    if (old) old.remove();
    sealed = true;
    var seal = document.createElement('div');
    seal.className = 'seal';
    seal.innerHTML = '<span>收</span><span>稿</span>';
    PAPER.appendChild(seal);
    SHEET.classList.add('sealed');

    SFX.play('paper.seal');
    var r = seal.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    /* 重大档：DOM 印面持久落定；burst 撒低重力朱色印泥墨点，ring 一圈朱色收边，
       shake 给纸面一下实颤。不再叠 fx-stamp 浮层——与持久印面重复会叠字。 */
    FX.burst(r, {
      count: 12, dust: 10, power: 260, gravity: 240, size: 6,
      colors: ['#b5342b', '#f28b82', '#252525', '#fff8e8'],
      ring: true, flash: false
    });
    FX.ring(cx, cy, r.width * .3, r.width * .95, 3, '#b5342b');
    FX.shake(SHEET, 2);

    var full = chars.length >= COLS * ROWS;
    SHEET.classList.toggle('is-full', full);
    STATE.textContent = full ? '满页 · 已收稿' : '已收稿';
    if (ctx.current === 'paper') MHINT.textContent = full ? '一页满了 · 点清空再写' : '再点清空，写下一张';
    if (FINEPOINTER) { try { INPUT.blur(); } catch(e){} }
  }

  function clearSheet(){
    stopTyping();
    chars = [];
    cols.length = 0;
    lines = [''];
    COLSEL.innerHTML = '';
    sealed = false;
    var s = PAPER.querySelector('.seal');
    if (s) s.remove();
    SHEET.classList.remove('sealed', 'is-full');
    STATE.textContent = '待落笔';
    readout();
    placeCaret();
  }
  function stopTyping(){
    if (typingTimer){ clearInterval(typingTimer); typingTimer = null; }
    if (sealTimer){ clearTimeout(sealTimer); sealTimer = null; }
  }

  /* 自动演示：随机取一首现代诗，逐字打出，打完落款 */
  function playQuote(){
    clearSheet();
    manual = false;
    var q = pickPoem();
    SOURCE.textContent = q.from;
    SOURCE.style.opacity = '';
    var seq = [];
    splitLines(q.text).forEach(function(L, idx){
      for (var k = 0; k < L.length; k++){
        seq.push({ ch: L.charAt(k), brk: k === 0 && idx > 0 });
      }
    });
    var i = 0;
    typingTimer = setInterval(function(){
      if (manual || sealed){ stopTyping(); return; }
      if (i >= seq.length){
        stopTyping();
        sealTimer = setTimeout(function(){ if (!manual && !sealed) sealNow(); }, 900);
        return;
      }
      var it = seq[i++];
      pushChar(it.ch, it.brk);
    }, 170);
  }

  /* ================= 稿纸交互（兼容中文输入法组词） ================= */
  var paperComposing = false;

  function commitPaper(raw){
    var clean = Array.prototype.slice.call(raw).filter(function(c){ return c && !/\s/.test(c); });
    if (!clean.length) return;
    stopTyping();
    if (!manual){
      manual = true;
      if (!sealed) clearSheet();
      SOURCE.style.opacity = '0';
    }
    clean.forEach(function(c){ pushChar(c, false); });
  }
  on(INPUT, 'compositionstart', function(){ paperComposing = true; });
  on(INPUT, 'compositionend', function(){
    paperComposing = false;
    var v = INPUT.value;
    INPUT.value = '';
    commitPaper(v);
  });
  on(INPUT, 'input', function(e){
    if (paperComposing || e.isComposing) return;   // 组词中不吞字符，等 compositionend
    var v = INPUT.value;
    INPUT.value = '';
    commitPaper(v);
  });

  /* 回车 = 换到下一竖列（不是收稿）；⌘/Ctrl + 回车 才落印 */
  function paperNewCol(){
    if (sealed) return;
    stopTyping();
    if (!manual){
      manual = true;
      clearSheet();
      SOURCE.style.opacity = '0';
    }
    if (lines.length >= COLS) return;
    if (lines[lines.length - 1].length === 0) return;
    lines.push('');
    SFX.play('paper.line');
    placeCaret();
  }

  function onKey(e){
    if (e.isComposing || paperComposing) return;    // 组词回车 = 上屏，不是换列
    if (e.key === 'Enter'){
      e.preventDefault();
      if (e.ctrlKey || e.metaKey){
        if (chars.length){ stopTyping(); manual = true; sealNow(); }
        return;
      }
      paperNewCol();
    } else if (e.key === 'Backspace' && !sealed){
      e.preventDefault();
      if (!chars.length) return;
      chars.pop();
      /* 整列重建：静音重排，还原标点/括号样式与手写姿态 */
      COLSEL.innerHTML = '';
      cols.length = 0;
      lines = [''];
      chars.forEach(appendEntry);
      readout();
      placeCaret();
    }
  }
  on(INPUT, 'keydown', onKey);

  // 稿纸本身：点一下就自己写（打过的会自动清成白纸）
  on(SHEET, 'click', function(e){
    e.stopPropagation();
    if (sealed){ clearSheet(); manual = true; SOURCE.style.opacity = '0'; }
    try { INPUT.focus({ preventScroll: true }); } catch(err){}
  });

  return {
    open: playQuote,
    stop: stopTyping,
    close: stopTyping,
    /* 落印 / 清空按钮：引擎按 current 分发到这两台 */
    seal(){ if (chars.length && !sealed){ stopTyping(); manual = true; sealNow(); } },
    clear(){ clearSheet(); manual = true; SOURCE.style.opacity = '0'; }
  };
}
