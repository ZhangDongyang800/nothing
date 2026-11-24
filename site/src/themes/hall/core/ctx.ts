/* 机台共用上下文：生命周期收口（AbortController / timeouts）、FX/SFX 持有、
   全台共用的小工具（连击 / 飘分 / 判词 / 洗牌 / 主题字库 / 最佳成绩 / 尺寸适配）。
   各台游戏模块只通过这个 ctx 拿共享能力，不直接挂全局。
   沿用工程现状：关闭类型检查，交互以站点实际表现为准。 */
// @ts-nocheck
import { createFx } from '../fx';
import { createSfx } from '../sfx';

export function createCtx() {
  const ac = new AbortController();
  const timeouts = [];

  /* 统一接线：所有监听走同一个 AbortController，卸载时同批清掉 */
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });

  /* 特效层：全屏粒子画布 + 飘分层，实现见 fx.ts */
  const FX = createFx(ac.signal);
  window.__FX = FX;
  /* 音效层：零资源（WebAudio 现算），一台机器一套音色，实现见 sfx.ts */
  const SFX = createSfx();
  window.__SFX = SFX;
  ac.signal.addEventListener('abort', function(){ SFX.stop(); });
  /* 浏览器的自动播放策略：AudioContext 必须在一次真实手势里创建。
     挂在 document 上（只做一次 unlock，重复调用也只是 resume 一下），不拦任何点击。 */
  ['pointerdown', 'keydown', 'touchstart'].forEach(function(ev){
    document.addEventListener(ev, function(){ SFX.unlock(); }, { passive: true });
  });

  /* 触屏方向键的通用接线：按下即触发一次，按住则连发。
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

  /* ================= 字库：成套的字，不是随机单字 ================= */
  /* 每局先选一套**词**，牌面上的字都从这套词里拆出来 —— 收走一对就是拼回一个名字，
     吃掉两个字就是写完一个词。 */
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
  /* 一个字只有一个字，读起来还是"报字"。给每个字配一枚 10px 的象形记号。
     记号按**字义**归类，不按主题；只画线、只用一个颜色。 */
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
    /* 判词落下就是这一局的结论：十一台共用这一条路，收场音只写在这里。
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
     连击只在"两次成功之间不超过 win 毫秒"时续上，超过就断；
     乘区就是连击本身（2 连 = ×2，封顶 max）；飘分落在**发生地**。 */
  function comboState(winMs, max){
    return { n: 0, t: -1e9, win: winMs, max: max || 8 };
  }
  function comboAdd(st){
    return comboBump(st, 1);
  }
  /* 一次加多格连击（一手消两条线就 +2） */
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

  /* 按句读断列：一句一列，太碎的小句并到前一句（稿纸 / 专注共用） */
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

  /* 舞台尺寸通用：量父容器、按比例取最大 */
  function fitBox(el, ratio, maxW){
    if (!el || !el.parentElement) return;
    var host = el.parentElement;
    var aw = host.clientWidth, ah = host.clientHeight;
    if (aw < 80 || ah < 80) return;
    var w = Math.min(aw, ah * ratio, maxW || 1e9);
    el.style.width = Math.floor(w) + 'px';
  }

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

  var FINEPOINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- 机台外壳共享 DOM（引擎路由与各台都会读） ---------- */
  var MODAL = document.getElementById('modal');
  var PANES = {
    paper: document.getElementById('pane-paper'),
    word: document.getElementById('pane-word'),
    brick: document.getElementById('pane-brick'),
    break: document.getElementById('pane-break'),
    merge: document.getElementById('pane-merge'),
    tap: document.getElementById('pane-tap'),
    run: document.getElementById('pane-run'),
    stack: document.getElementById('pane-stack'),
    rogue: document.getElementById('pane-rogue'),
    legion: document.getElementById('pane-legion')
  };
  var MNO = document.getElementById('mNo');
  var MNAME = document.getElementById('mName');
  var MTAG = document.getElementById('mTag');
  var MHINT = document.getElementById('mHint');
  var MCOUNT = document.getElementById('mCount');
  var MREPLAY = document.getElementById('mReplay');
  var MSEAL = document.getElementById('mSeal');
  var MCLEAR = document.getElementById('mClear');
  var INPUT = document.getElementById('typeIn');

  /* 页脚"再来一次"按钮文案：各台边玩边改写 */
  function mReplayLabel(text){
    var s = MREPLAY && MREPLAY.querySelector('span');
    if (s) s.textContent = text;
  }

  const ctx = {
    /* 生命周期 */
    ac, timeouts, on, bindPad, later,
    /* 持有 */
    FX, SFX,
    /* 主题 / 字库 / 素材 */
    WORDS, themeOf, themeChars, themeWordChars, markTheme,
    CHAR_FAMILY, iconOf, markIcon,
    POEMS, pickPoem, COLS, ROWS,
    /* 公共小工具 */
    comboState, comboAdd, comboBump, comboBreak, comboMult,
    popAt, hudSet, fmtStars, shuffle, splitLines, showVerdict, fitBox, BEST,
    /* 环境 */
    FINEPOINTER,
    /* 外壳 DOM */
    MODAL, PANES, MNO, MNAME, MTAG, MHINT, MCOUNT, MREPLAY, MSEAL, MCLEAR,
    INPUT, mReplayLabel,
    /* 当前开机台（引擎写、各台读，做按键闸门） */
    current: null,
    /* 动画循环计数：引擎实现后回填，各台开/停循环时调用 */
    syncLoops: function(){}
  };
  return ctx;
}
