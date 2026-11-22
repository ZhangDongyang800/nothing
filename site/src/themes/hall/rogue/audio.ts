/* 音效与背景音乐 —— 全部用 WebAudio 现场合成，不加载任何音频文件。
 *
 * 原因很直接：这个站点目前只有 js/css 两个产物（AGENTS.md 里量过），
 * 为了一款网页游戏塞十几条 mp3 会让首屏变重；合成器还能让"同一件事的强弱"
 * 跟着局面走（Boss 登场比普通击杀沉得多）。
 *
 * 两类声音：
 *   · 短音效 —— 一次振荡器 + 一次噪声，几十毫秒内结束；
 *   · 背景音乐 —— 五声音阶的拨弦循环，按局面分三档密度，只在真的开局后跑。
 * 所有音量都有独立增益，静音就是增益归零，不是把节点拆掉重来。
 */
type Ctx = AudioContext

const NOTE = [0, 2, 4, 7, 9, 12, 14, 16];

export class GameAudio {
  private ctx: Ctx | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private bgmBus: GainNode | null = null
  private bgmTimer = 0
  private bgmStep = 0
  private intensity = 0
  private lastAt: Record<string, number> = {}
  private muted = false

  get ready(): boolean { return !!this.ctx }

  /** 必须由一次真实手势调用（点击"进入墨潮"），否则浏览器不给开音频。 */
  unlock(sfx: number, bgm: number): void {
    if (this.ctx) { this.ctx.resume().catch(() => {}); return }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.gain.value = 1
      this.master.connect(this.ctx.destination)
      this.sfxBus = this.ctx.createGain()
      this.sfxBus.gain.value = sfx
      this.sfxBus.connect(this.master)
      this.bgmBus = this.ctx.createGain()
      this.bgmBus.gain.value = bgm
      this.bgmBus.connect(this.master)
    } catch {
      this.ctx = null
    }
  }

  setVolumes(sfx: number, bgm: number): void {
    if (this.sfxBus) this.sfxBus.gain.value = sfx
    if (this.bgmBus) this.bgmBus.gain.value = bgm
    this.muted = sfx <= 0.001 && bgm <= 0.001
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}) }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}) }

  /* ---------- 基础发声 ---------- */
  private tone(freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number, delay = 0): void {
    if (!this.ctx || !this.sfxBus || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur / 3))
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g); g.connect(this.sfxBus)
    osc.start(t0); osc.stop(t0 + dur + 0.02)
  }

  private noise(dur: number, gain: number, lp = 1800, delay = 0): void {
    if (!this.ctx || !this.sfxBus || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur))
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate)
    const arr = buf.getChannelData(0)
    for (let i = 0; i < n; i++) arr[i] = (Math.random() * 2 - 1) * (1 - i / n)
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const f = this.ctx.createBiquadFilter()
    f.type = 'lowpass'; f.frequency.value = lp
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(f); f.connect(g); g.connect(this.sfxBus)
    src.start(t0)
  }

  /** 同名音效最多每 45 毫秒一次：一百个敌人同时死的时候不能真放一百声。 */
  private gate(name: string): boolean {
    if (!this.ctx) return false
    const now = this.ctx.currentTime
    const last = this.lastAt[name] || 0
    if (now - last < 0.045) return false
    this.lastAt[name] = now
    return true
  }

  sfx(name: string, power = 1): void {
    if (!this.ctx || this.muted || !this.gate(name)) return
    switch (name) {
      case 'shoot':
        this.tone(520 + Math.random() * 90, 0.08, 'triangle', 0.09 * power, 240)
        break
      case 'shoot2':
        this.tone(880, 0.1, 'sawtooth', 0.06 * power, 300)
        break
      case 'hit':
        this.noise(0.05, 0.16 * power, 2600)
        break
      case 'kill':
        this.tone(220, 0.12, 'triangle', 0.08 * power, 90)
        this.noise(0.08, 0.08 * power, 1200)
        break
      case 'zap':
        this.tone(1200, 0.09, 'square', 0.07, 300)
        this.noise(0.06, 0.1, 4000)
        break
      case 'boom':
        this.noise(0.32, 0.28 * power, 420)
        this.tone(90, 0.34, 'sine', 0.2 * power, 40)
        break
      case 'pick':
        this.tone(760 + Math.random() * 120, 0.06, 'sine', 0.06, 980)
        break
      case 'coin':
        this.tone(1100, 0.07, 'triangle', 0.08, 1500)
        this.tone(1500, 0.06, 'triangle', 0.05, 1900, 0.05)
        break
      case 'heal':
        this.tone(520, 0.2, 'sine', 0.08, 900)
        break
      case 'level':
        this.tone(392, 0.16, 'triangle', 0.14, 523)
        this.tone(523, 0.16, 'triangle', 0.12, 659, 0.1)
        this.tone(784, 0.22, 'triangle', 0.1, 988, 0.2)
        break
      case 'chest':
        this.tone(660, 0.12, 'sine', 0.1, 880)
        this.tone(880, 0.14, 'sine', 0.1, 1320, 0.1)
        this.tone(1320, 0.2, 'sine', 0.07, 1760, 0.2)
        break
      case 'evolve':
        this.tone(196, 0.7, 'sawtooth', 0.1, 392)
        this.tone(392, 0.6, 'triangle', 0.14, 784, 0.08)
        this.tone(784, 0.5, 'triangle', 0.1, 1568, 0.16)
        this.noise(0.4, 0.08, 900, 0.1)
        break
      case 'boss':
        this.tone(70, 1.1, 'sine', 0.32, 46)
        this.tone(110, 0.9, 'triangle', 0.12, 70, 0.1)
        this.noise(0.8, 0.1, 320, 0.05)
        break
      case 'death':
        this.tone(330, 1.2, 'triangle', 0.16, 70)
        this.tone(220, 1.0, 'sine', 0.12, 55, 0.15)
        break
      case 'dash':
        this.noise(0.14, 0.12, 3200)
        this.tone(300, 0.12, 'sine', 0.05, 600)
        break
      case 'warn':
        this.tone(880, 0.1, 'square', 0.08, 880)
        this.tone(880, 0.1, 'square', 0.08, 660, 0.16)
        break
      case 'alarm':
        this.tone(180, 0.5, 'sawtooth', 0.1, 120)
        break
      case 'ui':
        this.tone(620, 0.05, 'triangle', 0.04, 700)
        break
      case 'tick':
        this.tone(420, 0.04, 'sine', 0.03, 380)
        break
      default:
        this.tone(400, 0.06, 'triangle', 0.04, 300)
    }
  }

  /* ---------- 背景音乐 ---------- */
  startBgm(): void {
    if (!this.ctx || this.bgmTimer) return
    this.bgmStep = 0
    this.intensity = 0
    const tick = () => this.playBar()
    this.playBar()
    this.bgmTimer = window.setInterval(tick, 2400)
  }

  stopBgm(): void {
    if (this.bgmTimer) {
      window.clearInterval(this.bgmTimer)
      this.bgmTimer = 0
    }
  }

  setIntensity(level: number): void {
    this.intensity = Math.max(0, Math.min(3, level))
  }

  public get bgmRunning(): boolean { return !!this.bgmTimer }

  private bgmPluck(freq: number, gain: number, at: number): void {
    if (!this.ctx || !this.bgmBus) return
    const t0 = this.ctx.currentTime + at
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.04)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6)
    osc.connect(g); g.connect(this.bgmBus)
    osc.start(t0); osc.stop(t0 + 1.7)
  }

  private playBar(): void {
    if (!this.ctx || !this.bgmBus) return
    const step = this.bgmStep++
    const base = 196
    const root = NOTE[step % NOTE.length]
    const f = base * Math.pow(2, root / 12)
    this.bgmPluck(f, 0.055, 0)
    if (this.intensity >= 1) {
      this.bgmPluck(base * Math.pow(2, NOTE[(step + 4) % NOTE.length] / 12), 0.04, 0.55)
      this.bgmPluck(base * Math.pow(2, NOTE[(step + 2) % NOTE.length] / 12), 0.035, 1.1)
    }
    if (this.intensity >= 2) {
      this.bgmPluck(base * 2 * Math.pow(2, NOTE[(step + 6) % NOTE.length] / 12), 0.028, 1.6)
    }
    if (this.intensity >= 3) {
      this.bgmPluck(base * Math.pow(2, NOTE[(step + 1) % NOTE.length] / 12), 0.03, 1.9)
    }
  }
}
