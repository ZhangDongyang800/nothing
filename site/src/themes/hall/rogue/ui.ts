/* 界面层：HUD、开局、升级、暂停、结算、宝箱、商人、局外成长。
 *
 * 只有一个原则：**每帧不碰 React，也不重排布局**。
 * HUD 的每个读数都先和上一次比，变了才写 textContent；血条/经验条只改 transform。
 * 覆盖层是"换一屏内容"，不是每帧刷新，所以用 innerHTML 一次性铺出来。
 */
import type { SaveData, Checkpoint } from './save';
import { fmtTime } from './save';
import type { CharDef } from './data/chars';
import { META_UPS, ACHIEVEMENTS, metaCost } from './data/meta';

export interface UiHost {
  onAction(act: string, arg: string): void
  onStick(x: number, y: number, active: boolean): void
  onDash(): void
  onVolume(kind: 'sfx' | 'bgm', v: number): void
}

export interface HudWeapon { name: string; glyph: string; level: number; evolved: boolean; color: string }
export interface HudPassive { name: string; glyph: string; level: number }
export interface HudView {
  time: string
  stage: string
  level: number
  hp: number
  maxHp: number
  xp: number
  xpNext: number
  kills: number
  gold: number
  combo: number
  dash: number
  boss: { name: string; hp: number; max: number } | null
  weapons: HudWeapon[]
  passives: HudPassive[]
}

export interface OfferView {
  kind: string
  id: string
  name: string
  glyph: string
  tag: string
  desc: string
  next: string
  level: number
  color: string
  evolved: boolean
  /** 升级前 / 升级后的具体数值，卡面下半区靠这两行做对比 */
  now?: string
  then?: string
  thenLabel?: string
  /** 数值变化的小结，例如「伤害 +2.4」「间隔 -0.08s」 */
  deltas?: string[]
  /** 满级数；只有真能升级的卡才有等级刻度，补给卡不画 */
  max?: number
}

export interface LevelInfo {
  level: number
  pending: number
}

export interface StartData {
  chars: CharDef[]
  unlocked: string[]
  save: SaveData
  checkpoint: Checkpoint | null
  lastChar: string
}

export interface SummaryView {
  time: number
  kills: number
  level: number
  gold: number
  dmg: number
  weapons: HudWeapon[]
  passives: HudPassive[]
  record: boolean
  bestTime: number
  dust: number
  newAchievements: string[]
  charName: string
}

export interface RewardView { id: string; name: string; desc: string; color: string; glyph: string }
export interface GoodView { id: string; name: string; desc: string; cost: number; glyph: string; afford: boolean }

const html = (s: string) => s;

export class RogueUI {
  root: HTMLElement
  canvas: HTMLCanvasElement
  private host: UiHost
  private overlay: HTMLElement
  private el: Record<string, HTMLElement> = {}
  private prev: Record<string, string> = {}
  private toastTimer: number[] = []
  private bannerTimer = 0
  private flashTimer = 0
  private stickActive = false
  /* 升级/宝箱卡片的键盘游标：0 号默认选中，方向键移动，Enter 落定 */
  private cards: HTMLElement[] = []
  private selIndex = 0
  private pickLock = false
  private pickTimer = 0

  constructor(hostEl: HTMLElement, host: UiHost) {
    this.host = host
    hostEl.innerHTML = html(`
      <div class="rg" data-phase="start">
        <canvas class="rg-canvas" aria-label="墨潮战场"></canvas>
        <div class="rg-vignette"></div>
        <div class="rg-hud">
          <div class="rg-top">
            <div class="rg-top-row">
              <div class="rg-lead">
                <span class="rg-ident"><b id="rgChar">墨客</b><i id="rgLv">Lv.1</i></span>
                <span class="rg-xp"><em class="rg-xp-cap">经验</em><span class="rg-xp-track"><i id="rgXpFill"></i></span><em class="rg-xp-num"><b id="rgXpNum">0</b><u>/</u><i id="rgXpNext">12</i></em></span>
              </div>
              <span class="rg-hp"><i id="rgHpFill"></i><span id="rgHpNum">100 / 100</span></span>
              <div class="rg-clock"><b id="rgTime">00:00</b><span id="rgStage">初落笔</span></div>
              <div class="rg-nums">
                <span class="rg-stat is-main" title="斩杀"><i>斩</i><b id="rgKills">0</b></span>
                <span class="rg-stat" title="铜钱"><i>墨</i><b id="rgGold">0</b></span>
                <span class="rg-stat is-combo" id="rgComboBox" title="连斩"><i>连</i><b id="rgCombo">0</b></span>
              </div>
              <div class="rg-tools">
                <span class="rg-dash" title="冲刺"><i id="rgDashFill"></i><em>冲</em></span>
                <button class="rg-icon" data-act="sfx" id="rgSfx" aria-label="音效开关">♪</button>
                <button class="rg-icon" data-act="pause" id="rgPause" aria-label="暂停">⏸</button>
              </div>
            </div>
            <div class="rg-boss" id="rgBoss">
              <div class="rg-boss-top"><b id="rgBossName"></b><i id="rgBossPct"></i></div>
              <div class="rg-boss-bar"><i id="rgBossFill"></i></div>
            </div>
          </div>
          <div class="rg-build">
            <div class="rg-build-row" id="rgWeapons"></div>
            <div class="rg-build-row" id="rgPassives"></div>
          </div>
          <div class="rg-toasts" id="rgToasts"></div>
        </div>
        <div class="rg-mobile" id="rgMobile">
          <div class="rg-stick" id="rgStick"><i id="rgKnob"></i></div>
          <button class="rg-dashbtn" data-act="dash">冲<small>空格</small></button>
        </div>
        <div class="rg-banner" id="rgBanner"><span></span><b></b><i></i></div>
        <div class="rg-flash" id="rgFlash"></div>
        <div class="rg-overlay" id="rgOverlay"></div>
      </div>
    `)
    this.root = hostEl.firstElementChild as HTMLElement
    this.canvas = this.root.querySelector('.rg-canvas') as HTMLCanvasElement
    this.overlay = this.root.querySelector('#rgOverlay') as HTMLElement
    for (const id of ['rgChar', 'rgLv', 'rgHpFill', 'rgHpNum', 'rgXpFill', 'rgXpNum', 'rgXpNext', 'rgTime', 'rgStage', 'rgKills', 'rgGold',
      'rgDashFill', 'rgBoss', 'rgBossName', 'rgBossPct', 'rgBossFill', 'rgWeapons', 'rgPassives', 'rgToasts',
      'rgBanner', 'rgFlash', 'rgSfx', 'rgPause', 'rgMobile', 'rgStick', 'rgKnob', 'rgCombo', 'rgComboBox']) {
      const e = this.root.querySelector('#' + id)
      if (e) this.el[id] = e as HTMLElement
    }
    this.root.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement
      const b = t.closest('[data-act]') as HTMLElement | null
      if (!b) return
      const act = b.getAttribute('data-act') || ''
      if (!act) return
      ev.preventDefault()
      if (act === 'dash') { this.host.onDash(); return }
      /* 升级 / 宝箱卡：先落一个「已选」态再提交，手上有回执，画面不空跳 */
      if ((act === 'pick' || act === 'chest') && b.classList.contains('rg-offer')) { this.confirmCard(b); return }
      this.host.onAction(act, b.getAttribute('data-id') || b.getAttribute('data-char') || b.getAttribute('data-i') || '')
    })
    this.overlay.addEventListener('focusin', (ev) => {
      const t = ev.target as HTMLElement
      const i = this.cards.indexOf(t)
      if (i >= 0 && i !== this.selIndex) this.selectCard(i, false)
    })
    document.addEventListener('keydown', this.onDocKey, true)
    this.overlay.addEventListener('input', (ev) => {
      const t = ev.target as HTMLInputElement
      const kind = t.getAttribute('data-vol')
      if (kind === 'sfx' || kind === 'bgm') this.host.onVolume(kind, Number(t.value) / 100)
    })
    this.bindStick()
    this.showMobile(!!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches))
  }

  destroy(): void {
    for (const t of this.toastTimer) window.clearTimeout(t)
    this.toastTimer = []
    if (this.bannerTimer) window.clearTimeout(this.bannerTimer)
    if (this.flashTimer) window.clearTimeout(this.flashTimer)
    if (this.pickTimer) window.clearTimeout(this.pickTimer)
    document.removeEventListener('keydown', this.onDocKey, true)
    this.root.remove()
  }

  /* ---------------- 卡片的键盘选择 ---------------- */
  private onDocKey = (e: KeyboardEvent): void => {
    if (!this.overlay.classList.contains('is-on')) return
    const phase = this.root.getAttribute('data-phase')
    if (phase !== 'levelup' && phase !== 'chest') return
    const cards = this.cards
    if (!cards.length) return
    const k = e.key
    const dir = k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : k === 'ArrowRight' || k === 'ArrowDown' ? 1 : 0
    if (dir) {
      e.preventDefault()
      e.stopPropagation()
      this.selectCard((this.selIndex + dir + cards.length) % cards.length, true)
      return
    }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      /* 焦点停在同一屏的重摇 / 关闭按钮上时，把回车让给浏览器原生行为 */
      const active = document.activeElement as HTMLElement | null
      if (active && active !== document.body && !cards.includes(active)) return
      e.preventDefault()
      e.stopPropagation()
      this.confirmCard(cards[this.selIndex] || cards[0])
      return
    }
    if (/^[1-9]$/.test(k)) {
      const i = Number(k) - 1
      if (i < cards.length) {
        e.preventDefault()
        e.stopPropagation()
        this.selectCard(i, false)
        this.confirmCard(cards[i])
      }
      return
    }
    if (phase === 'levelup' && (k === 'r' || k === 'R')) {
      e.preventDefault()
      e.stopPropagation()
      this.host.onAction('reroll', '')
    }
  }

  private bindCards(): void {
    this.cards = Array.from(this.overlay.querySelectorAll<HTMLElement>('.rg-offer'))
    this.selIndex = 0
    this.pickLock = false
    this.cards.forEach((c, i) => {
      c.setAttribute('role', 'option')
      c.setAttribute('aria-selected', i === 0 ? 'true' : 'false')
    })
    if (this.cards[0]) {
      this.cards[0].classList.add('is-current')
      try { this.cards[0].focus({ preventScroll: true }) } catch { /* ignore */ }
    }
  }

  private selectCard(i: number, focus: boolean): void {
    if (!this.cards.length) return
    const idx = Math.max(0, Math.min(this.cards.length - 1, i))
    this.cards.forEach((c, k) => {
      const on = k === idx
      c.classList.toggle('is-current', on)
      c.setAttribute('aria-selected', on ? 'true' : 'false')
    })
    this.selIndex = idx
    if (focus) {
      try { this.cards[idx].focus({ preventScroll: true }) } catch { /* ignore */ }
    }
  }

  private confirmCard(card: HTMLElement): void {
    if (this.pickLock || !card) return
    this.pickLock = true
    card.classList.add('is-picked')
    const act = card.getAttribute('data-act') || ''
    const arg = card.getAttribute('data-i') || card.getAttribute('data-id') || ''
    if (this.pickTimer) window.clearTimeout(this.pickTimer)
    this.pickTimer = window.setTimeout(() => {
      this.pickLock = false
      this.host.onAction(act, arg)
    }, 110)
  }

  /* ---------------- 摇杆（只在触屏设备上挂出来） ---------------- */
  private bindStick(): void {
    const stick = this.el.rgStick
    if (!stick) return
    const knob = this.el.rgKnob
    let cx = 0, cy = 0, radius = 46
    const setVec = (dx: number, dy: number) => {
      const len = Math.hypot(dx, dy) || 1
      const k = Math.min(1, len / radius)
      const nx = dx / len, ny = dy / len
      if (knob) knob.style.transform = `translate(${nx * radius * k * 0.55}px,${ny * radius * k * 0.55}px)`
      this.host.onStick(k > 0.14 ? dx / len : 0, k > 0.14 ? dy / len : 0, true)
    }
    stick.addEventListener('pointerdown', (ev) => {
      ev.preventDefault()
      const r = stick.getBoundingClientRect()
      cx = r.left + r.width / 2
      cy = r.top + r.height / 2
      radius = Math.max(28, r.width / 2)
      this.stickActive = true
      try { stick.setPointerCapture(ev.pointerId) } catch { /* ignore */ }
      setVec(ev.clientX - cx, ev.clientY - cy)
    })
    stick.addEventListener('pointermove', (ev) => {
      if (!this.stickActive) return
      setVec(ev.clientX - cx, ev.clientY - cy)
    })
    const end = () => {
      if (!this.stickActive) return
      this.stickActive = false
      if (knob) knob.style.transform = 'translate(0,0)'
      this.host.onStick(0, 0, false)
    }
    stick.addEventListener('pointerup', end)
    stick.addEventListener('pointercancel', end)
    stick.addEventListener('pointerleave', end)
  }

  showMobile(on: boolean): void {
    if (this.el.rgMobile) this.el.rgMobile.classList.toggle('is-on', on)
    this.root.setAttribute('data-touch', on ? '1' : '0')
  }

  setPhase(phase: string): void { this.root.setAttribute('data-phase', phase) }

  /* ---------------- HUD ---------------- */
  setHud(h: HudView): void {
    const set = (id: string, text: string) => {
      if (this.prev[id] === text) return
      this.prev[id] = text
      const e = this.el[id]
      if (e) e.textContent = text
    }
    set('rgLv', 'Lv.' + h.level)
    set('rgHpNum', Math.max(0, Math.ceil(h.hp)) + ' / ' + Math.round(h.maxHp))
    const hpPct = Math.max(0, Math.min(1, h.hp / Math.max(1, h.maxHp)))
    if (this.el.rgHpFill) {
      this.el.rgHpFill.style.transform = `scaleX(${hpPct})`
      const box = this.el.rgHpFill.parentElement
      if (box) box.classList.toggle('is-low', hpPct < 0.35)
    }
    const xpPct = Math.max(0, Math.min(1, h.xp / Math.max(1, h.xpNext)))
    if (this.el.rgXpFill) this.el.rgXpFill.style.transform = `scaleX(${xpPct})`
    set('rgXpNum', String(Math.floor(h.xp)))
    set('rgXpNext', String(Math.round(h.xpNext)))
    set('rgTime', h.time)
    set('rgStage', h.stage)
    set('rgKills', String(h.kills))
    set('rgGold', String(h.gold))
    set('rgCombo', String(h.combo))
    if (this.el.rgComboBox) this.el.rgComboBox.classList.toggle('is-hot', h.combo > 0)
    if (this.el.rgDashFill) this.el.rgDashFill.style.transform = `scaleY(${Math.max(0, Math.min(1, h.dash))})`

    if (h.boss) {
      this.el.rgBoss.classList.add('is-on')
      set('rgBossName', h.boss.name)
      set('rgBossPct', Math.max(0, Math.round(h.boss.hp / Math.max(1, h.boss.max) * 100)) + '%')
      if (this.el.rgBossFill) this.el.rgBossFill.style.transform = `scaleX(${Math.max(0, Math.min(1, h.boss.hp / Math.max(1, h.boss.max)) )})`
    } else {
      this.el.rgBoss.classList.remove('is-on')
    }

    const wkey = h.weapons.map(w => w.name + w.level + (w.evolved ? 'e' : '')).join('|')
    if (this.prev.weaponKey !== wkey) {
      this.prev.weaponKey = wkey
      this.el.rgWeapons.innerHTML = h.weapons.map(w => `
        <span class="rg-chip ${w.evolved ? 'is-evo' : ''}" style="--c:${w.color}">
          <i>${w.glyph}</i><b>${w.name}</b><em>${w.evolved ? '进' : w.level}</em>
        </span>`).join('')
    }
    const pkey = h.passives.map(p => p.name + p.level).join('|')
    if (this.prev.passiveKey !== pkey) {
      this.prev.passiveKey = pkey
      this.el.rgPassives.innerHTML = h.passives.map(p => `
        <span class="rg-chip is-pass"><i>${p.glyph}</i><b>${p.name}</b><em>${p.level}</em></span>`).join('')
    }
  }

  setCharName(name: string): void { this.el.rgChar.textContent = name }

  setAudioLabel(on: boolean): void {
    if (this.el.rgSfx) this.el.rgSfx.classList.toggle('is-off', !on)
  }

  toast(text: string, kind = ''): void {
    const box = this.el.rgToasts
    if (!box) return
    const n = document.createElement('div')
    n.className = 'rg-toast' + (kind ? ' is-' + kind : '')
    n.textContent = text
    box.appendChild(n)
    while (box.children.length > 4) box.removeChild(box.firstChild as Node)
    const t = window.setTimeout(() => { if (n.parentNode) n.parentNode.removeChild(n) }, 3000)
    this.toastTimer.push(t)
  }

  banner(title: string, sub: string, kind = ''): void {
    const b = this.el.rgBanner
    if (!b) return
    const k = b.querySelector('span') as HTMLElement
    const n = b.querySelector('b') as HTMLElement
    const i = b.querySelector('i') as HTMLElement
    if (k) k.textContent = kind === 'boss' ? 'BOSS' : kind === 'evo' ? 'EVOLVE' : kind === 'mile' ? 'MILESTONE' : ''
    if (n) n.textContent = title
    if (i) i.textContent = sub
    b.className = 'rg-banner is-on' + (kind ? ' is-' + kind : '')
    if (this.bannerTimer) window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => { b.classList.remove('is-on') }, 2100)
  }

  flash(kind = ''): void {
    const f = this.el.rgFlash
    if (!f) return
    f.className = 'rg-flash is-on' + (kind ? ' is-' + kind : '')
    if (this.flashTimer) window.clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => { f.className = 'rg-flash' }, 420)
  }

  hideOverlay(): void {
    this.overlay.classList.remove('is-on')
    this.overlay.innerHTML = ''
    this.cards = []
    this.pickLock = false
    this.setPhase('play')
  }

  private openOverlay(inner: string, phase: string): void {
    this.cards = []
    this.pickLock = false
    this.overlay.innerHTML = inner
    this.overlay.classList.add('is-on')
    this.setPhase(phase)
  }

  /* ---------------- 开局 ---------------- */
  showStart(d: StartData): void {
    const rec = d.save.records
    const chars = d.chars.filter(c => c.unlock === 0 || d.unlocked.includes(c.id))
    const locked = d.chars.filter(c => c.unlock > 0 && !d.unlocked.includes(c.id))
    const cp = d.checkpoint
    const cards = chars.map((c) => {
      const on = c.id === d.lastChar
      return `
      <button class="rg-char ${on ? 'is-on' : ''}" data-act="start" data-char="${c.id}">
        <span class="rg-char-glyph">${c.glyph}</span>
        <span class="rg-char-name">${c.name}<i>${c.title}</i></span>
        <span class="rg-char-intro">${c.intro}</span>
        <span class="rg-char-stat">血 ${c.hp} · 速 ${c.speed} · 攻 ${Math.round(c.damage * 100)}%</span>
        <span class="rg-char-ability"><b>${c.ability.name}</b> ${c.ability.desc}</span>
        <span class="rg-char-weapon">起手 · ${weaponName(c.startWeapon)}</span>
      </button>`
    }).join('')
    const lockedCards = locked.map((c) => `
      <button class="rg-char is-locked" data-act="unlock" data-id="${c.id}">
        <span class="rg-char-glyph">?</span>
        <span class="rg-char-name">未知<i>${c.title}</i></span>
        <span class="rg-char-intro">${c.intro}</span>
        <span class="rg-char-lock">${c.unlock} 墨屑解锁</span>
      </button>`).join('')

    this.openOverlay(`
      <div class="rg-panel rg-screen">
        <div class="rg-screen-head">
          <div class="rg-title-wrap"><h2>墨潮<em>。</em></h2><p>无尽 · 随机构筑 · 活多久算多久</p></div>
          <div class="rg-dust"><span>墨屑</span><b>${Math.floor(d.save.dust)}</b>
            <button class="rg-mini" data-act="meta">永久成长</button></div>
        </div>
        <div class="rg-char-grid">${cards}${lockedCards}</div>
        <div class="rg-screen-foot">
          <div class="rg-records">
            <span>最久 <b>${fmtTime(rec.bestTime)}</b></span>
            <span>最高 <b>Lv.${rec.bestLevel}</b></span>
            <span>最多斩 <b>${rec.bestKills}</b></span>
            <span>局数 <b>${rec.runs}</b></span>
          </div>
          <div class="rg-acts">
            ${cp ? `<button class="rg-btn" data-act="continue">续上一局 ${fmtTime(cp.elapsed)} · Lv.${cp.level}</button>` : ''}
            <button class="rg-go" data-act="start" data-char="${d.lastChar}">进入墨潮</button>
          </div>
        </div>
        <div class="rg-foot-note">WASD / 拖动移动 · 空格 冲刺 · P 暂停 · 武器自动出手 · 无尽模式，死了就结算</div>
      </div>`, 'start')
  }

  /* ---------------- 升级 ---------------- */
  showLevel(offers: OfferView[], rerolls: number, info?: LevelInfo): void {
    const cards = offers.map((o, i) => {
      const pips = o.max
        ? Array.from({ length: o.max }, (_, k) => `<i class="${k < o.level ? 'on' : ''}"></i>`).join('')
        : ''
      const cls = o.kind === 'evolve' ? 'is-evo' : o.kind === 'weapon' ? 'is-weapon' : o.kind === 'passive' ? 'is-pass' : 'is-fill'
      const deltas = o.deltas && o.deltas.length
        ? `<span class="rg-offer-deltas">${o.deltas.map(d => `<b>${d}</b>`).join('')}</span>`
        : ''
      const compare = (o.now || o.then)
        ? `<span class="rg-offer-compare">
            <span class="rg-cmp-row"><i>现在</i><b>${o.now || '—'}</b></span>
            <span class="rg-cmp-row is-next"><i>${o.thenLabel || '升级后'}</i><b>${o.then || '—'}</b></span>
          </span>`
        : ''
      return `
      <button class="rg-offer ${cls}" data-act="pick" data-i="${i}" style="--c:${o.color}">
        <span class="rg-offer-top">
          <span class="rg-offer-glyph" aria-hidden="true">${o.glyph}</span>
          <span class="rg-offer-id">
            <span class="rg-offer-tag">${o.tag}</span>
            <span class="rg-offer-name">${o.name}</span>
          </span>
          <span class="rg-offer-key" aria-hidden="true">${i + 1}</span>
        </span>
        <span class="rg-offer-desc">${o.desc}</span>
        ${compare}
        ${deltas}
        ${pips ? `<span class="rg-pips" aria-hidden="true">${pips}</span>` : ''}
      </button>`
    }).join('')
    const sub = info ? `Lv.${info.level} · 还剩 ${info.pending} 次` : '选一项'
    this.openOverlay(`
      <div class="rg-panel rg-levelup" role="dialog" aria-modal="true" aria-label="落笔 · 选择升级">
        <div class="rg-level-head">
          <span class="rg-lv-rule"></span>
          <div class="rg-level-title"><h2>落笔</h2><p>${sub}</p></div>
          <span class="rg-key-note"><b>← →</b> 切换 <b>Enter</b> 落定 <b>1-3</b> 直选</span>
        </div>
        <div class="rg-offers" role="listbox" aria-label="升级选项">${cards}</div>
        <div class="rg-level-foot">
          <button class="rg-mini ${rerolls ? '' : 'is-off'}" data-act="reroll" ${rerolls ? '' : 'disabled'}>重摇 ×${rerolls}${rerolls ? ' · R' : ''}</button>
          <span class="rg-lock-note">战斗已暂停</span>
        </div>
      </div>`, 'levelup')
    this.bindCards()
  }

  /* ---------------- 暂停 ---------------- */
  showPause(h: HudView, s: SaveData): void {
    this.openOverlay(`
      <div class="rg-panel rg-pause">
        <div class="rg-screen-head">
          <div class="rg-title-wrap"><h2>停笔</h2><p>${h.time} · ${h.stage}</p></div>
          <div class="rg-dust"><span>本局</span><b>${h.kills} 斩</b></div>
        </div>
        <div class="rg-pause-grid">
          <div class="rg-build-list">
            <span class="rg-cap">手里的东西</span>
            ${h.weapons.map(w => `<span class="rg-line"><b>${w.glyph}</b>${w.name}<i>${w.evolved ? '进化' : 'Lv.' + w.level}</i></span>`).join('')}
          </div>
          <div class="rg-build-list">
            <span class="rg-cap">被动</span>
            ${h.passives.length ? h.passives.map(p => `<span class="rg-line"><b>${p.glyph}</b>${p.name}<i>${p.level}</i></span>`).join('') : '<span class="rg-empty">还没捡到</span>'}
          </div>
        </div>
        <div class="rg-vols">
          <label>音效 <input type="range" min="0" max="100" value="${Math.round(s.settings.sfx * 100)}" data-vol="sfx"></label>
          <label>音乐 <input type="range" min="0" max="100" value="${Math.round(s.settings.bgm * 100)}" data-vol="bgm"></label>
          <div class="rg-seg">
            <span>画面</span>
            <button data-act="quality" data-id="high" class="${s.settings.quality === 'low' ? '' : 'on'}">精细</button>
            <button data-act="quality" data-id="low" class="${s.settings.quality === 'low' ? 'on' : ''}">流畅</button>
          </div>
        </div>
        <div class="rg-acts">
          <button class="rg-go" data-act="resume">继续</button>
          <button class="rg-btn" data-act="quit">放弃本局</button>
        </div>
      </div>`, 'paused')
  }

  /* ---------------- 结算 ---------------- */
  showGameOver(s: SummaryView): void {
    const rec = s.record ? '<span class="rg-record">新纪录</span>' : ''
    const ach = s.newAchievements.length
      ? `<div class="rg-new-ach"><span class="rg-cap">这一局解锁</span>${s.newAchievements.map(a => `<b>${a}</b>`).join('')}</div>`
      : ''
    this.openOverlay(`
      <div class="rg-panel rg-over">
        <div class="rg-over-head">
          <div class="rg-stamp">墨尽</div>
          <div><h2>${s.charName}</h2><p>${s.record ? '这一局写进了记录' : '比上次差一点，也比上次多知道一点'}</p></div>
          ${rec}
        </div>
        <div class="rg-over-stats">
          <span><i>存活</i><b>${fmtTime(s.time)}</b><em>最久 ${fmtTime(s.bestTime)}</em></span>
          <span><i>斩杀</i><b>${s.kills}</b><em>总计 ${s.dmg > 9999 ? (s.dmg / 1000).toFixed(1) + 'k' : Math.round(s.dmg)} 伤害</em></span>
          <span><i>等级</i><b>Lv.${s.level}</b><em>金币 ${s.gold}</em></span>
          <span class="is-dust"><i>墨屑</i><b>+${s.dust}</b><em>可用于永久成长</em></span>
        </div>
        <div class="rg-over-build">
          <div class="rg-build-list"><span class="rg-cap">最终武器</span>
            ${s.weapons.map(w => `<span class="rg-line ${w.evolved ? 'is-evo' : ''}"><b>${w.glyph}</b>${w.name}<i>${w.evolved ? '进化' : 'Lv.' + w.level}</i></span>`).join('')}
          </div>
          <div class="rg-build-list"><span class="rg-cap">被动</span>
            ${s.passives.map(p => `<span class="rg-line"><b>${p.glyph}</b>${p.name}<i>${p.level}</i></span>`).join('') || '<span class="rg-empty">一个都没捡</span>'}
          </div>
        </div>
        ${ach}
        <div class="rg-acts">
          <button class="rg-go" data-act="restart">再写一局</button>
          <button class="rg-btn" data-act="meta">去用墨屑</button>
          <button class="rg-btn" data-act="backStart">回到开头</button>
        </div>
      </div>`, 'over')
  }

  /* ---------------- 宝箱 ---------------- */
  showChest(rewards: RewardView[]): void {
    this.openOverlay(`
      <div class="rg-panel rg-chest" role="dialog" aria-modal="true" aria-label="开箱 · 选择奖励">
        <div class="rg-level-head">
          <span class="rg-lv-rule"></span>
          <div class="rg-level-title"><h2>开箱</h2><p>挑一样带走</p></div>
          <span class="rg-key-note"><b>← →</b> 切换 <b>Enter</b> 落定 <b>1-3</b> 直选</span>
        </div>
        <div class="rg-offers rg-three" role="listbox" aria-label="宝箱奖励">
          ${rewards.map((r, i) => `
            <button class="rg-offer is-weapon is-loot" data-act="chest" data-i="${i}" style="--c:${r.color}">
              <span class="rg-offer-top">
                <span class="rg-offer-glyph" aria-hidden="true">${r.glyph}</span>
                <span class="rg-offer-id">
                  <span class="rg-offer-tag">宝箱 · 选一</span>
                  <span class="rg-offer-name">${r.name}</span>
                </span>
                <span class="rg-offer-key" aria-hidden="true">${i + 1}</span>
              </span>
              <span class="rg-offer-desc">${r.desc}</span>
            </button>`).join('')}
        </div>
        <div class="rg-level-foot"><span class="rg-lock-note">战斗已暂停</span></div>
      </div>`, 'chest')
    this.bindCards()
  }

  /* ---------------- 商人 ---------------- */
  showMerchant(goods: GoodView[], gold: number): void {
    this.openOverlay(`
      <div class="rg-panel rg-shop">
        <div class="rg-screen-head">
          <div class="rg-title-wrap"><h2>墨商</h2><p>只收铜钱，不讲价</p></div>
          <div class="rg-dust"><span>手里</span><b>${gold} 金</b></div>
        </div>
        <div class="rg-goods">
          ${goods.map((g, i) => `
            <button class="rg-good ${g.afford ? '' : 'is-poor'}" data-act="buyGood" data-i="${i}">
              <span class="rg-good-glyph">${g.glyph}</span>
              <span class="rg-good-name">${g.name}</span>
              <span class="rg-good-desc">${g.desc}</span>
              <span class="rg-good-cost">${g.cost} 金</span>
            </button>`).join('')}
        </div>
        <div class="rg-acts"><button class="rg-btn" data-act="leaveShop">走了</button></div>
      </div>`, 'merchant')
  }

  /* ---------------- 局外成长 ---------------- */
  showMeta(s: SaveData): void {
    const rows = META_UPS.map((m) => {
      const lv = s.meta[m.id] || 0
      const max = lv >= m.max
      const cost = metaCost(m, lv)
      const afford = s.dust >= cost && !max
      return `
      <div class="rg-up ${max ? 'is-max' : ''}">
        <span class="rg-up-glyph">${m.glyph}</span>
        <span class="rg-up-main"><b>${m.name}</b><i>${m.per}</i>
          <span class="rg-pips">${Array.from({ length: Math.min(10, m.max) }, (_, k) => `<i class="${k < Math.min(10, lv) ? 'on' : ''}"></i>`).join('')}</span>
        </span>
        <span class="rg-up-lv">${lv}/${m.max}</span>
        ${max ? '<span class="rg-up-cost is-max">满</span>' : `<button class="rg-buy ${afford ? '' : 'is-poor'}" data-act="buy" data-id="${m.id}">${cost}</button>`}
      </div>`
    }).join('')

    const charRows = s.chars.length
      ? s.chars.map(id => `<span class="rg-unlock"><b>已解锁</b>${charName(id)}</span>`).join('')
      : '<span class="rg-empty">还没有额外角色</span>'

    const achRows = ACHIEVEMENTS.map((a) => {
      const got = !!s.achievements[a.id]
      return `<span class="rg-ach ${got ? 'is-on' : ''}"><b>${got ? '✓' : '·'}</b><i>${a.name}</i><em>${a.desc}</em></span>`
    }).join('')

    this.openOverlay(`
      <div class="rg-panel rg-meta">
        <div class="rg-screen-head">
          <div class="rg-title-wrap"><h2>墨库</h2><p>攒下的墨屑，换下一次活得更久</p></div>
          <div class="rg-dust"><span>墨屑</span><b>${Math.floor(s.dust)}</b></div>
        </div>
        <div class="rg-meta-body">
          <div class="rg-meta-ups">
            <span class="rg-cap">永久属性</span>
            ${rows}
          </div>
          <div class="rg-meta-side">
            <span class="rg-cap">角色</span>
            <div class="rg-unlocks">${charRows}</div>
            <span class="rg-cap">成就</span>
            <div class="rg-achs">${achRows}</div>
          </div>
        </div>
        <div class="rg-acts"><button class="rg-btn" data-act="backStart">回到开头</button></div>
      </div>`, 'meta')
  }
}

function charName(id: string): string {
  const names: Record<string, string> = { bifeng: '笔锋', shouyan: '守砚', fenshu: '焚书', wuxiang: '无相', moke: '墨客' };
  return names[id] || id
}

function weaponName(id: string): string {
  const names: Record<string, string> = {
    feibai: '飞白', thunder: '惊雷', ember: '炭火', orbit: '环锋', seek: '追魂',
    laser: '一线', turret: '墨塔', poison: '毒瘴', clone: '影身', meteor: '陨石',
    fan: '折扇', bell: '钟鸣',
  };
  return names[id] || id
}
