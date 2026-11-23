/* 音效与战鼓 BGM：全部用 WebAudio 现场合成，不加载任何音频文件。
 *
 * 站点目前只有 js/css 两个产物，为了一个网页游戏塞几十条 mp3 会让首屏变重。
 * 合成器还有一个好处：同一件事的强弱能跟着局面走 —— Boss 登场比小兵阵亡沉得多，
 * 五级合成比二三级合成多一层泛音。
 *
 * 同名音效 45ms 内只响一次：百来个敌人同时倒下的时候，不能真放一百声。
 */
type Ctx = AudioContext

const PENTA = [0, 2, 4, 7, 9]

export class LegionAudio {
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
  get bgmRunning(): boolean { return !!this.bgmTimer }

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
    if (this.sfxBus) this.sfxBus.gain.value = Math.max(0, Math.min(1, sfx))
    if (this.bgmBus) this.bgmBus.gain.value = Math.max(0, Math.min(1, bgm))
    this.muted = sfx <= 0.001 && bgm <= 0.001
  }

  suspend(): void { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}) }
  resume(): void { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}) }

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

  private gate(name: string, ms = 45): boolean {
    if (!this.ctx) return false
    const now = this.ctx.currentTime
    const last = this.lastAt[name] || 0
    if (now - last < ms / 1000) return false
    this.lastAt[name] = now
    return true
  }

  sfx(name: string, power = 1): void {
    if (!this.ctx || this.muted || !this.gate(name)) return
    switch (name) {
      case 'shoot':
        this.tone(620 + Math.random() * 90, 0.06, 'triangle', 0.05 * power, 300)
        break
      case 'arrow':
        this.noise(0.05, 0.06 * power, 3600)
        this.tone(900, 0.05, 'sine', 0.03, 500)
        break
      case 'orb':
        this.tone(320, 0.18, 'sine', 0.06 * power, 560)
        break
      case 'hit':
        this.noise(0.04, 0.1 * power, 2400)
        break
      case 'crit':
        this.noise(0.08, 0.18 * power, 4200)
        this.tone(1000, 0.1, 'square', 0.06, 500)
        break
      case 'kill':
        this.tone(190, 0.1, 'triangle', 0.06 * power, 80)
        this.noise(0.06, 0.05 * power, 900)
        break
      case 'merge':
        this.tone(392, 0.14, 'triangle', 0.1, 523)
        this.tone(523, 0.16, 'triangle', 0.09, 784, 0.09)
        this.noise(0.12, 0.05, 2000, 0.02)
        break
      case 'merge5':
        this.tone(196, 0.5, 'sawtooth', 0.12, 392)
        this.tone(392, 0.5, 'triangle', 0.12, 784, 0.08)
        this.tone(784, 0.6, 'triangle', 0.1, 1568, 0.18)
        this.noise(0.4, 0.08, 900, 0.06)
        break
      case 'recruit':
        this.tone(520, 0.1, 'sine', 0.06, 700)
        this.tone(700, 0.1, 'sine', 0.05, 900, 0.08)
        break
      case 'rare':
        this.tone(660, 0.14, 'sine', 0.09, 880)
        this.tone(880, 0.16, 'triangle', 0.08, 1320, 0.1)
        this.tone(1320, 0.22, 'sine', 0.05, 1760, 0.2)
        break
      case 'levelup':
        this.tone(440, 0.12, 'triangle', 0.1, 660)
        this.tone(660, 0.14, 'triangle', 0.08, 880, 0.09)
        break
      case 'sell':
        this.tone(300, 0.08, 'triangle', 0.05, 200)
        break
      case 'wave':
        this.tone(260, 0.5, 'sine', 0.12, 180)
        this.noise(0.5, 0.07, 700)
        break
      case 'clear':
        this.tone(392, 0.2, 'triangle', 0.1, 523)
        this.tone(523, 0.2, 'triangle', 0.09, 659, 0.12)
        this.tone(784, 0.3, 'triangle', 0.08, 988, 0.24)
        break
      case 'boss':
        this.tone(64, 1.2, 'sine', 0.32, 40)
        this.tone(96, 1.0, 'triangle', 0.12, 60, 0.12)
        this.noise(0.9, 0.12, 300, 0.06)
        break
      case 'bossDie':
        this.tone(160, 1.5, 'sawtooth', 0.18, 48)
        this.noise(1.0, 0.2, 420)
        this.tone(392, 0.6, 'triangle', 0.12, 784, 0.4)
        break
      case 'base':
        this.tone(90, 0.4, 'sawtooth', 0.2, 50)
        this.noise(0.3, 0.14, 500)
        break
      case 'cannon':
        this.noise(0.35, 0.28, 600)
        this.tone(80, 0.35, 'sine', 0.18, 36)
        break
      case 'heal':
        this.tone(520, 0.22, 'sine', 0.08, 880)
        this.tone(780, 0.2, 'sine', 0.05, 1040, 0.1)
        break
      case 'freeze':
        this.tone(1200, 0.3, 'sine', 0.07, 400)
        this.noise(0.3, 0.05, 5000)
        break
      case 'skill':
        this.tone(262, 0.3, 'sawtooth', 0.12, 524)
        this.tone(524, 0.4, 'triangle', 0.12, 1046, 0.1)
        this.noise(0.3, 0.09, 1400, 0.05)
        break
      case 'achievement':
        this.tone(523, 0.14, 'triangle', 0.1, 659)
        this.tone(659, 0.14, 'triangle', 0.09, 784, 0.12)
        this.tone(1046, 0.3, 'sine', 0.07, 1318, 0.24)
        break
      case 'record':
        this.tone(392, 0.2, 'triangle', 0.1, 523)
        this.tone(523, 0.2, 'triangle', 0.1, 659, 0.16)
        this.tone(659, 0.2, 'triangle', 0.1, 784, 0.32)
        this.tone(784, 0.5, 'sine', 0.1, 1046, 0.48)
        break
      case 'end':
        this.tone(330, 1.4, 'triangle', 0.16, 70)
        this.tone(220, 1.2, 'sine', 0.12, 55, 0.15)
        break
      case 'error':
        this.tone(200, 0.12, 'square', 0.06, 160)
        break
      case 'ui':
        this.tone(600, 0.05, 'triangle', 0.035, 700)
        break
      case 'stroke':
        /* 笔势合击：毛笔划过纸面的一下 —— 低频噪声 + 一枚短音 */
        this.noise(0.22, 0.14 * power, 1200)
        this.tone(150, 0.2, 'triangle', 0.07 * power, 90)
        this.tone(320, 0.16, 'sine', 0.04 * power, 210, 0.05)
        break
      case 'cut':
        this.noise(0.05, 0.09 * power, 5200)
        this.tone(880, 0.06, 'square', 0.03, 420)
        break
      case 'erase':
        this.noise(0.7, 0.2, 480)
        this.tone(220, 0.8, 'sawtooth', 0.1, 60)
        break
      default:
        this.tone(420, 0.06, 'triangle', 0.04, 320)
    }
  }

  /* ---------------- 战鼓 BGM ---------------- */
  startBgm(): void {
    if (!this.ctx || this.bgmTimer) return
    this.bgmStep = 0
    this.intensity = 0
    this.playBar()
    this.bgmTimer = window.setInterval(() => this.playBar(), 2600)
  }

  stopBgm(): void {
    if (this.bgmTimer) {
      window.clearInterval(this.bgmTimer)
      this.bgmTimer = 0
    }
  }

  setIntensity(level: number): void {
    this.intensity = Math.max(0, Math.min(4, level))
  }

  private pluck(freq: number, gain: number, at: number, dur = 1.6, type: OscillatorType = 'triangle'): void {
    if (!this.ctx || !this.bgmBus) return
    const t0 = this.ctx.currentTime + at
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.05)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g); g.connect(this.bgmBus)
    osc.start(t0); osc.stop(t0 + dur + 0.1)
  }

  private drum(gain: number, at: number, base = 62): void {
    if (!this.ctx || !this.bgmBus) return
    const t0 = this.ctx.currentTime + at
    const osc = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(base, t0)
    osc.frequency.exponentialRampToValueAtTime(base * 0.6, t0 + 0.28)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4)
    osc.connect(g); g.connect(this.bgmBus)
    osc.start(t0); osc.stop(t0 + 0.45)
  }

  private playBar(): void {
    if (!this.ctx || !this.bgmBus) return
    const step = this.bgmStep++
    const base = 146.8
    const n = PENTA[step % PENTA.length]
    this.pluck(base * Math.pow(2, n / 12), 0.05, 0)
    this.pluck(base * 2 * Math.pow(2, PENTA[(step + 2) % PENTA.length] / 12), 0.022, 1.2)
    this.drum(0.07, 0)
    if (this.intensity >= 1) this.drum(0.055, 0.65, 54)
    if (this.intensity >= 2) {
      this.pluck(base * Math.pow(2, PENTA[(step + 3) % PENTA.length] / 12), 0.03, 0.9)
      this.drum(0.05, 1.3, 58)
    }
    if (this.intensity >= 3) {
      this.pluck(base * 2 * Math.pow(2, n / 12), 0.02, 1.9, 0.9, 'sine')
      this.drum(0.06, 1.75, 50)
    }
    if (this.intensity >= 4) {
      this.drum(0.05, 0.32, 70)
      this.drum(0.05, 0.98, 66)
    }
  }
}
