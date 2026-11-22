/* 首页「五台机器」的交互逻辑。
 *
 * 前两台（稿纸 / 专注）从 web/paper.html 的 <script> 原样搬来；后三台是重写的——
 * 写了个写（三层牌堆凑字）、抽词（翻卡成双）、砖块（八乘八消行）。
 * 五台都有明确的结果反馈：成了落黄印「成」，散了落朱红「散」。
 *
 * 三条工程约定：
 *   ① 包成 attachHall() 返回清理函数 —— React 的 StrictMode 会挂载两次，
 *      所有监听走同一个 AbortController，所有 setTimeout 进 timeouts，卸载时同批清掉；
 *   ② 每次挂载前先清空动态容器，避免第二次挂载把内容叠成两份；
 *   ③ 汉字一个没换成图：牌子、卡面、判词都是字，配纸色与硬边。
 *
 * 因为是 DOM 驱动的移植（大量 DOM 操作、没有把状态交给 React），这里关掉类型检查：
 * 交互以站点实际表现为准。结构在 Hall.tsx，样式在 hall.css。
 */
// @ts-nocheck
/* 特效层是独立模块，必须显式 import —— 打平后的 bundle 里 `createFx` 恰好是同一个作用域的函数，
   少这行 import 时"构建能过、dev 直接 ReferenceError"，是那种只在开发服务器上炸的错。 */
import { createFx } from './fx';
/* 音效同理：同一条 import 缺失，build 绿、dev 白屏。 */
import { createSfx } from './sfx';
/* 「墨潮」是独立模块：它自己建 DOM、自己算、自己存档，不接这台 engine 的状态机。 */
import { mountRogue } from './rogue';

export function attachHall() {
  const ac = new AbortController();
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  var timeouts = [];

  /* 触屏方向键的通用接线：按下即触发一次，按住则连发（方向键"按住持续走"的手感）。
     用 pointerdown 而不是 click —— 触摸端 click 有 300ms 的等待，方向键等不起。 */
  function bindPad(padId, onKey, holdMs){
    var pad = document.getElementById(padId);
    if (!pad) return null;
    var holdTimer = 0, cur = null;
    function stop(){
      if (holdTimer){ window.clearTimeout(holdTimer); holdTimer = 0; }
      cur = null;
    }
    function fire(btn){
      var key = btn.getAttribute('data-dir') || btn.getAttribute('data-move');
      if (!key) return;
      btn.classList.add('is-hit');
      window.setTimeout(function(){ btn.classList.remove('is-hit'); }, 90);
      onKey(key);
    }
    on(pad, 'pointerdown', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('.tbtn') : null;
      if (!btn) return;
      e.preventDefault();
      stop();
      cur = btn;
      fire(btn);
      if (holdMs){
        holdTimer = window.setInterval(function(){ if (cur) onKey(cur.getAttribute('data-dir') || cur.getAttribute('data-move')); }, holdMs);
        timeouts.push(holdTimer);
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(ev){ on(pad, ev, stop); });
    /* 手指滑出按键也要停：否则一直按着会"粘住" */
    on(pad, 'pointermove', function(e){
      if (!cur) return;
      var over = e.target && e.target.closest ? e.target.closest('.tbtn') : null;
      if (over !== cur) stop();
    });
    return pad;
  }

  /* 特效层：全屏粒子画布 + 飘分层，实现见 fx.ts
     （对象池、自适应预算、飘分、连击读数、命中停顿都在那一份里） */
  var FX = createFx(ac.signal);
  window.__FX = FX;
  /* 音效层：零资源（WebAudio 现算），一台机器一套音色，实现见 sfx.ts。
     这里只拿到接口；`setGame()` 在开机台时切，`fanfare()` 在判词落定时响，其余在各自的节拍点。 */
  var SFX = createSfx();
  window.__SFX = SFX;
  ac.signal.addEventListener('abort', function(){ SFX.stop(); });
  /* 浏览器的自动播放策略：AudioContext 必须在一次真实手势里创建。
     挂在 document 上（只做一次 unlock，重复调用也只是 resume 一下），不拦任何点击。 */
  ['pointerdown', 'keydown', 'touchstart'].forEach(function(ev){
    document.addEventListener(ev, function(){ SFX.unlock(); }, { passive: true });
  });

  /* ================= 字库：成套的字，不是随机单字 ================= */
  /* 上一版每台各自 `shuffle(一堆单字)`，读起来就是"随机报字"，字与字之间没有关系。
     现在每局先选一套**词**，牌面上的字都从这套词里拆出来 —— 收走一对就是拼回一个名字，
     吃掉两个字就是写完一个词。四套的口径：
       · 五行：五个字自己成一圈（金木水火土），食物按圈排；
       · 三国：两字名字（赵云、关羽……），07 收一对 = 拼回一个人；
       · 山水 / 器物：两字词（青松、流水 / 笔墨、纸砚）。
     每套还带一个记号（em）与纸色（tint），牌角一枚很小的印，标明这一局在写什么。 */
  var WORDS = {
    wuxing: {
      name: '五行', em: 'dot', tint: '#a98a4b',
      hint: '金木水火土 · 一气转一圈',
      words: ['金', '木', '水', '火', '土'],
      color: { '金': '#a98a4b', '木': '#6f8f5b', '水': '#5b7fa8', '火': '#c2533f', '土': '#a98a63' }
    },
    sanguo: {
      name: '三国', em: 'flag', tint: '#c2533f',
      hint: '两字一名 · 收一对就是拼回一个人',
      words: ['赵云', '关羽', '张飞', '黄忠', '马超', '周瑜', '陆逊', '孙权',
        '曹操', '典韦', '许褚', '张辽', '徐晃', '甘宁', '太史慈', '姜维',
        '庞统', '法正', '马谡', '魏延']
    },
    shanshui: {
      name: '山水', em: 'peak', tint: '#5c7a63',
      hint: '两字一景 · 石桥、远山、归舟',
      words: ['青松', '流水', '明月', '寒江', '归舟', '落雪', '远山', '野渡',
        '孤云', '晚钟', '石桥', '竹林', '清泉', '夜雨', '空谷', '残阳']
    },
    qiwu: {
      name: '器物', em: 'cup', tint: '#8a6b45',
      hint: '两字一物 · 笔墨、纸砚、孤灯',
      words: ['笔墨', '纸砚', '孤灯', '清茶', '旧书', '寒窗', '铜镜', '玉尺',
        '纸伞', '木匣', '墨盒', '笔架', '石印', '镇纸']
    }
  };

  function themeOf(key){ return WORDS[key] || WORDS.sanguo; }

  /* 这套词里出现过的字（两字词会有重复字，去重后才是"能配对"的字） */
  function themeChars(key){
    var t = themeOf(key), seen = {}, out = [];
    t.words.forEach(function(word){
      for (var i = 0; i < word.length; i++){
        var c = word.charAt(i);
        if (!seen[c]){ seen[c] = 1; out.push(c); }
      }
    });
    return out;
  }

  /* 取 n 个整词、合起来正好 n 个字（只取整词，07 才能保证"每个名字都拼得完"）。
     凑不满就返回 null，交给调用方退化成"单字循环"。 */
  function themeWordChars(key, charCount){
    var t = themeOf(key), words = t.words.slice(), out = [], pick = [];
    for (var i = 0; i < words.length; i++){
      if (out.length + words[i].length > charCount) continue;
      pick.push(words[i]);
      for (var k = 0; k < words[i].length; k++) out.push(words[i].charAt(k));
      if (out.length === charCount) return { words: pick, chars: out };
    }
    return null;
  }

  /* 牌角那枚小印：把主题写到容器上，具体图案交给 CSS（一个主题一条 ::before） */
  function markTheme(el, key){
    if (!el) return;
    var t = themeOf(key);
    el.setAttribute('data-em', t.em);
    el.setAttribute('data-theme', key);
  }

  /* ================= 字的"象形标记" ================= */
  /* 一个字只有一个字，读起来还是"报字"。给每个字配一枚 10px 的象形记号：
     水是三道波纹、火是一点焰、山是一个尖、月是一弯钩…… 牌角那一枚说明"这个字画的是什么"，
     一局下来是"山水"还是"器物"不用看标题也认得出来。
     记号按**字义**归类，不按主题：同一个"云"在三国与山水里都是同一朵云。
     只画线、只用一个颜色，和纸面同调；不做彩色插画，否则 80 张牌会吵成一团。 */
  var CHAR_FAMILY = (function(){
    var groups = {
      metal: '金银铜铁镜钱尺刃锋',
      wood: '木松竹梅林枝叶桃柳',
      water: '水江泉河海流波潮',
      fire: '火灯烛炎焰',
      earth: '土尘沙石岩泥',
      peak: '山峰岭岳峦崖',
      cloud: '云雪雾风霜',
      moon: '月明星辰',
      boat: '舟渡桥帆船',
      book: '书墨笔纸砚卷册字',
      cup: '茶酒杯壶盏',
      bird: '雁鹤燕莺鸿',
      stone: '砖壁墙瓦',
      sky: '天穹宇'
    };
    var out = {};
    for (var fam in groups){
      var cs = groups[fam];
      for (var i = 0; i < cs.length; i++) out[cs.charAt(i)] = fam;
    }
    /* 三国那一套全是人名里的字：给"人"这一枚，收一对就是拼回一个人 */
    var men = '赵云关羽张飞黄忠马超周瑜陆逊孙权曹操典韦许褚张辽徐晃甘宁太史慈姜维庞统法正马谡魏延';
    for (var k = 0; k < men.length; k++) out[men.charAt(k)] = 'person';
    return out;
  })();
  function iconOf(ch){ return CHAR_FAMILY[ch] || ''; }
  /* 牌/卡/格上挂 data-ic，图案由 CSS 的 [data-ic] 规则给（每个族一条 data URI） */
  function markIcon(el, ch){
    if (!el) return;
    var fam = iconOf(ch);
    if (fam) el.setAttribute('data-ic', fam);
  }

  /* 挂载前清场：动态生成的格子 / 牌 / 行 / 卡都不进 JSX，重挂时先抹掉 */
  (function resetDynamic() {
    ['cols', 'ticks', 'focusBlock', 'pile', 'pairGrid', 'brkBoard', 'brkTray', 'onetGrid', 'mergeTiles'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    ['pileVerdict', 'pairVerdict', 'brkVerdict', 'bkVerdict'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('is-on');
    });
    ['pairCount', 'pairVText', 'pairVSeal', 'pileVText', 'pileVSeal', 'brkVText', 'brkVSeal', 'bkVText', 'bkVSeal'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    const slot0 = document.getElementById('pileSlot');
    if (slot0) slot0.querySelectorAll('.slot').forEach(function (s) { s.innerHTML = ''; });
    const pairGrid0 = document.getElementById('pairGrid');
    if (pairGrid0) pairGrid0.classList.remove('is-live');
    const paneWord0 = document.getElementById('pane-word');
    if (paneWord0) paneWord0.classList.remove('is-idle');
    const paneBreak0 = document.getElementById('pane-break');
    if (paneBreak0) paneBreak0.classList.remove('is-over');
    const paper = document.getElementById('paper');
    if (paper) paper.querySelectorAll('.seal').forEach(function (n) { n.remove(); });
  })();

/* ================= 素材：现代诗（每台随机取一首） ================= */
  var POEMS = [
    { text:'黑夜给了我黑色的眼睛，我却用它寻找光明。', from:'顾城 · 一代人' },
    { text:'卑鄙是卑鄙者的通行证，高尚是高尚者的墓志铭。', from:'北岛 · 回答' },
    { text:'从明天起，做一个幸福的人，喂马，劈柴，周游世界。', from:'海子 · 面朝大海，春暖花开' },
    { text:'从前的日色变得慢，车，马，邮件都慢。', from:'木心 · 从前慢' },
    { text:'你站在桥上看风景，看风景的人在楼上看你。', from:'卞之琳 · 断章' },
    { text:'小时候，乡愁是一枚小小的邮票，我在这头，母亲在那头。', from:'余光中 · 乡愁' },
    { text:'只要想起一生中后悔的事，梅花便落了下来。', from:'张枣 · 镜中' },
    { text:'轻轻的我走了，正如我轻轻的来，我轻轻的招手，作别西天的云彩。', from:'徐志摩 · 再别康桥' },
    { text:'我必须是你近旁的一株木棉，作为树的形象和你站在一起。', from:'舒婷 · 致橡树' },
    { text:'我打江南走过，那等在季节里的容颜，如莲花的开落。', from:'郑愁予 · 错误' },
    { text:'远在远方的风，比远方更远。', from:'海子 · 九月' },
    { text:'巴巴地活着，每天打水，煮饭，按时吃药。', from:'余秀华 · 我爱你' }
  ];
  var lastPick = -1;
  function pickPoem(){
    if (POEMS.length < 2) return POEMS[0];
    var i = lastPick;
    while (i === lastPick) i = Math.floor(Math.random() * POEMS.length);
    lastPick = i;
    return POEMS[i];
  }

  var COLS = 5;   // .cols 的 inset:0 var(--cell) → 7 格宽里只占 5 格
  var ROWS = 9;   // .paper 的高度 calc(var(--cell) * 9)

  var SHEET = document.getElementById('sheet');
  var PAPER = document.getElementById('paper');
  var COLSEL = document.getElementById('cols');
  var COUNT = document.getElementById('count');
  var TICKS = document.getElementById('ticks');
  var STATE = document.getElementById('state');
  var SOURCE = document.getElementById('source');
  var INPUT = document.getElementById('typeIn');
  var FINEPOINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  var chars = [];
  var cols = [];
  var lines = [''];        // 一句一列：诗词按句断列，满 9 字才自然换列
  var sealed = false;
  var manual = false;
  var typingTimer = null;

  for (var t = 0; t < ROWS; t++){
    var tick = document.createElement('i');
    tick.className = 'ro-tick';
    TICKS.appendChild(tick);
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
  function pushChar(ch, brk){
    if (sealed || chars.length >= COLS * ROWS) return false;
    var li = lines.length - 1;
    var liFrom = li;
    if (brk && lines[li].length > 0){ lines.push(''); li = lines.length - 1; }
    if (lines[li].length >= ROWS){ lines.push(''); li = lines.length - 1; }
    if (li >= COLS) return false;
    var col = ensureCol(li);
    var caret = findCaret();
    var g = document.createElement('div');
    g.className = 'glyph is-land';
    g.textContent = ch;
    if (caret && caret.parentNode === col) col.insertBefore(g, caret); else col.appendChild(g);
    lines[li] += ch;
    chars.push(ch);
    /* 笔尖落纸：一声很轻的沙，170ms 一次，慢慢写的时候像真的在写；
       换列时补一下"翻过去"的轻响 —— 一行写满和随手打字应该听得出不一样 */
    SFX.play(li > liFrom ? 'paper.line' : 'paper.type');
    readout();
    placeCaret();
    if (chars.length >= COLS * ROWS) sealNow();
    return true;
  }
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
    /* 落印是这一页的结论：写满了说满页，没写满说收稿。印砸下去要有一下"实"的反馈 */
    SFX.play('paper.seal');
    FX.burst(seal.getBoundingClientRect(), { count: 13, dust: 8, power: 380, size: 7, colors: ['#c0392b', '#252525', '#fff8e8'] });
    FX.shake(SHEET, 2);
    /* 落印就是这一页的结论：写满了说满页，没写满说收稿 */
    var full = chars.length >= COLS * ROWS;
    SHEET.classList.toggle('is-full', full);
    STATE.textContent = full ? '满页 · 已收稿' : '已收稿';
    if (current === 'paper') MHINT.textContent = full ? '一页满了 · 点清空再写' : '再点清空，写下一张';
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
  }

  /* 按句读断列：一句一列，太碎的小句并到前一句 */
  function splitLines(text){
    var raw = [], cur = '';
    for (var i = 0; i < text.length; i++){
      var ch = text.charAt(i);
      cur += ch;
      if ('，。！？；：、'.indexOf(ch) >= 0){ raw.push(cur); cur = ''; }
    }
    if (cur) raw.push(cur);
    var out = [], buf = '';
    raw.forEach(function(seg){
      buf += seg;
      if (buf.length >= 3){ out.push(buf); buf = ''; }
    });
    if (buf){
      if (out.length) out[out.length - 1] += buf;
      else out.push(buf);
    }
    return out;
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
        setTimeout(function(){ if (!manual && !sealed) sealNow(); }, 900);
        return;
      }
      var it = seq[i++];
      pushChar(it.ch, it.brk);
    }, 170);
  }

  /* ================= 02 专注 ================= */
  var FBLOCK = document.getElementById('focusBlock');
  var FSRC = null;
  var FLINES = [];
  var focusIndex = -1;
  var focusTimer = null;
  var focusManual = false;

  function makeLine(i, text){
    var p = document.createElement('p');
    p.className = 'fline';
    p.setAttribute('data-i', String(i));
    p.innerHTML = '<i>' + ('0' + (i + 1)).slice(-2) + '</i><span class="txt"></span>';
    p.querySelector('.txt').textContent = text || '';
    on(p, 'click', function(){
      stopFocus();
      focusManual = true;
      setFocus(Number(p.getAttribute('data-i')));
    });
    return p;
  }
  function buildFocus(lines, from){
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
  }
  function setFocus(i){
    focusIndex = i;
    for (var k = 0; k < FLINES.length; k++){
      FLINES[k].classList.toggle('is-live', k === i);
    }
  }
  function stopFocus(){
    if (focusTimer){ clearInterval(focusTimer); focusTimer = null; }
  }
  function playFocus(){
    stopFocus();
    focusManual = false;
    var q = pickPoem(), lines = splitLines(q.text), tries = 0;
    while (lines.length < 3 && tries < 8){
      q = pickPoem();
      lines = splitLines(q.text);
      tries++;
    }
    buildFocus(lines, q.from);
    setFocus(0);
    focusTimer = setInterval(function(){
      if (focusIndex >= FLINES.length - 1){ stopFocus(); finishFocus(); return; }
      setFocus(focusIndex + 1);
    }, 2200);
  }

  /* 一行一行推到末尾，就是"这一首读完了"——落一枚终字印，别让人对着末行发愣 */
  function finishFocus(){
    if (!FBLOCK || focusManual) return;
    if (FBLOCK.querySelector('.focus-end')) return;
    var end = document.createElement('div');
    end.className = 'focus-end';
    end.innerHTML = '<span class="focus-seal">终</span><span class="focus-end-text">这一首读完了</span>';
    FBLOCK.appendChild(end);
    SFX.play('focus.end');
    if (current === 'focus') MHINT.textContent = '这一首读完了 · 再来一次重挑';
  }

  /* 手动：点一下就开始写，写满一行回车换行 */
  function focusStartManual(){
    focusManual = true;
    stopFocus();
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

  /* --------- 共用：延时、判词 --------- */
  function later(fn, ms){
    var id = setTimeout(fn, ms);
    timeouts.push(id);
    return id;
  }

  /* 判词：文案上一句人话，结论落成一方印 */
  function showVerdict(wrap, textEl, sealEl, cls, text, glyph){
    textEl.textContent = text;
    sealEl.className = 'verdict-seal ' + cls;
    sealEl.textContent = glyph;
    wrap.classList.add('is-on');
    later(function(){ sealEl.classList.add('is-on'); }, 120);
    /* 判词落下就是这一局的结论：十一台共用这一条路，所以收场音只写在这里。
       和弦的根音按机器取（WIN_BASE），同一个"赢"在十一台机器上是十一种高度。 */
    later(function(){ SFX.fanfare(cls === 'v-ok'); }, 120);
    /* 收场那一刻也该有"落下"的反馈：赢了在判词条上撒一把纸穗与金粉，输了不撒 */
    if (cls === 'v-ok'){
      later(function(){
        var r = wrap.getBoundingClientRect();
        FX.burst({ left: r.left + r.width * 0.2, top: r.top, width: r.width * 0.6, height: 8 }, {
          count: glyph === '满' ? 26 : 16, dust: glyph === '满' ? 10 : 6, power: 300,
          gravity: 980, size: 7, ring: false, flash: false,
          colors: ['#fff8e8', '#ffd166', '#252525']
        });
        if (glyph === '满') FX.ring(r.left + r.width / 2, r.top + 10, 10, r.width * 0.5, 3, '#ffd166');
      }, 240);
    }
  }

  /* ---------- 得分 / 连击 / 飘分的公共小工具 ----------
     四台机器（03/04/05/06/07）都用同一套口径，免得"连击"在每台里含义不一样：
       · 连击只在"两次成功之间不超过 win 毫秒"时续上，超过就断；
       · 乘区就是连击数本身（2 连 = ×2，封顶 max）—— 简单到玩家不用看说明；
       · 飘分落在**发生地**（卡面、砖块、槽口），不是只让 HUD 的数字变大。 */
  function comboState(winMs, max){
    return { n: 0, t: -1e9, win: winMs, max: max || 8 };
  }
  function comboAdd(st){
    return comboBump(st, 1);
  }
  /* 一次加多格连击（一手消两条线就 +2）：比"每条线各调一次 comboAdd"更能表达"一手多条" */
  function comboBump(st, add){
    var now = performance.now();
    st.n = (now - st.t <= st.win) ? Math.min(st.max, st.n + add) : add;
    st.t = now;
    return st.n;
  }
  function comboBreak(st){ st.n = 0; st.t = -1e9; return 0; }
  function comboMult(st){ return Math.max(1, st.n); }
  function popAt(el, text, cls){
    if (!el) return;
    var r = el.getBoundingClientRect();
    FX.pop(r.left + r.width / 2, r.top + r.height / 2 - 6, text, { cls: cls });
  }
  function hudSet(el, v){ if (el) el.textContent = String(v); }
  function fmtStars(n){ return n >= 3 ? '★★★' : n === 2 ? '★★' : '★'; }

  function shuffle(a){
    for (var i = a.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ================= 03 写了个写 · 三层牌堆 ================= */
  /* 牌叠成塔，上层压住下层（被压的翻成牌背、点不动）。点最上面那层的牌，
     牌进底下那条槽（五到七格），攒够三张同字就一起消掉。
     全清是「成」并进下一关，槽塞满没消是「散」，本关重来。
     每层张数都是 3 的倍数、层内互不遮挡、上层完整压住下层 —— 所以每一关都有解：
     一格一格往下清（先顶层、再中层、最后底层）必然通关；乱取才会把槽塞满。
     五关的分别是：层数 4→5→6、槽位 7→6→5。 */
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

  /* 字池要够大：一组三张独占一个字，组与组不共用 —— 这样"哪三张是一伙的"没有歧义，
     也才敢说"同字三张一定不同层"。第 5 关 32 组，池子得留出余量。 */
  var PCHARS = ['月','舟','烛','钥','伞','雁','窗','梅','灯','雪','风','云',
    '书','墨','茶','松','石','桥','巷','雨','霜','鸟','花','竹',
    '琴','棋','诗','酒','江','山','船','潭'];
  /* 每关一套词：越到后面牌越多，字也要够 —— 器物 28 字、山水 32 字、三国 40 字 */
  var PILE_THEMES = ['sanguo', 'shanshui', 'qiwu', 'sanguo', 'shanshui'];
  var pTiles = [], pSlot = [], pDone = false, pLock = false, pWin = false;
  /* —— 这一轮加的三件：分数、连击、以及每关一枚「钥」牌 ——
     分数：凑成一组 120 × 连击，过关再加整关奖励；最高分只存本地。
     连击：4.2 秒内接着凑成就是连击，断一次归零 —— 逼着人"想清楚了再落手"，而不是乱点。
     钥牌：每关随机埋在第二层或更深处的一张「钥」，取到它不占槽，而是**永久 +1 槽位**（最多 +2）。
           这是"要不要为了宽一点的槽先挖深"的取舍，也是这一台唯一能改变规则的东西。 */
  var pScore = 0, pBest = 0, pSlotBonus = 0, pKeyTile = null;
  var pCombo = comboState(4200, 8);
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
  var PILE_UNITS = 5;      // 横向几列牌
  var PILE_ROWS = 4;       // 纵向几行牌

  /* 每层 [列数, 行数, 偏移, 层号]；层张数必须能被 3 整除。
     难度三件事一起抬：牌更多、层更厚（被压住的更多）、槽更少（失误余量更小）。
     第 1 关 54 张 / 四层 / 七格；第 5 关 96 张 / 六层 / 五格。 */
  var PLEVELS = [
    { layers: [[6,3,0],[5,3,.5],[4,3,1],[3,3,1.5]], slots: 7 },
    { layers: [[7,3,0],[6,3,.5],[5,3,1],[4,3,1.5]], slots: 6 },
    { layers: [[7,3,0],[6,3,.5],[5,3,1],[4,3,1.5],[3,3,2]], slots: 5 },
    { layers: [[8,3,0],[7,3,.5],[6,3,1],[5,3,1.5],[4,3,2]], slots: 5 },
    { layers: [[8,3,0],[7,3,.5],[6,3,1],[5,3,1.5],[4,3,2],[2,3,2.5]], slots: 5 }
  ];
  var pLevel = 0;
  var SLOTS = 7;

  function pileSpec(){ return PLEVELS[Math.min(pLevel, PLEVELS.length - 1)]; }

  function pileLayout(spec){
    var out = [];
    spec.layers.forEach(function(L, layer){
      for (var r = 0; r < L[1]; r++){
        for (var c = 0; c < L[0]; c++){
          out.push({ x: L[2] + c, y: L[2] + r, layer: layer });
        }
      }
    });
    return out;
  }

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

  /* 重来一次只重来这一关：爬到第 4 关输了不该被踢回第 1 关。
     分数也退回这一关开局时的值（本关白打了，但前几关的分不该被扣）。 */
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
  var pLevelScore = 0;   // 本关开局那一刻的总分，输了只退回这里

  /* 一副牌 = 一条"合法剥皮顺序" + 一组三张的分法。
     为什么要有"剥皮顺序"这件事：旧版把同字三张塞在同一层，而同一层内互不遮挡，
     于是"从上往下一层一层剥"每层都自给自足 —— 拿三张就消一组，槽永远不满，等于不用想。
     现在同字三张被拆到不同层，想凑齐必须往深处挖，而每挖一层就多压几张在槽里。 */
  function pileDeal(pos){
    /* 剥皮顺序：两步 —— ① 80% 概率别紧跟上一层，② 换层之后仍有 72% 概率往最深处挖。
       每一步都只取当下没被压住的牌，所以这整条顺序是一条合法解，只是会在上下层之间来回。 */
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
        if (Math.random() < 0.72){
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

    /* 发字：按"波"分。一波里同时开 G 条线，每条线取"前中后三段"各一张，
       槽里最多压 2G 张、第三张一到就凑齐（2G+1 正好等于槽位数）。
       配组时优先挑不同层的牌，所以一组三张几乎总是散在几层上。 */
    var budget = SLOTS - 1;
    var G = Math.max(1, Math.min(2, Math.floor(budget / 2)));
    var waveLen = 3 * G;
    var trios = [];
    for (var b0 = 0; b0 < peel.length; b0 += waveLen){
      var rest = Math.min(b0 + waveLen, peel.length) - b0;
      if (rest === waveLen){
        var A = [], B = [], C = [];
        for (var q = 0; q < G; q++){ A.push(b0 + q); B.push(b0 + q + G); C.push(b0 + q + 2 * G); }
        for (var t = 0; t < G; t++){
          var a = A[t], bi = 0, ci = 0, k2;
          for (k2 = 0; k2 < B.length; k2++) if (peel[B[k2]].layer !== peel[a].layer){ bi = k2; break; }
          var bix = B.splice(bi, 1)[0];
          for (k2 = 0; k2 < C.length; k2++){
            var cl = peel[C[k2]].layer;
            if (cl !== peel[a].layer && cl !== peel[bix].layer){ ci = k2; break; }
          }
          if (peel[C[ci]].layer === peel[a].layer){
            for (k2 = 0; k2 < C.length; k2++) if (peel[C[k2]].layer !== peel[a].layer){ ci = k2; break; }
          }
          trios.push([a, bix, C.splice(ci, 1)[0]]);
        }
      } else {
        for (var q2 = 0; q2 + 3 <= rest; q2 += 3) trios.push([b0 + q2, b0 + q2 + 1, b0 + q2 + 2]);
      }
    }

    /* 字池按"这一关写哪一套"来取：三国、山水、器物轮着来，牌面上是一个个名字的偏旁。
       每组三张独占一个字，所以池子要不重复；套里的字不够时（如五行只有五个字）用旧池补足。 */
    var need = Math.ceil(pos.length / 3);
    var tchars = themeChars(PILE_THEMES[pLevel] || 'sanguo');
    if (tchars.length < need){
      PCHARS.forEach(function(c){ if (tchars.length < need && tchars.indexOf(c) < 0) tchars.push(c); });
    }
    var pool = shuffle(tchars);
    var chByPos = {}, sameLayer = 0;
    trios.forEach(function(ix, k){
      var ch = pool[k % pool.length];
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

  function buildPile(){
    PILE.innerHTML = '';
    pTiles = [];
    pSlot = [];
    pDone = false;
    pLock = false;
    pKeyTile = null;
    pLevelScore = pScore;
    PILE_V.classList.remove('is-on');
    PILE_PANE.classList.remove('is-over');
    PILE_VS.className = 'verdict-seal';
    PILE_VS.textContent = '';
    MHINT.textContent = '点没被压住的牌 · 同字三张不一定同层';
    mReplayLabel('再来一次');

    var spec = pileSpec();
    pSlotBonus = 0;
    SLOTS = spec.slots;
    var pos = pileLayout(spec);
    PILE_UNITS = spec.layers[0][0];
    PILE_ROWS = 3 + spec.layers[spec.layers.length - 1][2];

    /* 这一局写哪一套：牌面上是"赵云关羽张飞"的字，HUD 里写清主题 */
    var themeKey = PILE_THEMES[pLevel] || 'sanguo';
    markTheme(PILE_PANE, themeKey);
    if (PILE_THEME) PILE_THEME.textContent = themeOf(themeKey).name;

    /* 排局重试：直到"没有任何一组三张落在同一层"为止。
       组内同层意味着这一组能在这一层里自给自足，攒够几组就等于白送一层 —— 正是上一版被判太简单的原因。
       一副 54 张的排局算一次只要几毫秒，最多试 40 次，取同层组最少的那副兜底。 */
    var deal = null;
    for (var att = 0; att < 40; att++){
      var d = pileDeal(pos);
      if (!deal || d.sameLayer < deal.sameLayer) deal = d;
      if (d.sameLayer === 0) break;
    }
    var peel = deal.peel;
    var chByPos = deal.chByPos;
    var sameLayerTrios = deal.sameLayer;

    var tw = 100 / PILE_UNITS;
    var th = 100 / PILE_ROWS;
    pos.forEach(function(p, k){
      var b = document.createElement('button');
      p.ch = chByPos[k];   /* 配对靠 p.ch，别只把字写在 DOM 上 */
      b.type = 'button';
      b.className = 'ptile';
      b.style.left = (p.x / PILE_UNITS * 100) + '%';
      b.style.top = (p.y / PILE_ROWS * 100) + '%';
      b.style.width = tw + '%';
      b.style.height = th + '%';
      b.style.zIndex = String(10 + p.layer * 10);
      b.textContent = p.ch;
      markIcon(b, p.ch);
      b.setAttribute('aria-label', '取走一张「' + p.ch + '」');
      on(b, 'click', function(){ takeTile(p); });
      PILE.appendChild(b);
      p.el = b;
      p.idx = k;
      pTiles.push(p);
    });

    /* 钥牌：埋在第 2 层或更深（不放在最上层，否则开局就能白拿）。
       它不改配对规则，只把槽位永久放宽 1 格（最多 2 格），所以排局一定有解这条不被破坏。 */
    var deep = pTiles.filter(function(t){ return t.layer >= 1; });
    if (deep.length){
      pKeyTile = deep[Math.floor(Math.random() * deep.length)];
      pKeyTile.key = true;
      pKeyTile.el.classList.add('is-key');
      pKeyTile.el.textContent = '钥';
      pKeyTile.el.setAttribute('aria-label', '取走「钥」· 槽位 +1');
      markIcon(pKeyTile.el, '钥');
    }

    /* 给自动化验收留的钩子：sol 是"照这个顺序点一定清完"的那串下标 */
    PILE.__sol = peel.map(function(p){ return p.idx; });
    PILE.__stats = { groups: deal.trios.length, sameLayer: sameLayerTrios, slots: SLOTS, tiles: pTiles.length };
    refreshPileCover();
    renderSlots();
    pileHud();
    syncSlotCount();
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

  function refreshPileCover(){
    pTiles.forEach(function(t){
      var cov = pileCovered(t);
      t.el.classList.toggle('is-lock', cov);
      if (cov) t.el.setAttribute('aria-disabled', 'true');
      else t.el.removeAttribute('aria-disabled');
    });
  }

  function renderSlots(){
    var slots = Array.prototype.slice.call(PILE_SLOT.querySelectorAll('.slot'));
    slots.forEach(function(s){
      while (s.firstChild) s.removeChild(s.firstChild);
    });
    var n = 0;
    pSlot.forEach(function(it){
      var s = slots[n];
      if (!s) return;
      var chip = document.createElement('span');
      chip.className = 'sitem' + (it.pop ? ' is-pop' : '');
      chip.textContent = it.ch;
      s.appendChild(chip);
      n++;
    });
    PILE_SLOT.classList.toggle('is-hot', pSlot.filter(function(it){ return !it.pop; }).length >= SLOTS - 1);
  }

  function takeTile(t){
    if (pDone || pLock) return;
    if (!t.el || t.el.classList.contains('is-lock')) return;
    if (t.el.classList.contains('is-go')) return;

    pTiles.splice(pTiles.indexOf(t), 1);
    t.el.classList.add('is-go');

    /* 钥牌不进槽：它把槽位永久放宽一格，是"先挖深换空间"的那一手 */
    if (t.key){
      pSlotBonus = Math.min(2, pSlotBonus + 1);
      SLOTS = pileSpec().slots + pSlotBonus;
      pKeyTile = null;
      pScore += 60;
      SFX.play('pile.key');
      popAt(t.el, '槽 +1', 'is-gold');
      FX.rise(t.el.getBoundingClientRect().left + 12, t.el.getBoundingClientRect().top + 8, 12, ['#ffd166', '#a8c7a0', '#fff8e8']);
      syncSlotCount();
      refreshPileCover();
      pileHud();
      MHINT.textContent = '取到「钥」· 槽位放宽到 ' + SLOTS + ' 格';
      return;
    }

    pSlot.push({ ch: t.ch });
    /* 取牌一记短脆（瓷片），凑成时再三片叠响 —— 取和消必须听得出区别 */
    SFX.play('pile.pick');
    renderSlots();
    refreshPileCover();
    pileHud();

    var same = pSlot.filter(function(it){ return !it.pop && it.ch === t.ch; });
    if (same.length >= 3){
      pLock = true;
      /* 三张凑齐：槽里炸一下 + 牌面炸一下。牌是"被抽走"的，槽是"被消掉"的，两处都该有反馈 */
      SFX.play('pile.match', { rate: 1 + Math.min(0.5, comboMult(pCombo) * 0.06) });
      FX.burst(t.el.getBoundingClientRect(), { count: 10, power: 420, colors: ['#252525', '#f28b82', '#fff8e8'] });
      FX.burst(PILE_SLOT.getBoundingClientRect(), { count: 20, power: 400, dust: 10, colors: ['#252525', '#f28b82', '#ffd166', '#fff8e8'] });
      FX.shake(PILE, 3);
      var marked = 0;
      pSlot.forEach(function(it){
        if (!it.pop && it.ch === t.ch && marked < 3){ it.pop = true; marked++; }
      });
      renderSlots();

      /* 得分落在槽口：120 × 连击。连击 2 以上再补一圈金环与"×N 连击"的飘字，
         让人一眼知道自己正处在什么节奏里 —— 这是"重复点"和"有节奏地取"的分界线。 */
      comboAdd(pCombo);
      var mult = comboMult(pCombo);
      var gain = 120 * mult;
      pScore += gain;
      popAt(PILE_SLOT, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 3 ? 'is-gold' : '');
      if (mult >= 2){
        var sr = PILE_SLOT.getBoundingClientRect();
        FX.ring(sr.left + sr.width / 2, sr.top + sr.height / 2, 8, sr.width * 0.55, 3, '#ffd166');
        FX.rise(sr.left + sr.width / 2, sr.top, 8 + mult * 2, ['#ffd166', '#fff8e8']);
      }
      pileHud();
      later(function(){
        pSlot = pSlot.filter(function(it){ return !it.pop; });
        renderSlots();
        pLock = false;
        pileHud();
        if (!pTiles.length){
          pDone = true;
          pWin = true;
          PILE_PANE.classList.add('is-over');
          var last = pLevel >= PLEVELS.length - 1;
          /* 过关奖励 = 300 × 关号：越往后拖得越久，一次过关的回本也越大 */
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
      return;
    }

    /* 取了一张却没凑成：这一手不算失败，但槽满就是失败 */
    if (pSlot.length >= SLOTS){
      pDone = true;
      comboBreak(pCombo);
      PILE_PANE.classList.add('is-over');
      pScore = pLevelScore;
      pileHud();
      showVerdict(PILE_V, PILE_VT, PILE_VS, 'v-bad', '第 ' + (pLevel + 1) + ' 关散了 · 槽满了', '散');
      MHINT.textContent = '散了 · 槽塞满，本关重来';
      mReplayLabel('重开本关');
      return;
    }
    MHINT.textContent = '还剩 ' + Math.ceil(pTiles.length / 3) + ' 组 · 槽里 ' + pSlot.length + ' / ' + SLOTS;
  }

  /* ================= 05 砖块 · 八格填满就消 ================= */
  /* 八乘八的空盘，每次发三块方砖。点一块拿起来，在盘上找地方按下去：
     整行或整列填满就消。消满十行算「成」，三块都放不下就是「散」。 */
  var BOARD = document.getElementById('brkBoard');
  var TRAY = document.getElementById('brkTray');
  var BRK_ROWS = document.getElementById('brkRows');
  var BRK_GOAL = document.getElementById('brkGoal');
  var BRK_HAND = document.getElementById('brkHand');
  var BRK_V = document.getElementById('brkVerdict');
  var BRK_VT = document.getElementById('brkVText');
  var BRK_VS = document.getElementById('brkVSeal');

  var BN = 8, BGOAL = 10;
  var SHAPES = [
    [[1]],
    [[1,1]],
    [[1,1,1]],
    [[1,1,1,1]],
    [[1],[1],[1]],
    [[1],[1],[1],[1]],
    [[1,1],[1,1]],
    [[1,1,1],[1,1,1]],
    [[1,0],[1,0],[1,1]],
    [[1,1],[1,0],[1,0]],
    [[0,1],[0,1],[1,1]],
    [[1,1,1],[0,1,0]],
    [[1,1,1],[1,0,1]],
    [[1,0],[1,1]],
    [[0,1],[1,1]],
    [[1,1],[0,1]]
  ];
  var bGrid = [], bPieces = [], bSel = -1, bRows = 0, bHand = 0, bDone = false, bLock = false;
  var bHover = null;
  var BRK_PANE = document.getElementById('pane-brick');
  var BRK_SCORE = document.getElementById('brkScore');
  var BRK_COMBO = document.getElementById('brkCombo');
  /* 分数与连击：一次落砖 +5/格；消行 120 × 线数 × 连击。
     连击的涨法跟"一手消几条线"直接挂钩（一次双消就跳 +2），断法是"这一手没消任何线"。
     —— 于是"先在不重要的地方落一块"会断连击，玩家必须在"这一块能不能忍"上做取舍。 */
  var bScore = 0, bBest = 0, bMaxCombo = 0;
  var bCombo = comboState(4200, 9);

  function bHudScore(){
    hudSet(BRK_SCORE, bScore);
    FX.combo(BRK_COMBO, bCombo.n);
  }

  function makeCell(r, c){
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'bcell';
    cell.setAttribute('data-r', String(r));
    cell.setAttribute('data-c', String(c));
    cell.setAttribute('aria-label', '第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 格');
    on(cell, 'click', function(){ dropAt(r, c); });
    on(cell, 'mouseenter', function(){ bHover = { r: r, c: c }; paintPreview(); });
    BOARD.appendChild(cell);
    return { filled: '', el: cell };
  }

  function startBrick(){
    BOARD.innerHTML = '';
    TRAY.innerHTML = '';
    bGrid = [];
    bPieces = [];
    bSel = -1;
    bRows = 0;
    bHand = 0;
    bDone = false;
    bLock = false;
    bHover = null;
    bScore = 0;
    bMaxCombo = 0;
    bBest = BEST.get('brick.score');
    bCombo = comboState(4200, 9);
    BRK_ROWS.textContent = '0';
    BRK_GOAL.textContent = String(BGOAL);
    BRK_HAND.textContent = '0';
    hudSet(BRK_SCORE, 0);
    FX.combo(BRK_COMBO, 0);
    BRK_V.classList.remove('is-on');
    BRK_PANE.classList.remove('is-over');
    BRK_VS.className = 'verdict-seal';
    BRK_VS.textContent = '';
    MHINT.textContent = '点一块砖，再点盘上落下去';

    for (var r = 0; r < BN; r++){
      var row = [];
      for (var c = 0; c < BN; c++){
        row.push(makeCell(r, c));
      }
      bGrid.push(row);
    }
    on(BOARD, 'mouseleave', function(){ bHover = null; paintPreview(); });
    dealPieces();
    paintPreview();
  }

  function dealPieces(){
    bPieces = [];
    for (var i = 0; i < 3; i++){
      /* 难度靠"发什么形状"抬，而不是靠把盘子变小：
         前四行不给 3×2 的大块（那是死局制造机），消到第 7 行之后反而多给一块 ——
         盘面越空越敢发大块，这个节奏跟"连击"是同一个方向。 */
      var pool = SHAPES.slice();
      if (bRows < 4) pool = pool.filter(function(_s, ix){ return ix !== 7; });
      if (bRows >= 7) pool = pool.concat([SHAPES[7], SHAPES[7], SHAPES[3]]);
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
      wrap.className = 'bpiece' + (p.used ? ' is-used' : '') + (i === bSel ? ' is-on' : '');
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
        if (bDone || p.used) return;
        bSel = (bSel === i ? -1 : i);
        renderTray();
        paintPreview();
        MHINT.textContent = bSel < 0 ? '点一块砖，再点盘上落下去' : '现在点盘子上的格子';
      });
      TRAY.appendChild(wrap);
    });
  }

  function canPlace(shape, r0, c0){
    for (var r = 0; r < shape.length; r++){
      for (var c = 0; c < shape[r].length; c++){
        if (!shape[r][c]) continue;
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= BN || cc < 0 || cc >= BN) return false;
        if (bGrid[rr][cc].filled) return false;
      }
    }
    return true;
  }

  function paintPreview(){
    for (var r = 0; r < BN; r++) for (var c = 0; c < BN; c++){
      bGrid[r][c].el.classList.remove('is-ok', 'is-bad');
    }
    if (bSel < 0 || bDone) return;
    var shape = bPieces[bSel].shape;
    var at = bHover || { r: 0, c: 0 };
    var ok = canPlace(shape, at.r, at.c);
    for (var r2 = 0; r2 < shape.length; r2++){
      for (var c2 = 0; c2 < shape[r2].length; c2++){
        if (!shape[r2][c2]) continue;
        var tr = at.r + r2, tc = at.c + c2;
        if (tr < 0 || tr >= BN || tc < 0 || tc >= BN) continue;
        bGrid[tr][tc].el.classList.add(ok ? 'is-ok' : 'is-bad');
      }
    }
  }

  function dropAt(r, c){
    if (bDone || bLock || bSel < 0) return;
    var p = bPieces[bSel];
    if (!p || p.used) return;
    if (!canPlace(p.shape, r, c)) return;

    var placedCells = 0;
    for (var rr = 0; rr < p.shape.length; rr++){
      for (var cc = 0; cc < p.shape[rr].length; cc++){
        if (!p.shape[rr][cc]) continue;
        var cell = bGrid[r + rr][c + cc];
        cell.filled = String(p.k);
        cell.el.classList.add('is-on', 'k' + p.k);
        placedCells++;
      }
    }
    bScore += placedCells * 5;
    /* 落砖：按这一手的块数给厚度不同的木响（5 格的方块比 1 格的单砖沉） */
    SFX.play('brick.place', { gain: Math.min(1.4, 0.55 + placedCells * 0.12) });
    bHudScore();
    p.used = true;
    bSel = -1;
    bHand++;
    BRK_HAND.textContent = String(bHand);
    renderTray();
    paintPreview();

    /* 满行满列一起算 */
    var rows = [], cols = [];
    for (var i = 0; i < BN; i++){
      var rowFull = true, colFull = true;
      for (var j = 0; j < BN; j++){
        if (!bGrid[i][j].filled) rowFull = false;
        if (!bGrid[j][i].filled) colFull = false;
      }
      if (rowFull) rows.push(i);
      if (colFull) cols.push(i);
    }
    if (rows.length || cols.length){
      bLock = true;
      rows.forEach(function(r2){
        for (var c2 = 0; c2 < BN; c2++) bGrid[r2][c2].el.classList.add('is-clear');
      });
      cols.forEach(function(c2){
        for (var r2 = 0; r2 < BN; r2++) bGrid[r2][c2].el.classList.add('is-clear');
      });
      /* 消行的"碎"要沿整行/整列炸：单点一团看不出是"这一行没了"。
         一行一条带（rect 取整行的并集）、一条冲击环；初速压小、重力加大，
         碎片落在盘内 —— 打穿盘面把渣子甩到机台外面，读起来像"屏幕漏了"。 */
      var lineCols = ['#252525', '#ffd166', '#9cc7f5', '#f28b82', '#a8c7a0'];
      rows.forEach(function(r2, ri){
        var a2 = bGrid[r2][0].el.getBoundingClientRect();
        var z2 = bGrid[r2][BN - 1].el.getBoundingClientRect();
        var rowRect = { left: a2.left, top: a2.top, width: z2.right - a2.left, height: a2.height };
        FX.burst(rowRect, {
          count: 30, dust: 10, power: 270, gravity: 940, size: 8, ring: false, flash: false,
          colors: [lineCols[ri % lineCols.length], '#252525', '#fff8e8']
        });
      });
      cols.forEach(function(c2, ci){
        var a2 = bGrid[0][c2].el.getBoundingClientRect();
        var z2 = bGrid[BN - 1][c2].el.getBoundingClientRect();
        var colRect = { left: a2.left, top: a2.top, width: a2.width, height: z2.bottom - a2.top };
        FX.burst(colRect, {
          count: 30, dust: 10, power: 270, gravity: 940, size: 8, ring: false, flash: false,
          colors: [lineCols[(ci + 2) % lineCols.length], '#252525', '#fff8e8']
        });
      });
      /* 双消（行列交叉）才给爆点 + 强震：单行只该是"一条被削掉"，不必整屏炸 */
      if (rows.length + cols.length >= 2){
        FX.burst(BOARD.getBoundingClientRect(), { count: 8, dust: 6, size: 5, power: 380, colors: ['#fff8e8', '#252525'] });
      }
      FX.shake(BOARD, rows.length + cols.length >= 2 ? 5 : 3);
      var nLines = rows.length + cols.length;
      /* 消行一记木条被削断的响，连消就往上抬 —— 双消、三消是"这一手值更多"，音高该说明它 */
      SFX.play(nLines >= 2 ? 'brick.combo' : 'brick.clear', { rate: 1 + Math.min(0.6, (nLines - 1) * 0.12) });
      /* 连击按"这一手几条线"涨：双消一次跳两级，三消跳三级。乘区就是这个数。 */
      comboBump(bCombo, nLines);
      bMaxCombo = Math.max(bMaxCombo, bCombo.n);
      var gain = 120 * nLines * comboMult(bCombo);
      bScore += gain;
      var bc = BOARD.getBoundingClientRect();
      FX.pop(bc.left + bc.width / 2, bc.top + bc.height * 0.44,
        '+' + gain + (nLines > 1 ? ' · ' + (nLines >= 3 ? '三消' : '双消') + ' ×' + comboMult(bCombo) : ''),
        nLines >= 2 ? 'is-gold' : '');
      if (nLines >= 2) FX.rise(bc.left + bc.width / 2, bc.top + bc.height * 0.4, 10 + nLines * 4, ['#ffd166', '#fff8e8']);
      bHudScore();
      later(function(){
        rows.forEach(function(r2){
          for (var c2 = 0; c2 < BN; c2++){
            var cell = bGrid[r2][c2];
            cell.filled = '';
            cell.el.classList.remove('is-on', 'is-clear', 'k0', 'k1', 'k2', 'k3');
          }
        });
        cols.forEach(function(c2){
          for (var r2 = 0; r2 < BN; r2++){
            var cell = bGrid[r2][c2];
            cell.filled = '';
            cell.el.classList.remove('is-on', 'is-clear', 'k0', 'k1', 'k2', 'k3');
          }
        });
        bLock = false;
        bRows += nLines;
        BEST.set('brick.rows', bRows);
        BRK_ROWS.textContent = String(bRows);

        /* 满盘：消完之后一格不剩 —— 这是这台机器唯一"整盘清空"的时刻，值得一次金环 */
        var leftCells = 0;
        for (var q = 0; q < BN; q++) for (var w2 = 0; w2 < BN; w2++) if (bGrid[q][w2].filled) leftCells++;
        if (!leftCells){
          bScore += 600;
          SFX.play('brick.full');
          var br2 = BOARD.getBoundingClientRect();
          FX.ring(br2.left + br2.width / 2, br2.top + br2.height / 2, 10, br2.width * 0.55, 4, '#ffd166');
          FX.rise(br2.left + br2.width / 2, br2.top + br2.height * 0.3, 20, ['#ffd166', '#fff8e8', '#a8c7a0']);
          FX.pop(br2.left + br2.width / 2, br2.top + br2.height * 0.42, '满盘 +600', 'is-gold');
          bHudScore();
        }

        /* 一手消掉两条以上就该有回声：不然"一手清了两行"和"清了一行"读起来一样 */
        if (bRows >= BGOAL){
          bDone = true;
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
        } else if (nLines >= 3){
          MHINT.textContent = '三消 · 一手三条线，已清 ' + bRows + ' 行';
        } else if (nLines === 2){
          MHINT.textContent = '双消 · 一手两条线，已清 ' + bRows + ' 行';
        } else {
          MHINT.textContent = '已清 ' + bRows + ' 行 · 还差 ' + (BGOAL - bRows) + ' 行';
        }
      }, 300);
    } else {
      /* 这一手没消任何线：连击断。它是"别乱塞"的唯一代价 —— 不扣分，只断势头。 */
      comboBreak(bCombo);
      bHudScore();
    }

    /* 三块都放完了才补新的 */
    if (bPieces.every(function(x){ return x.used; })) later(function(){ dealPieces(); }, 60);

    /* 一块都放不下 = 死局 */
    later(function(){
      if (bDone) return;
      var stuck = bPieces.filter(function(x){ return !x.used; });
      if (!stuck.length) return;
      var any = stuck.some(function(x){
        for (var r2 = 0; r2 < BN; r2++) for (var c2 = 0; c2 < BN; c2++){
          if (canPlace(x.shape, r2, c2)) return true;
        }
        return false;
      });
      if (!any){
        bDone = true;
        comboBreak(bCombo);
        bHudScore();
        BEST.set('brick.score', bScore);
        BRK_PANE.classList.add('is-over');
        showVerdict(BRK_V, BRK_VT, BRK_VS, 'v-bad', '放不下了 · ' + bRows + ' 行 / ' + bScore + ' 分收场', '散');
        MHINT.textContent = '散了 · 盘子塞满，再来一次';
      }
    }, 420);
  }

  /* ================= 06 破砖 · 七关打墙 ================= */
  /* 照"砖块破坏者 / 打砖块"做的：底下一块**可以拖动的板子**，板子在哪、球就从哪往上打；
     球撞砖**反弹**（砖上是剩余血量的数字），落回来要拿板子接住 —— 接球的位置决定下一段轨迹，
     所以"用板子边角把球送出去"是真本事。漏接这颗球就没了，掉落物（金 +1 球 / 蓝 ×3 球）也要拿板子接。
     每关只发固定数量的球：球用完墙上还有砖就是「散」，打光了进下一关，七关全清落「满」。 */
  var BK = document.getElementById('bkCanvas');
  var BK_STAGE = document.getElementById('bkStage');
  var BK_NAIL = document.getElementById('bkLeft');
  var BK_TOTAL = document.getElementById('bkTotal');
  var BK_LIFE = document.getElementById('bkLife');
  var BK_LV = document.getElementById('bkLv');
  var BK_LVN = document.getElementById('bkLvn');
  var BK_V = document.getElementById('bkVerdict');
  var BK_VT = document.getElementById('bkVText');
  var BK_VS = document.getElementById('bkVSeal');
  var BK_PANE = document.getElementById('pane-break');
  var BK_SCORE = document.getElementById('bkScore');
  var BK_COMBO = document.getElementById('bkCombo');

  /* 2026-11-22 第二次调：作者说"移动板和上方砖块的距离需要扩大"。
     行数与砖数不动（那是上一轮刚定的密度），改的是**板到墙之间的那片空地**：
     BH 360→430（画布比例 4:3 → 48:43），墙仍贴顶、板仍贴底，最下一行砖到板的距离
     从 ≈164 拉到 ≈234 逻辑像素（+43%）。球速没再动 —— 这次要给的是"看得见球路"的空间，
     不是"更慢"，所以是拉长跑道而不是踩刹车。 */
  var BW = 480, BH = 430;                    // 逻辑坐标，跟显示尺寸无关
  /* 2026-11-22：作者说"砖块有点大了，缩小 1/4 并提高紧密度"。于是砖宽 44.7→34.8（约 0.78）、
     砖高 21→16、缝 3→2、行距 24→18，列数 10→13 —— 墙仍然铺满左右，但每块小一圈、挤得更紧。
     行数同时收一行（砖多了 30% 会变成"一关打不完"），球速也一并降下来。 */
  var BK_COLS = 13;                          // 十三列：小砖密墙
  var BK_PAD_W = 76, BK_PAD_H = 12;          // 板子的标准宽度（接到「宽」道具会临时变宽）
  var BK_PAD_Y = BH - 24;                    // 板子中心线（底下留一条"掉出去"的缝）
  /* 板宽是变量了（接道具会变宽），所以左右边界改成函数，别再当成常量用 */
  var bkPadW = BK_PAD_W, bkWideT = 0;
  function padMin(){ return bkPadW / 2 - 4; }
  function padMax(){ return BW - bkPadW / 2 + 4; }
  var BK_BRICK_GAP = 2, BK_BRICK_TOP = 24, BK_BRICK_H = 16;
  var BK_BRICK_PITCH = BK_BRICK_H + BK_BRICK_GAP;   // 行距，画"行色"与排墙共用
  /* 球跟着砖一起收一圈：直径 13 的新球压在 16px 高的砖上像颗弹珠，5.5 才和墙同比例 */
  var BK_BALL_R = 5.5;
  var BK_MAXAIM = 0.55;                      // 甩出去最大倾角（约 31°）
  /* 七关：map 是墙面（一行十三个字符，1 有砖、0 是空的），hp 按行轮换、stone 是最下面几行石砖（sHp 血）、
     gold 金砖（碎了掉"加一球"）、split 蓝砖（碎了掉"×3"）、balls 这一关发几颗球。
     球一碰砖就弹回来，所以血量直接等于"这块砖要几趟"，前几关给 1，后面才上 2。
     2026-11-22：砖宽 44.7→34.8、高 21→16、缝 3→2、列 10→13。砖小了四分之一，墙还是铺满同一块面积，
     于是砖数从 60 涨到 100 出头 —— 重新算了一遍账：**一关的球数与"总血量"成比例地抬**（8→11、11→14），
     同时在飞的球上限 4→6，每颗球仍然打 7–9 趟，关卡时长与旧版持平（机器人实测 28–46 秒/关），只是墙更细更密。
     行数是"墙占到画面上沿 45% 左右"倒推的：7 行太少像一条窄带，10 行以上一关会拖到一分钟。 */
  var BKLEVELS = [
    { map: ['1111111111111','1111111111111','1111111111111','1111111111111','1111111111111','1111111111111','1111111111111','1111111111111'], hp: [1], stone: 0, sHp: 0, gold: 0, split: 0, balls: 11 },
    { map: ['1111111111111','1111111111111','1111110111111','1111111111111','1111101111111','1111111111111','1111111111111','1111111111111'], hp: [1], stone: 0, sHp: 0, gold: 1, split: 0, balls: 11 },
    { map: ['1111111111111','1111111111111','1111110001111','1111111111111','1111110111111','1111111111111','1111111111111','1111101111111'], hp: [1, 1, 2], stone: 1, sHp: 2, gold: 2, split: 1, balls: 12, wide: 0 },
    { map: ['1111111111111','1111111111111','1111110001111','1111111111111','1111110111111','1111111111111','1111111111111','1111100011111','1111110111111'], hp: [1, 1, 2], stone: 1, sHp: 2, gold: 2, split: 1, balls: 12, wide: 1 },
    { map: ['1111111111111','1111100011111','1111111111111','1110011111111','1111111111111','1111100011111','1111111111111','1111111111111','1111111111111'], hp: [1, 1, 2], stone: 1, sHp: 3, gold: 3, split: 2, balls: 14, wide: 1 },
    { map: ['1111111111111','1111111111111','1111100011111','1111111111111','1111110111111','1111111111111','1111111111111','1111100011111','1111110111111'], hp: [1, 1, 2], stone: 2, sHp: 3, gold: 3, split: 2, balls: 13, wide: 1 },
    { map: ['1111111111111','1111111111111','1110011111111','1111111111111','1111111111111','1111001111111','1111110111111','1111111111111','1111110111111'], hp: [1, 1, 2], stone: 2, sHp: 4, gold: 3, split: 2, balls: 14, wide: 1 }
  ];

  var bkCtx = null, bkWallCv = null, bkWallCtx = null, bkWallDirty = true;
  var bkRaf = 0, bkLast = 0, bkRunning = false, bkDone = false, bkWin = false;
  var bkKeys = { left: false, right: false };
  var bkPx = BW / 2, bkPxPrev = BW / 2, bkPadV = 0, bkAim = 0;
  var bkBalls = [], bkBricks = [], bkItems = [];
  var bkLeft = 0, bkTotal = 0, bkStock = 0, bkLv = 0, bkHitT = 0, bkNote = '', bkShots = 0;
  /* 这一轮加的三件：分数、连击、宽板道具。
     分数：碎一块 100（石砖 250）× 连击；连击靠"连续碰到砖"续，漏球就断。
     宽板：第三种掉落物（绿），接住之后板子加宽 28px、维持 9 秒 —— 是"这一关打得太窄"时的解法。 */
  var bkScore = 0, bkBest = 0, bkMaxCombo = 0;
  var bkCombo = comboState(4000, 10);
  function bkHudScore(){
    hudSet(BK_SCORE, bkScore);
    FX.combo(BK_COMBO, bkCombo.n);
  }

  function bkFit(){
    if (!BK) return;
    fitBreak();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = BK.clientWidth || BW;
    BK.width = Math.round(cw * dpr);
    BK.height = Math.round(cw * (BH / BW) * dpr);
    bkCtx = BK.getContext('2d');
    var s = BK.width / BW;
    bkCtx.setTransform(s, 0, 0, s, 0, 0);
    /* 墙层：和主画布同尺寸、同一套变换，砖只需要在"变"的时候重画一次 */
    bkWallCv = bkWallCv || document.createElement('canvas');
    bkWallCv.width = BK.width;
    bkWallCv.height = BK.height;
    bkWallCtx = bkWallCv.getContext('2d');
    bkWallCtx.setTransform(s, 0, 0, s, 0, 0);
    bkWallDirty = true;
  }

  function bkHud(){
    if (BK_NAIL) BK_NAIL.textContent = String(bkLeft);
    if (BK_TOTAL) BK_TOTAL.textContent = String(bkTotal);
    if (BK_LIFE) BK_LIFE.textContent = String(bkStock);
    if (BK_LV) BK_LV.textContent = String(bkLv + 1);
    if (BK_LVN) BK_LVN.textContent = String(BKLEVELS.length);
    bkHudScore();
  }

  /* 排墙：按 map 铺，血量按行轮换，最下面几行是石砖（更厚）；金砖/蓝砖/宽板砖等距定点撒（不随机，难度才可比） */
  function bkDeck(){
    var spec = BKLEVELS[bkLv];
    bkBricks = [];
    bkItems = [];
    bkBalls = [];
    bkAim = 0;
    bkPx = BW / 2;
    bkPxPrev = BW / 2;
    bkPadV = 0;
    bkPadW = BK_PAD_W;
    bkWideT = 0;
    var map = spec.map;
    var rows = map.length;
    var gp = BK_BRICK_GAP, top = BK_BRICK_TOP, h = BK_BRICK_H;
    var cw = (BW - gp * (BK_COLS + 1)) / BK_COLS;
    var r, c;
    for (r = 0; r < rows; r++){
      var stone = r >= rows - spec.stone;
      for (c = 0; c < BK_COLS; c++){
        if (map[r].charAt(c) !== '1') continue;
        bkBricks.push({
          x: gp + c * (cw + gp),
          y: top + r * (h + gp),
          w: cw, h: h,
          hp: stone ? spec.sHp : spec.hp[r % spec.hp.length],
          stone: stone,
          on: true,
          kind: 0
        });
      }
    }
    var plain = [], i;
    for (i = 0; i < bkBricks.length; i++) if (!bkBricks[i].stone) plain.push(i);
    var total = Math.min(spec.gold + spec.split, plain.length);
    for (i = 0; i < total; i++){
      bkBricks[plain[Math.floor((i + 1) * plain.length / (total + 1))]].kind = i < spec.gold ? 1 : 2;
    }
    /* 宽板砖：从第 3 关起每关一块，放在墙的中段（太靠上接不到、太靠下会被石砖挡住） */
    if (spec.wide && plain.length){
      bkBricks[plain[Math.floor(plain.length * 0.45)]].kind = 3;
    }

    bkTotal = bkBricks.length;
    bkLeft = bkTotal;
    bkStock = spec.balls;
    bkHitT = 0;
    bkWallDirty = true;
    bkHud();
  }

  function bkSpeed(){
    /* 作者反馈"圆球反弹速度有点快"。旧版 540 + 14/关、封顶 640，一趟上来太快、
       板子跟不上；降到 450 + 11/关、封顶 540（约 -17%），砖与砖之间还看得清。 */
    return Math.min(450 + bkLv * 11, 540);
  }

  /* 同时在飞的球数上限：砖墙比旧版密了一倍（104 块 vs 60 块），
     "一次只飞四颗"会让密墙变成磨时间；抬到 6 颗，手上多发几颗就能把墙打出节奏。 */
  var BK_MAX_BALLS = 6;

  /* 发一颗球：从板子中间往上打。板子正在甩动时给一点倾角（±0.55 rad），
     所以"先把板子拉到位、再点一下"就是瞄准。
     可以连点发球（球会同时在场上飞）—— 代价是**一块板子接不住几颗**，漏一颗就少一颗。 */
  function bkFire(){
    if (bkDone || bkStock <= 0 || bkBalls.length >= BK_MAX_BALLS) return;
    bkStock--;
    bkHud();
    var sp = bkSpeed();
    var tilt = bkAim;
    /* 站着不动发球时给一点点交替偏角：正垂直的球只会把同一列来回撞，读起来像"卡住了" */
    if (Math.abs(tilt) < 0.05) tilt = (bkShots++ % 2 ? 0.14 : -0.14);
    bkBalls.push({
      x: bkPx, y: BK_PAD_Y - BK_PAD_H / 2 - 7,
      vx: Math.sin(tilt) * sp, vy: -Math.cos(tilt) * sp,
      sp: sp, r: BK_BALL_R, idle: 0
    });
    MHINT.textContent = bkNote = '球出去了 · 还剩 ' + bkStock + ' 颗';
    /* 电子乒乓那一声"嗒"：短、干、没有尾音 —— 它是这一台唯一的起手动作，得听得出来 */
    SFX.play('break.fire');
  }

  function bkDropItem(br){
    if (br.kind === 1 || br.kind === 2) bkItems.push({ x: br.x + br.w / 2, y: br.y + br.h / 2, kind: br.kind });
  }

  /* 打一下砖，返回"这块砖是不是被打碎了" —— 碎了球就顺着这个洞继续飞，不会再被它弹回来 */
  /* 砖的底色只在这里定义一次：画砖与"碎出来的渣"必须同色，否则碎片像从别的游戏飞来的 */
  function bkFill(br){
    if (br.stone) return '#cdc6b8';
    if (br.kind === 1) return '#ffd166';
    if (br.kind === 2) return '#f28b82';
    if (br.kind === 3) return '#a8c7a0';
    if (br.hp >= 3) return (Math.round((br.y - BK_BRICK_TOP) / BK_BRICK_PITCH) % 2 ? '#f7c08a' : '#f4b9b3');
    if (br.hp === 2) return '#9cc7f5';
    return '#a8c7a0';
  }

  /* 逻辑坐标 → 视口坐标：粒子画在全屏画布上，这里只做一次换算 */
  function bkRect(br){
    if (!BK) return null;
    var r = BK.getBoundingClientRect();
    var sx = r.width / BW, sy = r.height / BH;
    return { left: r.left + br.x * sx, top: r.top + br.y * sy, width: br.w * sx, height: br.h * sy };
  }

  function bkSmash(br){
    var col = bkFill(br);
    var rect = bkRect(br);
    br.hp--;
    bkHitT = 1;
    bkWallDirty = true;   /* 砖的血量与存亡变了，墙层这一帧必须重画 */
    /* 连击：每碰到一次砖都续上（不用等它碎）。一次来回能连撞好几块，乘区就上去了 */
    comboAdd(bkCombo);
    bkMaxCombo = Math.max(bkMaxCombo, bkCombo.n);
    if (br.hp > 0){
      /* 没打穿：只擦出火星，不能给"碎了"的碎片，否则玩家分不清这块还剩几趟 */
      SFX.play('break.hit', { rate: 1.06 });
      FX.sparks(rect, 4, '#fff8e8');
      bkHudScore();
      return false;
    }
    /* 打穿：同色硬片 + 砖上的数字也随尘飞出去 */
    SFX.play(br.stone ? 'break.stone' : 'break.smash', { rate: 1 + Math.min(0.5, bkCombo.n * 0.05) });
    FX.burst(rect, {
      count: br.stone ? 20 : 15, dust: 10, power: 470, gravity: 780,
      colors: [col, col, col, '#252525', '#fff8e8'], ring: br.stone ? true : false
    });
    var base = br.stone ? 250 : 100;
    var mult = comboMult(bkCombo);
    var gain = base * mult;
    bkScore += gain;
    /* 石砖打穿是这一台最"实"的一击：碎片、白环、震屏之外再按 60ms 的命中停顿 */
    if (br.stone){
      FX.shake(BK, 4);
      FX.freeze(60);
    }
    if (rect) FX.pop(rect.left + rect.width / 2, rect.top - 2, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 4 ? 'is-gold' : '');
    br.on = false;
    bkLeft--;
    bkHud();
    bkDropItem(br);
    return true;
  }

  function bkCatch(kind){
    /* 接住一块"木片/皮球"的手感：三档各给一个不同高度的短音，靠音高就能分出手里多了什么 */
    SFX.play('break.item', { rate: kind === 1 ? 1.18 : (kind === 3 ? 0.92 : 1.06) });
    if (kind === 1){
      bkStock++;
      bkNote = '接住一颗球 · 现在 ' + bkStock + ' 颗';
    } else if (kind === 3){
      bkPadW = Math.min(126, bkPadW + 28);
      bkWideT = 9;
      bkNote = '接住宽板 · 板子加宽 9 秒';
      FX.rise(BK.getBoundingClientRect().left + BK.getBoundingClientRect().width / 2, BK.getBoundingClientRect().bottom - 26, 10, ['#a8c7a0', '#fff8e8']);
    } else {
      bkNote = '接住 ×3 · 裂出两颗';
      var sp = bkSpeed();
      bkBalls.push({ x: bkPx, y: BK_PAD_Y - BK_PAD_H / 2 - 7, vx: Math.sin(-0.42) * sp, vy: -Math.cos(-0.42) * sp, sp: sp, r: BK_BALL_R, idle: 0 });
      bkBalls.push({ x: bkPx, y: BK_PAD_Y - BK_PAD_H / 2 - 7, vx: Math.sin(0.42) * sp, vy: -Math.cos(0.42) * sp, sp: sp, r: BK_BALL_R, idle: 0 });
    }
    bkHud();
    MHINT.textContent = bkNote;
  }

  function bkStep(dt){
    var i, b;
    var ms = dt / 1000;
    /* 宽板到期：慢慢收回标准宽度（突然缩回去会把正在接的球让掉） */
    if (bkWideT > 0){
      bkWideT -= ms;
      if (bkWideT <= 0 && bkPadW > BK_PAD_W) bkPadW = Math.max(BK_PAD_W, bkPadW - 60 * ms);
      if (bkWideT < 0) { bkWideT = 0; bkPadW = BK_PAD_W; }
    }
    /* 板子：指针是主路，A/D 也能推（键盘党不用拖） */
    if (bkKeys.left) bkPx -= 300 * ms;
    if (bkKeys.right) bkPx += 300 * ms;
    bkPx = Math.max(padMin(), Math.min(padMax(), bkPx));
    bkPadV = (bkPx - bkPxPrev) / (ms || 0.016);
    bkPxPrev = bkPx;
    /* 甩动速度决定发球倾角：拖得快就是斜的，站着不动就是直上 */
    var tilt = Math.max(-BK_MAXAIM, Math.min(BK_MAXAIM, bkPadV * 0.0026));
    bkAim = bkAim * 0.82 + tilt * 0.18;

    /* 掉落物：往下飘，落到底部要拿板子接；没接住就沉了 */
    for (i = bkItems.length - 1; i >= 0; i--){
      var it = bkItems[i];
      it.y += 5.6 * (dt / 16.7);
      if (it.y >= BK_PAD_Y - BK_PAD_H / 2 - 9 && it.y <= BK_PAD_Y + BK_PAD_H && Math.abs(it.x - bkPx) <= bkPadW / 2 + 8){
        bkCatch(it.kind);
        bkItems.splice(i, 1);
        continue;
      }
      if (it.y > BH){ bkItems.splice(i, 1); }
    }

    for (var bi = bkBalls.length - 1; bi >= 0; bi--){
      b = bkBalls[bi];
      var stepx = b.vx * ms;
      var stepy = b.vy * ms;
      var sub = Math.max(1, Math.ceil(Math.max(Math.abs(stepx), Math.abs(stepy)) / 5));
      b.idle += ms;
      var dead = false;
      for (var k = 0; k < sub; k++){
        b.x += stepx / sub;
        b.y += stepy / sub;

        if (b.x - b.r < 0){ b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x + b.r > BW){ b.x = BW - b.r; b.vx = -Math.abs(b.vx); }
        if (b.y - b.r < 0){ b.y = b.r; b.vy = Math.abs(b.vy); }

        /* 砖：**一碰就弹**。按"扎得最浅的那一面"弹出去（顶面弹回、侧面弹开），
           打碎了也只是"这一块没了"，球当场就被弹回来 —— 砖是硬的，不是纸糊的。 */
        for (i = 0; i < bkBricks.length; i++){
          var br = bkBricks[i];
          if (!br.on) continue;
          if (b.x + b.r <= br.x || b.x - b.r >= br.x + br.w) continue;
          if (b.y + b.r <= br.y || b.y - b.r >= br.y + br.h) continue;
          var ox = Math.min(b.x + b.r - br.x, br.x + br.w - (b.x - b.r));
          var oy = Math.min(b.y + b.r - br.y, br.y + br.h - (b.y - b.r));
          if (ox < oy){
            if (b.x < br.x + br.w / 2){ b.x = br.x - b.r - 0.6; b.vx = -Math.abs(b.vx); }
            else { b.x = br.x + br.w + b.r + 0.6; b.vx = Math.abs(b.vx); }
          } else {
            if (b.y < br.y + br.h / 2){ b.y = br.y - b.r - 0.6; b.vy = -Math.abs(b.vy); }
            else { b.y = br.y + br.h + b.r + 0.6; b.vy = Math.abs(b.vy); }
          }
          bkSmash(br);
          b.idle = 0;
          break;   /* 一帧只认一块砖，否则两块砖同时改角度会把球卡在缝里 */
        }

        /* 板子接球：接球点离板心越远，弹出去越斜 —— 这就是"用边角把球送出去" */
        if (b.vy > 0 && b.y + b.r >= BK_PAD_Y - BK_PAD_H / 2 && b.y - b.r <= BK_PAD_Y + BK_PAD_H / 2 &&
            Math.abs(b.x - bkPx) <= bkPadW / 2 + b.r){
          var off = (b.x - bkPx) / (bkPadW / 2);
          off = Math.max(-1, Math.min(1, off));
          /* 最小倾角：板心正对着接也不会变成"垂直无限弹"，球每回一次都要往边上挪一点 */
          if (Math.abs(off) < 0.26) off = (off < 0 ? -0.26 : 0.26);
          var ang = off * 0.95;
          b.vx = Math.sin(ang) * b.sp;
          b.vy = -Math.cos(ang) * b.sp;
          b.y = BK_PAD_Y - BK_PAD_H / 2 - b.r - 0.6;
          b.idle = 0;
          /* 板子那一声"啪"：离板心越远越轻（边角送球本来就该是擦着走） */
          SFX.play('break.pad', { rate: 1 + Math.abs(off) * 0.1, gain: 0.9 - Math.abs(off) * 0.25 });
        }

        if (b.y - b.r > BH){ dead = true; break; }
      }

      /* 兜底：一颗球 24 秒没碰到砖，就当它掉下去了（不让一局无限挂着） */
      if (b.idle > 12) dead = true;
      if (dead){
        bkBalls.splice(bi, 1);
        bkHitT = 1;
        /* 漏球 = 断连击。不扣分，但乘区归零 —— 这是这台机器里"接球"的实际价值 */
        comboBreak(bkCombo);
        bkHudScore();
        if (!bkDone) MHINT.textContent = '漏了一颗 · 还剩 ' + bkStock + ' 颗';
      }
    }

    if (!bkLeft){ bkEnd(true); return; }
    if (!bkBalls.length && !bkStock) bkEnd(false);
  }

  function bkPaintBrick(c, br){
    var fill = bkFill(br);
    c.fillStyle = fill;
    c.fillRect(br.x, br.y, br.w, br.h);
    c.strokeStyle = '#252525';
    /* 砖小了，2px 边会把 16px 高的砖吃掉一圈，收到 1.5px；数字 11→10px 才塞得下 */
    c.lineWidth = 1.5;
    c.strokeRect(br.x + 0.75, br.y + 0.75, br.w - 1.5, br.h - 1.5);
    c.fillStyle = '#252525';
    c.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(br.hp), br.x + br.w / 2, br.y + br.h / 2 + 1);
  }

  /* 墙是一层"只在砖被打穿/换关时变"的静态画面。
     一帧重画 60–85 块砖 = 每块一次填充 + 一次描边 + 一次写数字，60fps 下每秒上万次画布调用；
     改成先画进一张同尺寸的离屏画布，主循环每帧只 drawImage 一次，砖的数字也不会每帧重新排版。 */
  function bkPaintWall(){
    if (!bkWallCtx) return;
    bkWallCtx.clearRect(0, 0, BW, BH);   /* 墙层与主画布同一套变换，所以这里用逻辑坐标 */
    for (var i = 0; i < bkBricks.length; i++) if (bkBricks[i].on) bkPaintBrick(bkWallCtx, bkBricks[i]);
    bkWallDirty = false;
  }

  function bkDrawPaddle(){
    var x = bkPx - bkPadW / 2, y = BK_PAD_Y - BK_PAD_H / 2;
    bkCtx.fillStyle = bkWideT > 0 ? '#3f6b3a' : '#252525';
    bkCtx.fillRect(x, y, bkPadW, BK_PAD_H);
    bkCtx.fillStyle = '#fff8e8';
    bkCtx.fillRect(x + 4, y + 4, bkPadW - 8, BK_PAD_H - 8);
    /* 中间一道短印，看得出"板心在哪"。原来画满整条高，屏幕上读成"板子被切成两截"，
       所以只留上下各 5px 的空，长度 2px。 */
    bkCtx.fillStyle = '#252525';
    bkCtx.fillRect(bkPx - 1, y + 5, 2, BK_PAD_H - 10);
    /* 宽板还剩几秒：在板子上打一条剩余宽度的暗条，不用另开 HUD */
    if (bkWideT > 0){
      bkCtx.fillStyle = '#a8c7a0';
      bkCtx.fillRect(x + 4, y + BK_PAD_H - 4, (bkPadW - 8) * Math.min(1, bkWideT / 9), 2);
    }
  }

  function bkDraw(){
    if (!bkCtx) return;
    bkCtx.clearRect(0, 0, BW, BH);
    if (bkWallCv){
      if (bkWallDirty) bkPaintWall();
      bkCtx.drawImage(bkWallCv, 0, 0, BW, BH);
    } else {
      for (var w0 = 0; w0 < bkBricks.length; w0++) if (bkBricks[w0].on) bkPaintBrick(bkCtx, bkBricks[w0]);
    }
    for (var i = 0; i < bkItems.length; i++){
      var it = bkItems[i];
      bkCtx.beginPath();
      bkCtx.arc(it.x, it.y, 9, 0, Math.PI * 2);
      bkCtx.fillStyle = it.kind === 1 ? '#ffd166' : (it.kind === 3 ? '#a8c7a0' : '#9cc7f5');
      bkCtx.fill();
      bkCtx.strokeStyle = '#252525';
      bkCtx.lineWidth = 2;
      bkCtx.stroke();
      bkCtx.fillStyle = '#252525';
      bkCtx.font = 'bold 10px ui-monospace, monospace';
      bkCtx.textAlign = 'center';
      bkCtx.textBaseline = 'middle';
      bkCtx.fillText(it.kind === 1 ? '+1' : (it.kind === 3 ? '宽' : '×3'), it.x, it.y + 1);
    }

    /* 发球方向：场上一颗球都没有时才画，免得跟飞行中的球抢眼 */
    if (!bkDone && bkStock > 0 && !bkBalls.length){
      bkCtx.strokeStyle = 'rgba(37,37,37,.45)';
      bkCtx.lineWidth = 2;
      bkCtx.setLineDash([5, 7]);
      bkCtx.beginPath();
      bkCtx.moveTo(bkPx, BK_PAD_Y - BK_PAD_H / 2 - 8);
      bkCtx.lineTo(bkPx + Math.sin(bkAim) * 90, BK_PAD_Y - BK_PAD_H / 2 - 8 - Math.cos(bkAim) * 90);
      bkCtx.stroke();
      bkCtx.setLineDash([]);
    }

    bkDrawPaddle();

    for (i = 0; i < bkBalls.length; i++){
      var b = bkBalls[i];
      bkCtx.beginPath();
      bkCtx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      bkCtx.fillStyle = bkHitT > 0.7 ? '#ffffff' : '#252525';
      bkCtx.fill();
      bkCtx.strokeStyle = '#252525';
      bkCtx.lineWidth = 2;
      bkCtx.stroke();
    }

    /* 底线：板子下面那一条缝，提醒"从这里掉出去就没了" */
    bkCtx.strokeStyle = 'rgba(37,37,37,.22)';
    bkCtx.lineWidth = 1;
    bkCtx.setLineDash([6, 6]);
    bkCtx.beginPath();
    bkCtx.moveTo(0, BH - 2);
    bkCtx.lineTo(BW, BH - 2);
    bkCtx.stroke();
    bkCtx.setLineDash([]);
  }

  function bkFrame(ts){
    if (!bkRunning) return;
    if (!bkLast) bkLast = ts;
    var dt = Math.min(ts - bkLast, 40);
    bkLast = ts;
    if (bkHitT > 0) bkHitT = Math.max(0, bkHitT - dt / 90);
    if (!bkDone) bkStep(dt);
    bkDraw();
    bkRaf = requestAnimationFrame(bkFrame);
  }

  /* 起一关：墙、球数、板子全部重置。分数与连击跨关保留（总分是一整轮七关的账） */
  function bkStage(){
    if (!BK) return;
    bkDone = false;
    bkWin = false;
    bkRunning = true;
    bkNote = '';
    bkHitT = 0;
    BK_PANE.classList.remove('is-over');
    BK_V.classList.remove('is-on');
    BK_VS.className = 'verdict-seal';
    BK_VS.textContent = '';
    MHINT.textContent = '拖动板子接球 · 点一下发球（接球的位置决定角度）';
    bkFit();
    bkDeck();
    bkDraw();
    bkLast = 0;
    if (bkRaf) cancelAnimationFrame(bkRaf);
    bkRaf = requestAnimationFrame(bkFrame);
    later(function(){ if (bkRunning && BK && BK.clientWidth) bkFit(); }, 140);
  }

  function bkStart(){
    bkLv = 0;
    bkScore = 0;
    bkMaxCombo = 0;
    bkBest = BEST.get('break.score');
    bkCombo = comboState(4000, 10);
    bkHudScore();
    bkStage();
  }
  function bkNext(){ bkLv = (bkLv >= BKLEVELS.length - 1) ? 0 : bkLv + 1; bkStage(); }

  function bkStop(){
    bkRunning = false;
    if (bkRaf){ cancelAnimationFrame(bkRaf); bkRaf = 0; }
  }

  function bkEnd(win){
    bkDone = true;
    bkWin = win;
    bkRunning = false;
    /* 收场时把还在飞的球清掉：落在半空的球会让人以为这局还没完 */
    bkBalls = [];
    bkItems = [];
    if (bkRaf){ cancelAnimationFrame(bkRaf); bkRaf = 0; }
    BK_PANE.classList.add('is-over');
    var last = bkLv >= BKLEVELS.length - 1;
    /* 收场才结算最高分：中途关掉弹层不算成绩 */
    var prevBest = Math.max(bkBest, BEST.get('break.score'));
    if (bkScore > prevBest) BEST.set('break.score', bkScore);
    var scoreLine = ' · ' + bkScore + ' 分' + (bkScore > prevBest && bkScore > 0 ? '（新纪录）' : '');
    if (win){
      if (last){
        showVerdict(BK_V, BK_VT, BK_VS, 'v-ok', '七关全清 · 还剩 ' + bkStock + ' 颗球' + scoreLine, '满');
        MHINT.textContent = '七关全清 · ' + bkMaxCombo + ' 最高连击';
        mReplayLabel('从头再来');
      } else {
        showVerdict(BK_V, BK_VT, BK_VS, 'v-ok', '第 ' + (bkLv + 1) + ' 关打光 · 剩 ' + bkStock + ' 颗球' + scoreLine, '成');
        MHINT.textContent = '打光了 · 点「下一关」';
        mReplayLabel('下一关');
      }
    } else {
      showVerdict(BK_V, BK_VT, BK_VS, 'v-bad', '第 ' + (bkLv + 1) + ' 关散了 · 还剩 ' + bkLeft + ' 块' + scoreLine, '散');
      MHINT.textContent = '散了 · 球用完了，本关重来';
      mReplayLabel('重开本关');
    }
    bkDraw();
  }

  /* 指针横向位置 = 板子位置（拖动板子就是瞄哪儿打哪儿）；点一下（不是拖）= 发球。
     手机端旧版是"一碰就发球"，想挪板子必然先打出一颗球；现在按位移区分：拖 = 只挪、点 = 发球。 */
  function bkPointer(clientX){
    if (!BK) return;
    var rect = BK.getBoundingClientRect();
    var x = (clientX - rect.left) / rect.width * BW;
    bkPx = Math.max(padMin(), Math.min(padMax(), x));
  }
  var bkTouch = null;
  on(BK, 'pointerdown', function(e){
    bkPointer(e.clientX);
    bkTouch = { x: e.clientX, y: e.clientY, drag: false };
  });
  on(BK, 'pointermove', function(e){
    bkPointer(e.clientX);
    if (bkTouch && (Math.abs(e.clientX - bkTouch.x) > 8 || Math.abs(e.clientY - bkTouch.y) > 8)) bkTouch.drag = true;
  });
  on(BK, 'pointerup', function(){
    if (bkTouch && !bkTouch.drag) bkFire();
    bkTouch = null;
  });
  on(BK, 'pointercancel', function(){ bkTouch = null; });
  /* 触屏：板子用 ◀ ▶（按住连挪）+「发球」，不必拿手指去遮台面 */
  bindPad('breakPad', function(key){
    if (key === 'fire'){ bkFire(); return; }
    bkPx = Math.max(padMin(), Math.min(padMax(), bkPx + (key === 'l' ? -34 : 34)));
  }, 60);
  on(window, 'resize', function(){ if (BK && BK.clientWidth) bkFit(); });
  on(window, 'keydown', function(e){
    if (current !== 'break') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') bkKeys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') bkKeys.right = true;
    if (e.key === ' '){ e.preventDefault(); bkFire(); }
  });
  on(window, 'keyup', function(e){
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') bkKeys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') bkKeys.right = false;
  });
  /* 给自动化验收读状态用的钩子：不参与玩法，只回报状态 */
  if (BK) BK.__probe = function(){
    var lo = null, i;
    for (i = 0; i < bkBalls.length; i++) if (!lo || bkBalls[i].y > lo.y) lo = bkBalls[i];
    return {
      bx: lo ? lo.x : bkPx,
      by: lo ? lo.y : BK_PAD_Y,
      vx: lo ? lo.vx : 0,
      vy: lo ? lo.vy : 0,
      px: bkPx, padW: bkPadW, padY: BK_PAD_Y,
      aim: bkAim,
      left: bkLeft, total: bkTotal, lives: bkStock, level: bkLv + 1, levels: BKLEVELS.length,
      balls: bkBalls.length, items: bkItems.length,
      score: bkScore, combo: bkCombo.n, wide: Math.round(bkWideT * 10) / 10,
      /* 掉落物的位置也给验收看（它要决定先接球还是先接道具） */
      drops: bkItems.map(function(it){ return { x: it.x, y: it.y, kind: it.kind }; }),
      /* 剩下的砖给验收脚本看（它靠这个决定打哪块），不参与玩法 */
      stay: bkBricks.filter(function(br){ return br.on; }).map(function(br){
        return { x: br.x, y: br.y, w: br.w, h: br.h, hp: br.hp, stone: br.stone ? 1 : 0 };
      }),
      stuck: bkBalls.length === 0, run: bkRunning, done: bkDone, win: bkWin
    };
  };
  /* 验收/截图要直接看某一关的墙面密度，不必先打完前六关 */
  if (BK) BK.__jump = function(n){ bkLv = Math.max(0, Math.min(BKLEVELS.length - 1, n)); bkStage(); };
  /* 资源口径的实测口径（只在验收脚本里调，不参与玩法）：
     `fromScratch` = 每帧重新画整面墙（旧写法），`blit` = 每帧贴一次墙层（现在的写法）。 */
  if (BK) BK.__bench = function(n){
    n = n || 60;
    if (!bkCtx || !bkWallCtx) return null;
    var t0, i;
    t0 = performance.now();
    for (i = 0; i < n; i++){ bkWallDirty = true; bkPaintWall(); }
    var fromScratch = (performance.now() - t0) / n;
    t0 = performance.now();
    for (i = 0; i < n; i++) bkCtx.drawImage(bkWallCv, 0, 0, BW, BH);
    var blit = (performance.now() - t0) / n;
    return { bricks: bkBricks.length, on: bkBricks.filter(function(b){ return b.on; }).length,
      fromScratch: Math.round(fromScratch * 1000) / 1000, blit: Math.round(blit * 1000) / 1000 };
  };

  /* ================= 04 抽词 · 翻卡成双 ================= */
  /* 翻开一样的两个就成双收走，步数用完还没清完就是散了。
     开局面板选难度 → 三秒倒数 → （易/中档先亮一眼位置）→ 才准翻。
     十个意象的纸色几乎同色，靠记形状，不靠认颜色。 */
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

  /* 卡面不再是一堆散字：每张牌取一个词里的一个字，卡名就是那个词 ——
     翻开「赵 / 云」两张，卡名都写「赵云」，配上了就知道自己在拼人名。 */
  var PAIR_THEMES = ['sanguo', 'qiwu', 'shanshui', 'qiwu'];
  var pairRound = 0;
  var PAIR_THEME_KEY = 'sanguo';
  var PAPER_TONES = ['#f4e8cf', '#f6ecd2', '#eee3c9'];
  function pairDeck(n){
    var key = PAIR_THEMES[pairRound++ % PAIR_THEMES.length];
    var t = themeOf(key), out = [], seen = {};
    for (var i = 0; i < t.words.length && out.length < n; i++){
      var w = t.words[i];
      for (var k = 0; k < w.length && out.length < n; k++){
        var c = w.charAt(k);
        if (seen[c]) continue;
        seen[c] = 1;
        out.push({ g: c, n: w, c: PAPER_TONES[out.length % PAPER_TONES.length] });
      }
    }
    var extra = themeChars(key);
    for (var j = 0; out.length < n && j < extra.length * 4; j++){
      var c2 = extra[j % extra.length];
      if (seen[c2] && j < extra.length) continue;
      out.push({ g: c2, n: t.name, c: PAPER_TONES[out.length % PAPER_TONES.length] });
    }
    PAIR_THEME_KEY = key;
    return out;
  }
  /* 三档：张数越多、步数越紧、预展越短。难档十对无预展。 */
  var PAIR_TIERS = {
    easy: { pairs:6,  steps:18, preview:1800, cols:4 },
    mid:  { pairs:8,  steps:20, preview:1000, cols:4 },
    hard: { pairs:10, steps:22, preview:0,    cols:5 }
  };
  var pairTier = 'mid';
  try {
    var savedTier = localStorage.getItem('txxt-pair-tier');
    if (savedTier && PAIR_TIERS[savedTier]) pairTier = savedTier;
  } catch(e){}
  var pOpen = [], pMatched = 0, pSteps = 0, pLock = false, pPhase = 'idle';
  /* 这一轮加的三件：分数、连击、以及"看一眼"（耗 2 步，每局 2 次）。
     连击窗口 3.8 秒：翻得快才续得上，慢悠悠地翻会自然断 —— 这是记忆游戏里唯一的时间压力。
     "看一眼"是**策略**而不是外挂：步数是硬资源，花 2 步换一次全亮，值不值得由人自己判。 */
  var pScore = 0, pBestScore = 0, pPeek = 2, pMaxCombo = 0;
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
    pPeek = 2;
    pMaxCombo = 0;
    pCombo = comboState(3800, 6);
    pBestScore = BEST.get('pair.score');
    pLock = true;
    PAIR_GRID.innerHTML = '';
    PAIR_GRID.classList.remove('is-live');
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
    var deck = [];
    var glyphs = pairDeck(t.pairs);
    for (var i = 0; i < t.pairs; i++) deck.push(glyphs[i], glyphs[i]);
    shuffle(deck);
    /* 主题写进页面：卡名就是词（赵云、孤灯……），一角一枚小印 */
    markTheme(PAIR_PANE, PAIR_THEME_KEY);
    if (PAIR_THEME) PAIR_THEME.textContent = themeOf(PAIR_THEME_KEY).name;
    PAIR_GRID.style.setProperty('--cols', String(t.cols));
    PAIR_GRID.innerHTML = '';
    deck.forEach(function(g, idx){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pcard';
      b.style.animationDelay = (idx * 26) + 'ms';
      b.setAttribute('aria-label', '翻开一张卡');
      b.innerHTML =
        '<span class="pcard-inner">' +
          '<span class="pback"><i>?</i></span>' +
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

  function onPair(el, g){
    if (pPhase !== 'play' || pLock) return;
    if (el.classList.contains('is-up') || el.classList.contains('is-out')) return;
    el.classList.add('is-up');
    /* 翻牌一记纸牌"嗒"；两张不一样时低半度的一记"翻回去"，成双则由匹配音接住 */
    SFX.play('pair.flip', { rate: pOpen.length ? 0.92 : 1 });
    pOpen.push({ el: el, g: g });
    if (pOpen.length < 2) return;

    var a = pOpen[0].el, b = pOpen[1].el;
    var same = pOpen[0].g.g === pOpen[1].g.g;
    pSteps++;
    pLock = true;
    updatePairHud();
    tickHud();

    if (same){
      /* 成双：先描金、露一个勾，再让两张各自歪着飘走，留一块虚线空位 */
      SFX.play('pair.match', { rate: 1 + Math.min(0.45, pCombo.n * 0.05) });
      later(function(){
        a.classList.add('is-match');
        b.classList.add('is-match');
      }, 90);
      later(function(){
        a.style.setProperty('--tilt', '-11deg');
        b.style.setProperty('--tilt', '11deg');
        a.classList.remove('is-match');
        b.classList.remove('is-match');
        /* 成双：两面一起炸，金粉是"奖励"色，纸屑是"卡纸"色 —— 只给金粉会像撒彩纸 */
        FX.burst(a.getBoundingClientRect(), { count: 11, power: 440, colors: ['#ffd166', '#fff8e8', '#252525'] });
        FX.burst(b.getBoundingClientRect(), { count: 11, power: 440, colors: ['#ffd166', '#fff8e8', '#252525'] });
        a.classList.add('is-out');
        b.classList.add('is-out');
        pMatched++;
        pOpen = [];
        pLock = false;

        /* 成双得分：100 × 连击。翻得越快连击越高，但连击不额外给步数 ——
           它只兑现成"分数与星级"，所以不会把一局记忆游戏变成抢手速。 */
        comboAdd(pCombo);
        pMaxCombo = Math.max(pMaxCombo, pCombo.n);
        var mult = comboMult(pCombo);
        var gain = 100 * mult;
        pScore += gain;
        popAt(a, '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 3 ? 'is-gold' : '');
        if (mult >= 3) FX.rise(b.getBoundingClientRect().left + 12, b.getBoundingClientRect().top + 6, 10, ['#ffd166', '#fff8e8']);
        updatePairHud();

        if (pMatched === tier().pairs){
          pPhase = 'done';
          PAIR_GRID.classList.remove('is-live');
          var bs = BEST.get('pair.steps');
          BEST.setMin('pair.steps', pSteps);
          /* 星级：步数越省星越多。三颗星是"几乎没走空步"，一颗星是"刚好翻完" */
          var stars = pSteps <= tier().pairs + 2 ? 3 : (pSteps <= tier().pairs + Math.ceil((tier().steps - tier().pairs) / 2) ? 2 : 1);
          var prevBest = Math.max(pBestScore, BEST.get('pair.score'));
          pScore += stars * 150;   /* 星级本身就是结算奖励 */
          BEST.set('pair.score', pScore);
          showVerdict(PAIR_V, PAIR_VT, PAIR_VS, 'v-ok',
            fmtStars(stars) + ' ' + tier().pairs + ' 对全成 · ' + pSteps + ' 步 · ' + pScore + ' 分'
            + (bs && bs < pSteps ? '（最好 ' + bs + ' 步）' : (pScore > prevBest ? ' · 新纪录' : '')), '成');
          MHINT.textContent = '全成 · 最多 ' + pMaxCombo + ' 连击';
        } else {
          MHINT.textContent = '还剩 ' + (tier().pairs - pMatched) + ' 对' + (pCombo.n >= 2 ? ' · ' + pCombo.n + ' 连击' : '');
        }
      }, 430);
      return;
    }

    /* 不一样：先抖一下再翻回去，翻回去落定之后才判散 */
    if (pCombo.n >= 2) popAt(b, '断', 'is-bad');
    SFX.play('pair.miss');
    comboBreak(pCombo);
    updatePairHud();
    later(function(){
      a.classList.add('is-shake');
      b.classList.add('is-shake');
    }, 40);
    later(function(){
      a.classList.remove('is-up', 'is-shake');
      b.classList.remove('is-up', 'is-shake');
      pOpen = [];
      pLock = false;
      later(function(){
        if (pPhase === 'play' && pSteps >= tier().steps && pMatched < tier().pairs){
          pPhase = 'done';
          PAIR_GRID.classList.remove('is-live');
          showVerdict(PAIR_V, PAIR_VT, PAIR_VS, 'v-bad', '散了 · 步数用完，只成 ' + pMatched + ' 对 / ' + pScore + ' 分', '散');
          MHINT.textContent = '散了 · 只成 ' + pMatched + ' 对，再来一次';
        }
      }, 180);
    }, 460);
  }

  /* 选档：只在开局面板期（一手没出）可换 */
  on(PAIR_TIER, 'click', function(e){
    var b = e.target;
    while (b && b !== PAIR_TIER && !b.getAttribute('data-tier')) b = b.parentNode;
    if (!b || b === PAIR_TIER) return;
    var t = b.getAttribute('data-tier');
    if (!PAIR_TIERS[t] || pPhase !== 'idle') return;
    pairTier = t;
    try { localStorage.setItem('txxt-pair-tier', t); } catch(e){}
    syncTierUI();
    updatePairHud();
    MHINT.textContent = t === 'hard' ? '难档 · 十对，没有预展'
      : (t === 'easy' ? '易档 · 六对，先亮一眼' : '中档 · 八对，先亮一眼');
  });
  on(PAIR_GO, 'click', beginPair);

  /* 看一眼：花 2 步换一次全亮（每局 2 次）。它是"记忆"这台机器里唯一的策略按钮 ——
     翻到一半卡住时，用它比乱翻两张更划算，但步数是硬账。 */
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

  /* ================= 舞台尺寸：量父容器、按比例取最大 =================
     旧版把台面宽度写成 clamp(300px,52vw,660px)，不管窗口多高都只给这么宽 ——
     这就是"游玩区偏小"的根。现在一律改成：先量父容器，再按台面的长宽比取
     能塞进去的最大尺寸。窗口一大，台面就跟着大；窄屏交回 CSS 铺满。 */
  function fitBox(el, ratio, maxW){
    if (!el || !el.parentElement) return;
    var host = el.parentElement;
    var aw = host.clientWidth, ah = host.clientHeight;
    if (aw < 80 || ah < 80) return;
    var w = Math.min(aw, ah * ratio, maxW || 1e9);
    el.style.width = Math.floor(w) + 'px';
  }

  function fitBreak(){
    var st = document.getElementById('bkStage');
    if (!st || !st.parentElement) return;
    var host = st.parentElement;
    var pane = host.closest ? host.closest('.pane') : null;
    /* 2026-11-22：可用高度改成量**整页**、再减掉页内兄弟（HUD / 触控条 / 判词），
       不再量 host —— host 的高度本来就是由台面撑出来的，量它等于"用上一帧的结果算下一帧"，
       手机上会一路缩到 126px。横屏时那两个兄弟是 absolute（不占位），直接跳过。 */
    /* 宽度仍量 host（它等于这一页的可用宽度，不含 padding）；clientWidth 会把左右 padding 也算进去，
       手机上会多出 20px 让台面横向溢出。 */
    var aw = host.clientWidth || (pane || host).clientWidth;
    var ah = (pane || host).clientHeight;
    if (pane){
      var used = 0;
      Array.prototype.forEach.call(pane.children, function(ch){
        if (ch === host) return;
        var cs = window.getComputedStyle(ch);
        if (cs.position === 'absolute' || cs.display === 'none') return;
        used += ch.getBoundingClientRect().height + 8;
      });
      ah -= used + 8;
    }
    if (aw < 80 || ah < 80) return;
    st.style.width = Math.floor(Math.min(aw, ah * (BW / BH))) + 'px';
  }

  function fitBrick(){
    var b = document.getElementById('brkBoard');
    if (!b || !b.parentElement) return;
    var host = b.parentElement;
    var aw = host.clientWidth, ah = host.clientHeight;
    if (aw < 80 || ah < 80) return;
    /* 宽屏待放砖在右侧，留出那一条；窄屏它在下面，按高度收 */
    var side = window.innerWidth <= 900 ? Math.floor(Math.min(aw, ah * 0.74)) : Math.floor(Math.min(ah, aw - 190));
    if (side < 80) return;
    b.style.width = side + 'px';
    b.style.height = side + 'px';
  }

  function fitPile(){
    fitBox(document.getElementById('pileStage'), 5 / 4, 760);
  }

  /* 04 的卡阵：先按"行数 × 卡高"反算卡宽，再看列宽够不够 */
  function fitPair(){
    var g = document.getElementById('pairGrid');
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

  var LAST_FIT = 0;
  function refitAll(){
    if (Date.now() - LAST_FIT < 40) return;
    LAST_FIT = Date.now();
    fitBreak();
    if (typeof bkFit === 'function') bkFit();
    fitBrick();
    fitPile();
    fitPair();
    if (typeof onetFit === 'function') onetFit();
    if (typeof mgFit === 'function') mgFit();
  }
  /* 转屏与尺寸变化的重算统一在文件末尾接（那里才有 later() 与节流重置），这里不再重复挂 resize。 */

  /* 最好成绩只存在本地：没有后端，也不想为一张榜去接服务 */
  var BEST = {
    get: function(k){
      try { var v = window.localStorage.getItem('txxt.hall.' + k); return v ? Number(v) || 0 : 0; } catch(e){ return 0; }
    },
    set: function(k, v){
      try { if (v > BEST.get(k)) window.localStorage.setItem('txxt.hall.' + k, String(v)); } catch(e){}
    },
    /* 有些纪录越小越好（步数、手数），不能走 set 的"取大"语义 */
    setMin: function(k, v){
      try {
        var cur = BEST.get(k);
        if (!cur || v < cur) window.localStorage.setItem('txxt.hall.' + k, String(v));
      } catch(e){}
    }
  };

  /* ================= 07 连字 · 两拐之内连走两张同字 ================= */
  /* 两张同字之间若能用一条**不超过两次拐弯**的空路连起来，就能一起收走；
     路径可以绕到盘子外面那一圈留白，所以"贴边的两张"往往最好连。
     三关：8×6 / 8×8 / 10×8，每关两次洗牌；牌清了落「成」，洗不动了落「散」。
     格子数必须是偶数（成对发牌），所以三关都用 48 / 64 / 80 这种整偶数。 */
  var ONET_LV = [
    { cols: 8, rows: 6, name: '暖场', theme: 'shanshui' },
    { cols: 8, rows: 8, name: '中场', theme: 'qiwu' },
    { cols: 10, rows: 8, name: '满盘', theme: 'sanguo' }
  ];
  var ONET_CH = ['月','舟','烛','窗','梅','灯','雪','风','云','山','水','松','雁','书','墨','茶','江','岸'];
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
  var oBoard = [], oTiles = [], oSel = null, oLock = false, oDone = false, oWin = false;
  /* 分数 / 连击 / 提示：连击窗口 5 秒（连字是慢游戏，窗口不能跟抽词一样短）；
     提示每关 2 次，只"点出一对能连的"，不动手也不改盘 —— 它降低的是"找不到"的挫败，不是难度。 */
  var oScore = 0, oBest = 0, oHints = 2, oMaxCombo = 0;
  var oCombo = comboState(5000, 8);
  if (ONET_LVN) ONET_LVN.textContent = String(ONET_LV.length);

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

  function onetRender(){
    ONET_GRID.innerHTML = '';
    ONET_GRID.style.gridTemplateColumns = '0.5fr repeat(' + oCols + ', 1fr) 0.5fr';
    ONET_GRID.style.gridTemplateRows = '0.5fr repeat(' + oRows + ', 1fr) 0.5fr';
    oTiles = [];
    for (var r = 0; r < oRows + 2; r++){
      var row = [];
      for (var c = 0; c < oCols + 2; c++){
        var cell = document.createElement('div');
        cell.className = 'o-cell';
        var ch = oBoard[r][c];
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
          cell.classList.add('o-blank');
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
    oShuffles = 2; oHints = 2; oLock = false; oDone = false; oWin = false; oSel = null;
    oCombo = comboState(5000, 8);
    ONET_PANE.classList.remove('is-over');
    ONET_V.classList.remove('is-on');
    ONET_VS.className = 'verdict-seal';
    ONET_VS.textContent = '';
    ONET_LINE.classList.remove('is-on');
    ONET_LINE.setAttribute('points', '');

    var pairs = Math.floor((oCols * oRows) / 2);
    var chars = [], picked = null;
    /* 优先按"整词"发牌：24 对就是 12 个两字词，清完一对等于拼回一个名字。
       名字之间会共用字（张飞 / 张辽都是"张"），所以完成判定按"这个字还有没有留在盘上"算，
       而不是"这一对扣在哪一个词上"。词凑不满（比如五行只有五个字）才退化成单字循环。 */
    picked = themeWordChars(spec.theme, pairs);
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
    for (var r = 0; r < oRows + 2; r++){
      var row = [];
      for (var c2 = 0; c2 < oCols + 2; c2++){
        var inner = r >= 1 && c2 >= 1 && r <= oRows && c2 <= oCols;
        row.push(inner ? tiles[(r - 1) * oCols + (c2 - 1)] : '');
      }
      oBoard.push(row);
    }
    oPairs = pairs;
    onetRender();
    onetFit();
    onetHud();
    MHINT.textContent = '点两张相同的字 · 两拐之内能连通才收走';
    if (!onetHasPair()) onetReshuffle(true);
  }

  /* 两点之间找一条 ≤2 拐的空路（padded 坐标，绕边也在范围内） */
  function oFind(a, b){
    var W = oCols + 2, H = oRows + 2;
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    var seen = new Int8Array(W * H * 4);
    for (var i = 0; i < seen.length; i++) seen[i] = 9;
    var out = null;
    function walk(r, c, dir, turns, path){
      if (out) return;
      if (r < 0 || c < 0 || r >= H || c >= W) return;
      if (r === b.r && c === b.c){ out = path.concat([{ r: r, c: c }]); return; }
      if (oBoard[r][c]) return;
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
          if (nr < 0 || nc < 0 || nr >= H || nc >= W || oBoard[nr][nc]) continue;
          walk(nr, nc, d, turns + 1, p2);
          if (out) return;
        }
      }
    }
    for (var d2 = 0; d2 < 4; d2++){
      var r0 = a.r + dirs[d2][0], c0 = a.c + dirs[d2][1];
      if (r0 === b.r && c0 === b.c) return [{ r: a.r, c: a.c }, { r: b.r, c: b.c }];
      if (r0 < 0 || c0 < 0 || r0 >= H || c0 >= W || oBoard[r0][c0]) continue;
      walk(r0, c0, d2, 0, [{ r: a.r, c: a.c }]);
      if (out) return out;
    }
    return out;
  }

  function onetCells(){
    var list = [];
    for (var r = 1; r <= oRows; r++) for (var c = 1; c <= oCols; c++){
      if (oBoard[r][c]) list.push({ r: r, c: c });
    }
    return list;
  }

  /* 同字才可能连上，所以先按字分组再两两试路 —— 80 张的满盘上，
     全量两两比是 O(n²) 次 oFind（每次还要跑一遍 DFS）；按字分组之后每组通常只有两张，
     oFind 的调用数掉到"对数"这一级。 */
  function onetFindPair(){
    var by = {};
    for (var r = 1; r <= oRows; r++){
      for (var c = 1; c <= oCols; c++){
        var ch = oBoard[r][c];
        if (!ch) continue;
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

  /* 洗牌：只把还在的字重排，位置不动（空位保持空） */
  /* 死锁兜底：剩下的牌挤成一块实心矩形时，怎么洗都连不上 —— 洗牌只换字、不换位置。
     此时拆掉"同一字的两张"（任意位置，不算玩家出手），在实心块上开一个洞，
     后面的牌就有路了。拆的是一对，所以字数奇偶不乱，不会剩一张永远配不掉的牌。 */
  function onetUnblock(){
    var cells = onetCells();
    for (var i = 0; i < cells.length; i++){
      for (var j = i + 1; j < cells.length; j++){
        var ch = oBoard[cells[i].r][cells[i].c];
        if (ch !== oBoard[cells[j].r][cells[j].c]) continue;
        var a = cells[i], b = cells[j];
        [oTiles[a.r][a.c], oTiles[b.r][b.c]].forEach(function(t){
          if (!t) return;
          t.classList.add('is-go');
          FX.burst(t.getBoundingClientRect(), { count: 9, power: 380, colors: ['#252525', '#f28b82', '#fff8e8'] });
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
    if (oDone || oLock) return;
    var cells = onetCells();
    if (!cells.length) return;
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
    if (!onetHasPair()){
      onetEnd(false);
    }
  }

  function onetDrawLine(path){
    if (!ONET_LINE || !ONET_STAGE) return;
    var w = ONET_STAGE.clientWidth, h = ONET_STAGE.clientHeight;
    if (!w || !h) return;
    var cw = w / (oCols + 2), chh = h / (oRows + 2);
    var pts = path.map(function(p){
      return Math.round((p.c + 0.5) * cw) + ',' + Math.round((p.r + 0.5) * chh);
    });
    ONET_SVG.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    ONET_LINE.setAttribute('points', pts.join(' '));
    ONET_LINE.classList.remove('is-on');
    void ONET_LINE.getBoundingClientRect();
    ONET_LINE.classList.add('is-on');
  }

  function oPick(r, c){
    if (oLock || oDone) return;
    var ch = oBoard[r][c];
    if (!ch) return;
    if (!oSel){ oSel = { r: r, c: c }; oPaint(); SFX.play('onet.pick'); return; }
    if (oSel.r === r && oSel.c === c){ oSel = null; oPaint(); return; }
    if (oBoard[oSel.r][oSel.c] !== ch){
      oSel = { r: r, c: c };
      oPaint();
      MHINT.textContent = '这两张不是同一个字';
      return;
    }
    var a = oSel, b = { r: r, c: c };
    var path = oFind(a, b);
    if (!path){
      var t1 = oTiles[a.r][a.c], t2 = oTiles[b.r][b.c];
      [t1, t2].forEach(function(t){ if (t){ t.classList.add('is-bad'); later(function(){ t.classList.remove('is-bad'); }, 340); } });
      MHINT.textContent = '连不上 · 拐弯超过两次';
      return;
    }
    oLock = true;
    oSel = null;
    oPaint();
    onetDrawLine(path);
    var e1 = oTiles[a.r][a.c], e2 = oTiles[b.r][b.c];
    [e1, e2].forEach(function(t){ if (t) t.classList.add('is-go'); });
    /* 收牌：两张一起碎，碎屑沿连线方向推一点 —— 视觉上"顺着这条路被抽走" */
    SFX.play(justWords.length ? 'onet.word' : 'onet.link', { rate: 1 + Math.min(0.4, oCombo.n * 0.05) });
    if (e1) FX.burst(e1.getBoundingClientRect(), { count: 10, power: 420, colors: ['#252525', '#f28b82', '#fff8e8'] });
    if (e2) FX.burst(e2.getBoundingClientRect(), { count: 10, power: 420, colors: ['#252525', '#f28b82', '#fff8e8'] });
    oBoard[a.r][a.c] = '';
    oBoard[b.r][b.c] = '';
    oPairs--;
    if (oRemain[ch] != null) oRemain[ch] = Math.max(0, oRemain[ch] - 2);
    var justWords = [];
    oWords.forEach(function(wd){
      if (wd.done) return;
      var all = true;
      for (var i = 0; i < wd.chars.length; i++){ if ((oRemain[wd.chars[i]] || 0) > 0) { all = false; break; } }
      if (all){ wd.done = true; oWordsDone++; justWords.push(wd.word); }
    });
    if (oWords.length && ONET_WORDS){
      ONET_WORDS.textContent = oWordsDone + '/' + oWords.length;
      /* 这一对正好把某个词收齐了，就把那个词报出来：
         "拼成「赵云」" 比 "拼成 1/12 个" 更像在写东西，也让人知道这些字之间本来是一句话。 */
      MHINT.textContent = justWords.length
        ? '拼成「' + justWords.join('」「') + '」· 已 ' + oWordsDone + '/' + oWords.length + ' 个'
        : '拼成 ' + oWordsDone + ' / ' + oWords.length + ' 个 · 还剩 ' + oPairs + ' 对';
    }
    /* 收一对 = 200 × 连击；正好拼成一个词再加 300。词是这一台唯一"有意义"的奖励，
       所以它比一对普通牌值钱一倍半 —— 让人愿意去凑词，而不是随便找两张能连的。 */
    comboAdd(oCombo);
    oMaxCombo = Math.max(oMaxCombo, oCombo.n);
    var mult = comboMult(oCombo);
    var gain = 200 * mult + justWords.length * 300;
    oScore += gain;
    if (e1) FX.pop(
      (e1.getBoundingClientRect().left + e2.getBoundingClientRect().right) / 2,
      Math.min(e1.getBoundingClientRect().top, e2.getBoundingClientRect().top) - 8,
      '+' + gain + (mult > 1 ? ' ×' + mult : ''), mult >= 4 ? 'is-gold' : '');
    if (justWords.length) FX.rise(e1 ? e1.getBoundingClientRect().left + 10 : 20, e1 ? e1.getBoundingClientRect().top : 20, 12, ['#ffd166', '#fff8e8']);
    onetHud();
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
    }, 360);
  }

  function oPaint(){
    for (var r = 0; r < oRows + 2; r++) for (var c = 0; c < oCols + 2; c++){
      var el = oTiles[r] && oTiles[r][c];
      if (!el) continue;
      el.classList.toggle('is-sel', !!(oSel && oSel.r === r && oSel.c === c));
    }
  }

  function onetEnd(win, glyph){
    oDone = true; oWin = win; oLock = false;
    var cells = onetCells();
    var prevBest = Math.max(oBest, BEST.get('onet.score'));
    var bestLine = oScore > prevBest && oScore > 0 ? ' · 新纪录' : (prevBest ? ' · 最高 ' + prevBest : '');
    BEST.set('onet.score', Math.max(prevBest, oScore));
    if (win){
      ONET_PANE.classList.add('is-over');
      showVerdict(ONET_V, ONET_VT, ONET_VS, 'v-ok',
        '三关连光 · 牌清了 ' + (oCols * oRows) + ' 张 · ' + oScore + ' 分' + bestLine, glyph || '满');
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
    if (oDone || oLock || oShuffles <= 0) return;
    oShuffles--;
    onetReshuffle(false);
  });

  /* 提示：点出一对能连的牌，亮 1.4 秒。每关两次 */
  if (ONET_HINT_BTN) on(ONET_HINT_BTN, 'click', function(){
    if (oDone || oLock || oHints <= 0) return;
    var pair = onetFindPair();
    if (!pair) { MHINT.textContent = '这盘现在没有能连的一对'; return; }
    oHints--;
    oLock = true;
    SFX.play('onet.hint');
    onetHud();
    var t1 = oTiles[pair[0].r][pair[0].c], t2 = oTiles[pair[1].r][pair[1].c];
    [t1, t2].forEach(function(t){ if (t) t.classList.add('is-hint'); });
    var r1 = t1 && t1.getBoundingClientRect(), r2 = t2 && t2.getBoundingClientRect();
    if (r1 && r2) FX.ring((r1.left + r1.width / 2 + r2.left + r2.width / 2) / 2, (r1.top + r1.height / 2 + r2.top + r2.height / 2) / 2, 10, 90, 2, '#ffd166');
    MHINT.textContent = '提示 · 这两张能连（还剩 ' + oHints + ' 次）';
    later(function(){
      [t1, t2].forEach(function(t){ if (t) t.classList.remove('is-hint'); });
      oLock = false;
      onetHud();
    }, 1400);
  });

  if (ONET_STAGE) ONET_STAGE.__link = function(r1, c1, r2, c2){
    return !!oFind({ r: r1, c: c1 }, { r: r2, c: c2 });
  };
  if (ONET_STAGE) ONET_STAGE.__tiles = function(){
    return onetCells().map(function(p){ return { r: p.r, c: p.c, ch: oBoard[p.r][p.c] }; });
  };
  if (ONET_STAGE) ONET_STAGE.__probe = function(){
    return {
      level: oLv + 1, levels: ONET_LV.length, pairs: oPairs, left: onetCells().length,
      shuffles: oShuffles, sel: oSel ? [oSel.r, oSel.c] : null,
      live: onetHasPair(), done: oDone, win: oWin,
      /* 拼成多少个词（只给验收看） */
      wordsDone: oWordsDone, wordsTotal: oWords.length
    };
  };

  /* 标签页切到后台时把破砖的画布循环停掉：浏览器会把 rAF 降到 1fps 甚至冻结，
     但定时器、粒子与 canvas 仍然在记账；切回来按原状态接上（不重置 bkLast，避免一帧跳很远）。 */
  on(document, 'visibilitychange', function(){
    if (document.hidden){
      if (bkRaf){ cancelAnimationFrame(bkRaf); bkRaf = 0; }
      if (runRaf){ cancelAnimationFrame(runRaf); runRaf = 0; }
      if (stkRaf){ cancelAnimationFrame(stkRaf); stkRaf = 0; }
      if (tapRaf){ cancelAnimationFrame(tapRaf); tapRaf = 0; }
      syncLoops();
      FX.stop();
      return;
    }
    if (bkRunning && !bkRaf){ bkLast = 0; bkRaf = requestAnimationFrame(bkFrame); }
    if (runRunning && !runRaf){ runLast = 0; runAcc = 0; runRaf = requestAnimationFrame(runFrame); }
    if (stkRunning && !stkRaf){ stkLast = 0; stkRaf = requestAnimationFrame(stkFrame); }
    if (tapRunning && !tapRaf){ tapLast = 0; tapRaf = requestAnimationFrame(tapFrame); }
    syncLoops();
  });
  /* ================= 09 叠山 · 同字相撞长一级 ================= */
  /* 2048 的骨、汉字的皮：两个「尘」撞成「沙」，一路撞到「天」。
     一粒尘 → 沙 → 石 → 岩 → 山 → 岭 → 峰 → 岳 → 峦 → 云 → 天。 */
  var MG_N = 4, MG_CH = ['尘', '沙', '石', '岩', '山', '岭', '峰', '岳', '峦', '云', '天'];
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

  var mgBoard = [], mgEls = {}, mgId = 1, mgScore = 0, mgDone = false, mgWin = false, mgLock = false;
  var mgSwipe = null, mgBest = 0;
  /* 这一轮加的两件：连击与回退。
     连击：连续两次"推动里有合并"就 +1，乘区作用在得分上（连着合 = 分更高）；
           没有合并的那一步就断 —— 所以"下一步还能不能合"变成了要算的事。
     回退：整局 3 次，只回一步。它是 2048 里最实用的一条"再来一次"，但有限额，
           否则玩家会一路回退到完美局。 */
  var mgCombo = comboState(6000, 6), mgComboMax = 0;
  var mgUndo = 3, mgSnap = null;

  /* 先清空再建 16 个底格：热更新会把模块重跑一遍，不清就是 32 个格子 ——
     盘面被撑成 8 行、上下两半各露一半，看起来像"格子被压歪了"。 */
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
    mgPaint();
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

  function mgTileEl(t, m, i){
    var el = mgEls[t.id];
    var fresh = false;
    if (!el){
      el = document.createElement('div');
      MG_TILES.appendChild(el);
      mgEls[t.id] = el;
      fresh = true;
    }
    /* 叠山的字是"一座山长出来"的十一级，每级给一枚对应的象形记号：
       尘是一粒、沙是波纹、石是方块、山是尖、云是弧、天是一条横 —— 升级时换的不只是字，还有形 */
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
    if (fresh){ el.classList.add('is-new'); }
    return el;
  }

  function mgPaint(){
    if (!MG_STAGE || !MG_TILES) return;
    var m = mgMetrics();
    var alive = {};
    for (var i = 0; i < 16; i++){
      var t = mgBoard[i];
      if (!t) continue;
      alive[t.id] = 1;
      mgTileEl(t, m, i);
    }
    Object.keys(mgEls).forEach(function(id){
      if (alive[id]) return;
      var el = mgEls[id];
      el.classList.add('is-gone');
      delete mgEls[id];
      later(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 180);
    });
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
    mgLock = true;
    mgBoard = mgSnap.board.map(function(t){ return t ? { id: t.id, lvl: t.lvl } : null; });
    mgScore = mgSnap.score;
    mgSnap = null;
    comboBreak(mgCombo);
    mgPaint();
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

  function mgMove(dir){
    if (mgDone || mgLock) return;
    var i, j, rr, cc;
    var next = new Array(16).fill(null);
    var gained = 0, moved = false;
    for (i = 0; i < 4; i++){
      var line = [];
      for (j = 0; j < 4; j++){
        if (dir === 'l'){ rr = i; cc = j; }
        else if (dir === 'r'){ rr = i; cc = 3 - j; }
        else if (dir === 'u'){ rr = j; cc = i; }
        else { rr = 3 - j; cc = i; }
        line.push({ idx: rr * 4 + cc, t: mgBoard[rr * 4 + cc] });
      }
      var ts = line.filter(function(x){ return x.t; }).map(function(x){ return x.t; });
      var out = [], k = 0;
      while (k < ts.length){
        if (k + 1 < ts.length && ts[k].lvl === ts[k + 1].lvl && ts[k].lvl < MG_CH.length){
          var nl = ts[k].lvl + 1;
          out.push({ lvl: nl, merge: true });
          gained += Math.pow(2, nl + 1);
          k += 2;
        } else {
          out.push({ tile: ts[k], lvl: ts[k].lvl, merge: false });
          k++;
        }
      }
      for (var q = 0; q < 4; q++){
        var item = out[q];
        if (!item) continue;
        if (item.merge) next[line[q].idx] = { id: mgId++, lvl: item.lvl, merged: true };
        else next[line[q].idx] = item.tile;
      }
    }
    for (i = 0; i < 16; i++){
      if (mgBoard[i] && (!next[i] || next[i].id !== mgBoard[i].id)){ moved = true; break; }
    }
    /* 推不动的一手也要有声音：听得到"这一下白推了"比看着棋子不动更有反馈 */
    SFX.play('merge.move');
    if (!moved) return;
    mgLock = true;
    /* 推之前先记一份局面（回退用）。只留最近一步，回退一次就用掉一次机会。 */
    mgSnap = {
      board: mgBoard.map(function(t){ return t ? { id: t.id, lvl: t.lvl } : null; }),
      score: mgScore
    };
    mgBoard = next;
    var mult = 0;
    if (gained){
      comboAdd(mgCombo);
      mgComboMax = Math.max(mgComboMax, mgCombo.n);
      mult = comboMult(mgCombo);
      gained = gained * mult;
    } else {
      comboBreak(mgCombo);
    }
    mgScore += gained;
    if (gained) BEST.set('merge.score', mgScore);
    mgBest = Math.max(mgBest, BEST.get('merge.score'));
    mgPaint();
    mgHud();
    mgAdd(1);
    mgPaint();
    /* 合并的那一格炸一下：同字相撞是这台的唯一"得分动作"，反馈要落在落点上 */
    if (gained){
      var topNew = 0;
      mgBoard.forEach(function(t){
        if (!t || !t.merged) return;
        t.merged = false;
        var el = mgEls[t.id];
        /* 每一次合并一记石响，越往上音越低越厚：听音高就知道这次撞出了什么级别 */
        SFX.play('merge.hit', { rate: Math.max(0.55, 1.35 - t.lvl * 0.1), gain: 0.8 + Math.min(0.5, t.lvl * 0.05) });
        if (el) FX.burst(el.getBoundingClientRect(), {
          count: 12, dust: 7, power: 400,
          colors: ['#ffd166', '#f28b82', '#fff8e8'], ring: true
        });
        if (t.lvl > topNew) topNew = t.lvl;
      });
      var sr = MG_STAGE.getBoundingClientRect();
      FX.pop(sr.left + sr.width / 2, sr.top + sr.height * 0.36,
        '+' + gained + (mult > 1 ? ' ×' + mult : ''), mult >= 3 ? 'is-gold' : '');
      /* 合出「岭」以上就不只是"加分"了：震一下 + 50ms 停顿，让人感到这一撞很重 */
      if (topNew >= 6){ FX.shake(MG_STAGE, 4); FX.freeze(50); SFX.play('merge.big'); }
      if (topNew >= 8){
        FX.ring(sr.left + sr.width / 2, sr.top + sr.height / 2, 12, sr.width * 0.5, 4, '#ffd166');
        FX.rise(sr.left + sr.width / 2, sr.top + sr.height * 0.3, 18, ['#ffd166', '#fff8e8']);
      }
    }
    var top = 0;
    for (i = 0; i < 16; i++) if (mgBoard[i] && mgBoard[i].lvl > top) top = mgBoard[i].lvl;
    later(function(){
      mgLock = false;
      if (top >= MG_CH.length) mgEnd(true);
      else if (!mgCanMove()) mgEnd(false);
      else MHINT.textContent = '方向键推 · 同字相撞长一级';
      /* 这一步必须补：mgHud 是在 mgLock 还开着的时候调的，
         那时「回退」被禁用；锁放开后不重画一次，按钮会一直灰着 —— 回退等于废了。 */
      mgHud();
    }, 130);
  }

  function mgReset(){
    MG_TILES.innerHTML = '';
    mgEls = {};
    mgBoard = new Array(16).fill(null);
    mgId = 1; mgScore = 0; mgDone = false; mgWin = false; mgLock = false;
    mgBest = BEST.get('merge.score');
    mgUndo = 3; mgSnap = null; mgComboMax = 0;
    mgCombo = comboState(6000, 6);
    MG_PANE.classList.remove('is-over');
    MG_V.classList.remove('is-on');
    MG_VS.className = 'verdict-seal';
    MG_VS.textContent = '';
    mgAdd(1); mgAdd(1);
    mgPaint();
    mgHud();
    MHINT.textContent = '方向键 / WASD 或滑动 · 同字相撞长一级';
  }

  function mgEnd(win){
    mgDone = true; mgWin = win; mgLock = false;
    MG_PANE.classList.add('is-over');
    if (win){
      showVerdict(MG_V, MG_VT, MG_VS, 'v-ok', '叠到「天」· ' + mgScore + ' 分 · 最高 ' + mgComboMax + ' 连击', '成');
      MHINT.textContent = '垒到天了 · 再来一次还能更高';
    } else {
      showVerdict(MG_V, MG_VT, MG_VS, 'v-bad', '推不动了 · ' + mgScore + ' 分 / ' + mgTopText(), '散');
      MHINT.textContent = '散了 · 满盘又没得撞';
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
    if (current !== 'merge') return;
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
    /* 滑动超过 22px 当场推一次（并把起点挪到手指当前位置）：一次拖动可以连推，
       旧版只在抬手时判，手机上"划一下要等抬手"就是那个迟钝感。 */
    on(MG_STAGE, 'pointermove', function(e){
      if (!mgSwipe) return;
      if (mgDone) return;
      var dx = e.clientX - mgSwipe.x, dy = e.clientY - mgSwipe.y;
      var th = 22;
      if (Math.abs(dx) < th && Math.abs(dy) < th) return;
      if (Math.abs(dx) > Math.abs(dy)) mgMove(dx > 0 ? 'r' : 'l');
      else mgMove(dy > 0 ? 'd' : 'u');
      mgSwipe = { x: e.clientX, y: e.clientY };
    });
    on(MG_STAGE, 'pointerup', function(){ mgSwipe = null; });
    MG_STAGE.__probe = function(){
      return {
        cells: mgBoard.map(function(t){ return t ? t.lvl : 0; }),
        score: mgScore, best: mgBest, done: mgDone, win: mgWin, can: mgCanMove(),
        combo: mgCombo.n, undo: mgUndo
      };
    };
  }
  bindPad('mergePad', function(key){ if (!mgDone) mgMove(key); });
  if (MG_UNDO_BTN) on(MG_UNDO_BTN, 'click', mgRestore);

  /* ================= 09 敲印 · 反应 ================= */
  /* 十二个格子里随机会冒出一枚印，在它缩回去之前点掉。
     —— 为什么是"点掉印"而不是"打地鼠"：印会自己缩（时间窗），还会混进一枚**墨印**，
        点墨印要扣一条命。于是它不只是比手快，还要在一瞬间分辨"该不该点"。
     难度四件事一起抬：印冒得更密、留得更短、墨印更多、后期一次冒两枚。 */
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

  var tapCells = [], tapLive = [], tapRaf = 0, tapLast = 0;
  var tapRunning = false, tapDone = false, tapPaused = false;
  var tapScore = 0, tapBest = 0, tapLivesN = 3, tapHits = 0, tapLevel = 1;
  var tapMaxCombo = 0, tapSpawnAcc = 0, tapSpawnAt = 0, tapGapMs = 640, tapLifeMs = 1060;
  var tapCombo = comboState(2400, 10);
  var TAP_CH = ['云', '月', '灯', '舟', '雪', '松', '竹', '茶', '墨', '花'];

  if (TAP_BOARD){
    /* 先清空再建：开发时热更新会把这个模块重跑一遍，不清空就是 12 + 12 = 24 格，
       盘面被撑成 6 行、格子被压扁（这是"看起来格子乱掉"的真正原因）。 */
    TAP_BOARD.textContent = '';
    tapCells = [];
    for (var tc = 0; tc < 12; tc++){
      (function(i){
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tap-cell';
        b.setAttribute('aria-label', '第 ' + (i + 1) + ' 格');
        b.innerHTML = '<span class="tap-seal"><i></i></span>';
        b._seal = b.querySelector('.tap-seal');
        b._mark = b.querySelector('i');
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
      c.classList.remove('is-live', 'is-gold', 'is-ink');
      c._seal.style.removeProperty('--p');
    });
    tapLive = [];
  }

  function tapStartRun(showOverlay){
    tapClearCells();
    tapRunning = false; tapDone = false; tapPaused = false;
    tapScore = 0; tapLivesN = 3; tapHits = 0; tapLevel = 1;
    tapMaxCombo = 0; tapSpawnAcc = 0; tapSpawnAt = 700;
    tapGapMs = 640; tapLifeMs = 1060;
    tapCombo = comboState(2400, 10);
    tapBest = BEST.get('tap.score');
    TAP_PANE.classList.remove('is-over');
    TAP_V.classList.remove('is-on');
    TAP_VS.className = 'verdict-seal';
    TAP_VS.textContent = '';
    TAP_START.classList.toggle('is-on', !!showOverlay);
    tapHud();
    MHINT.textContent = showOverlay ? '三枚印，别点墨印 · 按开始' : '点掉冒出来的印 · 墨印别点';
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

  function tapSpawn(){
    var free = tapCells.filter(function(c){ return !c._live; });
    if (!free.length) return;
    var cell = free[Math.floor(Math.random() * free.length)];
    var kind = 0;
    var r = Math.random();
    /* 墨印从第二段才出现：第一段只教"点掉"，第二段才教"有时候不要点" */
    if (tapLevel >= 2 && r < Math.min(0.18, 0.06 + tapLevel * 0.012)) kind = 2;
    else if (r < Math.min(0.24, 0.1 + tapLevel * 0.01)) kind = 1;
    var life = tapLifeMs * (kind === 0 ? 1 : 1.15);
    var seal = cell._seal;
    seal.textContent = kind === 2 ? '墨' : (kind === 1 ? '金' : TAP_CH[Math.floor(Math.random() * TAP_CH.length)]);
    cell.classList.toggle('is-gold', kind === 1);
    cell.classList.toggle('is-ink', kind === 2);
    cell.classList.add('is-live');
    cell._live = { kind: kind, until: performance.now() + life, life: life };
    tapLive.push(cell);
  }

  function tapDrop(cell, dead){
    cell._live = null;
    cell.classList.remove('is-live', 'is-gold', 'is-ink');
    cell._seal.style.removeProperty('--p');
    var k = tapLive.indexOf(cell);
    if (k >= 0) tapLive.splice(k, 1);
    if (dead) return false;
    return true;
  }

  function tapHit(cell){
    if (!tapRunning || tapDone || tapPaused) return;
    var live = cell._live;
    if (!live){ return; }   /* 空点不罚命，只断连击（触屏上误触太容易，罚命会变成"运气"） */
    var kind = live.kind;
    tapDrop(cell, true);
    if (kind === 2){
      /* 墨印：点错了。扣命 + 一记"墨"的爆开，震一下让人记住这个颜色 */
      tapLivesN--;
      comboBreak(tapCombo);
      SFX.play('tap.bad');
      FX.burst(cell.getBoundingClientRect(), { count: 16, dust: 10, power: 420, size: 9, colors: ['#252525', '#454545', '#fff8e8'], ringColor: '#252525' });
      FX.shake(TAP_BOARD, 5);
      FX.freeze(60);
      FX.pop(cell.getBoundingClientRect().left + 20, cell.getBoundingClientRect().top + 10, '墨 · -1', 'is-bad');
      tapHud();
      if (tapLivesN <= 0) tapEnd();
      return;
    }
    comboAdd(tapCombo);
    tapMaxCombo = Math.max(tapMaxCombo, tapCombo.n);
    var base = kind === 1 ? 300 : 100;
    var mult = comboMult(tapCombo);
    /* 木鱼一记：普通字是"笃"，金印是更亮一档的"咚" */
    SFX.play(kind === 1 ? 'tap.gold' : 'tap.hit', { rate: 1 + Math.min(0.35, tapCombo.n * 0.03) });
    tapScore += base * mult;
    tapHits++;
    var r = cell.getBoundingClientRect();
    FX.pop(r.left + r.width / 2, r.top - 4, '+' + (base * mult) + (mult > 1 ? ' ×' + mult : ''), kind === 1 ? 'is-gold' : '');
    FX.ring(r.left + r.width / 2, r.top + r.height / 2, 6, 34, 2, kind === 1 ? '#ffd166' : '#fff8e8');
    if (kind === 1){
      tapLivesN = Math.min(5, tapLivesN + 1);
      FX.rise(r.left + r.width / 2, r.top, 10, ['#ffd166', '#fff8e8']);
    }
    var prevLv = tapLevel;
    tapLevel = 1 + Math.floor(tapHits / 12);
    if (tapLevel > prevLv) SFX.play('tap.up');   /* 升段：更快的节拍得先"听得见" */
    tapGapMs = Math.max(250, 640 - (tapLevel - 1) * 52);
    tapLifeMs = Math.max(520, 1060 - (tapLevel - 1) * 66);
    tapHud();
  }

  function tapUpdate(dt){
    tapSpawnAcc += dt;
    if (tapSpawnAcc >= tapGapMs){
      tapSpawnAcc = 0;
      tapSpawn();
      /* 第 4 段起一次可能冒两枚：两枚同屏才算"要看一眼再决定先点哪个" */
      if (tapLevel >= 4 && tapLive.length < 2 && Math.random() < 0.5) tapSpawn();
    }
    for (var i = tapLive.length - 1; i >= 0; i--){
      var cell = tapLive[i];
      var live = cell._live;
      if (!live) continue;
      var left = live.until - performance.now();
      if (left <= 0){
        tapDrop(cell, true);
        if (live.kind !== 2){
          tapLivesN--;
          comboBreak(tapCombo);
          FX.sparks(cell.getBoundingClientRect(), 3, '#f28b82');
          tapHud();
          if (tapLivesN <= 0){ tapEnd(); return; }
        } else {
          /* 墨印自己缩回去 = 你躲对了，不给奖励也不罚 */
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
    return {
      score: tapScore, combo: tapCombo.n, level: tapLevel, lives: tapLivesN,
      hits: tapHits, live: tapLive.length, run: tapRunning, paused: tapPaused, done: tapDone,
      kinds: tapLive.map(function(c){ return c._live ? c._live.kind : -1; }),
      left: tapLive.map(function(c){ return c._live ? Math.round(c._live.until - performance.now()) : -1; })
    };
  };

  /* ================= 10 走墨 · 无尽跑 ================= */
  /* 一条墨在纸上往前跑，跳过石头。跑得越远越快，越快的间距也越大 ——
     难度是"速度"和"间距配比"一起抬的，不是单纯把速度调高（那样只会变成反应不及）。
     操作只有跳：空格 / ↑ / W / 点画面。二段跳是留给"踩空了"的一次补救，不是常规路线。 */
  var RUN = document.getElementById('runCanvas');
  var RUN_START = document.getElementById('runStart');
  var RUN_GO = document.getElementById('runGo');
  var RUN_PAUSE = document.getElementById('runPause');
  var RUN_DIST = document.getElementById('runDist');
  var RUN_BEST = document.getElementById('runBest');
  var RUN_CHARS = document.getElementById('runChars');
  var RUN_COMBO = document.getElementById('runCombo');
  var RUN_V = document.getElementById('runVerdict');
  var RUN_VT = document.getElementById('runVText');
  var RUN_VS = document.getElementById('runVSeal');
  var RUN_PANE = document.getElementById('pane-run');

  var RW = 960, RH = 420, RGROUND = 336;
  var runCtx = null, runRaf = 0, runLast = 0, runAcc = 0;
  var runRunning = false, runDone = false, runPaused = false;
  var runDist = 0, runSpeed = 300, runChars = 0, runScore = 0, runBest = 0, runMaxCombo = 0;
  var runObstacles = [], runCoins = [], runNextObs = 260, runNextCoin = 380;
  var runP = { x: 168, y: RGROUND - 54, vy: 0, w: 38, h: 54, jumps: 0, on: true };
  var runCoyote = 0, runBuf = 0, runGhost = [], runT = 0;
  var runCombo = comboState(2200, 8);
  var runBgFar = null, runBgNear = null;

  function runFit(){
    if (!RUN) return;
    fitBox(RUN, RW / RH, 1180);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = RUN.clientWidth || RW;
    RUN.width = Math.round(cw * dpr);
    RUN.height = Math.round(cw * (RH / RW) * dpr);
    runCtx = RUN.getContext('2d');
    var s = RUN.width / RW;
    runCtx.setTransform(s, 0, 0, s, 0, 0);
    if (!runBgFar) runBgFar = document.createElement('canvas');
    if (!runBgNear) runBgNear = document.createElement('canvas');
    runBgFar.width = RW; runBgFar.height = RH;
    runBgNear.width = RW; runBgNear.height = RH;
    runPaintBg(runBgFar.getContext('2d'), 0);
    runPaintBg(runBgNear.getContext('2d'), 1);
  }

  /* 两层山各自画进一张离屏画布，每帧只贴图 + 平移 —— 每帧重画 40 个点的山脊线没必要。
     画法从"半透明灰块"改成"剪纸"：远山一整块纸色、近山压深一档 + 一圈墨线。
     这套皮是纸黄 + 墨边，半透明灰在纸底上会读成"脏"，实色剪纸才读成"山"。 */
  function runPaintBg(c, layer){
    c.clearRect(0, 0, RW, RH);
    var base = RGROUND - 4;
    var amp = layer ? 62 : 112;
    c.fillStyle = layer ? '#e2d7bf' : '#f0e7d4';
    c.beginPath();
    c.moveTo(0, base);
    for (var x = 0; x <= RW; x += 24){
      var y = base - Math.abs(Math.sin(x * 0.0042 + layer * 1.7)) * amp - (layer ? 0 : 20);
      c.lineTo(x, y);
    }
    c.lineTo(RW, base);
    c.closePath();
    c.fill();
    /* 山脊：只有近山描墨线，远山留白 —— 两条墨线会抢地面那条主线 */
    c.strokeStyle = layer ? 'rgba(37,37,37,.5)' : 'rgba(37,37,37,.16)';
    c.lineWidth = layer ? 2.4 : 1.6;
    c.beginPath();
    for (var x2 = 0; x2 <= RW; x2 += 24){
      var y2 = base - Math.abs(Math.sin(x2 * 0.0042 + layer * 1.7)) * amp - (layer ? 0 : 20);
      if (x2 === 0) c.moveTo(x2, y2); else c.lineTo(x2, y2);
    }
    c.stroke();
    if (!layer){
      /* 天上几枚淡字：跑起来背景不动，但有字在，就不是"一张空纸" */
      c.fillStyle = 'rgba(37,37,37,.07)';
      c.font = '900 96px Georgia, serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      ['云', '山', '风'].forEach(function(ch, i){ c.fillText(ch, 180 + i * 300, 96 + (i % 2) * 34); });
    }
    if (layer){
      /* 地下：斜细纹（土），只在近层铺一次，随地面一起平移到画布外再回卷 */
      c.strokeStyle = 'rgba(37,37,37,.14)';
      c.lineWidth = 1.4;
      for (var hx = -RH; hx < RW + RH; hx += 22){
        c.beginPath();
        c.moveTo(hx, RGROUND);
        c.lineTo(hx + (RH - RGROUND) * 1.4, RH);
        c.stroke();
      }
    }
  }

  function runReset(showOverlay){
    runObstacles = []; runCoins = []; runGhost = [];
    runDist = 0; runSpeed = 300; runChars = 0; runScore = 0; runMaxCombo = 0;
    runNextObs = 420; runNextCoin = 360;
    runP.y = RGROUND - runP.h; runP.vy = 0; runP.jumps = 0; runP.on = true;
    runRunning = false; runDone = false; runPaused = false;
    runCombo = comboState(2200, 8);
    runBest = BEST.get('run.best');
    RUN_PANE.classList.remove('is-over');
    RUN_V.classList.remove('is-on');
    RUN_VS.className = 'verdict-seal';
    RUN_VS.textContent = '';
    RUN_START.classList.toggle('is-on', !!showOverlay);
    runHud();
    runFit();
    runDraw();
    MHINT.textContent = showOverlay ? '空格 / 点画面起跳 · 按开始' : '空格 / 点画面跳 · 二段跳补一次';
    if (!showOverlay) runGo();
  }

  function runHud(){
    /* 每帧都会调它，所以只在"数字真的变了"的时候写 DOM —— 60fps 下每帧重写四个 span 是纯浪费 */
    var d = Math.floor(runDist);
    var b = Math.max(runBest, d);
    if (RUN_DIST && d !== runHudCache.d){ RUN_DIST.textContent = String(d); runHudCache.d = d; }
    if (RUN_BEST && b !== runHudCache.b){ RUN_BEST.textContent = String(b); runHudCache.b = b; }
    if (RUN_CHARS && runChars !== runHudCache.c){ RUN_CHARS.textContent = String(runChars); runHudCache.c = runChars; }
    if (runCombo.n !== runHudCache.n){ FX.combo(RUN_COMBO, runCombo.n); runHudCache.n = runCombo.n; }
    if (RUN_PAUSE && runPaused !== runHudCache.p){ RUN_PAUSE.textContent = runPaused ? '▶' : '⏸'; runHudCache.p = runPaused; }
  }
  var runHudCache = { d: -1, b: -1, c: -1, n: -1, p: null };

  function runGo(){
    if (!RUN) return;
    RUN_START.classList.remove('is-on');
    runRunning = true; runDone = false; runPaused = false;
    runLast = 0; runAcc = 0;
    if (runRaf) cancelAnimationFrame(runRaf);
    runRaf = requestAnimationFrame(runFrame);
    syncLoops();
  }

  function runStop(){
    runRunning = false;
    if (runRaf){ cancelAnimationFrame(runRaf); runRaf = 0; }
    syncLoops();
  }

  function runJump(){
    if (!runRunning || runDone || runPaused) return;
    if (runP.on || runCoyote > 0){
      runP.vy = -640;
      runP.on = false;
      runP.jumps = 1;
      runCoyote = 0;
      /* 起跳：一声很短的"呼" */
      SFX.play('run.jump', { rate: 0.96 });
      FX.ring((RUN.getBoundingClientRect().left + (runP.x + runP.w / 2) * (RUN.getBoundingClientRect().width / RW)),
        RUN.getBoundingClientRect().top + (runP.y + runP.h) * (RUN.getBoundingClientRect().height / RH), 4, 26, 2, 'rgba(37,37,37,.55)');
    } else if (runP.jumps < 2){
      runP.vy = -540;
      runP.jumps = 2;
      /* 二段跳比第一段高一档：听得出自己踩的是哪一段 */
      SFX.play('run.jump', { rate: 1.14 });
      FX.ring((RUN.getBoundingClientRect().left + (runP.x + runP.w / 2) * (RUN.getBoundingClientRect().width / RW)),
        RUN.getBoundingClientRect().top + (runP.y + runP.h) * (RUN.getBoundingClientRect().height / RH), 4, 22, 2, '#ffd166');
    } else {
      runBuf = 0.14;   /* 按早了：落地前 140ms 内按的跳会被记住（跳跃缓冲） */
    }
  }

  function runUpdate(dt){
    runT += dt;
    runCoyote = Math.max(0, runCoyote - dt);
    runBuf = Math.max(0, runBuf - dt);
    runSpeed = Math.min(760, runSpeed + 7.5 * dt);
    runDist += runSpeed * dt / 40;

    runP.vy += 1520 * dt;
    runP.y += runP.vy * dt;
    if (runP.y + runP.h >= RGROUND){
      if (!runP.on){
        FX.trail(RUN.getBoundingClientRect().left + runP.x * (RUN.getBoundingClientRect().width / RW),
          RUN.getBoundingClientRect().top + RGROUND * (RUN.getBoundingClientRect().height / RH), 'rgba(37,37,37,.5)', 6);
      }
      runP.y = RGROUND - runP.h;
      runP.vy = 0;
      runP.on = true;
      runP.jumps = 0;
      if (runBuf > 0){ runBuf = 0; runJump(); }
    } else if (runP.on){
      runP.on = false;
      runCoyote = 0.09;
    }

    /* 拖尾位置只留 8 个：多了看不见，还要每帧画一堆椭圆 */
    runGhost.push({ x: runP.x + runP.w / 2, y: runP.y + runP.h / 2, a: 1 });
    if (runGhost.length > 8) runGhost.shift();

    var dx = runSpeed * dt;
    runNextObs -= dx;
    if (runNextObs <= 0){
      var h = 26 + Math.random() * 34;
      var w = 26 + Math.random() * 30;
      runObstacles.push({ x: RW + 30, y: RGROUND - h, w: w, h: h, ch: ['石', '木', '岩'][Math.floor(Math.random() * 3)] });
      /* 间距 = 好跳的距离（约 0.95 个滞空）到 1.5 个滞空之间，快起来之后仍然可跳 */
      runNextObs = runSpeed * (0.95 + Math.random() * 0.55);
    }
    runNextCoin -= dx;
    if (runNextCoin <= 0 && Math.random() < 0.7){
      var cy = RGROUND - 90 - Math.random() * 70;
      for (var ci = 0; ci < 3; ci++) runCoins.push({ x: RW + 40 + ci * 34, y: cy - Math.sin(ci / 2 * Math.PI) * 26, got: false });
      runNextCoin = runSpeed * (0.8 + Math.random() * 0.7);
    }

    for (var i = runObstacles.length - 1; i >= 0; i--){
      var o = runObstacles[i];
      o.x -= dx;
      if (o.x + o.w < -20) runObstacles.splice(i, 1);
    }
    for (var j = runCoins.length - 1; j >= 0; j--){
      var co = runCoins[j];
      co.x -= dx;
      if (co.x < -30) runCoins.splice(j, 1);
      var pr = { x: runP.x + 4, y: runP.y + 4, w: runP.w - 8, h: runP.h - 8 };
      if (!co.got && co.x > pr.x - 12 && co.x < pr.x + pr.w + 12 && co.y > pr.y - 12 && co.y < pr.y + pr.h + 12){
        co.got = true;
        runChars++;
        /* 吃字：一声清亮的"叮"，连吃就顺着往上抬 —— 三枚一组的距离本来就该连成一小段旋律 */
        SFX.play('run.coin', { rate: 1 + Math.min(0.6, runCombo.n * 0.07) });
        comboAdd(runCombo);
        runMaxCombo = Math.max(runMaxCombo, runCombo.n);
        runScore = Math.floor(runDist) + runChars * 8;
        var cr = RUN.getBoundingClientRect();
        FX.pop(cr.left + co.x * (cr.width / RW), cr.top + co.y * (cr.height / RH),
          '+' + (8 * comboMult(runCombo)), 'is-gold');
        FX.sparks({ left: cr.left + co.x * (cr.width / RW) - 8, top: cr.top + co.y * (cr.height / RH) - 8, width: 16, height: 16 }, 3, '#ffd166');
        runHud();
      }
    }

    /* 碰撞：内缩 4px，避免"擦肩也算撞" */
    var hit = false;
    for (var k = 0; k < runObstacles.length; k++){
      var ob = runObstacles[k];
      if (runP.x + 6 < ob.x + ob.w && runP.x + runP.w - 6 > ob.x &&
          runP.y + 6 < ob.y + ob.h && runP.y + runP.h > ob.y){ hit = true; break; }
    }
    if (hit) runEnd();
  }

  function runEnd(){
    runDone = true;
    runRunning = false;
    if (runRaf){ cancelAnimationFrame(runRaf); runRaf = 0; }
    runScore = Math.floor(runDist) + runChars * 8;
    var prevBest = Math.max(runBest, BEST.get('run.best'));
    var isBest = Math.floor(runDist) > prevBest;
    BEST.set('run.best', Math.floor(runDist));
    runBest = Math.max(prevBest, Math.floor(runDist));
    var cr = RUN.getBoundingClientRect();
    /* 撞上石头的那一下：一声闷的"顿"，震屏与 90ms 停顿时同一刻发生 */
    SFX.play('run.dead');
    FX.burst({ left: cr.left + runP.x * (cr.width / RW), top: cr.top + runP.y * (cr.height / RH), width: 40, height: 54 },
      { count: 26, dust: 14, power: 520, size: 9, colors: ['#252525', '#f28b82', '#fff8e8'], ringColor: '#f28b82' });
    FX.shake(RUN, 7);
    FX.freeze(90);
    RUN_PANE.classList.add('is-over');
    showVerdict(RUN_V, RUN_VT, RUN_VS, 'v-bad',
      '止步 ' + Math.floor(runDist) + ' 米 · 收字 ' + runChars + ' · ' + runScore + ' 分' + (isBest ? ' · 新纪录' : ''), '散');
    MHINT.textContent = '止步了 · 最多 ' + runMaxCombo + ' 连 · 再跑一次';
    runHud();
    syncLoops();
  }

  function runDraw(){
    if (!runCtx) return;
    var g = runCtx;
    g.clearRect(0, 0, RW, RH);
    g.fillStyle = '#f7efdd';
    g.fillRect(0, 0, RW, RH);
    /* 两层山：远层慢、近层快。贴图而不是重画 */
    var offFar = (runDist * 3.4) % RW;
    var offNear = (runDist * 7.2) % RW;
    g.globalAlpha = 1;
    g.drawImage(runBgFar, -offFar, 0);
    g.drawImage(runBgFar, RW - offFar, 0);
    g.drawImage(runBgNear, -offNear, 0);
    g.drawImage(runBgNear, RW - offNear, 0);

    /* 地面：一条墨线 + 跟着跑的短刻线（跑动的参照物） */
    g.fillStyle = '#252525';
    g.fillRect(0, RGROUND, RW, 3);
    var d0 = (runDist * 12) % 44;
    g.fillStyle = 'rgba(37,37,37,.32)';
    for (var x = -d0; x < RW; x += 44) g.fillRect(x, RGROUND + 9, 16, 3);

    for (var i = 0; i < runCoins.length; i++){
      var co = runCoins[i];
      if (co.got) continue;
      g.beginPath(); g.arc(co.x, co.y, 11, 0, Math.PI * 2);
      g.fillStyle = '#ffd166'; g.fill();
      g.strokeStyle = '#252525'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#252525'; g.font = 'bold 12px ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('字', co.x, co.y + 1);
    }

    for (var k = 0; k < runObstacles.length; k++){
      var o = runObstacles[k];
      if (o.x > RW + 40) continue;                 /* 屏幕外的不画 */
      g.fillStyle = '#3b3b3b';
      g.fillRect(o.x, o.y, o.w, o.h);
      g.strokeStyle = '#252525'; g.lineWidth = 2;
      g.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      g.fillStyle = 'rgba(255,248,232,.42)';
      g.font = 'bold 13px ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(o.ch, o.x + o.w / 2, o.y + o.h / 2);
    }

    /* 墨迹拖尾 + 本体：一团墨、笔尖在前 */
    for (var gi = 0; gi < runGhost.length; gi++){
      var gg = runGhost[gi];
      var a = (gi + 1) / runGhost.length;
      g.globalAlpha = a * 0.14;
      g.beginPath();
      g.ellipse(gg.x - 6, gg.y, 16 * a, 11 * a, 0, 0, Math.PI * 2);
      g.fillStyle = '#252525'; g.fill();
    }
    g.globalAlpha = 1;
    var px = runP.x, py = runP.y;
    var tilt = runP.on ? 0 : Math.max(-0.3, Math.min(0.35, runP.vy / 900));
    g.save();
    g.translate(px + runP.w / 2, py + runP.h / 2);
    g.rotate(tilt);
    g.fillStyle = '#252525';
    g.beginPath();
    g.ellipse(0, 4, 14, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-2, -16); g.lineTo(10, -30); g.lineTo(3, -9);
    g.fill();
    /* 身上一枚小小的"墨"点，让它在深色块上也有细节 */
    g.fillStyle = '#fff8e8';
    g.beginPath(); g.arc(2, 0, 3.2, 0, Math.PI * 2); g.fill();
    g.restore();

    if (runPaused && runRunning){
      g.fillStyle = 'rgba(255,248,232,.88)';
      g.fillRect(0, RH / 2 - 30, RW, 60);
      g.fillStyle = '#252525'; g.font = '900 26px Georgia, serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('暂停 · 点 ▶ 继续', RW / 2, RH / 2);
    }
  }

  /* 固定步长：物理按 120Hz 算，渲染按屏幕刷新率画。
     这样 60Hz 与 144Hz 设备上的跳跃高度完全一致，也不会因为掉一帧就穿墙。 */
  var RSTEP = 1 / 120;
  function runFrame(ts){
    if (!runRunning) return;
    var raw = runLast ? Math.min(120, ts - runLast) : 16;
    runLast = ts;
    if (!runPaused && !runDone && !FX.frozen()){
      runAcc += raw / 1000;
      var guard = 0;
      while (runAcc >= RSTEP && guard++ < 6){ runUpdate(RSTEP); runAcc -= RSTEP; if (runDone) break; }
    }
    runDraw();
    runHud();
    runRaf = requestAnimationFrame(runFrame);
  }

  if (RUN_GO) on(RUN_GO, 'click', runGo);
  if (RUN_PAUSE) on(RUN_PAUSE, 'click', function(){
    if (!runRunning || runDone) return;
    runPaused = !runPaused;
    MHINT.textContent = runPaused ? '已暂停 · 点 ▶ 接着跑' : '接着跑 · 空格跳';
    runHud(); runDraw();
  });
  if (RUN){
    on(RUN, 'pointerdown', function(e){ e.preventDefault(); runJump(); });
    RUN.__probe = function(){
      return {
        dist: Math.round(runDist * 10) / 10, speed: Math.round(runSpeed), chars: runChars,
        score: runScore, best: runBest, combo: runCombo.n,
        y: Math.round(runP.y), vy: Math.round(runP.vy), on: runP.on, jumps: runP.jumps,
        obstacles: runObstacles.map(function(o){ return { x: Math.round(o.x), w: o.w, h: o.h }; }),
        coins: runCoins.filter(function(c){ return !c.got; }).length,
        run: runRunning, paused: runPaused, done: runDone
      };
    };
  }

  /* ================= 11 垒塔 · 时序堆叠 ================= */
  /* 一块砖左右来回晃，点一下（或空格）就落下去。重叠的部分留下、露出来的部分被切掉掉下去；
     完全没重叠就塌了。对准（误差 ≤6px）算"准"：连准会给连击、还会把砖补宽一点。
     难度只有一条：晃得越来越快 —— 没有新规则，压力全在"稳得住"。 */
  var STK = document.getElementById('stackCanvas');
  var STK_START = document.getElementById('stackStart');
  var STK_GO = document.getElementById('stackGo');
  var STK_PAUSE = document.getElementById('stackPause');
  var STK_H = document.getElementById('stackH');
  var STK_BEST = document.getElementById('stackBest');
  var STK_SCORE = document.getElementById('stackScore');
  var STK_COMBO = document.getElementById('stackCombo');
  var STK_V = document.getElementById('stackVerdict');
  var STK_VT = document.getElementById('stackVText');
  var STK_VS = document.getElementById('stackVSeal');
  var STK_PANE = document.getElementById('pane-stack');

  var SW = 480, SH = 600, SGND = 560, SBH = 30, SBASE = 244;
  var stkCtx = null, stkRaf = 0, stkLast = 0;
  var stkRunning = false, stkDone = false, stkPaused = false;
  var stkBlocks = [], stkPhase = 0, stkSpeed = 1.15, stkCam = 0, stkCamT = 0;
  var stkScore = 0, stkBest = 0, stkCombo = 0, stkMaxCombo = 0, stkFall = [], stkFlash = 0, stkFlashX = 0;
  var stkMoving = { x: 130, w: SBASE };

  function stkFit(){
    if (!STK) return;
    fitBox(STK, SW / SH, 540);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = STK.clientWidth || SW;
    STK.width = Math.round(cw * dpr);
    STK.height = Math.round(cw * (SH / SW) * dpr);
    stkCtx = STK.getContext('2d');
    var s = STK.width / SW;
    stkCtx.setTransform(s, 0, 0, s, 0, 0);
  }

  function stkHud(){
    if (STK_H) STK_H.textContent = String(stkBlocks.length - 1);
    if (STK_BEST) STK_BEST.textContent = String(Math.max(stkBest, stkBlocks.length - 1));
    hudSet(STK_SCORE, stkScore);
    FX.combo(STK_COMBO, stkCombo);
    if (STK_PAUSE) STK_PAUSE.textContent = stkPaused ? '▶' : '⏸';
  }

  function stkReset(showOverlay){
    stkBlocks = [{ x: (SW - SBASE) / 2, w: SBASE }];
    stkPhase = 0; stkSpeed = 1.15; stkCam = 0; stkCamT = 0;
    stkScore = 0; stkCombo = 0; stkMaxCombo = 0; stkFall = []; stkFlash = 0;
    stkMoving = { x: (SW - SBASE) / 2, w: SBASE };
    stkRunning = false; stkDone = false; stkPaused = false;
    stkBest = BEST.get('stack.best');
    STK_PANE.classList.remove('is-over');
    STK_V.classList.remove('is-on');
    STK_VS.className = 'verdict-seal';
    STK_VS.textContent = '';
    STK_START.classList.toggle('is-on', !!showOverlay);
    stkHud();
    stkFit();
    stkDraw();
    MHINT.textContent = showOverlay ? '空格 / 点画面落砖 · 按开始' : '空格 / 点画面落砖 · 对准了算"准"';
    if (!showOverlay) stkGo();
  }

  function stkGo(){
    if (!STK) return;
    STK_START.classList.remove('is-on');
    stkRunning = true; stkDone = false; stkPaused = false;
    stkLast = 0;
    if (stkRaf) cancelAnimationFrame(stkRaf);
    stkRaf = requestAnimationFrame(stkFrame);
    syncLoops();
  }

  function stkStop(){
    stkRunning = false;
    if (stkRaf){ cancelAnimationFrame(stkRaf); stkRaf = 0; }
    syncLoops();
  }

  function stkDrop(){
    if (!stkRunning || stkDone || stkPaused) return;
    var top = stkBlocks[stkBlocks.length - 1];
    var mx = stkMoving.x, mw = stkMoving.w;
    var l = Math.max(mx, top.x), r = Math.min(mx + mw, top.x + top.w);
    var w = r - l;
    /* "准"要比的是**中心**，不是左边。砖被切窄之后左边天然对齐、中心已经偏了，
       按左边判会让"看上去明明对上了"却判不准 —— 玩家第一反应是"这游戏赖皮"。
       容差跟着砖宽走：宽砖 16px、窄砖 7px，一直用 6px 会把后半局变成碰运气。 */
    var mcx = mx + mw / 2, tcx = top.x + top.w / 2;
    var tol = Math.max(7, Math.min(16, Math.round(top.w * 0.14)));
    var perfect = Math.abs(mcx - tcx) <= tol;
    if (w <= 0){
      /* 完全错开 = 塌。把这块也丢下去，画面读起来是"塔倒了" */
      stkFall.push({ x: mx, w: mw, y: SGND - stkBlocks.length * SBH, vx: (mx > top.x ? 60 : -60), vy: -60, rot: 0, vr: (mx > top.x ? 3.2 : -3.2), c: '#f4b9b3' });
      stkEnd();
      return;
    }
    if (perfect){
      stkCombo++;
      stkMaxCombo = Math.max(stkMaxCombo, stkCombo);
      w = Math.min(SBASE, top.w + 8);          /* 连准会把砖补回来一点：奖励是"更宽的容错" */
      l = mx + (mw - w) / 2;
      stkFlash = 1; stkFlashX = l + w / 2;
      FX.freeze(40);
    } else {
      if (stkCombo >= 3) FX.pop((l + w / 2) / SW * STK.getBoundingClientRect().width + STK.getBoundingClientRect().left,
        STK.getBoundingClientRect().top + (SH * 0.35), '断', 'is-bad');
      stkCombo = 0;
      /* 露出来的那截掉下去：它就是"切掉的部分"，必须看得见 */
      var cutW = mw - w;
      if (cutW > 4){
        SFX.play('stack.slice', { gain: Math.min(1, 0.5 + cutW / mw) });
        stkFall.push({ x: mx < l ? mx : r, w: cutW, y: SGND - stkBlocks.length * SBH, vx: (mx < l ? -80 : 80), vy: -40, rot: 0, vr: (mx < l ? -4 : 4), c: '#cdc6b8' });
      } else {
        SFX.play('stack.drop', { gain: 0.85 });
      }
    }
    stkBlocks.push({ x: l, w: w });
    stkScore += 90 + (stkBlocks.length - 1) * 8 + stkCombo * 40;
    stkSpeed = 1.15 + Math.min(1.5, (stkBlocks.length - 1) * 0.035);
    stkPhase = (stkMoving.x - (l + w / 2)) / Math.max(60, SW / 2);
    stkMoving = { x: l, w: w };
    stkCamT = Math.max(0, (stkBlocks.length - 7) * SBH);
    var r = STK.getBoundingClientRect();
    var sx = r.width / SW, sy = r.height / SH;
    var contactY = SGND - (stkBlocks.length - 1) * SBH + stkCam;
    FX.sparks({ left: r.left + (l + w / 2) * sx - 10, top: r.top + contactY * sy - 8, width: 20, height: 16 }, perfect ? 6 : 3, '#fff8e8');
    /* 落砖：准的一记清亮"扣"；切歪了是一声木头被削掉的"擦"（切得越多越沉）。
       同一件事只给一声 —— 削与落叠在一起会读成两个动作。 */
    if (perfect) SFX.play('stack.perfect', { rate: 1 + Math.min(0.4, stkCombo * 0.06) });
    if (perfect){
      FX.ring(r.left + (l + w / 2) * sx, r.top + contactY * sy, 6, 42, 2, '#ffd166');
      FX.pop(r.left + (l + w / 2) * sx, r.top + contactY * sy - 12, '准 ×' + stkCombo, 'is-gold');
    }
    FX.shake(STK, perfect ? 3 : 2);
    stkHud();
  }

  function stkUpdate(dt){
    stkPhase += dt * stkSpeed * Math.PI * 2 * 0.42;
    /* 摆幅不能"越窄越远"：砖被切到 30px 时，(480-30)/2 会把整块砖横穿全屏，
       而它只剩 30px 宽 —— 那不是难，是没法瞄准。封在 148 以内（约屏宽三成）。 */
    var amp = Math.max(26, Math.min(148, (SW - stkMoving.w) / 2 - 6));
    stkMoving.x = SW / 2 - stkMoving.w / 2 + Math.sin(stkPhase) * amp * 0.85;
    stkCam += (stkCamT - stkCam) * Math.min(1, dt * 7);
    stkFlash = Math.max(0, stkFlash - dt * 3.2);
    for (var i = stkFall.length - 1; i >= 0; i--){
      var f = stkFall[i];
      f.vy += 1200 * dt;
      f.y += f.vy * dt;
      f.x += f.vx * dt;
      f.rot += f.vr * dt;
      if (f.y > SH + 80) stkFall.splice(i, 1);
    }
  }

  function stkDraw(){
    if (!stkCtx) return;
    var g = stkCtx;
    g.clearRect(0, 0, SW, SH);
    var bgGrad = g.createLinearGradient(0, 0, 0, SH);
    bgGrad.addColorStop(0, '#fbf4e6');
    bgGrad.addColorStop(1, '#f0e6d2');
    g.fillStyle = bgGrad;
    g.fillRect(0, 0, SW, SH);
    /* 背景上的刻度线：塔升多高，看这条线在动就知道（比读数字直观） */
    g.strokeStyle = 'rgba(37,37,37,.12)';
    g.lineWidth = 1;
    for (var y = -(stkCam % SBH); y < SH; y += SBH){
      g.beginPath(); g.moveTo(0, Math.round(y)); g.lineTo(SW, Math.round(y)); g.stroke();
    }
    /* 天上三朵淡云：塔往上长的时候，上方不是"空白格"，是"天" */
    g.strokeStyle = 'rgba(37,37,37,.10)';
    g.lineWidth = 2;
    for (var cl = 0; cl < 3; cl++){
      var cx0 = 90 + cl * 150, cy0 = 90 + (cl % 2) * 46 + (stkCam % 260) * 0.04;
      g.beginPath();
      g.arc(cx0, cy0, 26 + cl * 6, Math.PI * 1.05, Math.PI * 1.95);
      g.arc(cx0 + 34, cy0 - 6, 20, Math.PI * 1.1, Math.PI * 2);
      g.stroke();
    }
    /* 左侧标尺：每 5 层一道，写上层号。塔升起后上方大片空白才有"高度"的含义 ——
       没有标尺，那只是一块空画布。 */
    var pil = SGND + stkCam;
    for (var lb = 0; lb < 60; lb++){
      var ly = pil - lb * SBH;
      if (ly < 0 || ly > SH + 20) continue;
      var big = lb % 5 === 0 && lb > 0;
      g.fillStyle = big ? 'rgba(37,37,37,.34)' : 'rgba(37,37,37,.14)';
      g.fillRect(SW - (big ? 26 : 14), Math.round(ly) - 1, big ? 20 : 8, big ? 2 : 1.5);
      if (big){
        g.fillStyle = 'rgba(37,37,37,.32)';
        g.font = '9px ui-monospace, Menlo, monospace';
        g.textAlign = 'right'; g.textBaseline = 'middle';
        g.fillText(String(lb), SW - 30, Math.round(ly));
      }
    }
    /* 地面那条墨线：塔"长在地上"，不是浮在纸中间 */
    g.fillStyle = '#252525';
    g.fillRect(0, SGND + stkCam + SBH, SW, 3);

    /* 只画看得见的十几层：塔再高也不该整座重绘 */
    var from = Math.max(0, stkBlocks.length - 16);
    for (var i = from; i < stkBlocks.length; i++){
      var b = stkBlocks[i];
      var by = SGND - i * SBH + stkCam;
      stkBlock(g, b.x, by, b.w, SBH, i % 2 ? '#fff8e8' : '#f7efdd', i === 0);
    }
    /* 正在晃的那块：在塔顶上面一层。给一层硬偏移的影子，它才"浮在塔上"而不是长在塔里 */
    var my = SGND - stkBlocks.length * SBH + stkCam;
    g.fillStyle = 'rgba(37,37,37,.14)';
    g.fillRect(stkMoving.x + 5, my + 5, stkMoving.w, SBH);
    stkBlock(g, stkMoving.x, my, stkMoving.w, SBH, '#ffd166', false);

    for (var k = 0; k < stkFall.length; k++){
      var f = stkFall[k];
      g.save();
      g.translate(f.x + f.w / 2, f.y);
      g.rotate(f.rot);
      g.fillStyle = f.c;
      g.fillRect(-f.w / 2, 0, f.w, SBH);
      g.strokeStyle = '#252525'; g.lineWidth = 2;
      g.strokeRect(-f.w / 2 + 1, 1, f.w - 2, SBH - 2);
      g.restore();
    }

    if (stkFlash > 0){
      g.globalAlpha = stkFlash;
      g.strokeStyle = '#ffd166'; g.lineWidth = 4;
      g.beginPath(); g.arc(stkFlashX, SGND - (stkBlocks.length - 1) * SBH + stkCam, 22 + (1 - stkFlash) * 24, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }

    if (stkPaused && stkRunning){
      g.fillStyle = 'rgba(255,248,232,.88)';
      g.fillRect(0, SH / 2 - 30, SW, 60);
      g.fillStyle = '#252525'; g.font = '900 26px var(--font-heavy, Georgia, serif)';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('暂停 · 点 ▶ 继续', SW / 2, SH / 2);
    }
  }

  function stkBlock(g, x, y, w, h, fill, base){
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#252525';
    g.lineWidth = 3;
    g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.fillStyle = 'rgba(37,37,37,.5)';
    g.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    if (w > 46) g.fillText(base ? '础' : String(Math.round((SGND - y) / SBH) + 1), x + 7, y + h / 2);
  }

  function stkEnd(){
    stkDone = true;
    stkRunning = false;
    if (stkRaf){ cancelAnimationFrame(stkRaf); stkRaf = 0; }
    var hN = stkBlocks.length - 1;
    var prevBest = Math.max(stkBest, BEST.get('stack.best'));
    var isBest = hN > prevBest;
    BEST.set('stack.best', hN);
    var r = STK.getBoundingClientRect();
    FX.burst({ left: r.left + r.width * 0.2, top: r.top + r.height * 0.55, width: r.width * 0.6, height: r.height * 0.3 },
      { count: 30, dust: 16, power: 520, size: 10, colors: ['#cdc6b8', '#252525', '#fff8e8'], ringColor: '#f28b82' });
    FX.shake(STK, 7);
    FX.freeze(100);
    STK_PANE.classList.add('is-over');
    showVerdict(STK_V, STK_VT, STK_VS, 'v-bad',
      '垒到 ' + hN + ' 层 · ' + stkScore + ' 分' + (isBest ? ' · 新纪录' : '') + ' · 最多 ' + stkMaxCombo + ' 准', '散');
    MHINT.textContent = '塌了 · 对准了砖会变宽，连准有连击';
    stkHud();
    syncLoops();
  }

  function stkFrame(ts){
    if (!stkRunning) return;
    var dt = stkLast ? Math.min(0.05, (ts - stkLast) / 1000) : 0.016;
    stkLast = ts;
    if (!stkPaused && !stkDone && !FX.frozen()) stkUpdate(dt);
    stkDraw();
    stkRaf = requestAnimationFrame(stkFrame);
  }

  if (STK_GO) on(STK_GO, 'click', stkGo);
  if (STK_PAUSE) on(STK_PAUSE, 'click', function(){
    if (!stkRunning || stkDone) return;
    stkPaused = !stkPaused;
    MHINT.textContent = stkPaused ? '已暂停 · 点 ▶ 接着垒' : '接着垒 · 空格落砖';
    stkHud(); stkDraw();
  });
  if (STK){
    on(STK, 'pointerdown', function(e){ e.preventDefault(); stkDrop(); });
    STK.__probe = function(){
      return {
        h: stkBlocks.length - 1, score: stkScore, best: stkBest, combo: stkCombo,
        moving: { x: Math.round(stkMoving.x), w: Math.round(stkMoving.w) },
        top: { x: Math.round(stkBlocks[stkBlocks.length - 1].x), w: Math.round(stkBlocks[stkBlocks.length - 1].w) },
        cam: Math.round(stkCam), run: stkRunning, paused: stkPaused, done: stkDone
      };
    };
  }

  /* 空格：跑酷跳、垒塔落。只在对应弹层里吃键，别抢别处的输入 */
  on(window, 'keydown', function(e){
    if (e.key !== ' ' && e.key !== 'Spacebar' && e.key !== 'ArrowUp' && e.key !== 'w' && e.key !== 'W') return;
    if (current === 'run'){ e.preventDefault(); runJump(); }
    else if (current === 'stack'){ e.preventDefault(); stkDrop(); }
  });

  /* 三个画布循环的名字：性能探针要知道"现在有几个动画在跑"，关掉弹层之后必须是空数组 */
  function syncLoops(){
    var a = [];
    if (bkRaf) a.push('break');
    if (runRaf) a.push('run');
    if (stkRaf) a.push('stack');
    window.__loops = a;
  }

  var MODAL = document.getElementById('modal');
  var PANES = {
    paper: document.getElementById('pane-paper'),
    focus: document.getElementById('pane-focus'),
    pile: document.getElementById('pane-pile'),
    word: document.getElementById('pane-word'),
    brick: document.getElementById('pane-brick'),
    break: document.getElementById('pane-break'),
    onet: document.getElementById('pane-onet'),
    merge: document.getElementById('pane-merge'),
    tap: document.getElementById('pane-tap'),
    run: document.getElementById('pane-run'),
    stack: document.getElementById('pane-stack'),
    rogue: document.getElementById('pane-rogue')
  };
  var INFO = {
    paper: { no:'09', name:'稿纸', tag:'A4 · 竖排', hint:'点纸就写，回车换列', idx:'09 / 12' },
    focus: { no:'10', name:'专注', tag:'逐行 · 一次一句', hint:'点一行就写，回车换行', idx:'10 / 12' },
    pile: { no:'03', name:'写了个写', tag:'五关 · 三张一消 · 连击', hint:'点没被压住的牌 · 同字三张不一定同层', idx:'03 / 12' },
    word: { no:'11', name:'抽词', tag:'翻卡 · 三档成双 · 星级', hint:'选个难度 · 按开始', idx:'11 / 12' },
    brick: { no:'06', name:'砖块', tag:'八格 · 填满一行就消 · 连击', hint:'点一块砖，再点盘上落下去', idx:'06 / 12' },
    break: { no:'05', name:'破砖', tag:'七关 · 板子接球 · 宽板', hint:'拖动板子接球 · 点一下发球（接球的位置决定角度）', idx:'05 / 12' },
    onet: { no:'04', name:'连字', tag:'三关 · 两拐之内 · 提示', hint:'点两张相同的字 · 两拐之内能连通才收走 · 每关两次洗牌两次提示', idx:'04 / 12' },
    merge: { no:'08', name:'叠山', tag:'一粒尘，垒到天 · 回退', hint:'方向键 / WASD 或滑动 · 同字相撞长一级', idx:'08 / 12' },
    tap: { no:'12', name:'敲印', tag:'反应 · 三段加速 · 墨印陷阱', hint:'点掉冒出来的印 · 墨印别点', idx:'12 / 12' },
    run: { no:'02', name:'走墨', tag:'无尽跑 · 二段跳', hint:'空格 / 点画面跳 · 二段跳补一次', idx:'02 / 12' },
    stack: { no:'07', name:'垒塔', tag:'时序堆叠 · 对准算「准」', hint:'空格 / 点画面落砖 · 对准了算「准」', idx:'07 / 12' },
    rogue: { no:'01', name:'墨潮', tag:'无尽 · 肉鸽 · 自动出手', hint:'WASD / 拖动走位 · 空格 / 冲键冲刺 · P 暂停 · 武器自动出手', idx:'01 / 12' }
  };
  var MNO = document.getElementById('mNo');
  var MNAME = document.getElementById('mName');
  var MTAG = document.getElementById('mTag');
  var MHINT = document.getElementById('mHint');
  var MCOUNT = document.getElementById('mCount');
  var MREPLAY = document.getElementById('mReplay');
  var MSEAL = document.getElementById('mSeal');
  var MCLEAR = document.getElementById('mClear');
  var current = null;
  /* 墨潮自建 DOM 与状态机，这里只拿一个句柄 */
  var ROGUE = mountRogue(document.getElementById('rogueRoot'));

  function mReplayLabel(text){
    var s = MREPLAY && MREPLAY.querySelector('span');
    if (s) s.textContent = text;
  }

  function startGame(name){
    stopTyping(); stopFocus();
    bkStop(); runStop(); stkStop();
    /* 音色按机器切：同一个"取一张牌"，01 是笔尖、03 是瓷片、09 是木鱼。
       切晚了会让开机的第一声还是上一台的音色。 */
    SFX.setGame(name);
    if (name === 'paper') playQuote();
    if (name === 'focus') playFocus();
    if (name === 'pile') startPile();
    if (name === 'word') startPair();
    if (name === 'brick') startBrick();
    if (name === 'break') bkStart();
    if (name === 'onet') onetStart();
    if (name === 'merge') mgReset();
    if (name === 'tap') tapStartRun(true);
    if (name === 'run') runReset(true);
    if (name === 'stack') stkReset(true);
    if (name === 'rogue' && ROGUE) ROGUE.open();
  }
  function openGame(name){
    if (!PANES[name]) return;
    current = name;
    var info = INFO[name];
    MNO.textContent = info.no;
    MNAME.textContent = info.name;
    MTAG.textContent = info.tag;
    MHINT.textContent = info.hint;
    MCOUNT.textContent = info.idx;
    mReplayLabel('再来一次');
    MSEAL.style.display = name === 'paper' ? '' : 'none';
    MCLEAR.style.display = (name === 'paper' || name === 'focus') ? '' : 'none';
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
    later(function(){ refitAll(); }, 30);
    later(function(){ refitAll(); }, 300);
    if (name === 'paper' && FINEPOINTER){
      setTimeout(function(){ try { INPUT.focus({ preventScroll: true }); } catch(e){} }, 260);
    }
  }

  function closeMachine(){
    MODAL.classList.remove('is-on');
    MODAL.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-playing');
    stopTyping(); stopFocus();
    bkStop(); runStop(); stkStop();
    tapStop();
    if (ROGUE) ROGUE.close();
    /* 关掉弹层就把粒子一起收掉：不收的话，离场那几百片碎屑会在看不见的地方继续算 1 秒 */
    FX.stop();
    SFX.stop();
    while (timeouts.length) clearTimeout(timeouts.pop());
    current = null;
    document.body.classList.remove('is-leaving');
    try { INPUT.blur(); } catch(e){}
    try { FOCUS_IN.blur(); } catch(e){}
  }

  /* 横屏不再有"切换"这件事（见 hall.css 的"横屏 = 整块屏幕"）：
     没有按钮、没有全屏申请、没有方向锁 —— 手机横过来，版面自己变成整块屏幕；
     竖回去，自动回到"上读数、下按键"。
     这里只做一件必要的事：转屏之后重新算台面尺寸。
     iOS 的 orientationchange 比真正的布局重排早一步，所以补两次延迟重算。 */
  var onTurn = function(){
    refitAll();
    later(function(){ refitAll(); }, 160);
    later(function(){ refitAll(); }, 420);
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
  on(document.getElementById('mReplay'), 'click', function(){
    if (!current) return;
    if (current === 'pile'){ if (pWin) nextPile(); else retryPile(); return; }
    if (current === 'break'){ if (bkWin) bkNext(); else bkStage(); return; }
    if (current === 'onet'){ if (oWin && oLv < ONET_LV.length - 1) onetNext(); else onetLevel(oLv); refitAll(); return; }
    if (current === 'merge'){ mgReset(); refitAll(); return; }
    if (current === 'tap'){ tapStartRun(false); refitAll(); return; }
    if (current === 'run'){ runReset(false); refitAll(); return; }
    if (current === 'stack'){ stkReset(false); refitAll(); return; }
    if (current === 'rogue'){ if (ROGUE) ROGUE.replay(); return; }
    startGame(current);
  });

  /* 落印：写够了就按一下，纸歪一下、朱印落上去 */
  on(document.getElementById('mSeal'), 'click', function(){
    if (current === 'paper' && chars.length && !sealed){
      stopTyping();
      manual = true;
      sealNow();
    }
  });

  /* 清空：清完之后就是一张白纸，直接自己写 */
  on(document.getElementById('mClear'), 'click', function(){
    if (current === 'paper'){
      clearSheet();
      manual = true;
      SOURCE.style.opacity = '0';
      try { INPUT.focus({ preventScroll: true }); } catch(e){}
    } else if (current === 'focus'){
      focusStartManual();
      try { FOCUS_IN.focus({ preventScroll: true }); } catch(e){}
    }
  });

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
      if (chars.length){
        chars.pop();
        var snap = chars.slice();
        COLSEL.innerHTML = ''; cols.length = 0; chars = []; lines = [''];
        for (var i = 0; i < snap.length; i++) pushChar(snap[i], false);
        readout();
      }
    }
  }
  on(INPUT, 'keydown', onKey);

  // 稿纸本身：点一下就自己写（打过的会自动清成白纸）
  on(SHEET, 'click', function(e){
    e.stopPropagation();
    if (sealed){ clearSheet(); manual = true; SOURCE.style.opacity = '0'; }
    try { INPUT.focus({ preventScroll: true }); } catch(err){}
  });

  /* ================= 专注：自己写（同样兼容组词） ================= */
  var FOCUS_IN = document.getElementById('focusIn');
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

  // 键盘：Esc 关掉机台
  on(document, 'keydown', function(e){
    if (e.key === 'Escape' && MODAL.classList.contains('is-on')){
      if (current === 'rogue' && ROGUE && ROGUE.escape()) return;
      closeMachine();
    }
  });
  return function cleanup() {
    ac.abort();
    if (ROGUE && ROGUE.game) ROGUE.game.destroy();
    bkStop();
    FX.stop();
    if (FX.canvas && FX.canvas.parentNode) FX.canvas.parentNode.removeChild(FX.canvas);
    while (timeouts.length) clearTimeout(timeouts.pop());
    if (typeof typingTimer !== 'undefined' && typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    if (typeof focusTimer !== 'undefined' && focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  };
}




