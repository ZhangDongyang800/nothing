/* 界面层：HUD、招贤榜、点将台、道具栏、局内强化、局外成长、事件、结算。
 *
 * 一条硬规矩：**每帧不碰 React、不重排布局**。HUD 每个读数都与上一次比较，
 * 变了才写 textContent；血条只改 transform。覆盖层是"换一屏内容"，用 innerHTML 一次铺出来。
 * 画布在 DOM 之下，面板都是半透明纸片，棋盘由主控按面板占位算出可用矩形。
 */
import type { HeroId, ItemId, RecruitCard, UnitKind } from './types'
import { UNIT_BY_ID, fusionOf } from './data/units'
import { RARITY_COLOR, RARITY_LABEL } from './data/rarity'
import { HERO_BY_ID } from './data/heroes'
import { ITEM_BY_ID } from './data/items'
import { fmtNum, fmtTime, type SaveData } from './save'

export interface UiHost {
  onAct(act: string, arg: string): void
  onBenchDown(index: number, ev: PointerEvent): void
  onOverlayClose(): void
}

export interface HudView {
  wave: number
  stage: string
  phase: string
  prep: number
  baseHp: number
  baseMax: number
  grain: number
  silver: number
  enemies: number
  kills: number
  progress: number
  hero: HeroId
  skill: number
  skillReady: boolean
  fury: number
  speed: number
  record: number
  boss: boolean
  /** 当前笔势摘要：「横×2 直×1」或「未成阵」 */
  strokeText: string
  strokeOn: boolean
  /** 有笔势正被断笔者压住 */
  strokeDead: boolean
}

export interface InspectView {
  glyph: string
  name: string
  rarity: string
  color: string
  lv: number
  branch: string
  hp: string
  atk: string
  atkSpeed: string
  range: string
  lane: string
  syn: string[]
  note: string
  /** 所属笔势说明，例如「横锋 · 3 连 · 横扫整行」 */
  strokeNote: string
}

export interface TacticChip {
  id: string
  name: string
  lv: number
  glyph: string
  desc: string
}

export interface CardView {
  card: RecruitCard
  affordable: boolean
  /** 下阵后的用途提示：「可融 阵」「可合 Lv.3」「差一成阵」 */
  hint: string
}

export interface BenchView {
  kind: UnitKind
  lv: number
  veteran: boolean
}

export interface ItemView {
  id: ItemId
  charges: number
  armed: boolean
}

export interface StartView {
  bestWave: number
  bestTime: number
  runs: number
  gold: number
  heroes: { id: HeroId; unlocked: boolean; frag: number; need: number }[]
  lastHero: HeroId
  checkpointWave: number
  heroFrag: number
}

export interface ResultView {
  wave: number
  bestWave: number
  newRecord: boolean
  time: number
  kills: number
  damage: number
  income: number
  bestLv: number
  formation: { kind: UnitKind; lv: number; veteran: boolean }[]
  gold: number
  mat: number
  frag: number
  records: { name: string; value: string; best: boolean }[]
  achievements: string[]
}

export interface EventView {
  title: string
  desc: string
  choices: { id: string; label: string; desc: string; cost: string; tone: string }[]
}

export interface ShopView {
  silver: number
  ups: { id: string; name: string; sub?: string; glyph: string; desc: string; lv: number; max: number; price: number; afford: boolean }[]
  items: { id: ItemId; name: string; glyph: string; desc: string; price: number; afford: boolean; rarity: string }[]
}

export interface MetaView {
  gold: number
  mat: number
  frag: number
  bestWave: number
  bestTime: number
  runs: number
  units: { id: UnitKind; name: string; glyph: string; rarity: string; rar: string; color: string; unlocked: boolean; cost: number }[]
  heroes: { id: HeroId; name: string; title: string; glyph: string; color: string; desc: string; unlocked: boolean; cost: number }[]
  ups: { id: string; name: string; sub?: string; glyph: string; desc: string; lv: number; max: number; gold: number; mat: number; afford: boolean; maxed: boolean }[]
  achievements: { id: string; name: string; desc: string; got: boolean; gold: number }[]
  bossKilled: string[]
  tab: string
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

/** 联动 / 合击的通俗解释（悬浮可见），特色名保留、含义说清。 */
const SYN_HINT: Record<string, string> = {
  齐射: '同列齐射：这一列有 3 名以上弓兵，一起放箭',
  刀枪: '刀枪合击：刀兵与枪兵相邻，双方出手更快',
  军械: '军械强化：工程师在相邻格，提升其攻击',
  横锋: '横排合击：3 名以上士兵连成横排，周期横扫这一行道路',
  直锋: '竖列集火：3 名以上士兵连成竖列，集中攻击最前面的敌人',
}

export class LegionUI {
  root: HTMLElement
  canvas: HTMLCanvasElement
  top: HTMLElement
  dock: HTMLElement
  benchEl: HTMLElement
  overlay: HTMLElement
  private host: UiHost
  private el: Record<string, HTMLElement> = {}
  private prev: Record<string, string> = {}
  private cardKey = ''
  private benchKey = ''
  private benchSrc = -1
  private itemKey = ''
  private toastTimer = 0
  private bannerTimer = 0
  private cardHandlers: ((ev: PointerEvent) => void)[] = []

  constructor(hostEl: HTMLElement, host: UiHost) {
    this.host = host
    hostEl.innerHTML = `
      <div class="lg" data-phase="idle">
        <canvas class="lg-canvas" aria-label="纸上军团战场"></canvas>
        <div class="lg-top">
          <div class="lg-hud">
            <div class="lg-hud-wave">
              <div class="lg-wave"><span class="lg-wave-k">第</span><b id="lgWave">1</b><span class="lg-wave-k">波</span></div>
              <div class="lg-hud-sub">
                <div class="lg-stage" id="lgStage">初临山道</div>
                <div class="lg-next" id="lgNext"><span>整备</span><b id="lgPrep">10</b></div>
              </div>
            </div>
            <div class="lg-city">
              <div class="lg-city-top"><span>营寨</span><b id="lgBaseNum">1000</b></div>
              <div class="lg-city-bar"><i id="lgBaseFill"></i></div>
            </div>
            <div class="lg-res">
              <span class="lg-res-chip lg-grain" title="军粮：招募士兵、遣散返还"><i>粮</i><b id="lgGrain">0</b></span>
              <span class="lg-res-chip lg-silver" title="银币：解锁阵地、商店强化、高级招募"><i>银</i><b id="lgSilver">0</b></span>
              <span class="lg-res-chip lg-enemy" title="场上存活敌人"><i>敌</i><b id="lgAlive">0</b></span>
              <span class="lg-res-chip lg-kill" title="本局击杀数"><i>斩</i><b id="lgKills">0</b></span>
              <span class="lg-res-chip lg-stroke" id="lgStroke" title="合击（笔势）：3 名以上士兵连成横排或竖列，发动额外集体攻击"><i>阵</i><b id="lgStrokeNum">—</b></span>
            </div>
            <div class="lg-tools">
              <button class="lg-start-wave" type="button" data-act="start-wave" id="lgStartWave" aria-label="提前开战">开战</button>
              <button class="lg-skill" type="button" data-act="skill" id="lgSkill" aria-label="英雄主动技">
                <span class="lg-skill-ring" id="lgSkillRing"></span>
                <b id="lgSkillName">铁壁</b>
                <em>Q</em>
              </button>
              <button class="lg-round" type="button" data-act="shop" aria-label="商店：本局强化与道具" title="商店：花银币买本局强化与道具">强化</button>
              <button class="lg-round" type="button" data-act="speed" id="lgSpeed" aria-label="倍速">×1</button>
              <button class="lg-round" type="button" data-act="pause" aria-label="暂停">⏸</button>
              <button class="lg-round" type="button" data-act="settings" aria-label="设置">⚙</button>
            </div>
          </div>
          <div class="lg-progress"><u id="lgProgress"></u></div>
        </div>
        <div class="lg-boss" id="lgBoss">
          <div class="lg-boss-top"><b id="lgBossName"></b><i id="lgBossPhase"></i></div>
          <div class="lg-boss-bar"><i id="lgBossFill"></i><u id="lgBossShield"></u></div>
        </div>
        <div class="lg-suggest" id="lgSuggest" hidden>
          <i>提示</i><span id="lgSuggestTxt"></span>
          <button type="button" data-act="suggest-dismiss" aria-label="关闭提示">✕</button>
        </div>
        <div class="lg-coach" id="lgCoach" hidden>
          <div class="lg-coach-step" id="lgCoachStep">1 / 5</div>
          <b id="lgCoachTitle"></b>
          <p id="lgCoachBody"></p>
          <div class="lg-coach-btns">
            <button type="button" data-act="tutorial-skip">跳过引导</button>
            <button type="button" class="is-primary" data-act="tutorial-next" id="lgCoachNext">下一步</button>
          </div>
        </div>
        <div class="lg-dock" data-tab="rec">
          <div class="lg-tabs" role="tablist" aria-label="操作区切换">
            <button type="button" data-tab="rec" class="is-on" aria-selected="true">招募 · 兵营</button>
            <button type="button" data-tab="items" aria-selected="false">道具</button>
          </div>
          <div class="lg-rail-brand lg-dock-brand"><b>纸上军团</b><span>文字布阵 · 无尽守卫</span></div>
          <div class="lg-recruit">
            <div class="lg-sec-head"><span>招募<small>招贤榜</small></span><i>一次 <b id="lgCost">9</b> 粮</i></div>
            <div class="lg-cards" id="lgCards"></div>
            <div class="lg-rec-btns">
              <button type="button" id="lgRerollBtn" data-act="reroll" title="换一批招募卡">刷新 <b id="lgRerollCost">4</b>银</button>
              <button type="button" class="is-premium" data-act="premium" title="花银币招募，更容易出稀有 / 史诗 / 传说士兵">高级招募 <b id="lgPremiumCost">12</b>银</button>
              <button type="button" class="lg-bulk" data-act="bulk" title="按现有军粮能招多少招多少">一键招募</button>
            </div>
          </div>
          <div class="lg-inspect" id="lgInspect">
            <div class="lg-sec-head"><span>选中单位</span><i>点棋子查看</i></div>
            <div class="lg-inspect-body" id="lgInspectBody"><p class="lg-inspect-empty">—</p></div>
          </div>
          <div class="lg-run" id="lgRun">
            <div class="lg-sec-head"><span>战术牌<small>三选一</small></span><i>每 2 波选 1 张</i></div>
            <div class="lg-run-chips" id="lgRunChips"></div>
          </div>
          <div class="lg-items">
            <div class="lg-sec-head"><span>道具</span><i id="lgItemHint">点道具再用</i></div>
            <div class="lg-item-row" id="lgItems"></div>
          </div>
          <div class="lg-bench-wrap">
            <div class="lg-sec-head lg-bench-head"><span>预备兵营<small>点将台</small></span><em class="lg-bench-tip">拖到阵地部署 · 同名同级可合成</em></div>
            <div class="lg-bench" id="lgBench"></div>
          </div>
          <div class="lg-trash" id="lgTrash"><i>遣</i><span>拖到这里遣散 · 返还军粮</span></div>
        </div>
        <div class="lg-banner" id="lgBanner"><b></b><i></i></div>
        <div class="lg-toasts" id="lgToasts"></div>
        <div class="lg-overlay" id="lgOverlay"></div>
      </div>`
    this.root = hostEl.firstElementChild as HTMLElement
    this.canvas = this.root.querySelector('.lg-canvas') as HTMLCanvasElement
    this.top = this.root.querySelector('.lg-top') as HTMLElement
    this.dock = this.root.querySelector('.lg-dock') as HTMLElement
    this.benchEl = this.root.querySelector('#lgBench') as HTMLElement
    this.overlay = this.root.querySelector('#lgOverlay') as HTMLElement
    const ids = ['lgWave', 'lgStage', 'lgPrep', 'lgNext', 'lgBaseNum', 'lgBaseFill', 'lgGrain', 'lgSilver',
      'lgAlive', 'lgKills', 'lgSkill', 'lgSkillRing', 'lgSkillName', 'lgSpeed', 'lgBoss', 'lgBossName',
      'lgBossPhase', 'lgBossFill', 'lgBossShield', 'lgCost', 'lgCards', 'lgRerollBtn', 'lgRerollCost', 'lgPremiumCost',
      'lgItems', 'lgItemHint', 'lgTrash', 'lgBanner', 'lgToasts', 'lgOverlay',
      'lgProgress', 'lgInspectBody', 'lgRunChips', 'lgStrokeNum', 'lgStartWave',
      'lgSuggest', 'lgSuggestTxt', 'lgCoach', 'lgCoachStep', 'lgCoachTitle', 'lgCoachBody', 'lgCoachNext']
    for (const id of ids) {
      const e = this.root.querySelector('#' + id)
      if (e) this.el[id] = e as HTMLElement
    }
    this.root.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement
      if (t.closest('[data-close]')) { this.host.onOverlayClose(); return }
      /* 手机操作区的页签：只切视图，不动任何游戏状态 */
      const tab = t.closest('.lg-tabs [data-tab]') as HTMLElement | null
      if (tab) {
        const key = tab.getAttribute('data-tab') || 'rec'
        this.dock.dataset.tab = key
        for (const sib of this.dock.querySelectorAll('.lg-tabs [data-tab]')) {
          const on = sib === tab
          sib.classList.toggle('is-on', on)
          sib.setAttribute('aria-selected', on ? 'true' : 'false')
        }
        /* 抽屉高度变了，棋盘要让位 */
        window.dispatchEvent(new Event('resize'))
        return
      }
      const b = t.closest('[data-act]') as HTMLElement | null
      if (!b) return
      const act = b.getAttribute('data-act') || ''
      if (!act || act === 'ui') return
      ev.preventDefault()
      this.host.onAct(act, b.getAttribute('data-id') || b.getAttribute('data-arg') || '')
    })
  }

  destroy(): void {
    if (this.toastTimer) window.clearTimeout(this.toastTimer)
    if (this.bannerTimer) window.clearTimeout(this.bannerTimer)
    for (const fn of this.cardHandlers) {
      /* 处理器随节点一起被移除，这里只清引用 */
      void fn
    }
    this.root.remove()
  }

  setPhase(phase: string): void {
    this.root.setAttribute('data-phase', phase)
  }

  /* ---------------- HUD ---------------- */

  private set(id: string, text: string): void {
    if (this.prev[id] === text) return
    this.prev[id] = text
    const e = this.el[id]
    if (e) e.textContent = text
  }

  hud(v: HudView): void {
    this.set('lgWave', String(v.wave))
    this.set('lgStage', v.stage)
    this.set('lgBaseNum', `${Math.ceil(v.baseHp)} / ${Math.round(v.baseMax)}`)
    this.set('lgGrain', fmtNum(v.grain))
    this.set('lgSilver', fmtNum(v.silver))
    this.set('lgAlive', String(v.enemies))
    this.set('lgKills', fmtNum(v.kills))
    const pct = Math.max(0, Math.min(100, Math.round(v.progress * 100)))
    const prog = this.el.lgProgress
    if (prog) prog.style.transform = `scaleX(${(pct / 100).toFixed(3)})`
    this.set('lgPrep', v.phase === 'prep' ? String(Math.ceil(v.prep)) : '战')
    const next = this.el.lgNext
    if (next) {
      next.classList.toggle('is-fight', v.phase !== 'prep')
      const sp = next.querySelector('span')
      if (sp) sp.textContent = v.phase === 'prep' ? '整备' : '交战'
    }
    const fill = this.el.lgBaseFill
    if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, v.baseHp / Math.max(1, v.baseMax))).toFixed(3)})`
    const city = this.root.querySelector('.lg-city')
    if (city) city.classList.toggle('is-low', v.baseHp / v.baseMax < 0.3)
    this.set('lgSpeed', `×${v.speed}`)
    const hero = HERO_BY_ID[v.hero]
    this.set('lgSkillName', hero ? hero.activeName : '')
    const skill = this.el.lgSkill
    if (skill) skill.classList.toggle('is-ready', v.skillReady)
    const ring = this.el.lgSkillRing
    if (ring) ring.style.transform = `scaleX(${Math.max(0, Math.min(1, v.skill)).toFixed(3)})`
    this.root.classList.toggle('is-fury', v.fury > 0)
    this.root.classList.toggle('is-record', v.record > 0 && v.wave > v.record)
    this.set('lgStrokeNum', v.strokeText)
    this.root.classList.toggle('is-stroke', v.strokeOn)
    this.root.classList.toggle('is-stroke-dead', v.strokeDead)
    this.root.classList.toggle('can-start', v.phase === 'prep')
    const boss = this.el.lgBoss
    if (boss) boss.classList.toggle('is-on', v.boss)
  }

  inspect(v: InspectView | null): void {
    const box = this.el.lgInspectBody
    if (!box) return
    if (!v) {
      box.innerHTML = '<p class="lg-inspect-empty">—</p>'
      return
    }
    const chips = v.syn.length ? v.syn.map((s) => `<span title="${esc(SYN_HINT[s] || s)}">${esc(s)}</span>`).join('') : '<span class="is-off">暂无联动</span>'
    box.innerHTML = `
      <div class="lg-inspect-card" style="--rar:${v.color}">
        <div class="lg-inspect-top">
          <b class="lg-inspect-glyph">${esc(v.glyph)}</b>
          <div class="lg-inspect-id"><strong>${esc(v.name)}</strong><em>Lv.${v.lv} · ${esc(v.branch)}</em></div>
          <span class="lg-inspect-seal">${esc(v.rarity)}</span>
        </div>
        <div class="lg-inspect-stats">
          <span><i>攻击</i><b>${esc(v.atk)}</b></span>
          <span><i>攻速</i><b>${esc(v.atkSpeed)}</b></span>
          <span><i>射程</i><b>${esc(v.range)}</b></span>
          <span><i>位次</i><b>${esc(v.lane)}</b></span>
        </div>
        <div class="lg-inspect-syn"><em>联动</em>${chips}</div>
        ${v.strokeNote ? `<p class="lg-inspect-stroke">${esc(v.strokeNote)}</p>` : ''}
        <p class="lg-inspect-note"><em>机制</em>${esc(v.note)}</p>
      </div>`
  }

  tactics(list: TacticChip[]): void {
    const box = this.el.lgRunChips
    const html = list.length
      ? list.map((t) => `<span class="lg-chip" title="${esc(t.desc)}"><b>${esc(t.glyph)}</b>${esc(t.name)}${t.lv > 1 ? `<i>×${t.lv}</i>` : ''}</span>`).join('')
      : '<span class="lg-chip is-empty">第 3 波起，每两波三选一构筑</span>'
    if (box) box.innerHTML = html
  }

  bossBar(name: string, hp: number, max: number, phase: string, shield: number): void {
    this.set('lgBossName', name)
    this.set('lgBossPhase', phase)
    const fill = this.el.lgBossFill
    if (fill) fill.style.transform = `scaleX(${Math.max(0, Math.min(1, hp / Math.max(1, max))).toFixed(3)})`
    const sh = this.el.lgBossShield
    if (sh) {
      sh.style.opacity = shield > 0 ? '1' : '0'
      if (shield > 0) sh.style.transform = `scaleX(${Math.min(1, shield / Math.max(1, max)).toFixed(3)})`
    }
  }

  setCost(grain: number, reroll: number, premium: number, freeRerolls = 0): void {
    this.set('lgCost', String(grain))
    this.set('lgPremiumCost', String(premium))
    const btn = this.el.lgRerollBtn
    if (btn) {
      btn.innerHTML = freeRerolls > 0
        ? `刷新 <b>免费</b> ×${freeRerolls}`
        : `刷新 <b>${reroll}</b>银`
    } else this.set('lgRerollCost', String(reroll))
  }

  /* ---------------- 招贤榜 ---------------- */

  cards(list: CardView[]): void {
    const key = list.map((c) => `${c.card.key}${c.affordable ? 1 : 0}${c.hint}`).join('|')
    if (key === this.cardKey) return
    this.cardKey = key
    const box = this.el.lgCards
    if (!box) return
    box.innerHTML = list.map((c, i) => {
      const def = UNIT_BY_ID[c.card.kind]
      const col = RARITY_COLOR[def.rarity]
      return `<button type="button" class="lg-card is-${def.rarity}${c.affordable ? '' : ' is-poor'}${c.card.veteran ? ' is-vet' : ''}"
        data-act="recruit" data-id="${i}" style="--rar:${col}">
        <span class="lg-card-ribbon"><b>${RARITY_LABEL[def.rarity]}</b><i>${def.role}</i></span>
        <span class="lg-card-plate"><b>${def.glyph}</b></span>
        <span class="lg-card-name">${def.name}${c.card.veteran ? '<i class="lg-card-vet">精锐</i>' : ''}</span>
        <span class="lg-card-desc">${def.desc}</span>
        <span class="lg-card-foot">
          <span class="lg-card-cost"><i>粮</i>${c.card.cost}</span>
          ${c.hint ? `<span class="lg-card-hint">${esc(c.hint)}</span>` : '<span class="lg-card-hint is-off">—</span>'}
        </span>
      </button>`
    }).join('')
  }

  /* ---------------- 点将台 ---------------- */

  renderBench(list: (BenchView | null)[], slots: number, picked = -1, pop = -1): void {
    const marks = list.map((b, i) => {
      const a = picked >= 0 ? list[picked] : null
      if (!a || !b || i === picked) return ''
      if (a.kind === b.kind && a.lv === b.lv && a.lv < 5) return '合'
      return fusionOf(a.kind, b.kind) ? '融' : ''
    })
    const key = list.map((b) => (b ? `${b.kind}${b.lv}${b.veteran ? 1 : 0}` : '-')).join('|') + `#${slots}@${picked}:${marks.join('')}!${pop}`
    if (key === this.benchKey) return
    this.benchKey = key
    const box = this.benchEl
    if (!box) return
    let html = ''
    for (let i = 0; i < slots; i++) {
      const b = list[i]
      if (!b) { html += `<div class="lg-slot is-empty" data-slot="${i}"><i>+</i></div>`; continue }
      const def = UNIT_BY_ID[b.kind]
      const mark = marks[i]
      html += `<div class="lg-slot${picked === i ? ' is-picked' : ''}${mark ? ' is-' + (mark === '融' ? 'fuse' : 'ready') : ''}${pop === i ? ' is-pop' : ''}" data-slot="${i}" style="--rar:${RARITY_COLOR[def.rarity]}">
        <span class="lg-slot-glyph">${def.glyph}</span>
        <span class="lg-slot-name">${def.name}</span>
        <span class="lg-slot-lv">${'ⅠⅡⅢⅣⅤ'[Math.max(0, Math.min(4, b.lv - 1))]}</span>
        ${b.veteran ? '<em>锐</em>' : ''}
        ${mark ? `<b class="lg-slot-mark">${mark}</b>` : ''}
      </div>`
    }
    box.innerHTML = html
    /* pointerdown 单独绑：拖拽要在按下的一瞬间接管，不能等 click */
    this.cardHandlers = []
    box.querySelectorAll<HTMLElement>('.lg-slot').forEach((n) => {
      const idx = Number(n.getAttribute('data-slot'))
      const handler = (ev: PointerEvent) => {
        if (n.classList.contains('is-empty')) return
        this.host.onBenchDown(idx, ev)
      }
      n.addEventListener('pointerdown', handler)
      this.cardHandlers.push(handler)
    })
  }

  benchKeyNow(): string { return this.benchKey }

  /** 拖拽时高亮指针下面的台位：能合就标「合」、能融标「融」，不合就标「×」 */
  benchHover(index: number, mode: 'merge' | 'fuse' | '' | undefined): void {
    const box = this.benchEl
    if (!box) return
    const nodes = box.querySelectorAll<HTMLElement>('.lg-slot')
    nodes.forEach((n) => {
      const i = Number(n.getAttribute('data-slot'))
      n.classList.remove('is-hover', 'is-hover-bad', 'is-srcdrag')
      const mark = n.querySelector('.lg-slot-hover')
      if (mark) mark.remove()
      /* 被拖起来的那张压暗，手里有东西才好判断落点 */
      if (i === this.benchSrc) n.classList.add('is-srcdrag')
      if (i !== index || index < 0) return
      if (mode === 'merge' || mode === 'fuse') {
        n.classList.add('is-hover')
        const tag = document.createElement('b')
        tag.className = 'lg-slot-hover'
        tag.textContent = mode === 'merge' ? '合' : '融'
        n.appendChild(tag)
      } else {
        n.classList.add('is-hover-bad')
      }
    })
  }

  /** 记录当前被拖起的台位（-1 表示没有） */
  benchSource(index: number): void {
    this.benchSrc = index
    this.benchHover(-1, '')
  }

  /* ---------------- 道具 ---------------- */

  items(list: ItemView[]): void {
    const key = list.map((i) => `${i.id}${i.charges}${i.armed ? 1 : 0}`).join('|')
    if (key === this.itemKey) return
    this.itemKey = key
    const box = this.el.lgItems
    if (!box) return
    if (!list.length) {
      box.innerHTML = '<span class="lg-item-empty">还没有道具 · 波次奖励与商人处可得</span>'
      return
    }
    box.innerHTML = list.map((it) => {
      const def = ITEM_BY_ID[it.id]
      const col = RARITY_COLOR[def.rarity]
      return `<button type="button" class="lg-item${it.armed ? ' is-armed' : ''}" data-act="item" data-id="${it.id}"
        title="${esc(def.desc)}" style="--rar:${col}">
        <b>${def.glyph}</b><span>${it.charges}</span>
      </button>`
    }).join('')
  }

  itemHint(text: string): void { this.set('lgItemHint', text) }

  /* ---------------- 提示 ---------------- */

  toast(text: string, tone = ''): void {
    const box = this.el.lgToasts
    if (!box) return
    const d = document.createElement('div')
    d.className = `lg-toast ${tone ? 'is-' + tone : ''}`
    d.textContent = text
    box.appendChild(d)
    while (box.children.length > 3) box.removeChild(box.firstChild as Node)
    window.setTimeout(() => d.classList.add('is-out'), 1000)
    window.setTimeout(() => d.remove(), 1400)
  }

  banner(main: string, sub: string, tone = ''): void {
    const box = this.el.lgBanner
    if (!box) return
    const b = box.querySelector('b')
    const i = box.querySelector('i')
    if (b) b.textContent = main
    if (i) i.textContent = sub
    box.className = `lg-banner is-on ${tone ? 'is-' + tone : ''}`
    if (this.bannerTimer) window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => box.classList.remove('is-on'), 1600)
  }

  /* ---------------- 动态建议 / 新手引导 ---------------- */

  showSuggest(text: string): void {
    const box = this.el.lgSuggest
    const txt = this.el.lgSuggestTxt
    if (!box || !txt) return
    txt.textContent = text
    box.hidden = false
  }

  hideSuggest(): void {
    const box = this.el.lgSuggest
    if (box) box.hidden = true
  }

  showCoach(v: { step: number; total: number; title: string; body: string; last: boolean }): void {
    const box = this.el.lgCoach
    if (!box) return
    this.el.lgCoachStep.textContent = `${v.step} / ${v.total}`
    this.el.lgCoachTitle.textContent = v.title
    this.el.lgCoachBody.textContent = v.body
    this.el.lgCoachNext.textContent = v.last ? '开始游戏' : '下一步'
    box.hidden = false
  }

  hideCoach(): void {
    const box = this.el.lgCoach
    if (box) box.hidden = true
  }

  /* ---------------- 覆盖层 ---------------- */

  hideOverlay(): void {
    this.overlay.classList.remove('is-on')
    this.overlay.innerHTML = ''
  }

  get overlayOn(): boolean { return this.overlay.classList.contains('is-on') }

  private openOverlay(inner: string, cls = ''): void {
    this.overlay.className = `lg-overlay is-on ${cls}`
    this.overlay.innerHTML = inner
  }

  showStart(v: StartView): void {
    const heroes = v.heroes.map((h) => {
      const def = HERO_BY_ID[h.id]
      const label = h.unlocked ? (h.id === v.lastHero ? '出战' : '待命') : `${h.frag}/${h.need}`
      return `<button type="button" class="lg-hero${h.id === v.lastHero ? ' is-on' : ''}${h.unlocked ? '' : ' is-locked'}"
        data-act="${h.unlocked ? 'hero' : 'hero-unlock'}" data-id="${h.id}" style="--hc:${def.color}">
        <span class="lg-hero-glyph">${def.glyph}</span>
        <span class="lg-hero-name">${def.name}<i>${def.title}</i></span>
        <span class="lg-hero-passive">${def.passiveName}</span>
        <span class="lg-hero-text">${esc(def.passiveText)}</span>
        <span class="lg-hero-stat">血 ${def.hp} · 攻 ${def.atk} · 护甲 ${def.armor}</span>
        <span class="lg-hero-skill"><i>Q</i>${def.activeName}</span>
        <span class="lg-hero-tag">${label}</span>
      </button>`
    }).join('')
    const picked = HERO_BY_ID[v.lastHero]
    this.openOverlay(`
      <div class="lg-start">
        <div class="lg-start-art" aria-hidden="true">
          <span class="lg-art-seal">守</span>
          <div class="lg-art-grid">
            <i>刀</i><i>弓</i><i>阵</i>
            <i>枪</i><i>骑</i><i>骁</i>
            <i>刀</i><i>戟</i><i>焰</i>
          </div>
          <div class="lg-art-caption">同名可合 · 异兵可融 · 无尽波次</div>
        </div>
        <div class="lg-start-head">
          <span class="lg-kicker">单人无尽守卫 · 一局一种构筑</span>
          <h1 class="lg-title">纸上军团</h1>
          <p class="lg-sub">招募、合兵、布阵，守住山道。</p>
          <div class="lg-loop"><span>招募</span><i>→</i><span>合成</span><i>→</i><span>布阵</span><i>→</i><span>守卫</span></div>
        </div>
        <div class="lg-start-main">
          <div class="lg-records">
            <span><i>最高波次</i><b>${v.bestWave}</b></span>
            <span><i>最长生存</i><b>${fmtTime(v.bestTime)}</b></span>
            <span><i>已战</i><b>${v.runs}</b></span>
            <span title="局外货币：用于永久成长与解锁"><i>金币</i><b>${fmtNum(v.gold)}</b></span>
          </div>
          <p class="lg-rules">
            敌人只沿土路推进。士兵就是塔，固定攻击、不会被咬住；同名同级可合成升级，特定两种兵可融合成新兵。
          </p>
          <div class="lg-hero-head">英雄 <i>占一格上场 · Q 键手动放技能</i></div>
          <div class="lg-hero-list">${heroes}</div>
          <div class="lg-hero-detail" style="--hc:${picked.color}">
            <b>${picked.name} · ${picked.passiveName}</b>
            <span>${picked.passiveText}</span>
          </div>
        </div>
        <div class="lg-start-side">
          <button type="button" class="lg-go" data-act="start">开始守卫</button>
          ${v.checkpointWave > 0 ? `<button type="button" class="lg-side-btn is-continue" data-act="resume">继续上局 · 第 ${v.checkpointWave} 波</button>` : ''}
          <button type="button" class="lg-side-btn" data-act="meta">局外成长 <i>金币 · 材料 · 兵种解锁</i></button>
          <div class="lg-side-links">
            <button type="button" class="lg-text-btn" data-act="help">玩法说明</button>
            <button type="button" class="lg-text-btn" data-act="settings">设置</button>
          </div>
          <p class="lg-side-note">进度自动存在本机 · 单人无尽</p>
        </div>
      </div>`, 'is-start')
  }

  showBranch(name: string, _glyph: string, color: string, picks: { name: string; glyph: string; desc: string; effect: string }[]): void {
    const cards = picks.map((p, i) => `
      <button type="button" class="lg-branch-card" data-act="branch-pick" data-id="${i === 0 ? 'a' : 'b'}" style="--bc:${color}">
        <span class="lg-branch-glyph">${esc(p.glyph)}</span>
        <b>${esc(p.name)}</b>
        <em>${esc(p.desc)}</em>
        <p>${esc(p.effect)}</p>
        <u>选择此路线</u>
      </button>`).join('')
    this.openOverlay(`
      <div class="lg-branch">
        <div class="lg-modal-head"><span class="lg-kicker">3 级 · 二选一</span><h2>${esc(name)}：选择强化路线</h2></div>
        <p class="lg-branch-lead">选择一种强化方向，改变这名士兵的攻击方式。选定后本局不能更改。</p>
        <div class="lg-branch-row">${cards}</div>
      </div>`, 'is-branch')
  }

  showDraft(picks: { id: string; name: string; glyph: string; tag: string; desc: string }[]): void {
    const cards = picks.map((p, i) => `
      <button type="button" class="lg-draft-card" data-act="draft-pick" data-id="${i}">
        <span class="lg-draft-tag">${esc(p.tag)}</span>
        <span class="lg-draft-glyph">${esc(p.glyph)}</span>
        <b>${esc(p.name)}</b>
        <p>${esc(p.desc)}</p>
        <u>获得此牌</u>
      </button>`).join('')
    this.openOverlay(`
      <div class="lg-draft">
        <div class="lg-modal-head"><span class="lg-kicker">战术牌 · 三选一</span><h2>选一张战术牌</h2></div>
        <p class="lg-draft-lead">每张牌改变本局打法（范围 / 连锁 / 控制等），不只是加攻击。选完继续下一波。</p>
        <div class="lg-draft-row">${cards}</div>
      </div>`, 'is-draft')
  }

  showHelp(): void {
    this.openOverlay(`
      <div class="lg-modal lg-help">
        <div class="lg-modal-head"><h2>玩法速览</h2><button type="button" class="lg-x" data-close>✕</button></div>
        <div class="lg-help-body">
          <p><b>目标。</b>敌人只沿中间的土路走向你的营寨。营寨生命归零，本局结束。守住越多波，结算奖励越多。</p>
          <p><b>招募与部署。</b>点「招募」花军粮招士兵，先进预备兵营；再把士兵拖到阵地空格上。士兵就是塔，固定在格子里攻击，不会被敌人咬住。</p>
          <p><b>合击（笔势）。</b>3 名以上士兵在同一横排<b>相邻连成一线</b>＝横锋，周期横扫那一行道路；在同一竖列相邻连线＝直锋，集火最前面的敌人。格子上的墨线就是合击范围，被敌人压住会暂时失效。</p>
          <p><b>合成。</b>两个<b>同名同级</b>士兵拖到一起＝升 1 级（最高 5 级）。合成会少 1 名士兵，可能拆断一条合击——拖拽时会提前标出「会断 n 条合击」。</p>
          <p><b>融合。</b>特定两种兵合成出新兵种：枪＋骑＝骁骑，刀＋枪＝戟兵，弓＋法＝焰弓。</p>
          <p><b>强化路线（专精）。</b>士兵到 3 级时二选一，改变它的攻击方式（如枪兵选穿透或控制），本局不能改。</p>
          <p><b>两种货币。</b>军粮＝招兵；银币＝解锁阵地、商店强化、高级招募。局外另有金币 / 材料 / 碎片，用于永久成长。</p>
          <p><b>危险敌人。</b>断笔者贴近阵线后会暂停该线合击，击败它立刻恢复，优先击杀；火雷兵靠近营寨自爆；裂虫死亡分裂。每 10 波一个 Boss，技能首次出现会有说明。</p>
        </div>
        <div class="lg-modal-foot">
          <button type="button" class="lg-side-btn" data-act="tutorial">重看新手引导</button>
          <button type="button" class="lg-side-btn" data-close>知道了</button>
        </div>
      </div>`, 'is-modal')
  }

  showPause(v: { wave: number; time: string; kills: number }): void {
    this.openOverlay(`
      <div class="lg-modal lg-pause">
        <div class="lg-modal-head"><h2>暂停</h2></div>
        <p class="lg-pause-line">第 <b>${v.wave}</b> 波 · 已守 ${v.time} · 斩 ${v.kills}</p>
        <div class="lg-pause-btns">
          <button type="button" class="lg-go" data-act="resume-run">继续守卫</button>
          <button type="button" class="lg-side-btn" data-act="meta">局外成长</button>
          <button type="button" class="lg-side-btn" data-act="settings">设置</button>
          <button type="button" class="lg-side-btn" data-act="quit">返回游戏厅</button>
        </div>
        <p class="lg-side-note">关闭机台会自动存档到本波整备期</p>
      </div>`, 'is-modal')
  }

  showSettings(s: SaveData, muted: boolean): void {
    this.openOverlay(`
      <div class="lg-modal lg-set">
        <div class="lg-modal-head"><h2>设置</h2><button type="button" class="lg-x" data-close>✕</button></div>
        <label class="lg-range"><span>音效 <b>${Math.round(s.settings.sfx * 100)}</b></span>
          <input type="range" min="0" max="100" value="${Math.round(s.settings.sfx * 100)}" data-vol="sfx">
        </label>
        <label class="lg-range"><span>音乐 <b>${Math.round(s.settings.bgm * 100)}</b></span>
          <input type="range" min="0" max="100" value="${Math.round(s.settings.bgm * 100)}" data-vol="bgm">
        </label>
        <div class="lg-toggles">
          <button type="button" class="lg-toggle${s.settings.quality === 'high' ? ' is-on' : ''}" data-act="quality">画质 高</button>
          <button type="button" class="lg-toggle${s.settings.dmgNumbers ? ' is-on' : ''}" data-act="dmg">伤害飘字</button>
          <button type="button" class="lg-toggle${s.settings.shake ? ' is-on' : ''}" data-act="shake">屏幕震动</button>
          <button type="button" class="lg-toggle${muted ? ' is-on' : ''}" data-act="mute">全部静音</button>
        </div>
        <div class="lg-modal-foot">
          <button type="button" class="lg-side-btn lg-danger" data-act="wipe">清空全部进度</button>
          <button type="button" class="lg-side-btn" data-close>关闭</button>
        </div>
        <p class="lg-side-note">存档在本机 localStorage：刷新页面、重开浏览器都不会丢。</p>
      </div>`, 'is-modal')
    const root = this.overlay
    root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const kind = inp.getAttribute('data-vol')
        const val = Number(inp.value) / 100
        this.host.onAct('vol-' + kind, String(val))
        const b = inp.parentElement?.querySelector('b')
        if (b) b.textContent = inp.value
      })
    })
  }

  showShop(v: ShopView): void {
    const ups = v.ups.map((u) => `
      <div class="lg-shop-row${u.lv >= u.max ? ' is-maxed' : ''}">
        <span class="lg-shop-glyph">${u.glyph}</span>
        <div class="lg-shop-txt"><b>${u.name} <i>${u.lv}/${u.max}</i></b>${u.sub ? `<span class="lg-sub">${u.sub}</span>` : ''}<span>${u.desc}</span></div>
        <button type="button" data-act="buyup" data-id="${u.id}" ${u.lv >= u.max || !u.afford ? 'disabled' : ''}>
          ${u.lv >= u.max ? '满' : u.price + ' 银'}
        </button>
      </div>`).join('')
    const items = v.items.map((i) => `
      <div class="lg-shop-row">
        <span class="lg-shop-glyph" style="color:${RARITY_COLOR[i.rarity as keyof typeof RARITY_COLOR] || '#6b6255'}">${i.glyph}</span>
        <div class="lg-shop-txt"><b>${i.name}</b><span>${i.desc}</span></div>
        <button type="button" data-act="buyitem" data-id="${i.id}" ${i.afford ? '' : 'disabled'}>${i.price} 银</button>
      </div>`).join('')
    this.openOverlay(`
      <div class="lg-modal lg-shop">
        <div class="lg-modal-head">
          <h2>商店</h2>
          <span class="lg-shop-silver">银 <b>${fmtNum(v.silver)}</b></span>
          <button type="button" class="lg-x" data-close>✕</button>
        </div>
        <p class="lg-shop-note">花银币购买，只在本局有效；每项有上限，不能无限叠加。</p>
        <div class="lg-shop-cols">
          <div class="lg-shop-col"><h3>全军强化</h3>${ups}</div>
          <div class="lg-shop-col"><h3>道具</h3>${items}</div>
        </div>
      </div>`, 'is-modal')
  }

  showEvent(v: EventView): void {
    const btns = v.choices.map((c) => `
      <button type="button" class="lg-event-btn${c.tone ? ' is-' + c.tone : ''}" data-act="event" data-id="${c.id}">
        <b>${c.label}</b><span>${c.desc}</span><i>${c.cost}</i>
      </button>`).join('')
    this.openOverlay(`
      <div class="lg-modal lg-event">
        <div class="lg-modal-head"><h2>${v.title}</h2></div>
        <p class="lg-event-desc">${v.desc}</p>
        <div class="lg-event-list">${btns}</div>
      </div>`, 'is-modal')
  }

  showResults(v: ResultView): void {
    const form = v.formation.length
      ? v.formation.map((f) => {
        const def = UNIT_BY_ID[f.kind]
        return `<span class="lg-form-chip" style="--rar:${RARITY_COLOR[def.rarity]}">${def.glyph}<i>${'ⅠⅡⅢⅣⅤ'[Math.max(0, Math.min(4, f.lv - 1))]}</i>${f.veteran ? '<em>锐</em>' : ''}</span>`
      }).join('')
      : '<span class="lg-form-none">最后一格也没守住</span>'
    const recs = v.records.map((r) => `<li class="${r.best ? 'is-best' : ''}"><span>${r.name}</span><b>${r.value}</b></li>`).join('')
    const ach = v.achievements.length ? `<div class="lg-res-ach"><h3>新成就</h3>${v.achievements.map((a) => `<span>${a}</span>`).join('')}</div>` : ''
    this.openOverlay(`
      <div class="lg-modal lg-result">
        <div class="lg-modal-head">
          <h2>${v.newRecord ? '新纪录' : '营寨破了'}</h2>
          <span class="lg-res-wave">第 <b>${v.wave}</b> 波</span>
        </div>
        <p class="lg-res-line">${v.newRecord ? '你把这面纸旗插到了最高的地方。' : `历史最高 ${v.bestWave} 波 · 再往前一步就破了。`}</p>
        <div class="lg-res-grid">
          <div><span>生存时间</span><b>${fmtTime(v.time)}</b></div>
          <div><span>斩敌</span><b>${fmtNum(v.kills)}</b></div>
          <div><span>累计伤害</span><b>${fmtNum(v.damage)}</b></div>
          <div><span>资源收益</span><b>${fmtNum(v.income)}</b></div>
          <div><span>最强单位</span><b>${v.bestLv ? ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'][Math.max(0, Math.min(4, v.bestLv - 1))] + ' 级' : '—'}</b></div>
          <div><span>带走</span><b>${fmtNum(v.gold)} 金币 · ${fmtNum(v.mat)} 材料 · ${fmtNum(v.frag)} 碎片</b></div>
        </div>
        <div class="lg-res-form"><h3>最终军团</h3><div>${form}</div></div>
        <div class="lg-res-cols">
          <div><h3>本局记录</h3><ul>${recs}</ul></div>
          <div class="lg-res-achwrap">${ach}</div>
        </div>
        <div class="lg-res-btns">
          <button type="button" class="lg-go" data-act="again">再来一局</button>
          <button type="button" class="lg-side-btn" data-act="meta">局外成长</button>
          <button type="button" class="lg-side-btn" data-act="quit">返回游戏厅</button>
        </div>
      </div>`, 'is-modal')
  }

  showMeta(v: MetaView): void {
    const units = v.units.map((u) => `
      <div class="lg-unlock${u.unlocked ? ' is-on' : ''}" style="--rar:${u.rar}">
        <span class="lg-unlock-glyph" style="color:${u.color}">${u.glyph}</span>
        <div><b>${u.name}</b><span>${u.rarity}</span></div>
        ${u.unlocked ? '<i>已解锁</i>' : `<button type="button" data-act="unlock-unit" data-id="${u.id}">材料 ${u.cost}</button>`}
      </div>`).join('')
    const heroes = v.heroes.map((h) => `
      <div class="lg-unlock${h.unlocked ? ' is-on' : ''}" style="--rar:#b8860b">
        <span class="lg-unlock-glyph" style="color:${h.color}">${h.glyph}</span>
        <div><b>${h.name}<em>${h.title}</em></b><span>${h.desc}</span></div>
        ${h.unlocked ? '<i>已解锁</i>' : `<button type="button" data-act="unlock-hero" data-id="${h.id}">碎片 ${h.cost}</button>`}
      </div>`).join('')
    const ups = v.ups.map((u) => `
      <div class="lg-meta-row${u.maxed ? ' is-maxed' : ''}">
        <span class="lg-meta-glyph">${u.glyph}</span>
        <div><b>${u.name} <i>${u.lv}/${u.max}</i></b>${u.sub ? `<span class="lg-sub">${u.sub}</span>` : ''}<span>${u.desc}</span></div>
        <button type="button" data-act="metaup" data-id="${u.id}" ${u.maxed || !u.afford ? 'disabled' : ''}>
          ${u.maxed ? '满级' : `${u.gold} 金币 · ${u.mat} 材料`}
        </button>
      </div>`).join('')
    const achs = v.achievements.map((a) => `
      <div class="lg-ach${a.got ? ' is-on' : ''}"><b>${a.name}</b><span>${a.desc}</span><i>${a.got ? '已成' : '+' + a.gold + ' 金币'}</i></div>`).join('')
    const tab = v.tab || 'up'
    const tabBtn = (id: string, label: string): string => `<button type="button" class="lg-tab${tab === id ? ' is-on' : ''}" data-act="tab" data-id="${id}">${label}</button>`
    this.openOverlay(`
      <div class="lg-modal lg-meta">
        <div class="lg-modal-head">
          <h2>局外成长</h2>
          <div class="lg-meta-res"><span>金币 <b>${fmtNum(v.gold)}</b></span><span>材料 <b>${fmtNum(v.mat)}</b></span><span>碎片 <b>${fmtNum(v.frag)}</b></span></div>
          <button type="button" class="lg-x" data-close>✕</button>
        </div>
        <div class="lg-meta-top"><span>最高波次 <b>${v.bestWave}</b></span><span>最长生存 <b>${fmtTime(v.bestTime)}</b></span><span>已战 <b>${v.runs}</b> 局</span></div>
        <div class="lg-tabs">${tabBtn('up', '永久强化')}${tabBtn('unit', '兵种')}${tabBtn('hero', '英雄')}${tabBtn('ach', '成就')}</div>
        <div class="lg-meta-body">
          ${tab === 'up' ? `<div class="lg-meta-list">${ups}</div>` : ''}
          ${tab === 'unit' ? `<p class="lg-tab-note">解锁后就会出现在招贤榜里。材料来自每一局的结算。</p><div class="lg-meta-list">${units}</div>` : ''}
          ${tab === 'hero' ? `<p class="lg-tab-note">英雄碎片只从结算与成就里来。英雄占棋盘一格，主动技手动释放。</p><div class="lg-meta-list">${heroes}</div>` : ''}
          ${tab === 'ach' ? `<div class="lg-ach-grid">${achs}</div>` : ''}
        </div>
        <div class="lg-modal-foot"><button type="button" class="lg-side-btn" data-close>返回</button></div>
      </div>`, 'is-modal')
  }

  /* ---------------- 拖拽用的几何 ---------------- */

  metrics(): { top: number; dockW: number; dockH: number; railW: number; bench: DOMRect; trash: DOMRect | null; canvas: DOMRect } {
    const dockR = this.dock.getBoundingClientRect()
    const canvas = this.canvas.getBoundingClientRect()
    const trash = this.el.lgTrash
    const rail = this.root.querySelector('.lg-rail') as HTMLElement | null
    const railR = rail ? rail.getBoundingClientRect() : null
    return {
      top: this.top.getBoundingClientRect().height,
      dockW: dockR.width,
      dockH: dockR.height,
      railW: railR && railR.width > 20 ? railR.width : 0,
      bench: this.benchEl.getBoundingClientRect(),
      trash: trash ? trash.getBoundingClientRect() : null,
      canvas,
    }
  }

  slotRect(i: number): DOMRect | null {
    const n = this.benchEl.querySelector<HTMLElement>(`[data-slot="${i}"]`)
    return n ? n.getBoundingClientRect() : null
  }
}
