/* 机台厅的音效层。
 *
 * 为什么是"现算的合成音"而不是 mp3：
 * 这台厅的资源口径一直是"dist 里只有 js 与 css，没有字体、没有图片"（见 README「资源口径」），
 * 一旦塞进 11 台机器的音效包，包体与首屏都会多出一截，而且每台机器只在被点开的那几秒需要它。
 * WebAudio 用振荡器 + 一段一次性生成的噪声音频，**零资源、零请求**，代价是每个声音要写清楚"它是什么做的"。
 *
 * 三件必须成立的事：
 * 1. 不自动播：AudioContext 在第一次 pointerdown / keydown 里才创建（移动端与 Chrome 的 autoplay 策略）。
 * 2. 一台机器一套音色：同一声"消掉"在 03 是瓷片、在 05 是木块、在 08 是石头 —— 用 `${game}.${event}` 查表，
 *    查不到才退回通用名。换台机器只要 `setGame()`，不用给每个调用点传上下文。
 * 3. 连击不能炸耳朵：130ms 内超过 12 个声音就丢弃，音量走一个总 gain，静音开关落 localStorage。
 */

export type SfxApi = {
  play: (name: string, opt?: { rate?: number; gain?: number; pan?: number }) => void;
  fanfare: (win: boolean) => void;
  setGame: (id: string) => void;
  setMuted: (m: boolean) => void;
  toggle: () => boolean;
  isMuted: () => boolean;
  unlock: () => void;
  perf: () => { ctx: string; plays: number; dropped: number; voices: number; game: string };
  stop: () => void;
};

type V = {
  w?: 'sine' | 'tri' | 'sqr' | 'saw' | 'noise';
  f?: number;
  f2?: number;
  d?: number;   // 时长 ms
  g?: number;   // 峰值增益
  at?: number;  // attack ms
  lp?: number;  // 噪声低通（Hz）
  hp?: number;  // 噪声高通（Hz）
  q?: number;
  pan?: number;
  t?: number;   // 相对延迟 ms
};

/* ---------------- 音色表 ---------------- */
const BANK: Record<string, V[]> = {
  /* 共用：外壳 */
  'ui.open': [{ w: 'noise', hp: 520, lp: 3200, d: 190, g: 0.12 }, { w: 'sine', f: 210, f2: 150, d: 170, g: 0.07 }],
  'ui.close': [{ w: 'noise', lp: 1300, d: 150, g: 0.1 }, { w: 'sine', f: 300, f2: 190, d: 170, g: 0.05 }],
  'ui.click': [{ w: 'sqr', f: 600, f2: 700, d: 42, g: 0.07 }],

  /* 01 稿纸：纸与木 —— 落字是极轻的一下笔尖，收稿是一枚实印 */
  'paper.type': [{ w: 'noise', hp: 1500, lp: 4600, d: 22, g: 0.05 }],
  'paper.line': [{ w: 'tri', f: 720, f2: 810, d: 140, g: 0.06 }],
  'paper.seal': [{ w: 'noise', lp: 900, hp: 110, d: 230, g: 0.22 }, { w: 'sine', f: 92, f2: 58, d: 300, g: 0.13 }],

  /* 02 专注：一口低钟，一行一声，末尾一声更长 */
  'focus.type': [{ w: 'noise', hp: 1300, lp: 3800, d: 18, g: 0.035 }],
  'focus.line': [{ w: 'sine', f: 470, f2: 500, d: 300, g: 0.07 }],
  'focus.end': [{ w: 'sine', f: 392, d: 460, g: 0.09 }, { w: 'sine', f: 588, t: 40, d: 520, g: 0.06 }],

  /* 03 写了个写：硬瓷片。取牌是一记短脆，凑成是三片叠响 */
  'pile.pick': [{ w: 'sqr', f: 700, f2: 880, d: 55, g: 0.09 }],
  'pile.match': [
    { w: 'tri', f: 660, d: 190, g: 0.1 },
    { w: 'tri', f: 990, t: 60, d: 230, g: 0.09 },
    { w: 'noise', hp: 2200, lp: 6200, d: 80, g: 0.08 }
  ],
  'pile.key': [{ w: 'sine', f: 1180, f2: 1560, d: 150, g: 0.1 }, { w: 'tri', f: 480, t: 30, d: 200, g: 0.05 }],
  'pile.bad': [{ w: 'saw', f: 230, f2: 150, d: 190, g: 0.09 }],

  /* 04 抽词：纸牌。翻牌是纸擦过，成对是一声轻铃 */
  'pair.flip': [{ w: 'noise', hp: 820, lp: 4600, d: 80, g: 0.09 }],
  'pair.match': [{ w: 'sine', f: 700, d: 180, g: 0.09 }, { w: 'sine', f: 1050, t: 90, d: 250, g: 0.08 }],
  'pair.miss': [{ w: 'noise', lp: 640, d: 150, g: 0.09 }, { w: 'sine', f: 180, f2: 160, d: 130, g: 0.05 }],
  'pair.peek': [{ w: 'noise', hp: 3200, d: 400, g: 0.05 }, { w: 'sine', f: 1400, d: 300, g: 0.04 }],

  /* 05 砖块：木块落下、消行是一道往上刮 */
  'brick.place': [{ w: 'sine', f: 190, f2: 118, d: 90, g: 0.14 }, { w: 'noise', lp: 720, d: 45, g: 0.07 }],
  'brick.clear': [{ w: 'saw', f: 300, f2: 540, d: 180, g: 0.09 }, { w: 'noise', hp: 900, lp: 4200, d: 200, g: 0.07 }],
  'brick.combo': [{ w: 'tri', f: 900, d: 190, g: 0.1 }, { w: 'tri', f: 1200, t: 70, d: 220, g: 0.08 }],
  'brick.full': [{ w: 'tri', f: 520, d: 300, g: 0.1 }, { w: 'tri', f: 780, t: 90, d: 340, g: 0.08 }, { w: 'tri', f: 1040, t: 180, d: 380, g: 0.06 }],
  'brick.bad': [{ w: 'sqr', f: 200, f2: 120, d: 200, g: 0.1 }],

  /* 06 破砖：电子乒乓 —— 发球、接板、擦砖、打穿，四种不同高度的短脉冲 */
  'break.fire': [{ w: 'sqr', f: 900, f2: 520, d: 90, g: 0.11 }, { w: 'noise', hp: 2200, d: 60, g: 0.05 }],
  'break.pad': [{ w: 'sqr', f: 420, f2: 460, d: 52, g: 0.09 }],
  'break.hit': [{ w: 'sqr', f: 800, f2: 660, d: 38, g: 0.07 }],
  'break.smash': [{ w: 'noise', lp: 1900, hp: 300, d: 120, g: 0.15 }, { w: 'tri', f: 620, f2: 300, d: 130, g: 0.08 }],
  'break.stone': [{ w: 'noise', lp: 1200, d: 200, g: 0.18 }, { w: 'sine', f: 130, f2: 70, d: 260, g: 0.14 }],
  'break.item': [{ w: 'tri', f: 880, f2: 1280, d: 180, g: 0.1 }],

  /* 07 连字：铃。收一对是两响，收齐一个词多一响更高的 */
  'onet.pick': [{ w: 'tri', f: 640, d: 110, g: 0.07 }],
  'onet.link': [{ w: 'sine', f: 880, d: 250, g: 0.1 }, { w: 'sine', f: 1320, t: 80, d: 300, g: 0.07 }],
  'onet.word': [{ w: 'sine', f: 1320, d: 260, g: 0.09 }, { w: 'tri', f: 1760, t: 60, d: 300, g: 0.06 }],
  'onet.hint': [{ w: 'noise', hp: 2800, d: 220, g: 0.05 }, { w: 'tri', f: 1000, d: 200, g: 0.05 }],

  /* 08 叠山：石。越往上越闷、越沉，合并的响度靠 rate 抬 */
  'merge.move': [{ w: 'noise', lp: 520, d: 90, g: 0.07 }],
  'merge.hit': [{ w: 'sine', f: 180, f2: 120, d: 170, g: 0.13 }, { w: 'noise', lp: 900, hp: 200, d: 90, g: 0.1 }],
  'merge.big': [{ w: 'sine', f: 108, f2: 74, d: 320, g: 0.16 }, { w: 'noise', lp: 700, d: 220, g: 0.1 }],
  'merge.bad': [{ w: 'noise', lp: 420, d: 240, g: 0.1 }],

  /* 09 敲印：木鱼。点中一记短木响，点错是更低的一声 */
  'tap.hit': [{ w: 'noise', lp: 1500, hp: 200, d: 44, g: 0.16 }, { w: 'sine', f: 640, f2: 520, d: 60, g: 0.08 }],
  'tap.gold': [{ w: 'tri', f: 1100, f2: 1300, d: 170, g: 0.1 }],
  'tap.bad': [{ w: 'sqr', f: 180, f2: 130, d: 220, g: 0.12 }],
  'tap.up': [{ w: 'tri', f: 900, f2: 1350, d: 260, g: 0.1 }],

  /* 10 走墨：风与水。跳是风、吃字是清脆的两响、撞上是闷的一记 */
  'run.jump': [{ w: 'noise', hp: 1900, d: 130, g: 0.08 }, { w: 'tri', f: 470, f2: 700, d: 120, g: 0.06 }],
  'run.coin': [{ w: 'sine', f: 1040, d: 90, g: 0.1 }, { w: 'sine', f: 1400, t: 60, d: 130, g: 0.08 }],
  'run.dead': [{ w: 'noise', lp: 800, d: 320, g: 0.16 }, { w: 'sine', f: 190, f2: 68, d: 430, g: 0.15 }],

  /* 11 垒塔：塔。落砖是一记厚木，切歪是一道擦边 */
  'stack.drop': [{ w: 'sine', f: 150, f2: 108, d: 140, g: 0.15 }, { w: 'noise', lp: 600, d: 70, g: 0.08 }],
  'stack.perfect': [{ w: 'tri', f: 880, d: 220, g: 0.1 }, { w: 'tri', f: 1320, t: 90, d: 260, g: 0.08 }],
  'stack.slice': [{ w: 'noise', hp: 1200, lp: 6000, d: 160, g: 0.13 }],
  'stack.fail': [{ w: 'noise', lp: 500, d: 320, g: 0.14 }, { w: 'sine', f: 120, f2: 58, d: 420, g: 0.16 }]
};

/* 每台机器的收场根音：赢了在这个音上搭一个三和弦，输了往下滑。
   同一段"赢"的旋律在十一台机器上是十一种高度 —— 这才是"各自游戏的音效"。 */
const WIN_BASE: Record<string, number> = {
  paper: 523, focus: 392, pile: 659, word: 587, brick: 494, break: 698,
  onet: 784, merge: 330, tap: 622, run: 554, stack: 466
};

const NAMES = ['sine', 'triangle', 'square', 'sawtooth'] as const;

export function createSfx(): SfxApi {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let game = '';
  let muted = false;
  let plays = 0;
  let dropped = 0;
  let live = 0;
  let recent: number[] = [];

  try {
    muted = localStorage.getItem('txxt.hall.muted') === '1';
  } catch (e) { /* 隐私模式下没有 localStorage，按"有声"处理 */ }

  function ensure(): boolean {
    if (ac) return true;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return false;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch (e) {
      return false;
    }
    const m = ctx.createGain();
    m.gain.value = 0.62;
    m.connect(ctx.destination);
    /* 噪声只用一段 0.6s 的白噪，后面靠滤波与包络塑形 —— 比每声 new Buffer 便宜得多 */
    const n = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    ac = ctx; master = m; noise = buf;
    return true;
  }

  function unlock() {
    if (muted) return;
    if (!ensure() || !ac) return;
    if (ac.state === 'suspended') ac.resume().catch(function () { /* 忽略 */ });
  }

  function play(name: string, opt?: { rate?: number; gain?: number; pan?: number }) {
    if (muted) return;
    const spec = BANK[game + '.' + name] || BANK[name];
    if (!spec) return;
    if (!ensure() || !ac || !master || !noise) return;
    if (ac.state === 'suspended') ac.resume().catch(function () { /* 忽略 */ });

    const now = ac.currentTime;
    /* 连击限流：130ms 内超过 12 声就把后面的丢掉。05 一次三消、09 连击高段都能撞上这条 */
    recent = recent.filter(function (t) { return now - t < 0.13; });
    if (recent.length >= 12) { dropped++; return; }
    recent.push(now);

    const rate = opt && opt.rate ? opt.rate : 1;
    const extra = opt && opt.gain ? opt.gain : 1;
    plays++;

    for (let i = 0; i < spec.length; i++){
      const v = spec[i];
      const at = now + (v.t || 0) / 1000;
      const dur = (v.d || 120) / 1000;
      const gain = (v.g || 0.1) * extra;
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + (v.at || 4) / 1000);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

      let node: AudioNode;
      if (v.w === 'noise'){
        const src = ac.createBufferSource();
        src.buffer = noise;
        src.playbackRate.value = rate;
        let out: AudioNode = src;
        if (v.lp){
          const f = ac.createBiquadFilter();
          f.type = 'lowpass'; f.frequency.value = v.lp; f.Q.value = v.q || 0.7;
          out.connect(f); out = f;
        }
        if (v.hp){
          const f = ac.createBiquadFilter();
          f.type = 'highpass'; f.frequency.value = v.hp; f.Q.value = v.q || 0.7;
          out.connect(f); out = f;
        }
        node = out;
        src.start(at); src.stop(at + dur + 0.02);
      } else {
        const osc = ac.createOscillator();
        const idx = NAMES.indexOf((v.w || 'sine') as any);
        osc.type = idx >= 0 ? NAMES[idx] : 'sine';
        const f0 = (v.f || 440) * rate;
        osc.frequency.setValueAtTime(f0, at);
        if (v.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.f2 * rate), at + dur);
        node = osc;
        osc.start(at); osc.stop(at + dur + 0.02);
      }

      if (v.pan && 'createStereoPanner' in ac){
        const p = ac.createStereoPanner();
        p.pan.value = v.pan;
        node.connect(p); p.connect(env);
      } else {
        node.connect(env);
      }
      env.connect(master);

      live++;
      /* AudioNode 的类型里没有 "ended"，但振荡器与 BufferSource 都确实会发 —— 这里只用来数在飞的音数 */
      (node as any).addEventListener('ended', function () { live = Math.max(0, live - 1); });
    }
  }

  /* 赢：按这台机器的根音搭三个音，两声敲门式的推进；输：整条往下滑 */
  function fanfare(win: boolean) {
    const base = WIN_BASE[game] || 523;
    const spec: V[] = win
      ? [
          { w: 'tri', f: base, d: 260, g: 0.11 },
          { w: 'tri', f: base * 1.25, t: 110, d: 300, g: 0.1 },
          { w: 'tri', f: base * 1.5, t: 230, d: 360, g: 0.09 },
          { w: 'noise', hp: 2600, lp: 7000, t: 240, d: 320, g: 0.05 }
        ]
      : [
          { w: 'sine', f: base * 0.62, f2: base * 0.36, d: 380, g: 0.12 },
          { w: 'noise', lp: 700, t: 40, d: 300, g: 0.07 }
        ];
    if (muted) return;
    if (!ensure() || !ac || !master || !noise) return;
    if (ac.state === 'suspended') ac.resume().catch(function () { /* 忽略 */ });
    const now = ac.currentTime;
    plays++;
    for (let i = 0; i < spec.length; i++){
      const v = spec[i];
      const at = now + (v.t || 0) / 1000;
      const dur = (v.d || 200) / 1000;
      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, v.g || 0.1), at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      let node: AudioNode;
      if (v.w === 'noise'){
        const src = ac.createBufferSource(); src.buffer = noise;
        const f = ac.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = v.hp || 1000;
        const g2 = ac.createBiquadFilter();
        g2.type = 'lowpass'; g2.frequency.value = v.lp || 6000;
        src.connect(f); f.connect(g2); node = g2;
        src.start(at); src.stop(at + dur + 0.02);
      } else {
        const osc = ac.createOscillator();
        osc.type = v.w === 'tri' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(v.f || 440, at);
        if (v.f2) osc.frequency.exponentialRampToValueAtTime(v.f2, at + dur);
        node = osc;
        osc.start(at); osc.stop(at + dur + 0.02);
      }
      node.connect(env); env.connect(master);
    }
  }

  function setMuted(m: boolean) {
    muted = !!m;
    try { localStorage.setItem('txxt.hall.muted', muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
    if (muted && ac && ac.state === 'running') ac.suspend().catch(function () { /* 忽略 */ });
    if (!muted) unlock();
  }

  function toggle() { setMuted(!muted); return muted; }

  /* 关掉机台时把还在响的收掉：切走之后不该再有余音，也不该让 ctx 一直跑在后台 */
  function stop() {
    if (ac && ac.state === 'running'){ ac.suspend().catch(function () { /* 忽略 */ }); }
    live = 0;
    recent = [];
  }

  function perf() {
    return { ctx: ac ? ac.state : 'none', plays: plays, dropped: dropped, voices: live, game: game };
  }

  return {
    play: play,
    fanfare: fanfare,
    setGame: function (id) { game = id || ''; },
    setMuted: setMuted,
    toggle: toggle,
    isMuted: function () { return muted; },
    unlock: unlock,
    perf: perf,
    stop: stop
  };
}
