/* 「墨潮」主循环。
 *
 * 这里只做"编排"：谁先更新、什么时候暂停、什么时候结算。
 * 武器的打法在 data/weapons.ts，敌人的走法在 data/enemies.ts，Boss 的招式在
 * data/bosses.ts，画面在 draw.ts，界面在 ui.ts —— 这一份负责把它们串起来。
 *
 * 性能口径（都在同步里量过）：
 *   · 对象池：敌人 300 / 弹体 520 / 敌弹 260 / 宝石 320 / 粒子 760 / 数字 70；
 *   · 碰撞：均匀网格（grid.ts），不是每帧两两比较；
 *   · 屏幕外只更新不画，离得太远的敌人回收；
 *   · 暂停 / 升级 / 结算时不跑模拟，画面也只重画一帧。
 */
import type {
  Beam, Chain, Enemy, EShot, FloatText, GameApi, Gem, Meteor, Particle, Pickup, Player,
  PlayerStats, Shockwave, Shot, Turret, WeaponInst, WeaponLevel, Zone,
} from './types';
import { WEAPON_BY_ID, WEAPON_DEFS, statsOf, isEvolvedAvailable } from './data/weapons';
import { PASSIVES, PASSIVE_BY_ID } from './data/passives';
import { CHARS, CHAR_BY_ID, type CharDef } from './data/chars';
import { ENEMY_BY_ID, pickEnemyKind } from './data/enemies';
import { BOSS_BY_ID, BOSS_TIMES, bossForIndex, type BossDef } from './data/bosses';
import { META_BY_ID, metaCost, MILESTONES, ACHIEVEMENTS, stageName } from './data/meta';
import { EVENTS, EVENT_BY_ID, MERCHANT_GOODS, CHEST_KINDS, type EventDef } from './data/events';
import { loadSave, writeSave, fmtTime, type SaveData, type Checkpoint } from './save';
import { RogueUI, type HudView, type OfferView, type GoodView } from './ui';
import { GameAudio } from './audio';
import { Grid } from './grid';
import { drawGame } from './draw';

type Phase = 'idle' | 'start' | 'playing' | 'levelup' | 'paused' | 'over' | 'chest' | 'merchant' | 'meta';

interface ShopRow { def: (typeof MERCHANT_GOODS)[number]; cost: number; sold: boolean }
interface Reward { id: string; name: string; desc: string; color: string; glyph: string }

const MAX_ENEMIES = 300;
const MAX_SHOTS = 520;
const MAX_ESHOTS = 260;
const MAX_GEMS = 320;
const MAX_PARTS = 760;
const MAX_TEXTS = 70;
const MAX_ZONES = 56;
const MAX_BEAMS = 48;
const MAX_CHAINS = 24;
const MAX_METEORS = 32;
const MAX_TURRETS = 16;
const MAX_WAVES = 40;

function blankEnemy(): Enemy {
  return {
    active: false, id: 0, kind: '', name: '', x: 0, y: 0, vx: 0, vy: 0, r: 10, hp: 0, maxHp: 0,
    dmg: 0, speed: 0, xp: 0, gold: 0, elite: false, boss: false, bossId: '', hitT: 0, atkCd: 0,
    st: 0, st2: 0, phase: 1, shield: 0, shieldMax: 0, shieldT: 0, slowT: 0, spawnT: 0,
    orbitCd: 0, pack: false, pattern: 0, phaseT: 0, enrage: false, dead: false, dieT: 0,
    hx: 0, hy: 0, teleT: 0, teleKind: '',
  };
}

function blankShot(): Shot {
  return {
    active: false, x: 0, y: 0, vx: 0, vy: 0, r: 4, dmg: 0, pierce: 0, life: 0, age: 0, kind: 'ink',
    color: '#26221e', hitIds: [], homing: 0, target: null, explodeR: 0, explodeDmg: 0, split: 0,
    returnAt: 0, returned: false, slowT: 0, spin: 0, trail: false, width: 6, healPer: 0,
  };
}

function blankGem(): Gem {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, val: 0, kind: 'xp', age: 0, r: 5 };
}

function blankPart(): Particle {
  return { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, age: 0, size: 3, color: '#26221e', kind: 'dot', spin: 0, rot: 0 };
}

function blankText(): FloatText {
  return { active: false, x: 0, y: 0, vy: 0, life: 0, age: 0, text: '', kind: 'hit', size: 13 };
}

function newPlayer(): Player {
  return {
    x: 0, y: 0, r: 13, hp: 100, maxHp: 100, level: 1, xp: 0, xpNext: 12, gold: 0, kills: 0,
    dmg: 0, invuln: 0, dashT: 0, dashCd: 0, vx: 0, vy: 0, face: 0, streak: 0, streakT: 0,
    buffDmg: 0, buffSpeed: 0, buffArmor: 0, shield: 0, slowT: 0,
  };
}

function nextXp(level: number): number {
  return Math.round(12 + (level - 1) * 7 + Math.pow(level, 1.55) * 2.4);
}

/** 升级卡上的「现状」行：只写玩家真能比较的几个数，不写形容词。 */
function weaponStatsLine(l: WeaponLevel): string {
  const parts: string[] = [`伤害 ${l.dmg}`];
  if (l.count > 1) parts.push(`${l.count} 发`);
  parts.push(`间隔 ${l.cd}s`);
  if (l.pierce > 0) parts.push(`穿透 ${l.pierce}`);
  return parts.join(' · ');
}

function weaponDeltas(cur: WeaponLevel, next: WeaponLevel): string[] {
  const out: string[] = [];
  const dmg = Math.round((next.dmg - cur.dmg) * 10) / 10;
  if (dmg > 0) out.push(`伤害 +${dmg}`);
  if (next.cd < cur.cd) out.push(`间隔 -${Math.round((cur.cd - next.cd) * 100) / 100}s`);
  if (next.count > cur.count) out.push(`弹数 +${next.count - cur.count}`);
  if (next.pierce > cur.pierce) out.push(`穿透 +${next.pierce - cur.pierce}`);
  return out;
}

export class Game implements GameApi {
  save: SaveData;
  audio = new GameAudio();
  ui: RogueUI;
  ctx: CanvasRenderingContext2D;
  view = { w: 960, h: 600, dpr: 1 };

  phase: Phase = 'idle';
  char: CharDef = CHARS[0];
  player: Player = newPlayer();
  statsData: PlayerStats;
  weapons: WeaponInst[] = [];
  passives: Record<string, number> = {};
  rerolls = 0;

  enemies: Enemy[] = [];
  shots: Shot[] = [];
  eshots: EShot[] = [];
  zones: Zone[] = [];
  beams: Beam[] = [];
  chains: Chain[] = [];
  meteors: Meteor[] = [];
  turrets: Turret[] = [];
  gems: Gem[] = [];
  pickups: Pickup[] = [];
  particles: Particle[] = [];
  texts: FloatText[] = [];
  shockwaves: Shockwave[] = [];
  boss: Enemy | null = null;

  grid = new Grid();
  camX = 0;
  camY = 0;
  /* 相机缩放：1 = 屏幕宽就是世界宽。小于 1 能看到更远，
     追杀 / 走位才不会被屏幕边缘切掉。手机再放远一档。 */
  zoom = 0.82;
  shake = 0;
  time = 0;
  elapsed = 0;
  timeScale = 1;
  rain = 0;

  private rngState = 233;
  private idSeq = 1;
  private spawnTimer = 0;
  private waveTimer = 0;
  private eventTimer = 40;
  private chestTimer = 70;
  private merchantTimer = 200;
  private saveTimer = 0;
  private hudTimer = 0;
  private abilityCd = 0;
  private bossIndex = 0;
  private milestoneIndex = 0;
  private packAlive = 0;
  private pendingLevels = 0;
  private offers: OfferView[] = [];
  private rewards: Reward[] = [];
  private shop: ShopRow[] = [];
  private bonusSpeed = 0;
  private bonusArmor = 0;
  private bonusDust = 0;
  private bossKills = 0;
  private evolutions = 0;
  private totalDmg = 0;
  private reviveUsed = false;
  /** 连斩：2.2 秒内没有新击杀就断，挨打立即断。不是分数，是"这一口气还在不在"。 */
  private combo = 0;
  private comboT = 0;
  private keys = new Set<string>();
  private stickX = 0;
  private stickY = 0;
  private raf = 0;
  private lastTs = 0;
  private needDraw = false;
  private mutedSfx = 0;
  private qbuf: Enemy[] = [];

  /* 进化重大档演出：聚合 → 爆环 → 印章，纯视觉，不暂停操作 */
  evoAnim = 0;
  evoName = '';
  evoColor = '';
  /* 演出未结束前压住下一张升级卡，避免印章被新弹层盖住 */
  private evoHold = false;
  /* 预警计时：探针量 telegraph → 命中的帧差用 */
  private lastTeleAt = -1;
  private lastTeleKind = '';
  private lastHitAt = -1;
  private lastHitKind = '';

  fps = 60;
  maxEnemiesSeen = 0;
  maxShotsSeen = 0;
  private resizeObs: ResizeObserver | null = null;
  private onKeyDown = (e: KeyboardEvent) => this.keyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  /* 鼠标按住拖动 = 虚拟摇杆：桌面只用键盘也能玩，但没有键盘的人不该被挡在门外 */
  private ptrOn = false;
  private ptrX = 0;
  private ptrY = 0;
  private onPtrDown = (e: PointerEvent) => {
    if (this.phase !== 'playing') return;
    this.ptrOn = true;
    this.ptrX = e.clientX; this.ptrY = e.clientY;
    try { this.ui.canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  };
  private onPtrMove = (e: PointerEvent) => {
    if (!this.ptrOn || this.phase !== 'playing') return;
    const dx = e.clientX - this.ptrX, dy = e.clientY - this.ptrY;
    const len = Math.hypot(dx, dy);
    if (len < 10) { this.stickX = 0; this.stickY = 0; return }
    const k = Math.min(1, len / 58);
    this.stickX = dx / len * k;
    this.stickY = dy / len * k;
  };
  private onPtrUp = () => { this.ptrOn = false; this.stickX = 0; this.stickY = 0 };

  constructor(hostEl: HTMLElement) {
    this.save = loadSave();
    this.statsData = this.buildStats(CHARS[0]);
    this.ui = new RogueUI(hostEl, {
      onAction: (a, b) => this.handleAction(a, b),
      onStick: (x, y, active) => {
        this.stickX = active ? x : 0;
        this.stickY = active ? y : 0;
      },
      onDash: () => this.tryDash(),
      onVolume: (kind, v) => {
        if (kind === 'sfx') this.save.settings.sfx = v
        else this.save.settings.bgm = v
        this.audio.setVolumes(this.save.settings.sfx, this.save.settings.bgm)
        writeSave(this.save)
      },
    });
    const c = this.ui.canvas.getContext('2d');
    if (!c) throw new Error('canvas 2d unavailable');
    this.ctx = c;
    this.allocPools();
    this.layout();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => { this.layout(); this.needDraw = true });
      this.resizeObs.observe(this.ui.canvas.parentElement || this.ui.canvas);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.ui.canvas.addEventListener('pointerdown', this.onPtrDown);
    this.ui.canvas.addEventListener('pointermove', this.onPtrMove);
    this.ui.canvas.addEventListener('pointerup', this.onPtrUp);
    this.ui.canvas.addEventListener('pointercancel', this.onPtrUp);
    this.audio.setVolumes(this.save.settings.sfx, this.save.settings.bgm);
    this.ui.setAudioLabel(this.save.settings.sfx > 0);
  }

  destroy(): void {
    this.stopLoop();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.ui.canvas.removeEventListener('pointerdown', this.onPtrDown);
    this.ui.canvas.removeEventListener('pointermove', this.onPtrMove);
    this.ui.canvas.removeEventListener('pointerup', this.onPtrUp);
    this.ui.canvas.removeEventListener('pointercancel', this.onPtrUp);
    if (this.resizeObs) this.resizeObs.disconnect();
    this.audio.stopBgm();
    this.audio.suspend();
    this.ui.destroy();
  }

  private allocPools(): void {
    this.enemies = Array.from({ length: MAX_ENEMIES }, blankEnemy);
    this.shots = Array.from({ length: MAX_SHOTS }, blankShot);
    this.eshots = Array.from({ length: MAX_ESHOTS }, () => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, r: 4, dmg: 0, life: 0, age: 0, color: '#26221e', homing: 0, kind: '', spin: 0,
    } as EShot));
    this.zones = Array.from({ length: MAX_ZONES }, () => ({
      active: false, x: 0, y: 0, r: 0, life: 0, age: 0, dmg: 0, tick: 0, type: '', color: '', slow: 0, buff: '', follow: false,
    } as Zone));
    this.beams = Array.from({ length: MAX_BEAMS }, () => ({
      active: false, x1: 0, y1: 0, x2: 0, y2: 0, width: 0, life: 0, age: 0, dmg: 0, color: '', hitIds: [], kind: '',
    } as Beam));
    this.chains = Array.from({ length: MAX_CHAINS }, () => ({ active: false, x: 0, y: 0, points: [], life: 0, age: 0, color: '' } as Chain));
    this.meteors = Array.from({ length: MAX_METEORS }, () => ({ active: false, x: 0, y: 0, t: 0, delay: 0, dmg: 0, r: 0, color: '' } as Meteor));
    this.turrets = Array.from({ length: MAX_TURRETS }, () => ({
      active: false, x: 0, y: 0, life: 0, cd: 0, cool: 0, dmg: 0, range: 0, color: '', kind: 'turret', src: '', r: 10,
    } as Turret));
    this.gems = Array.from({ length: MAX_GEMS }, blankGem);
    this.pickups = Array.from({ length: 8 }, () => ({ active: false, x: 0, y: 0, kind: 'chest', age: 0, bob: 0 } as Pickup));
    this.particles = Array.from({ length: MAX_PARTS }, blankPart);
    this.texts = Array.from({ length: MAX_TEXTS }, blankText);
    this.shockwaves = Array.from({ length: MAX_WAVES }, () => ({
      active: false, x: 0, y: 0, r: 0, life: 0, age: 0, color: '', width: 0,
    } as Shockwave));
  }

  private layout(): void {
    const host = this.ui.canvas.parentElement;
    const w = Math.max(320, Math.round(host ? host.clientWidth : window.innerWidth));
    const h = Math.max(300, Math.round(host ? host.clientHeight : window.innerHeight - 100));
    const raw = window.devicePixelRatio || 1;
    const dpr = this.save.settings.quality === 'low' ? 1 : Math.min(1.5, raw);
    this.view = { w, h, dpr };
    /* 相机按屏幕宽归一：以前固定 0.82，1440 宽的机器能看到 1756 世界单位、
       1920 能看到 2341 —— 屏幕越大场面越空、还越简单，墨点只有十几像素。
       现在让可见世界宽稳定在 1200 上下（0.82–1.3 之间钳住），
       换台显示器看到的是同一场仗。手机仍走 0.74 那一档。 */
    this.zoom = w < 620 ? 0.74 : Math.min(1.3, Math.max(0.82, w / 1200));
    this.ui.canvas.width = Math.round(w * dpr);
    this.ui.canvas.height = Math.round(h * dpr);
    /* 改分辨率和窗口尺寸会清空画布。循环停着（暂停里改画面档）时必须当场补画一次，
       否则暂停页背后是一块空纸。 */
    if (!this.raf && this.phase !== 'idle' && this.phase !== 'start') drawGame(this);
  }

  /* ================= 生命周期 ================= */
  open(): void {
    if (this.phase !== 'idle') return;
    this.save = loadSave();
    this.audio.setVolumes(this.save.settings.sfx, this.save.settings.bgm);
    this.phase = 'start';
    this.camX = 0; this.camY = 0;
    this.ui.showStart(this.startData());
    this.ui.setCharName(this.char.name);
    this.layout();
    this.needDraw = true;
    this.drawStart();
  }

  close(): void {
    if (this.phase === 'idle') return;
    if (this.phase !== 'start' && this.phase !== 'over' && this.phase !== 'meta') this.saveCheckpoint();
    this.stopLoop();
    this.audio.stopBgm();
    this.audio.suspend();
    this.ui.hideOverlay();
    this.phase = 'idle';
    this.keys.clear();
    this.stickX = 0; this.stickY = 0;
  }

  replay(): void {
    if (this.phase === 'over' || this.phase === 'start') { this.startRun(this.char.id); return }
    if (this.phase === 'playing') this.pauseGame();
  }

  /** Esc / P：返回 true 表示这一次按键已经被游戏消费，不该关掉机台。 */
  escape(): boolean {
    if (this.phase === 'playing') { this.pauseGame(); return true }
    if (this.phase === 'paused') { this.resumeGame(); return true }
    if (this.phase === 'chest') { this.resumeGame(); return true }
    if (this.phase === 'merchant') { this.leaveShop(); return true }
    if (this.phase === 'levelup') return true
    if (this.phase === 'over') { this.goStart(); return true }
    if (this.phase === 'meta') { this.goStart(); return true }
    return false
  }

  private startData() {
    const unlocked = ['moke', 'bifeng', 'shouyan', 'fenshu', ...this.save.chars];
    return {
      chars: CHARS,
      unlocked,
      save: this.save,
      checkpoint: this.save.checkpoint,
      lastChar: this.save.lastChar,
    };
  }

  private goStart(): void {
    this.audio.stopBgm();
    this.phase = 'start';
    this.ui.showStart(this.startData());
    this.ui.setCharName(this.char.name);
    this.saveCheckpointClear();
    this.needDraw = true;
    this.drawStart();
  }

  private drawStart(): void {
    this.player = newPlayer();
    this.camX = 0; this.camY = 0;
    this.enemies.forEach(e => { e.active = false });
    this.weapons = [];
    this.statsData = this.buildStats(this.char);
    drawGame(this);
  }

  /* ================= 开局 / 结算 ================= */
  startRun(charId: string, cp?: Checkpoint | null): void {
    const ch = CHAR_BY_ID[charId] || CHARS[0];
    if (ch.unlock > 0 && !this.save.chars.includes(ch.id)) {
      this.toast('这个角色还没解锁');
      return;
    }
    this.char = ch;
    this.save.lastChar = ch.id;
    writeSave(this.save);
    this.resetRun();
    this.player = newPlayer();
    const meta = this.save.meta;
    this.weapons = [];
    this.passives = {};
    this.rerolls = (meta.reroll || 0);
    this.bonusSpeed = 0; this.bonusArmor = 0;
    this.bonusDust = 0; this.bossKills = 0; this.evolutions = 0; this.totalDmg = 0;
    this.reviveUsed = false;
    this.combo = 0; this.comboT = 0;
    this.active = true;

    if (cp) {
      this.player.level = Math.max(1, cp.level);
      this.player.xp = cp.xp;
      this.player.xpNext = Math.max(1, cp.xpNext);
      this.player.gold = cp.gold;
      this.player.kills = cp.kills;
      this.player.dmg = cp.dmg;
      this.elapsed = cp.elapsed;
      this.rngState = cp.seed || 233;
      this.weapons = cp.weapons
        .filter(w => !!WEAPON_BY_ID[w.id])
        .map(w => ({ id: w.id, level: Math.max(1, Math.min(8, w.level)), evolved: w.evolved, cool: 0 }));
      if (!this.weapons.length) this.weapons = [{ id: ch.startWeapon, level: 1, evolved: false, cool: 0 }];
      this.passives = { ...cp.passives };
      this.rerolls = cp.rerolls;
      this.bossKills = cp.bossKills;
      this.evolutions = cp.evolutions;
      this.bonusDust = cp.bonusDust;
      this.totalDmg = cp.dmg;
    } else {
      this.weapons = [{ id: ch.startWeapon, level: 1, evolved: false, cool: 0 }];
      const extra = meta.startPassive || 0;
      for (let i = 0; i < extra; i++) {
        const p = PASSIVES[Math.floor(this.rnd() * PASSIVES.length)];
        this.passives[p.id] = (this.passives[p.id] || 0) + 1;
      }
      this.player.gold = (meta.startGold || 0) * 30;
      this.elapsed = 0;
      this.rngState = 233 + Math.floor(Math.random() * 99991);
      /* 开新局时把上一局留下的续战记录作废，免得回到开始页还能"继续"一局早已重开过的战斗 */
      this.save.checkpoint = null;
      writeSave(this.save);
    }

    this.player.hp = 0;
    this.refreshStats(false);
    this.player.hp = cp ? Math.min(this.statsData.maxHp, Math.max(1, cp.hp)) : this.statsData.maxHp;
    this.player.level = Math.max(1, this.player.level);
    if (!cp) this.player.xpNext = nextXp(this.player.level);

    this.bossIndex = 0;
    while (this.bossIndex < BOSS_TIMES.length && BOSS_TIMES[this.bossIndex] <= this.elapsed / 60) this.bossIndex++;
    this.milestoneIndex = 0;
    while (this.milestoneIndex < MILESTONES.length && MILESTONES[this.milestoneIndex].min * 60 <= this.elapsed) this.milestoneIndex++;

    this.camX = this.player.x;
    this.camY = this.player.y;
    this.abilityCd = this.char.ability.cd;
    this.phase = 'playing';
    this.ui.hideOverlay();
    this.ui.setCharName(ch.name);
    this.ui.setAudioLabel(this.save.settings.sfx > 0);
    this.audio.unlock(this.save.settings.sfx, this.save.settings.bgm);
    this.audio.startBgm();
    this.audio.resume();
    this.lastTs = performance.now();
    this.startLoop();
    this.spawnTimer = 0.4;
    this.waveTimer = 20;
    this.eventTimer = 40;
    this.chestTimer = 70;
    this.merchantTimer = 200;
    this.saveTimer = 0;
    this.pendingLevels = 0;
    this.timeScale = 1;
    for (let i = 0; i < 5; i++) this.spawnRing(true);
    this.updHud(true);
    this.toast(cp ? '接着上一局写' : `${ch.name}落笔 · 活多久算多久`);
  }

  private resetRun(): void {
    for (const e of this.enemies) e.active = false;
    for (const s of this.shots) s.active = false;
    for (const s of this.eshots) s.active = false;
    for (const z of this.zones) z.active = false;
    for (const b of this.beams) b.active = false;
    for (const c of this.chains) c.active = false;
    for (const m of this.meteors) m.active = false;
    for (const t of this.turrets) t.active = false;
    for (const g of this.gems) g.active = false;
    for (const p of this.pickups) p.active = false;
    for (const p of this.particles) p.active = false;
    for (const t of this.texts) t.active = false;
    for (const s of this.shockwaves) s.active = false;
    this.boss = null;
    this.packAlive = 0;
    this.rain = 0;
    this.evoAnim = 0; this.evoName = ''; this.evoColor = ''; this.evoHold = false;
    this.lastTeleAt = -1; this.lastHitAt = -1;
    this.elapsed = 0;
    this.time = 0;
    this.camX = 0; this.camY = 0;
    this.shake = 0;
    this.player = newPlayer();
    this.ui.root.setAttribute('data-phase', 'play');
  }

  private active = false;

  private endRun(fell: boolean): void {
    if (this.phase === 'over' || this.phase === 'idle') return;
    this.active = false;
    this.audio.stopBgm();
    if (fell) this.audio.sfx('death');
    this.ui.flash('bad');
    const time = this.elapsed;
    const kills = this.player.kills;
    const level = this.player.level;
    const gold = this.player.gold;
    const dmg = this.totalDmg;
    const dust = this.computeDust();
    const prevBest = this.save.records.bestTime;
    const record = time > prevBest;
    this.save.records.bestTime = Math.max(prevBest, time);
    this.save.records.bestLevel = Math.max(this.save.records.bestLevel, level);
    this.save.records.bestKills = Math.max(this.save.records.bestKills, kills);
    this.save.records.bestDamage = Math.max(this.save.records.bestDamage, Math.floor(dmg));
    this.save.records.runs += 1;
    this.save.dust += dust;
    this.save.checkpoint = null;
    const newAch: string[] = [];
    this.checkAchievements(time, kills, level, dust, (name) => newAch.push(name));
    writeSave(this.save);
    this.phase = 'over';
    this.stopLoop();
    this.ui.showGameOver({
      time, kills, level, gold, dmg,
      weapons: this.weapons.map(w => {
        const def = WEAPON_BY_ID[w.id];
        return { name: def ? def.name : w.id, glyph: def ? def.glyph : '·', level: w.level, evolved: w.evolved, color: def ? def.color : '#26221e' };
      }),
      passives: Object.entries(this.passives).filter(([, v]) => v > 0).map(([k, v]) => {
        const p = PASSIVE_BY_ID[k];
        return { name: p ? p.name : k, glyph: p ? p.glyph : '·', level: v };
      }),
      record, bestTime: Math.max(prevBest, time), dust, newAchievements: newAch,
      charName: this.char.name,
    });
    this.ui.setAudioLabel(this.save.settings.sfx > 0);
  }

  private computeDust(): number {
    const t = this.elapsed;
    const base = t / 6 + this.player.kills / 7 + this.player.level * 2.2 + this.bossKills * 40 + this.evolutions * 28;
    return Math.floor(base + this.bonusDust);
  }

  private checkAchievements(time: number, kills: number, level: number, dust: number, push: (n: string) => void): void {
    const give = (id: string) => {
      if (this.save.achievements[id]) return;
      const a = ACHIEVEMENTS.find(x => x.id === id);
      if (!a) return;
      this.save.achievements[id] = 1;
      this.save.dust += a.dust;
      push(a.name);
    };
    give('first');
    if (time >= 300) give('t5');
    if (time >= 600) give('t10');
    if (time >= 1200) give('t20');
    if (time >= 1800) give('t30');
    if (time >= 3600) give('t60');
    if (time >= 6000) give('t100');
    if (kills >= 100) give('kill100');
    if (kills >= 1000) give('kill1000');
    if (kills >= 5000) give('kill5000');
    if (level >= 20) give('lv20');
    if (level >= 40) give('lv40');
    if (this.evolutions >= 1) give('evo1');
    if (this.evolutions >= 3) give('evo3');
    if (this.bossKills >= 1) give('boss1');
    if (this.bossKills >= 5) give('boss5');
    if (this.bossKills >= 10) give('boss10');
    if (this.save.dust >= 1000 || dust >= 1000) give('rich');
  }

  private saveCheckpoint(): void {
    if (!this.active || this.phase === 'over' || this.phase === 'start') return;
    this.save.checkpoint = {
      at: Date.now(),
      charId: this.char.id,
      elapsed: this.elapsed,
      level: this.player.level,
      xp: this.player.xp,
      xpNext: this.player.xpNext,
      hp: Math.max(1, this.player.hp),
      gold: this.player.gold,
      kills: this.player.kills,
      dmg: this.totalDmg,
      seed: this.rngState,
      weapons: this.weapons.map(w => ({ id: w.id, level: w.level, evolved: w.evolved })),
      passives: { ...this.passives },
      rerolls: this.rerolls,
      bossKills: this.bossKills,
      evolutions: this.evolutions,
      bonusDust: this.bonusDust,
    };
    writeSave(this.save);
  }

  private saveCheckpointClear(): void {
    if (this.save.checkpoint) {
      this.save.checkpoint = null;
      writeSave(this.save);
    }
  }

  /* ================= 属性 ================= */
  private buildStats(ch: CharDef): PlayerStats {
    const meta = this.save.meta;
    const base = {
      maxHp: ch.hp * (1 + (meta.hp || 0) * 0.04),
      speed: ch.speed * (1 + (meta.speed || 0) * 0.015),
      damage: ch.damage * (1 + (meta.damage || 0) * 0.03),
      armor: ch.armor + (meta.armor || 0),
    };
    const s: PlayerStats = {
      maxHp: base.maxHp,
      speed: base.speed,
      damage: base.damage,
      attackSpeed: 1,
      crit: ch.crit + (meta.luck || 0) * 0.02,
      critMul: 1.6,
      armor: base.armor,
      regen: 0,
      area: 1,
      extraProj: 0,
      pierce: 0,
      cdr: 0,
      xp: 1 + (meta.xp || 0) * 0.03,
      gold: 1 + (meta.gold || 0) * 0.04,
      pickup: 1,
      luck: (meta.luck || 0) * 0.02,
      thorns: 0,
      killHeal: 0,
      streak: 0,
    };
    for (const [id, lv] of Object.entries(this.passives)) {
      const p = PASSIVE_BY_ID[id];
      if (p && lv > 0) p.apply(s, Math.min(lv, p.max), base);
    }
    s.armor += this.bonusArmor;
    s.speed *= 1 + this.bonusSpeed;
    return s;
  }

  /** 验收开关：只给探针用，界面上永远打不开。 */
  private god = false;

  refreshStats(healDiff: boolean): void {
    const oldMax = this.player ? this.player.maxHp : 0;
    this.statsData = this.buildStats(this.char);
    if (!this.player) return;
    this.player.maxHp = this.statsData.maxHp;
    if (healDiff && this.statsData.maxHp > oldMax) this.player.hp += this.statsData.maxHp - oldMax;
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    if (this.player.hp <= 0) this.player.hp = 1;
  }

  stats(): PlayerStats { return this.statsData }

  /* ================= 局外成长 ================= */
  private buyMeta(id: string): void {
    const def = META_BY_ID[id];
    if (!def) return;
    const lv = this.save.meta[id] || 0;
    if (lv >= def.max) return;
    const cost = metaCost(def, lv);
    if (this.save.dust < cost) { this.toast('墨屑不够', 'bad'); return }
    this.save.dust -= cost;
    this.save.meta[id] = lv + 1;
    writeSave(this.save);
    this.audio.sfx('level');
    this.ui.showMeta(this.save);
  }

  private unlockChar(id: string): void {
    const ch = CHAR_BY_ID[id];
    if (!ch || ch.unlock <= 0) return;
    if (this.save.chars.includes(id)) return;
    if (this.save.dust < ch.unlock) { this.toast('墨屑不够', 'bad'); return }
    this.save.dust -= ch.unlock;
    this.save.chars.push(id);
    this.save.lastChar = id;
    writeSave(this.save);
    this.audio.sfx('chest');
    this.toast(`解锁了 ${ch.name}`, 'good');
    this.phase = 'start';
    this.ui.showStart(this.startData());
  }

  /* ================= 升级与三选一 ================= */
  private rollOffers(): OfferView[] {
    const evo: OfferView[] = [];
    for (const w of this.weapons) {
      const def = WEAPON_BY_ID[w.id];
      if (!def) continue;
      if (isEvolvedAvailable(w, def, this.passives)) {
        evo.push({
          kind: 'evolve', id: def.id, name: def.evo.name, glyph: def.evo.glyph, tag: '进化 · 条件已满足',
          desc: def.evo.intro, next: def.evo.stats.text,
          now: `${def.name} Lv.8 · ${weaponStatsLine(statsOf(w, def))}`,
          then: `${def.evo.name} · ${weaponStatsLine(def.evo.stats)}`,
          thenLabel: '进化后',
          level: 8, max: 8, color: '#b5342b', evolved: true,
        });
        break;
      }
    }
    const pool: OfferView[] = [];
    for (const w of this.weapons) {
      const def = WEAPON_BY_ID[w.id];
      if (!def || w.evolved || w.level >= def.levels.length) continue;
      const cur = statsOf(w, def);
      const next = def.levels[w.level];
      pool.push({
        kind: 'weapon', id: def.id, name: def.name, glyph: def.glyph, tag: `武器 · Lv.${w.level} → ${w.level + 1}`,
        desc: next.text, next: '→ ' + next.text,
        now: weaponStatsLine(cur),
        then: weaponStatsLine(next),
        thenLabel: '升级后',
        deltas: weaponDeltas(cur, next),
        level: w.level, max: def.levels.length, color: def.color, evolved: false,
      });
    }
    if (this.weapons.length < 6) {
      for (const def of WEAPON_DEFS) {
        if (this.weapons.some(w => w.id === def.id)) continue;
        pool.push({
          kind: 'weapon', id: def.id, name: def.name, glyph: def.glyph, tag: '武器 · 新',
          desc: def.intro, next: '新武器 · Lv.1',
          now: '未持有',
          then: `Lv.1 · ${weaponStatsLine(def.levels[0])}`,
          thenLabel: '拿到后',
          level: 0, max: def.levels.length, color: def.color, evolved: false,
        });
      }
    }
    for (const p of PASSIVES) {
      const lv = this.passives[p.id] || 0;
      if (lv >= p.max) continue;
      pool.push({
        kind: 'passive', id: p.id, name: p.name, glyph: p.glyph, tag: `${p.tag} · 被动`,
        desc: `可叠 ${p.max} 级 · 现在 ${lv} 级`,
        next: '→ ' + p.desc(lv + 1),
        now: lv ? `Lv.${lv} · ${p.desc(lv)}` : '未持有',
        then: `Lv.${lv + 1} · ${p.desc(lv + 1)}`,
        thenLabel: lv ? '升级后' : '拿到后',
        level: lv, max: p.max, color: '#3f5c86', evolved: false,
      });
    }
    const out: OfferView[] = [];
    if (evo.length) out.push(evo[0]);
    while (out.length < 3) {
      if (pool.length === 0) {
        const isGold = out.length % 2 !== 0;
        out.push({
          kind: 'fill', id: isGold ? 'gold' : 'heal', name: isGold ? '一把铜钱' : '一口回墨',
          glyph: isGold ? '金' : '墨', tag: '补给', desc: '立刻生效，不占武器位',
          next: '',
          now: isGold ? `金币 ${this.player.gold}` : `生命 ${Math.ceil(this.player.hp)} / ${Math.round(this.statsData.maxHp)}`,
          then: isGold ? `金币 ${this.player.gold + 80}` : `回复 ${Math.round(this.statsData.maxHp * 0.45)} 生命`,
          thenLabel: '拿走',
          level: 0, color: '#8a6a3a', evolved: false,
        });
        continue;
      }
      const i = Math.floor(this.rnd() * pool.length);
      const pick = pool.splice(i, 1)[0];
      if (out.some(o => o.id === pick.id && o.kind === pick.kind)) continue;
      out.push(pick);
    }
    return out;
  }

  private openLevel(): void {
    if (this.pendingLevels <= 0) return;
    this.phase = 'levelup';
    this.offers = this.rollOffers();
    this.audio.sfx('level');
    this.ui.showLevel(this.offers, this.rerolls, { level: this.player.level, pending: this.pendingLevels });
    this.saveCheckpoint();
  }

  private applyEvolve(w: WeaponInst, def: typeof WEAPON_BY_ID[string]): void {
    w.evolved = true;
    w.cool = 0;
    this.evolutions++;
    this.audio.sfx('evolve');
    this.ui.banner(def.evo.name, def.evo.intro, 'evo');
    this.ui.flash('gold');
    this.shake = 8;
    this.ui.toast(`${def.name} → ${def.evo.name}`, 'good');
    this.evoHold = true;
    this.startEvoCeremony(def.evo.name, def.color);
  }

  /** 进化三档演出：向内聚合 → 中心爆环 → 武器名印章。纯视觉，不暂停模拟。 */
  private startEvoCeremony(name: string, color: string): void {
    const p = this.player;
    this.evoAnim = 0.95;
    this.evoName = name;
    this.evoColor = color;
    /* 档一：外圈墨点向内聚合到笔尖 */
    const budget = this.save.settings.quality === 'low' ? 0.6 : 1;
    const n = Math.round(26 * budget);
    for (let i = 0; i < n; i++) {
      const pt = this.particles.find(v => !v.active);
      if (!pt) break;
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.3;
      const R = 120 + this.rnd() * 60;
      pt.active = true;
      pt.x = p.x + Math.cos(a) * R;
      pt.y = p.y + Math.sin(a) * R;
      /* 速度指向中心，约 0.32s 收到 */
      pt.vx = -Math.cos(a) * R * 3.1;
      pt.vy = -Math.sin(a) * R * 3.1;
      pt.life = 0.34; pt.age = 0;
      pt.size = 2.4 + this.rnd() * 3;
      pt.color = color; pt.kind = 'dot'; pt.spin = 0; pt.rot = a;
    }
  }

  private updateEvoAnim(dt: number): void {
    if (this.evoAnim <= 0) return;
    const prev = this.evoAnim;
    this.evoAnim = Math.max(0, this.evoAnim - dt);
    const p = this.player;
    /* 档二：聚合收满的一瞬，中心爆环外推 */
    if (prev > 0.63 && this.evoAnim <= 0.63) {
      this.shockwave(p.x, p.y, 150, 0.42, this.evoColor, 7);
      this.burst(p.x, p.y, this.evoColor, 22, 300);
      this.audio.sfx('boom', 0.6);
    }
    if (this.evoAnim <= 0) {
      this.evoName = ''; this.evoColor = ''
      if (this.evoHold) {
        this.evoHold = false
        if (this.phase === 'levelup') {
          if (this.pendingLevels > 0) {
            this.offers = this.rollOffers()
            this.ui.showLevel(this.offers, this.rerolls, { level: this.player.level, pending: this.pendingLevels })
          } else {
            this.phase = 'playing'; this.ui.hideOverlay(); this.lastTs = performance.now()
          }
        }
      }
    }
  }

  private pickOffer(i: number): void {
    const o = this.offers[i];
    if (!o) return;
    if (o.kind === 'evolve') {
      const w = this.weapons.find(x => x.id === o.id);
      const def = WEAPON_BY_ID[o.id];
      if (w && def) this.applyEvolve(w, def);
    } else if (o.kind === 'weapon') {
      const def = WEAPON_BY_ID[o.id];
      const w = this.weapons.find(x => x.id === o.id);
      if (!def) return;
      if (w) {
        w.level = Math.min(def.levels.length, w.level + 1);
        this.ui.toast(`${def.name} Lv.${w.level}`, 'good');
      } else {
        this.weapons.push({ id: o.id, level: 1, evolved: false, cool: 0 });
        this.ui.toast(`拿到 ${def.name}`, 'good');
      }
    } else if (o.kind === 'passive') {
      const lv = (this.passives[o.id] || 0) + 1;
      this.passives[o.id] = lv;
      this.ui.toast(`${o.name} Lv.${lv}`, 'good');
    } else if (o.id === 'heal') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.45);
      this.audio.sfx('heal');
    } else if (o.id === 'gold') {
      this.player.gold += 80;
      this.audio.sfx('coin');
    }
    this.audio.sfx('ui');
    this.refreshStats(true);
    this.pendingLevels--;
    if (this.pendingLevels > 0) {
      if (this.evoHold) {
        /* 演出进行中：先收掉当前卡，让出画面；updateEvoAnim 结束后再开下一张 */
        this.ui.hideOverlay()
      } else {
        this.offers = this.rollOffers();
        this.ui.showLevel(this.offers, this.rerolls, { level: this.player.level, pending: this.pendingLevels });
      }
    } else if (!this.evoHold) {
      this.phase = 'playing';
      this.ui.hideOverlay();
      this.lastTs = performance.now();
    }
  }

  private reroll(): void {
    if (this.rerolls <= 0) return;
    this.rerolls--;
    this.offers = this.rollOffers();
    this.audio.sfx('ui');
    this.ui.showLevel(this.offers, this.rerolls, { level: this.player.level, pending: this.pendingLevels });
  }

  /* ================= 输入 ================= */
  private keyDown(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (this.phase === 'levelup') {
      if (k === '1' || k === '2' || k === '3') { e.preventDefault(); this.pickOffer(Number(k) - 1); }
      if (k === 'r') { e.preventDefault(); this.reroll(); }
      return;
    }
    if (this.phase === 'chest') {
      if (k === '1' || k === '2' || k === '3') { e.preventDefault(); this.pickChest(Number(k) - 1); }
      return;
    }
    if (k === 'p') {
      /* P 是开关：页脚只写了「P 暂停」，但它同样得能继续，不然暂停后只能动鼠标 */
      if (this.phase === 'playing') { e.preventDefault(); this.pauseGame(); }
      else if (this.phase === 'paused') { e.preventDefault(); this.resumeGame(); }
      return;
    }
    if (this.phase !== 'playing') return;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) {
      e.preventDefault();
    }
    if (k === ' ') { this.tryDash(); return }
    this.keys.add(k);
  }

  private tryDash(): void {
    if (this.phase !== 'playing') return;
    const p = this.player;
    if (p.dashCd > 0) return;
    let dx = this.inputX(), dy = this.inputY();
    if (Math.abs(dx) + Math.abs(dy) < 0.1) { dx = Math.cos(p.face); dy = Math.sin(p.face); }
    const len = Math.hypot(dx, dy) || 1;
    p.dashT = 0.18;
    p.dashCd = this.char.id === 'bifeng' ? 2.4 : 3.5;
    p.invuln = Math.max(p.invuln, 0.42);
    /* 相机拉远后同样的 640 在屏幕上只剩 0.82 倍，冲刺要按世界单位补回来 */
    p.vx = dx / len * 760;
    p.vy = dy / len * 760;
    this.audio.sfx('dash');
    this.burst(p.x, p.y, '#26221e', 10, 130);
    if (this.char.id === 'bifeng') {
      this.zone(p.x, p.y, { r: 46, life: 2.5, dmg: this.statsData.damage * 6, tick: 0.4, type: 'poison', color: '#3f6f70' });
    }
  }

  private inputX(): number {
    const k = this.keys;
    let v = this.stickX + (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    if (Math.abs(v) > 1) v = Math.sign(v);
    return v;
  }

  private inputY(): number {
    const k = this.keys;
    let v = this.stickY + (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (Math.abs(v) > 1) v = Math.sign(v);
    return v;
  }

  /* ================= 界面动作 ================= */
  private handleAction(act: string, arg: string): void {
    switch (act) {
      case 'start': this.startRun(arg || this.save.lastChar); break
      case 'continue': if (this.save.checkpoint) this.startRun(this.save.checkpoint.charId, this.save.checkpoint); break
      case 'meta': this.phase = 'meta'; this.ui.showMeta(this.save); break
      case 'buy': this.buyMeta(arg); break
      case 'unlock': this.unlockChar(arg); break
      case 'pick': this.pickOffer(Number(arg)); break
      case 'reroll': this.reroll(); break
      case 'pause': this.pauseGame(); break
      case 'resume': this.resumeGame(); break
      case 'quality': this.setQuality(arg === 'low' ? 'low' : 'high'); break
      case 'quit': this.endRun(true); break
      case 'restart': this.startRun(this.char.id); break
      case 'backStart': this.goStart(); break
      case 'chest': this.pickChest(Number(arg)); break
      case 'buyGood': this.buyGood(Number(arg)); break
      case 'leaveShop': this.leaveShop(); break
      case 'dash': this.tryDash(); break
      case 'sfx': this.toggleSfx(); break
      default: break
    }
  }

  private toggleSfx(): void {
    if (this.save.settings.sfx > 0) { this.mutedSfx = this.save.settings.sfx; this.save.settings.sfx = 0 }
    else this.save.settings.sfx = this.mutedSfx || 0.7;
    this.audio.setVolumes(this.save.settings.sfx, this.save.settings.bgm);
    this.audio.sfx('ui');
    this.ui.setAudioLabel(this.save.settings.sfx > 0);
    writeSave(this.save);
  }

  /** 画面只有两档：精细按屏幕像素比画，流畅固定 1x —— 老机器上先把填充率降下来。 */
  private setQuality(q: 'low' | 'high'): void {
    if (this.save.settings.quality === q) return;
    this.save.settings.quality = q;
    writeSave(this.save);
    this.layout();
    this.needDraw = true;
    this.audio.sfx('ui');
    this.ui.showPause(this.buildHud(), this.save);
  }

  private pauseGame(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.saveCheckpoint();
    this.stopLoop();
    this.audio.suspend();
    this.ui.showPause(this.buildHud(), this.save);
  }

  private resumeGame(): void {
    if (this.phase !== 'paused' && this.phase !== 'chest' && this.phase !== 'merchant') return;
    if (this.phase === 'chest' || this.phase === 'merchant') this.saveCheckpoint();
    this.phase = 'playing';
    this.ui.hideOverlay();
    this.audio.resume();
    this.lastTs = performance.now();
    this.startLoop();
  }

  private toast(text: string, kind = ''): void { this.ui.toast(text, kind) }

  private buildHud(): HudView {
    const p = this.player;
    const b = this.boss;
    return {
      time: fmtTime(this.elapsed),
      stage: stageName(this.elapsed / 60),
      level: p.level,
      hp: p.hp,
      maxHp: this.statsData.maxHp,
      xp: p.xp,
      xpNext: p.xpNext,
      kills: p.kills,
      gold: p.gold,
      combo: this.combo,
      dash: 1 - p.dashCd / (this.char.id === 'bifeng' ? 2.4 : 3.5),
      boss: b && b.active && !b.dead ? { name: b.name, hp: b.hp, max: b.maxHp } : null,
      weapons: this.weapons.map(w => {
        const def = WEAPON_BY_ID[w.id];
        return { name: def ? def.name : w.id, glyph: def ? def.glyph : '·', level: w.level, evolved: w.evolved, color: def ? def.color : '#26221e' };
      }),
      passives: Object.entries(this.passives).filter(([, v]) => v > 0).map(([k, v]) => {
        const d = PASSIVE_BY_ID[k];
        return { name: d ? d.name : k, glyph: d ? d.glyph : '·', level: v };
      }),
    };
  }

  private updHud(force = false): void {
    this.ui.setHud(this.buildHud());
    if (force) this.hudTimer = 0;
  }

  /* ================= 循环 ================= */
  private startLoop(): void {
    if (this.raf) return;
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (ts: number): void => {
    if (!this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
    const real = Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.fps = this.fps * 0.92 + (1 / Math.max(0.001, real)) * 0.08;
    if (this.phase === 'playing') {
      this.timeScale += (1 - this.timeScale) * Math.min(1, real * 4);
      this.update(real * this.timeScale, real);
      this.needDraw = true;
    } else if (this.evoAnim > 0) {
      /* 进化演出在升级弹层后也要走完：只推粒子与演出计时，不推进敌人/武器 */
      this.updateFx(real);
      this.updateEvoAnim(real);
      this.needDraw = true;
    }
    if (this.needDraw) {
      drawGame(this);
      this.needDraw = false;
    }
  };

  /* ================= 每帧推进 ================= */
  private update(dt: number, real: number): void {
    this.time += dt;
    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - real * 34);
    this.rain = Math.max(0, this.rain - dt);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) { this.combo = 0; this.needDraw = true }
    }

    this.updatePlayer(dt);
    if (this.phase !== 'playing') return;
    this.updateEnemies(dt);
    this.grid.build(this.enemies);
    this.updateWeapons(dt);
    this.updateOrbit(dt);
    this.updateShots(dt);
    this.updateEShots(dt);
    this.updateZones(dt);
    this.updateMeteors(dt);
    this.updateTurrets(dt);
    this.updateGems(dt, real);
    this.updatePickups(dt);
    this.updateFx(dt);
    this.updateDirector(dt);

    this.hudTimer -= real;
    if (this.hudTimer <= 0) { this.hudTimer = 0.12; this.updHud(); }
    this.audio.setIntensity(this.elapsed > 1200 ? 3 : this.elapsed > 480 ? 2 : this.elapsed > 180 ? 1 : 0);

    this.saveTimer += real;
    if (this.saveTimer > 8) { this.saveTimer = 0; this.saveCheckpoint() }

    if (this.phase === 'playing' && this.pendingLevels > 0) this.openLevel();
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const st = this.statsData;
    let ix = this.inputX(), iy = this.inputY();
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len }

    let slow = p.slowT > 0;
    let inBuff = false;
    for (const z of this.zones) {
      if (!z.active) continue;
      const d = Math.hypot(p.x - z.x, p.y - z.y);
      if (d > z.r) continue;
      if (z.type === 'web' || z.type === 'hazard') slow = true;
      if (z.type === 'buff') inBuff = true;
    }
    if (inBuff) {
      p.buffDmg = Math.max(p.buffDmg, 0.6);
      p.buffSpeed = Math.max(p.buffSpeed, 0.6);
      p.hp = Math.min(st.maxHp, p.hp + 5 * dt);
    }
    if (slow) p.slowT = Math.max(p.slowT, 0.15);

    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.dashT <= 0) { p.vx = 0; p.vy = 0 }
    } else if (len > 0.05) {
      const sp = st.speed * (slow ? 0.52 : 1) * (p.buffSpeed > 0 ? 1.12 : 1);
      p.vx = ix * sp;
      p.vy = iy * sp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.face = Math.atan2(iy, ix);
    } else {
      p.vx *= 0.86;
      p.vy *= 0.86;
    }

    p.dashCd = Math.max(0, p.dashCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.buffDmg = Math.max(0, p.buffDmg - dt);
    p.buffSpeed = Math.max(0, p.buffSpeed - dt);
    p.slowT = Math.max(0, p.slowT - dt);
    if (p.streakT > 0) {
      p.streakT -= dt;
      if (p.streakT <= 0) p.streak = 0;
    }
    if (st.regen > 0) p.hp = Math.min(st.maxHp, p.hp + st.regen * dt);

    this.abilityCd -= dt;
    if (this.abilityCd <= 0) {
      this.abilityCd = this.char.ability.cd;
      this.fireAbility();
    }

    this.camX += (p.x - this.camX) * Math.min(1, dt * 6);
    this.camY += (p.y - this.camY) * Math.min(1, dt * 6);
  }

  private fireAbility(): void {
    const p = this.player;
    const st = this.statsData;
    switch (this.char.id) {
      case 'moke':
        this.ring(p.x, p.y, 128, st.damage * 22, 320, '#26221e');
        this.burst(p.x, p.y, '#26221e', 16, 180);
        this.audio.sfx('boom', 0.5);
        break
      case 'bifeng': {
        const a = p.face;
        p.dashT = 0.14;
        p.vx = Math.cos(a) * 520;
        p.vy = Math.sin(a) * 520;
        p.invuln = Math.max(p.invuln, 0.35);
        for (let i = 0; i < 3; i++) {
          this.zone(p.x + Math.cos(a) * i * 44, p.y + Math.sin(a) * i * 44, {
            r: 34, life: 1.8, dmg: st.damage * 5, tick: 0.4, type: 'poison', color: '#3f6f70',
          });
        }
        this.audio.sfx('dash');
        break
      }
      case 'shouyan':
        p.shield = Math.max(p.shield, st.maxHp * 0.26);
        this.audio.sfx('heal');
        this.burst(p.x, p.y, '#c7a45a', 14, 120);
        break
      case 'fenshu':
        this.zone(p.x, p.y, { r: 104, life: 4.2, dmg: st.damage * 8, tick: 0.4, type: 'fire', color: '#b5342b' });
        this.audio.sfx('boom', 0.6);
        break
      case 'wuxiang':
        p.invuln = Math.max(p.invuln, 2);
        this.burst(p.x, p.y, '#6d6a75', 20, 200);
        this.audio.sfx('dash');
        break
    }
  }

  private updateWeapons(dt: number): void {
    const st = this.statsData;
    for (const w of this.weapons) {
      const def = WEAPON_BY_ID[w.id];
      if (!def) continue;
      const L = statsOf(w, def);
      w.cool -= dt;
      if (w.cool > 0) continue;
      const cd = w.id === 'orbit' && !w.evolved ? 0.5 : Math.max(0.09, L.cd / (st.attackSpeed * (1 + st.cdr)));
      w.cool = cd;
      def.fire(this, w, dt);
    }
  }

  private updateOrbit(dt: number): void {
    const p = this.player;
    for (const w of this.weapons) {
      const o = w.orbit;
      if (!o) continue;
      o.ang += o.speed * dt;
      for (let i = 0; i < o.n; i++) {
        const a = o.ang + (i / Math.max(1, o.n)) * Math.PI * 2;
        const bx = p.x + Math.cos(a) * o.r;
        const by = p.y + Math.sin(a) * o.r;
        for (const e of this.enemies) {
          if (!e.active || e.dead) continue;
          if (e.orbitCd > 0) continue;
          if (Math.hypot(e.x - bx, e.y - by) > e.r + 20) continue;
          e.orbitCd = 0.32;
          this.hitEnemy(e, o.dmg);
          this.burst(bx, by, '#4f7757', 3, 70);
        }
      }
    }
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (e.dead) {
        e.dieT -= dt;
        if (e.dieT <= 0) { e.active = false; if (this.boss === e) this.boss = null }
        continue
      }
      if (e.spawnT > 0) e.spawnT -= dt;
      e.hitT = Math.max(0, e.hitT - dt);
      e.atkCd = Math.max(0, e.atkCd - dt);
      e.orbitCd = Math.max(0, e.orbitCd - dt);
      e.slowT = Math.max(0, e.slowT - dt);

      if (e.boss) {
        e.teleT = Math.max(0, e.teleT - dt);
        const bd = BOSS_BY_ID[e.bossId];
        if (bd) bd.think(e, this, dt);
        if (!e.enrage && e.hp < e.maxHp * 0.5) {
          e.enrage = true;
          e.phase = 2;
          e.pattern = 0;
          e.st = 0.8;
          this.ui.banner(`${e.name} · 变`, '第二阶段：出手更快，招式多一层', 'boss');
          this.ui.flash('bad');
          this.audio.sfx('alarm');
          this.burst(e.x, e.y, '#b5342b', 26, 260);
        }
      } else {
        const def = ENEMY_BY_ID[e.kind];
        if (def) def.think(e, this, dt);
      }

      const sm = e.slowT > 0 ? 0.5 : 1;
      e.x += e.vx * dt * sm;
      e.y += e.vy * dt * sm;

      if (e.hp <= 0) { this.killEnemy(e); continue }
      if (e.spawnT > 0) continue;

      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d < p.r + e.r && e.atkCd <= 0) {
        e.atkCd = e.boss ? 0.8 : 1.15;
        this.damagePlayer(e.dmg, e.x, e.y);
        if (this.phase !== 'playing') return;
      }
      if (!e.boss && d > 2600) e.active = false;
    }
  }

  private updateShots(dt: number): void {
    const p = this.player;
    for (const s of this.shots) {
      if (!s.active) continue;
      s.age += dt;
      s.life -= dt;
      if (s.returnAt > 0 && s.age > s.returnAt) {
        if (!s.returned) { s.returned = true; s.hitIds.length = 0 }
        const dx = p.x - s.x, dy = p.y - s.y;
        const a = Math.atan2(dy, dx);
        s.vx += (Math.cos(a) * 470 - s.vx) * 0.12;
        s.vy += (Math.sin(a) * 470 - s.vy) * 0.12;
      } else if (s.homing > 0) {
        if (!s.target || !s.target.active || s.target.dead) s.target = this.nearest(s.x, s.y, 420);
        if (s.target) {
          const a = Math.atan2(s.target.y - s.y, s.target.x - s.x);
          const sp = Math.hypot(s.vx, s.vy) || 1;
          s.vx += (Math.cos(a) * sp - s.vx) * Math.min(1, s.homing / 1000 * dt * 6);
          s.vy += (Math.sin(a) * sp - s.vy) * Math.min(1, s.homing / 1000 * dt * 6);
        }
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let dead = false;
      const list = this.grid.query(s.x, s.y, s.r + 30, this.qbuf).slice();
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e.active || e.dead) continue;
        if (s.hitIds.length && s.hitIds.includes(e.id)) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) > e.r + s.r) continue;
        s.hitIds.push(e.id);
        this.hitEnemy(e, s.dmg, { silent: s.kind === 'stroke-e' });
        if (s.explodeR > 0) {
          this.explodeAt(s.x, s.y, s.explodeR, s.explodeDmg, s.color);
          if (s.kind === 'ember-e' || s.kind === 'ember') {
            const big = s.kind === 'ember-e';
            this.zone(s.x, s.y, { r: s.explodeR * (big ? 0.7 : 0.5), life: big ? 2.6 : 1.6, dmg: s.dmg * 0.24, tick: 0.4, type: 'fire', color: s.color });
          }
          dead = true;
          break;
        }
        if (s.split > 0 && e.hp <= 0) {
          for (let k = 0; k < 2; k++) {
            const a = Math.atan2(s.vy, s.vx) + (k ? 0.8 : -0.8);
            this.shot({
              x: s.x, y: s.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380,
              r: s.r * 0.6, dmg: s.dmg * 0.5, pierce: 1, life: 0.5, kind: 'stroke', color: s.color,
            });
          }
        }
        s.pierce--;
        if (s.pierce < 0) { dead = true; break }
      }
      if (s.life <= 0 && !dead) {
        if (s.explodeR > 0) {
          this.explodeAt(s.x, s.y, s.explodeR, s.explodeDmg, s.color);
          if (s.kind === 'ember-e' || s.kind === 'ember') {
            const big = s.kind === 'ember-e';
            this.zone(s.x, s.y, { r: s.explodeR * (big ? 0.7 : 0.5), life: big ? 2.6 : 1.6, dmg: s.dmg * 0.24, tick: 0.4, type: 'fire', color: s.color });
          }
        }
        dead = true;
      }
      if (dead) s.active = false;
    }
  }

  private updateEShots(dt: number): void {
    const p = this.player;
    for (const e of this.eshots) {
      if (!e.active) continue;
      e.age += dt; e.life -= dt;
      if (e.homing > 0) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        const sp = Math.hypot(e.vx, e.vy) || 1;
        e.vx += (Math.cos(a) * sp - e.vx) * Math.min(1, dt * 1.8);
        e.vy += (Math.sin(a) * sp - e.vy) * Math.min(1, dt * 1.8);
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (Math.hypot(p.x - e.x, p.y - e.y) < p.r + e.r) {
        this.damagePlayer(e.dmg, e.x, e.y);
        e.active = false;
        if (this.phase !== 'playing') return;
      }
      if (e.life <= 0) e.active = false;
    }
  }

  private updateZones(dt: number): void {
    const p = this.player;
    for (const z of this.zones) {
      if (!z.active) continue;
      z.age += dt; z.life -= dt;
      if (z.life <= 0) { z.active = false; continue }

      if (z.type === 'hazard') {
        z.tick -= dt;
        if (z.tick <= 0) {
          z.tick = 2.4;
          const a = this.rnd() * Math.PI * 2;
          const d = this.rnd() * z.r * 0.8;
          const x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d;
          this.burst(x, y, '#5b5751', 10, 160);
          this.shockwave(x, y, 34, 0.4, '#5b5751', 3);
          if (Math.hypot(p.x - x, p.y - y) < 46) this.damagePlayer(this.dmgScale() * 16, x, y);
          if (this.phase !== 'playing') return;
        }
      }
      if (z.dmg > 0) {
        z.tick -= dt;
        if (z.tick > 0) continue;
        z.tick = 0.45;
        const list = this.grid.query(z.x, z.y, z.r, this.qbuf).slice();
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!e.active || e.dead) continue;
          if (Math.hypot(e.x - z.x, e.y - z.y) > z.r + e.r) continue;
          if (z.slow > 0) e.slowT = Math.max(e.slowT, 0.5);
          this.hitEnemy(e, z.dmg * 0.45, { silent: true, noCrit: true });
        }
      } else if (z.slow > 0) {
        z.tick -= dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          const list = this.grid.query(z.x, z.y, z.r, this.qbuf).slice();
          for (const e of list) {
            if (!e.active || e.dead) continue;
            if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) e.slowT = Math.max(e.slowT, 0.5);
          }
        }
      }
    }
  }

  private updateMeteors(dt: number): void {
    for (const m of this.meteors) {
      if (!m.active) continue;
      m.t -= dt;
      if (m.t <= 0) {
        this.explodeAt(m.x, m.y, m.r, m.dmg, m.color);
        this.shockwave(m.x, m.y, m.r, 0.5, m.color, 6);
        m.active = false;
      }
    }
  }

  private updateTurrets(dt: number): void {
    for (const t of this.turrets) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; continue }
      t.cool -= dt;
      if (t.kind === 'clone') {
        const target = this.nearest(t.x, t.y, t.range);
        if (target) {
          const a = Math.atan2(target.y - t.y, target.x - t.x);
          t.x += Math.cos(a) * 190 * dt;
          t.y += Math.sin(a) * 190 * dt;
          if (t.cool <= 0 && Math.hypot(target.x - t.x, target.y - t.y) < 38) {
            t.cool = t.cd;
            this.hitEnemy(target, t.dmg);
            this.burst(target.x, target.y, '#3a3a3a', 6, 100);
          }
        }
      } else if (t.cool <= 0) {
        const target = this.nearest(t.x, t.y, t.range);
        if (target) {
          t.cool = t.cd;
          const a = Math.atan2(target.y - t.y, target.x - t.x);
          this.shot({
            x: t.x, y: t.y, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480,
            r: 6, dmg: t.dmg, pierce: 1, life: 0.9, kind: 'ink', color: t.color,
          });
          if (t.double) {
            this.shot({
              x: t.x, y: t.y, vx: Math.cos(a + 0.18) * 480, vy: Math.sin(a + 0.18) * 480,
              r: 5, dmg: t.dmg, pierce: 1, life: 0.9, kind: 'ink', color: t.color,
            });
          }
        } else {
          t.cool = 0.3;
        }
      }
    }
  }

  private updateGems(_dt: number, real: number): void {
    const p = this.player;
    const magnet = 92 * this.statsData.pickup;
    for (const g of this.gems) {
      if (!g.active) continue;
      g.age += real;
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      if (d < magnet || g.age > 22) {
        const a = Math.atan2(p.y - g.y, p.x - g.x);
        const sp = 260 + (g.age > 22 ? 260 : 0);
        g.x += Math.cos(a) * sp * real;
        g.y += Math.sin(a) * sp * real;
      }
      if (d < p.r + 10) {
        g.active = false;
        if (g.kind === 'xp') {
          this.gainXp(g.val);
          this.audio.sfx('pick');
        } else if (g.kind === 'gold') {
          const add = Math.max(1, Math.round(g.val * this.statsData.gold));
          p.gold += add;
          this.pop(p.x, p.y - 16, '+' + add, 'info');
          this.audio.sfx('coin');
        } else if (g.kind === 'heal') {
          p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.16);
          this.pop(p.x, p.y - 16, '+16%', 'heal');
          this.audio.sfx('heal');
        }
      }
    }
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    for (const it of this.pickups) {
      if (!it.active) continue;
      it.age += dt;
      if (it.kind === 'merchant' && it.age > 45) {
        it.active = false;
        this.toast('墨商走了');
        continue;
      }
      if (Math.hypot(p.x - it.x, p.y - it.y) < 64) {
        if (it.kind === 'chest') this.openChest(it);
        else this.openMerchant(it);
        return;
      }
    }
  }

  private updateFx(dt: number): void {
    for (const b of this.beams) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) b.active = false;
    }
    for (const c of this.chains) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) c.active = false;
    }
    for (const s of this.shockwaves) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) s.active = false;
    }
    for (const pt of this.particles) {
      if (!pt.active) continue;
      pt.age += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.94;
      pt.vy *= 0.94;
      pt.rot += pt.spin * dt;
      if (pt.age >= pt.life) pt.active = false;
    }
    for (const t of this.texts) {
      if (!t.active) continue;
      t.age += dt;
      t.y += t.vy * dt;
      t.vy *= 0.94;
      if (t.age >= t.life) t.active = false;
    }
  }

  /* ================= 伤害 / 击杀 ================= */
  hitEnemy(e: Enemy, base: number, opts?: { silent?: boolean; noCrit?: boolean }): void {
    if (!e.active || e.dead) return;
    const st = this.statsData;
    const p = this.player;
    let d = base * st.damage;
    if (p.buffDmg > 0) d *= 1.25;
    if (st.streak > 0 && p.streak > 0) d *= 1 + st.streak * p.streak;
    const crit = !opts?.noCrit && this.rnd() < st.crit;
    if (crit) d *= st.critMul;

    if (e.shield > 0) {
      const over = d - e.shield;
      e.shield = Math.max(0, e.shield - d);
      if (over > 0) e.hp -= over;
    } else {
      e.hp -= d;
    }
    e.hitT = 0.1;
    this.totalDmg += d;
    if (!opts?.silent) {
      const big = crit || e.boss;
      this.pop(e.x + (this.rnd() - 0.5) * 14, e.y - e.r - 4, crit ? String(Math.round(d)) + '!' : String(Math.round(d)), crit ? 'crit' : 'hit', big ? 22 : 17);
      this.audio.sfx('hit', 0.5);
    }
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: Enemy): void {
    if (e.dead) return;
    e.dead = true;
    e.dieT = e.boss ? 1.6 : 0.3;
    const p = this.player;
    p.kills++;
    this.combo++;
    this.comboT = 2.2;
    if (this.combo % 10 === 0) {
      this.pop(p.x, p.y - 36, '连击 ×' + this.combo, 'crit', 18);
      this.shake = Math.max(this.shake, 2.5);
    }
    if (this.statsData.streak > 0) {
      p.streak = Math.min(20, p.streak + 1);
      p.streakT = 2.4;
    }
    if (this.statsData.killHeal > 0) p.hp = Math.min(p.maxHp, p.hp + this.statsData.killHeal);
    this.burst(e.x, e.y, e.boss ? '#b5342b' : e.kind === 'bomber' ? '#b5342b' : '#26221e', e.boss ? 70 : e.elite ? 20 : 7, e.boss ? 300 : 150);
    this.audio.sfx('kill', 0.6);

    if (e.boss) { this.onBossKilled(e); return }

    this.dropGem(e.x, e.y, 'xp', Math.max(1, e.xp) * (this.rain > 0 ? 2 : 1));
    if (this.rnd() < 0.42) this.dropGem(e.x + (this.rnd() - 0.5) * 16, e.y + (this.rnd() - 0.5) * 16, 'gold', Math.max(0.5, e.gold));
    if (this.rnd() < 0.008) this.dropGem(e.x, e.y, 'heal', 0);
    if (e.elite) {
      for (let i = 0; i < 6; i++) this.dropGem(e.x + (this.rnd() - 0.5) * 60, e.y + (this.rnd() - 0.5) * 60, 'gold', e.gold * 0.6);
      if (this.rnd() < 0.55) this.spawnPickup('chest', e.x, e.y);
    }
    if (e.kind === 'splitter' && !e.elite) {
      for (let i = 0; i < 2; i++) this.spawnEnemy('shard', e.x + (i ? 14 : -14), e.y, false);
    }
    if (e.kind === 'bomber') {
      this.explode(e.x, e.y, 74, e.dmg * 0.85, '#b5342b');
      this.shockwave(e.x, e.y, 74, 0.4, '#b5342b', 5);
    }
    if (e.pack) {
      this.packAlive--;
      if (this.packAlive <= 0) {
        this.spawnPickup('chest', e.x, e.y);
        this.toast('墨将清完 · 掉了一只箱子', 'good');
      }
    }
  }

  private onBossKilled(e: Enemy): void {
    this.bossKills++;
    const reward = 30 + Math.max(0, e.phase - 1) * 20;
    this.bonusDust += reward;
    this.boss = null;
    this.ui.banner('墨将倒', `${e.name} 散了 · 墨屑 +${reward}`, 'boss');
    this.ui.flash('gold');
    this.audio.sfx('evolve');
    this.audio.sfx('boom');
    this.shake = 16;
    this.timeScale = 0.3;
    for (let i = 0; i < 8; i++) this.dropGem(e.x + (this.rnd() - 0.5) * 120, e.y + (this.rnd() - 0.5) * 120, 'gold', 8 + this.minutes * 2);
    this.dropGem(e.x, e.y, 'heal', 0);
    this.spawnPickup('chest', e.x, e.y);
    this.toast(`${e.name} 倒下 · 墨屑 +${reward}`, 'good');
  }

  damagePlayer(dmg: number, sx: number, sy: number): void {
    if (this.phase !== 'playing') return;
    if (this.god) return;
    const p = this.player;
    if (p.invuln > 0) return;
    const st = this.statsData;
    let d = dmg * (1 - Math.min(0.55, st.armor / (st.armor + 52)));
    if (p.shield > 0) {
      const over = d - p.shield;
      p.shield = Math.max(0, p.shield - d);
      if (over <= 0) { p.invuln = 0.25; this.audio.sfx('hit'); return }
      d = over;
    }
    p.hp -= d;
    this.combo = 0; this.comboT = 0;
    p.invuln = 0.55;
    this.shake = Math.min(12, 4 + d * 0.2);
    this.burst(p.x, p.y, '#b5342b', 10, 140);
    this.pop(p.x, p.y - 22, '-' + Math.round(d), 'bad', 15);
    this.audio.sfx('hit', 0.8);
    if (st.thorns > 0 && sx !== undefined) {
      let best: Enemy | null = null;
      let bd = 46;
      for (const e of this.enemies) {
        if (!e.active || e.dead) continue;
        const dd = Math.hypot(e.x - sx, e.y - sy);
        if (dd < bd) { bd = dd; best = e }
      }
      if (best) this.hitEnemy(best, d * st.thorns, { silent: true });
    }
    if (p.hp <= 0) {
      if ((this.save.meta.revive || 0) > 0 && !this.reviveUsed) {
        this.reviveUsed = true;
        p.hp = Math.max(1, st.maxHp * 0.5);
        p.invuln = 3;
        this.ui.banner('墨魂', '这一下没死 · 站起来接着写', 'mile');
        this.ui.flash('good');
        this.audio.sfx('evolve');
        this.ring(p.x, p.y, 260, st.damage * 30, 420, '#b5342b');
        this.toast('墨魂替你挡了一次', 'good');
      } else {
        p.hp = 0;
        this.endRun(true);
      }
    }
  }

  /* ================= 刷怪与难度 ================= */
  private get minutes(): number { return this.elapsed / 60 }

  private hpScale(): number {
    const m = this.minutes;
    return 1 + 0.32 * m + 0.17 * Math.pow(m, 1.55);
  }

  private dmgScale(): number {
    const m = this.minutes;
    return 1 + 0.1 * m + 0.012 * Math.pow(m, 1.7);
  }

  spawnEnemy(kind: string, x: number, y: number, elite = false, pack = false): void {
    const def = ENEMY_BY_ID[kind];
    if (!def) return;
    if (this.countActive() >= MAX_ENEMIES - 2) return;
    const e = this.enemies.find(v => !v.active);
    if (!e) return;
    const m = this.minutes;
    e.active = true;
    e.id = this.idSeq++;
    e.kind = kind;
    e.name = (elite ? '精英·' : '') + def.name;
    e.x = x; e.y = y;
    e.r = def.r * (elite ? 1.55 : 1);
    e.hp = e.maxHp = def.hp * this.hpScale() * (elite ? 7 : 1);
    e.dmg = def.dmg * this.dmgScale() * (elite ? 1.65 : 1);
    e.speed = def.speed * (1 + Math.min(0.25, m * 0.01));
    e.xp = def.xp * (1 + Math.min(3, m * 0.12)) * (elite ? 5 : 1);
    e.gold = def.gold * (1 + m * 0.15) * (elite ? 4 : 1);
    e.elite = elite;
    e.boss = false;
    e.bossId = '';
    e.hitT = 0; e.atkCd = 0.8; e.orbitCd = 0;
    e.st = 0.6 + this.rnd() * 0.6;
    e.st2 = 0;
    e.phase = 1;
    e.shield = 0; e.shieldMax = 0; e.shieldT = 6;
    if (kind === 'warder') {
      e.shieldMax = e.shield = (34 + m * 26) * (elite ? 2 : 1);
    }
    e.slowT = 0;
    e.spawnT = 0.42;
    e.pack = pack;
    e.pattern = 0; e.phaseT = 0; e.enrage = false; e.dead = false; e.dieT = 0;
    e.hx = 1; e.hy = 0;
    if (elite) this.burst(x, y, '#b5342b', 10, 100);
  }

  private countActive(): number {
    let n = 0;
    for (const e of this.enemies) if (e.active) n++;
    return n;
  }

  /** 视野外一圈的世界距离：对角线一半 + 余量。三处出生点共用同一把尺。 */
  private offDist(extra: number): number {
    return Math.hypot(this.view.w, this.view.h) / (2 * this.zoom) + extra;
  }

  private spawnRing(initial = false): void {
    const p = this.player;
    const a = this.rnd() * Math.PI * 2;
    /* 出生圈按「视野对角线的一半（世界单位）」算。
       原来拿屏幕像素当世界距离用：宽屏上左右两侧的敌人会在画面里凭空冒出来。 */
    const d = this.offDist(60) + this.rnd() * 140;
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    const def = pickEnemyKind(() => this.rnd(), this.minutes);
    const elite = !initial && this.rnd() < Math.min(0.17, 0.02 + this.minutes * 0.006);
    this.spawnEnemy(def.id, x, y, elite);
  }

  private spawnBoss(): void {
    const free = this.enemies.find(v => !v.active);
    if (!free) return;
    const { def, tier } = bossForIndex(this.bossIndex) as { def: BossDef; tier: number };
    this.bossIndex++;
    const e = free;
    const p = this.player;
    const a = this.rnd() * Math.PI * 2;
    const m = this.minutes;
    e.active = true;
    e.id = this.idSeq++;
    e.kind = 'boss';
    e.boss = true;
    e.bossId = def.id;
    e.name = tier > 0 ? `${def.name}·潮${tier}` : def.name;
    e.x = p.x + Math.cos(a) * 520;
    e.y = p.y + Math.sin(a) * 520;
    e.r = def.r * (1 + tier * 0.08);
    e.hp = e.maxHp = def.hp * (1 + 0.2 * m) * (1 + tier * 1.9);
    e.dmg = 22 * this.dmgScale() * (1 + tier * 0.5);
    e.speed = 80;
    e.xp = 120; e.gold = 60;
    e.elite = false; e.pack = false;
    e.hitT = 0; e.atkCd = 1; e.orbitCd = 0;
    e.st = 1.2; e.st2 = 2.2; e.phase = 1; e.pattern = 0; e.phaseT = 0; e.enrage = false;
    e.shield = 0; e.shieldMax = 0; e.shieldT = 0;
    e.spawnT = 0.8; e.dead = false; e.dieT = 0;
    e.slowT = 0; e.hx = -1; e.hy = 0;
    e.teleT = 0; e.teleKind = '';
    this.boss = e;
    this.lastTeleAt = -1; this.lastHitAt = -1; this.lastTeleKind = ''; this.lastHitKind = '';
    this.audio.sfx('boss');
    this.ui.banner(e.name, `「${def.title}」`, 'boss');
    this.ui.toast(def.note, 'bad');
    this.shake = 12;
  }

  private nextBossMinute(i: number): number {
    if (i < BOSS_TIMES.length) return BOSS_TIMES[i];
    const last = BOSS_TIMES[BOSS_TIMES.length - 1];
    return last + (i - BOSS_TIMES.length + 1) * 12;
  }

  private updateDirector(dt: number): void {
    const m = this.minutes;
    this.spawnTimer -= dt;
    const cap = Math.min(238, 34 + m * 9.5);
    if (this.spawnTimer <= 0 && this.countActive() < cap) {
      this.spawnTimer = Math.max(0.055, 1.05 / (1 + m * 0.13)) / (this.rain > 0 ? 2.05 : 1);
      const batch = 1 + Math.floor(m / 5) + (this.rain > 0 ? 2 : 0);
      for (let i = 0; i < batch; i++) this.spawnRing();
    }
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = 24;
      const n = Math.min(28, 5 + Math.floor(m * 1.6));
      const base = this.rnd() * Math.PI * 2;
      const d = this.offDist(90);
      const p = this.player;
      for (let i = 0; i < n; i++) {
        const a = base + (i / n - 0.5) * 0.9 + (this.rnd() - 0.5) * 0.2;
        this.spawnEnemy(pickEnemyKind(() => this.rnd(), m).id, p.x + Math.cos(a) * (d + this.rnd() * 90), p.y + Math.sin(a) * (d + this.rnd() * 90));
      }
    }
    if (!this.boss && m >= this.nextBossMinute(this.bossIndex)) this.spawnBoss();

    this.eventTimer -= dt;
    if (this.eventTimer <= 0 && this.elapsed > 110) {
      this.eventTimer = 34 + this.rnd() * 26;
      this.startRandomEvent();
    }
    this.chestTimer -= dt;
    if (this.chestTimer <= 0) {
      this.chestTimer = 72;
      const a = this.rnd() * Math.PI * 2;
      const d = 240 + this.rnd() * 260;
      this.spawnPickup('chest', this.player.x + Math.cos(a) * d, this.player.y + Math.sin(a) * d);
    }
    this.merchantTimer -= dt;
    if (this.merchantTimer <= 0) {
      this.merchantTimer = 210;
      const a = this.rnd() * Math.PI * 2;
      const d = 260 + this.rnd() * 200;
      this.spawnPickup('merchant', this.player.x + Math.cos(a) * d, this.player.y + Math.sin(a) * d);
      this.toast('墨商来了 · 去看看吧');
    }
    while (this.milestoneIndex < MILESTONES.length && this.elapsed >= MILESTONES[this.milestoneIndex].min * 60) {
      const ms = MILESTONES[this.milestoneIndex];
      this.bonusDust += ms.dust;
      this.milestoneIndex++;
      this.ui.banner(`${ms.min} 分钟`, `${ms.name} · 墨屑 +${ms.dust}`, 'mile');
      this.ui.flash('gold');
      this.audio.sfx('level');
      this.toast(`撑过 ${ms.min} 分钟 · 墨屑 +${ms.dust}`, 'good');
    }
  }

  private startRandomEvent(forced?: EventDef): void {
    const m = this.minutes;
    const pool = EVENTS.filter(e => e.min <= m);
    let pick = forced || pool[0];
    if (!forced) {
      let total = 0;
      for (const e of pool) total += e.weight;
      let r = this.rnd() * total;
      for (const e of pool) { r -= e.weight; if (r <= 0) { pick = e; break } }
    }
    if (!pick) return;
    this.ui.toast(`【${pick.name}】${pick.desc}`, 'event');
    this.audio.sfx('warn', 0.6);
    const p = this.player;
    switch (pick.id) {
      case 'buff': {
        const a = this.rnd() * Math.PI * 2;
        this.zone(p.x + Math.cos(a) * 200, p.y + Math.sin(a) * 200, {
          r: 108, life: pick.dur, dmg: 0, tick: 1, type: 'buff', color: '#4f7757', slow: 0,
        });
        break
      }
      case 'hazard': {
        const a = this.rnd() * Math.PI * 2;
        this.zone(p.x + Math.cos(a) * 240, p.y + Math.sin(a) * 240, {
          r: 118, life: pick.dur, dmg: 0, tick: 2.4, type: 'hazard', color: '#5b5751', slow: 0,
        });
        break
      }
      case 'elite': {
        this.packAlive = 3;
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3 + this.rnd();
          this.spawnEnemy(pickEnemyKind(() => this.rnd(), m).id, p.x + Math.cos(a) * 360, p.y + Math.sin(a) * 360, true, true);
        }
        break
      }
      case 'rain':
        this.rain = pick.dur;
        break
      case 'tide': {
        const a = this.rnd() * Math.PI * 2;
        const d = this.offDist(80);
        for (let i = 0; i < 18; i++) {
          this.spawnEnemy(pickEnemyKind(() => this.rnd(), m).id, p.x + Math.cos(a) * (d + this.rnd() * 60), p.y + Math.sin(a) * (d + this.rnd() * 60) + (i - 9) * 46);
        }
        break
      }
      case 'gold': {
        for (let i = 0; i < 9; i++) {
          const a = this.rnd() * Math.PI * 2;
          const dd = 120 + this.rnd() * 260;
          this.dropGem(p.x + Math.cos(a) * dd, p.y + Math.sin(a) * dd, 'gold', 6 + m);
        }
        break
      }
      case 'treasure': {
        const a = this.rnd() * Math.PI * 2;
        this.spawnPickup('chest', p.x + Math.cos(a) * 220, p.y + Math.sin(a) * 220);
        break
      }
    }
  }

  /* ================= 宝箱 / 商人 ================= */
  private spawnPickup(kind: 'chest' | 'merchant', x: number, y: number): void {
    const it = this.pickups.find(v => !v.active);
    if (!it) return;
    it.active = true;
    it.kind = kind;
    it.x = x; it.y = y;
    it.age = 0; it.bob = 0;
    if (kind === 'chest') this.audio.sfx('chest');
  }

  private rollChest(): Reward[] {
    const evoEligible = this.weapons.filter(w => {
      const def = WEAPON_BY_ID[w.id];
      return def && isEvolvedAvailable(w, def, this.passives);
    }).length > 0;
    const luck = this.statsData.luck;
    const entries: { id: string; w: number }[] = [
      { id: 'weapon', w: 34 },
      { id: 'evo', w: evoEligible ? 24 + luck * 30 : 0 },
      { id: 'gold', w: 20 },
      { id: 'heal', w: 16 },
      { id: 'passive', w: 22 },
      { id: 'reroll', w: 10 },
    ];
    const out: Reward[] = [];
    while (out.length < 3) {
      let total = 0;
      for (const e of entries) if (!out.some(o => o.id === e.id)) total += e.w;
      if (total <= 0) break;
      let r = this.rnd() * total;
      let pick = 'gold';
      for (const e of entries) {
        if (out.some(o => o.id === e.id)) continue;
        r -= e.w;
        if (r <= 0) { pick = e.id; break }
      }
      const def = CHEST_KINDS.find(c => c.id === pick) || CHEST_KINDS[0];
      out.push({ id: def.id, name: def.name, desc: def.desc, color: def.color, glyph: def.id === 'evo' ? '进' : def.id === 'weapon' ? '器' : def.id === 'gold' ? '金' : def.id === 'heal' ? '墨' : def.id === 'passive' ? '印' : '符' });
    }
    if (out.length < 3) {
      out.push({ id: 'gold', name: '一把铜钱', desc: '金币 +120', color: '#8a6a3a', glyph: '金' });
    }
    return out;
  }

  private openChest(it: Pickup): void {
    if (this.phase !== 'playing') return;
    it.active = false;
    this.rewards = this.rollChest();
    this.phase = 'chest';
    this.audio.sfx('chest');
    this.ui.showChest(this.rewards.map(r => ({ id: r.id, name: r.name, desc: r.desc, color: r.color, glyph: r.glyph })));
    this.saveCheckpoint();
  }

  private pickChest(i: number): void {
    const r = this.rewards[i];
    if (!r) { this.resumeGame(); return }
    if (r.id === 'weapon') {
      const up = this.weapons.filter(w => { const d = WEAPON_BY_ID[w.id]; return d && !w.evolved && w.level < d.levels.length });
      if (up.length) {
        const w = up[Math.floor(this.rnd() * up.length)];
        const def = WEAPON_BY_ID[w.id];
        if (def) w.level = Math.min(def.levels.length, w.level + 2);
        this.toast(`${def ? def.name : ''} 连升两级`, 'good');
      } else if (this.weapons.length < 6) {
        const def = WEAPON_DEFS[Math.floor(this.rnd() * WEAPON_DEFS.length)];
        this.weapons.push({ id: def.id, level: Math.min(3, def.levels.length), evolved: false, cool: 0 });
        this.toast(`拿到 ${def.name}`, 'good');
      } else {
        this.player.gold += 90;
      }
    } else if (r.id === 'evo') {
      const w = this.weapons.find(x => { const d = WEAPON_BY_ID[x.id]; return d && isEvolvedAvailable(x, d, this.passives) });
      if (w) {
        const def = WEAPON_BY_ID[w.id];
        if (def) this.applyEvolve(w, def);
      } else {
        this.player.gold += 120;
      }
    } else if (r.id === 'gold') {
      this.player.gold += 90 + Math.floor(this.rnd() * 80);
      this.audio.sfx('coin');
    } else if (r.id === 'heal') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.45);
      this.audio.sfx('heal');
    } else if (r.id === 'passive') {
      this.grantRandomPassive();
    } else if (r.id === 'reroll') {
      this.rerolls += 2;
      this.toast('重选 +2', 'good');
    }
    this.refreshStats(true);
    this.phase = 'playing';
    this.ui.hideOverlay();
    this.lastTs = performance.now();
  }

  private grantRandomPassive(): void {
    const pool = PASSIVES.filter(p => (this.passives[p.id] || 0) < p.max);
    if (!pool.length) return;
    const p = pool[Math.floor(this.rnd() * pool.length)];
    this.passives[p.id] = (this.passives[p.id] || 0) + 1;
    this.toast(`${p.name} Lv.${this.passives[p.id]}`, 'good');
  }

  private openMerchant(it: Pickup): void {
    if (this.phase !== 'playing') return;
    it.active = false;
    this.shop = [];
    const picks = MERCHANT_GOODS.slice();
    for (let i = picks.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [picks[i], picks[j]] = [picks[j], picks[i]];
    }
    for (const g of picks.slice(0, 3)) {
      this.shop.push({ def: g, cost: Math.max(10, Math.round(g.cost * (1 + this.minutes * 0.08) * (1 - this.statsData.luck * 0.1))), sold: false });
    }
    this.phase = 'merchant';
    this.audio.sfx('chest');
    this.showShop();
  }

  private showShop(): void {
    const goods: GoodView[] = this.shop.filter(s => !s.sold).map(s => ({
      id: s.def.id, name: s.def.name, desc: s.def.desc, cost: s.cost, glyph: s.def.glyph,
      afford: this.player.gold >= s.cost,
    }));
    this.ui.showMerchant(goods, this.player.gold);
  }

  private buyGood(i: number): void {
    const row = this.shop.filter(s => !s.sold)[i];
    if (!row) return;
    if (this.player.gold < row.cost) { this.toast('铜钱不够', 'bad'); return }
    this.player.gold -= row.cost;
    row.sold = true;
    switch (row.def.id) {
      case 'heal':
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.3);
        break
      case 'weapon': {
        const up = this.weapons.filter(w => { const d = WEAPON_BY_ID[w.id]; return d && !w.evolved && w.level < d.levels.length });
        if (up.length) {
          const w = up[Math.floor(this.rnd() * up.length)];
          const d = WEAPON_BY_ID[w.id];
          if (d) w.level = Math.min(d.levels.length, w.level + 1);
        } else if (this.weapons.length < 6) {
          const def = WEAPON_DEFS[Math.floor(this.rnd() * WEAPON_DEFS.length)];
          this.weapons.push({ id: def.id, level: 1, evolved: false, cool: 0 });
        } else this.player.gold += 60;
        break
      }
      case 'passive': this.grantRandomPassive(); break
      case 'reroll': this.rerolls += 1; break
      case 'armor': this.bonusArmor += 3; break
      case 'speed': this.bonusSpeed += 0.06; break
      case 'shield': this.player.shield = Math.max(this.player.shield, this.statsData.maxHp * 0.2); break
    }
    this.refreshStats(true);
    this.audio.sfx('coin');
    this.showShop();
  }

  private leaveShop(): void {
    this.phase = 'playing';
    this.ui.hideOverlay();
    this.lastTs = performance.now();
  }

  /* ================= 经验 ================= */
  gainXp(n: number): void {
    const p = this.player;
    p.xp += n * this.statsData.xp;
    let guard = 0;
    while (p.xp >= p.xpNext && guard++ < 40) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = nextXp(p.level);
      this.pendingLevels++;
    }
  }

  /* ================= GameApi：武器与敌人共用 ================= */
  rnd(): number {
    let t = this.rngState += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nearest(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = range;
    for (const e of this.enemies) {
      if (!e.active || e.dead || e.spawnT > 0) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd) { bd = d; best = e }
    }
    return best;
  }

  enemiesNear(x: number, y: number, r: number): Enemy[] {
    const out: Enemy[] = [];
    for (const e of this.enemies) {
      if (!e.active || e.dead) continue;
      if (Math.hypot(e.x - x, e.y - y) <= r) out.push(e);
    }
    return out;
  }

  randomEnemyNear(x: number, y: number, r: number): Enemy | null {
    const out = this.enemiesNear(x, y, r);
    if (!out.length) return null;
    return out[Math.floor(this.rnd() * out.length)];
  }

  shot(o: Partial<Shot> & { x: number; y: number; dmg: number }): void {
    const s = this.shots.find(v => !v.active);
    if (!s) return;
    s.active = true;
    s.age = 0;
    s.life = 1;
    s.pierce = 1;
    s.r = 5;
    s.vx = 0; s.vy = 0;
    s.kind = 'ink';
    s.color = '#26221e';
    s.hitIds = [];
    s.homing = 0; s.target = null;
    s.explodeR = 0; s.explodeDmg = 0; s.split = 0; s.returnAt = 0; s.returned = false;
    s.slowT = 0; s.spin = 0; s.trail = false; s.width = 6; s.healPer = 0;
    Object.assign(s, o);
    s.hitIds = [];
    s.x = o.x; s.y = o.y; s.dmg = o.dmg;
    /* 穿石被动：额外穿透统一叠到弹体上，不用每把武器各自记 */
    s.pierce += this.statsData.pierce;
    /* 笔势：弹体尺寸与爆点半径随范围放大 */
    s.r *= this.statsData.area;
    if (s.explodeR > 0) s.explodeR *= this.statsData.area;
  }

  beam(x1: number, y1: number, x2: number, y2: number, o: Partial<Beam> & { dmg: number }): void {
    const b = this.beams.find(v => !v.active);
    if (!b) return;
    b.active = true;
    b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2;
    b.width = (o.width ?? 12) * this.statsData.area;
    b.life = o.life ?? 0.2;
    b.age = 0;
    b.dmg = o.dmg;
    b.color = o.color ?? '#3f5c86';
    b.kind = o.kind ?? 'laser';
    b.hitIds = [];
    const half = b.width / 2;
    for (const e of this.enemies) {
      if (!e.active || e.dead) continue;
      if (pointSegDist(e.x, e.y, x1, y1, x2, y2) > half + e.r) continue;
      b.hitIds.push(e.id);
      this.hitEnemy(e, o.dmg, { silent: true });
    }
    if (b.kind === 'light') {
      this.zone(x2, y2, { r: 44, life: 2, dmg: o.dmg * 0.16, tick: 0.4, type: 'fire', color: '#3f5c86' });
    }
  }

  zone(x: number, y: number, o: Partial<Zone> & { r: number; life: number; dmg: number }): void {
    const z = this.zones.find(v => !v.active);
    if (!z) return;
    z.active = true;
    z.x = x; z.y = y;
    z.r = o.r * this.statsData.area;
    z.life = o.life;
    z.age = 0;
    z.dmg = o.dmg;
    z.tick = 0.45;
    z.type = o.type ?? 'poison';
    z.color = o.color ?? '#4f7757';
    z.slow = o.slow ?? 0;
    z.buff = o.buff ?? '';
    z.follow = false;
  }

  chain(x: number, y: number, targets: number, dmg: number, range: number, color: string): void {
    const c = this.chains.find(v => !v.active);
    if (c) {
      c.active = true;
      c.life = 0.3;
      c.age = 0;
      c.color = color;
      c.points = [x, y];
      c.x = x; c.y = y;
    }
    const hits: number[] = [];
    let cx = x, cy = y;
    let d = dmg;
    for (let i = 0; i < targets; i++) {
      const t = this.nearestExcluding(cx, cy, range, hits);
      if (!t) break;
      hits.push(t.id);
      this.hitEnemy(t, d, { silent: true });
      const jx = t.x + (this.rnd() - 0.5) * 14;
      const jy = t.y + (this.rnd() - 0.5) * 14;
      if (c) { c.points.push(jx, jy) }
      this.burst(t.x, t.y, color, 3, 90);
      cx = t.x; cy = t.y;
      d *= 0.92;
    }
    this.audio.sfx('zap', 0.7);
  }

  private nearestExcluding(x: number, y: number, range: number, ids: number[]): Enemy | null {
    let best: Enemy | null = null;
    let bd = range;
    for (const e of this.enemies) {
      if (!e.active || e.dead || e.spawnT > 0) continue;
      if (ids.includes(e.id)) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bd) { bd = d; best = e }
    }
    return best;
  }

  meteor(x: number, y: number, delay: number, dmg: number, r: number, color: string): void {
    const m = this.meteors.find(v => !v.active);
    if (!m) return;
    m.active = true;
    m.x = x; m.y = y;
    m.t = delay; m.delay = delay;
    m.dmg = dmg; m.r = r * this.statsData.area; m.color = color;
  }

  turret(x: number, y: number, o: Partial<Turret> & { dmg: number }): void {
    const t = this.turrets.find(v => !v.active);
    if (!t) return;
    t.active = true;
    t.x = x; t.y = y;
    t.life = o.life ?? 12;
    t.cd = o.cd ?? 0.8;
    t.cool = 0;
    t.dmg = o.dmg;
    t.range = o.range ?? 300;
    t.color = o.color ?? '#8a6a3a';
    t.kind = o.kind ?? 'turret';
    t.src = o.src ?? '';
    t.r = o.r ?? 12;
    t.double = o.double ?? 0;
  }

  turretCount(src: string): number {
    let n = 0;
    for (const t of this.turrets) if (t.active && t.src === src) n++;
    return n;
  }

  ring(x: number, y: number, r: number, dmg: number, knock: number, color: string, healPer = 0): void {
    this.shockwave(x, y, r, 0.42, color, 6);
    const list = this.grid.query(x, y, r, this.qbuf).slice();
    let hits = 0;
    for (const e of list) {
      if (!e.active || e.dead) continue;
      if (Math.hypot(e.x - x, e.y - y) > r + e.r) continue;
      if (dmg > 0) {
        this.hitEnemy(e, dmg, { silent: true });
        hits++;
      }
      if (knock > 0) {
        const a = Math.atan2(e.y - y, e.x - x);
        e.vx += Math.cos(a) * knock;
        e.vy += Math.sin(a) * knock;
      }
    }
    if (healPer > 0 && hits > 0) this.player.hp = Math.min(this.player.maxHp, this.player.hp + hits * healPer);
    if (dmg > 0) this.audio.sfx('boom', 0.4);
  }

  private shockwave(x: number, y: number, r: number, life: number, color: string, width: number): void {
    const s = this.shockwaves.find(v => !v.active);
    if (!s) return;
    s.active = true;
    s.x = x; s.y = y; s.r = r;
    s.life = life; s.age = 0;
    s.color = color; s.width = width;
  }

  burst(x: number, y: number, color: string, count: number, power = 120): void {
    const budget = this.save.settings.quality === 'low' ? 0.55 : 1;
    const n = Math.round(count * budget);
    for (let i = 0; i < n; i++) {
      const p = this.particles.find(v => !v.active);
      if (!p) return;
      const a = this.rnd() * Math.PI * 2;
      const sp = power * (0.3 + this.rnd() * 0.9);
      p.active = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.life = 0.28 + this.rnd() * 0.5;
      p.age = 0;
      p.size = 1.6 + this.rnd() * 3.4;
      p.color = color;
      p.kind = this.rnd() < 0.3 ? 'splat' : this.rnd() < 0.5 ? 'line' : 'dot';
      p.spin = (this.rnd() - 0.5) * 8;
      p.rot = this.rnd() * 6.28;
    }
  }

  pop(x: number, y: number, text: string, kind = 'hit', size = 13): void {
    if (!this.save.settings.dmgNumbers && (kind === 'hit' || kind === 'crit')) return;
    const t = this.texts.find(v => !v.active);
    if (!t) return;
    t.active = true;
    t.x = x; t.y = y;
    t.vy = -46; t.life = 0.7; t.age = 0;
    t.text = text; t.kind = kind; t.size = size;
  }

  syncOrbit(w: WeaponInst, count: number, radius: number, speed: number, dmg: number): void {
    if (!w.orbit) w.orbit = { n: count, r: radius, speed, dmg, ang: this.rnd() * 6.28 };
    w.orbit.n = count;
    w.orbit.r = radius;
    w.orbit.speed = speed;
    w.orbit.dmg = dmg;
  }

  enemyShot(x: number, y: number, angle: number, speed: number, dmg: number, color: string, r = 5): void {
    const e = this.eshots.find(v => !v.active);
    if (!e) return;
    e.active = true;
    e.x = x; e.y = y;
    e.vx = Math.cos(angle) * speed;
    e.vy = Math.sin(angle) * speed;
    e.r = r; e.dmg = dmg;
    e.life = 4; e.age = 0;
    e.color = color;
    e.homing = 0;
    e.kind = 'dart';
    e.spin = 0;
  }

  enemyBeam(x1: number, y1: number, x2: number, y2: number, width: number, dmg: number, color: string): void {
    const b = this.beams.find(v => !v.active);
    if (b) {
      b.active = true;
      b.x1 = x1; b.y1 = y1; b.x2 = x2; b.y2 = y2;
      b.width = width; b.life = 0.32; b.age = 0;
      b.dmg = dmg; b.color = color; b.hitIds = []; b.kind = 'enemy';
    }
    /* 命中时刻留痕：探针量 telegraph → 命中的帧差 */
    this.lastHitAt = this.time;
    this.lastHitKind = 'beam';
    if (this.boss) { this.boss.teleT = 0; this.boss.teleKind = '' }
    const p = this.player;
    if (pointSegDist(p.x, p.y, x1, y1, x2, y2) < width / 2 + p.r) this.damagePlayer(dmg, p.x, p.y);
    this.audio.sfx('boom', 0.7);
    this.ui.flash('bad');
  }

  /** Boss 起手预警：记录预警开始时刻与招式类型，画面先画预警，判定后落。
   *  按招式类型边沿触发：上一段预警已在命中时清空 teleKind，新一轮起手才记录时刻。 */
  telegraph(kind: string, dur: number): void {
    if (this.boss) {
      if (this.boss.teleKind === '' || this.boss.teleKind !== kind) { this.lastTeleAt = this.time; this.lastTeleKind = kind }
      this.boss.teleT = dur; this.boss.teleKind = kind
    }
  }

  /** Boss 的范围震击：与玩家钟鸣共用 ring 结算，单独留命中时刻供探针量预警窗。 */
  enemyRing(x: number, y: number, r: number, dmg: number, knock: number, color: string): void {
    this.lastHitAt = this.time;
    this.lastHitKind = 'ring';
    if (this.boss) { this.boss.teleT = 0; this.boss.teleKind = '' }
    this.ring(x, y, r, dmg, knock, color);
  }

  explode(x: number, y: number, r: number, dmg: number, color: string): void {
    const p = this.player;
    if (Math.hypot(p.x - x, p.y - y) < r + p.r) this.damagePlayer(dmg, x, y);
    this.burst(x, y, color, 16, 200);
    this.shockwave(x, y, r, 0.4, color, 5);
    this.audio.sfx('boom', 0.8);
  }

  private explodeAt(x: number, y: number, r: number, dmg: number, color: string): void {
    r *= this.statsData.area;
    const list = this.grid.query(x, y, r, this.qbuf).slice();
    for (const e of list) {
      if (!e.active || e.dead) continue;
      if (Math.hypot(e.x - x, e.y - y) > r + e.r) continue;
      this.hitEnemy(e, dmg, { silent: true });
    }
    this.burst(x, y, color, 20, 230);
    this.shockwave(x, y, r, 0.42, color, 6);
    this.audio.sfx('boom', 0.8);
  }

  slowPlayer(sec: number): void {
    this.player.slowT = Math.max(this.player.slowT, sec);
  }

  private dropGem(x: number, y: number, kind: Gem['kind'], val: number): void {
    let g = this.gems.find(v => !v.active);
    if (!g) {
      /* 池满了就把最旧的一颗直接收掉，别让经验卡在地上 */
      let oldest: Gem | null = null;
      for (const v of this.gems) if (v.active && (!oldest || v.age > oldest.age)) oldest = v;
      if (!oldest) return;
      if (oldest.kind === 'xp') this.gainXp(oldest.val);
      oldest.active = false;
      g = oldest;
    }
    g.active = true;
    g.x = x; g.y = y;
    g.kind = kind;
    g.val = val;
    g.age = 0;
    g.vx = (this.rnd() - 0.5) * 60;
    g.vy = (this.rnd() - 0.5) * 60;
    g.r = kind === 'gold' ? 5 : 4;
  }

  /* ================= 调试 / 验收接口 ================= */
  debugState(): Record<string, unknown> {
    return {
      phase: this.phase,
      char: this.char.id,
      time: this.elapsed,
      minutes: Math.round(this.minutes * 10) / 10,
      bossIndex: this.bossIndex,
      hpScale: Math.round(this.hpScale() * 100) / 100,
      dmgScale: Math.round(this.dmgScale() * 100) / 100,
      x: Math.round(this.player.x),
      y: Math.round(this.player.y),
      level: this.player.level,
      xp: this.player.xp,
      xpNext: this.player.xpNext,
      hp: this.player.hp,
      maxHp: this.statsData.maxHp,
      kills: this.player.kills,
      gold: this.player.gold,
      combo: this.combo,
      dmg: this.totalDmg,
      bossKills: this.bossKills,
      evolutions: this.evolutions,
      boss: this.boss ? { name: this.boss.name, hp: this.boss.hp, max: this.boss.maxHp, phase: this.boss.phase, pattern: this.boss.pattern, teleT: Math.round(this.boss.teleT * 1000) / 1000, teleKind: this.boss.teleKind } : null,
      tele: { at: this.lastTeleAt, kind: this.lastTeleKind, hitAt: this.lastHitAt, hitKind: this.lastHitKind, gap: this.lastHitAt >= 0 && this.lastTeleAt >= 0 ? Math.round((this.lastHitAt - this.lastTeleAt) * 1000) / 1000 : -1 },
      evoAnim: Math.round(this.evoAnim * 1000) / 1000,
      evoName: this.evoName,
      enemies: this.countActive(),
      elites: this.enemies.filter(e => e.active && e.elite && !e.dead).length,
      shots: this.shots.filter(s => s.active).length,
      eshots: this.eshots.filter(s => s.active).length,
      gems: this.gems.filter(g => g.active).length,
      pickups: this.pickups.filter(p => p.active).length,
      zones: this.zones.filter(z => z.active).length,
      rain: this.rain > 0,
      particles: this.particles.filter(p => p.active).length,
      loop: !!this.raf,
      god: this.god,
      quality: this.save.settings.quality,
      dpr: this.view.dpr,
      weapons: this.weapons.map(w => ({ id: w.id, level: w.level, evolved: w.evolved })),
      passives: { ...this.passives },
      dust: this.save.dust,
      best: this.save.records.bestTime,
      offers: this.offers.map(o => ({ kind: o.kind, id: o.id, name: o.name })),
      rewards: this.rewards.map(r => r.id),
      fps: Math.round(this.fps),
      audio: this.audio.ready,
      timeScale: this.timeScale,
    };
  }

  debugWarp(sec: number): void {
    if (this.phase !== 'playing') return;
    this.elapsed += sec;
    this.spawnTimer = 0;
    this.waveTimer = Math.min(this.waveTimer, 1);
  }

  debugSpawn(n: number, kind?: string): void {
    const p = this.player;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const d = 180 + this.rnd() * 380;
      const def = kind ? ENEMY_BY_ID[kind] : pickEnemyKind(() => this.rnd(), this.minutes);
      this.spawnEnemy(def ? def.id : 'mote', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
    }
  }

  debugKillAll(): void {
    for (const e of this.enemies) {
      if (e.active && !e.dead) this.killEnemy(e);
    }
  }

  debugGive(id: string, level = 1, evolved = false): void {
    const def = WEAPON_BY_ID[id];
    if (!def) return;
    const ex = this.weapons.find(w => w.id === id);
    if (ex) { ex.level = Math.max(1, Math.min(8, level)); ex.evolved = evolved }
    else this.weapons.push({ id, level: Math.max(1, Math.min(8, level)), evolved, cool: 0 });
    this.refreshStats(true);
  }

  debugEvolve(id: string): void {
    const w = this.weapons.find(x => x.id === id);
    const def = WEAPON_BY_ID[id];
    if (!w || !def) return;
    w.level = 8;
    w.evolved = true;
    this.evolutions++;
    this.audio.sfx('evolve');
    this.refreshStats(true);
  }

  debugHurt(n: number): void {
    this.damagePlayer(n, this.player.x, this.player.y);
  }

  /** 验收用：直接削 Boss 的血，检查分阶段与死亡流程。 */
  debugHitBoss(n: number): void {
    if (this.boss && this.boss.active && !this.boss.dead) this.hitEnemy(this.boss, n, { silent: true, noCrit: true });
  }

  /** 验收用：不等时间表，直接召出当前 Boss，便于测预警窗口。 */
  debugBoss(): void {
    if (this.phase !== 'playing') return;
    if (!this.boss) this.spawnBoss();
  }

  debugAddXp(n: number): void { this.gainXp(n); }

  /** 验收用：在脚边放一个宝箱 / 商人，省得走位去找。 */
  debugPickup(kind: string): void {
    this.spawnPickup(kind === 'merchant' ? 'merchant' : 'chest', this.player.x + 30, this.player.y);
  }

  debugEvent(id: string): void { this.startRandomEvent(EVENT_BY_ID[id] || EVENTS[0]) }

  debugGold(n: number): void { this.player.gold += n }

  debugGod(on: boolean): void { this.god = on }

  debugStats(): Record<string, number> {
    const s = this.statsData;
    return {
      damage: s.damage, attackSpeed: s.attackSpeed, crit: s.crit, critMul: s.critMul,
      maxHp: s.maxHp, speed: s.speed, armor: s.armor, cdr: s.cdr, area: s.area,
      pickup: s.pickup, xp: s.xp, gold: s.gold,
    };
  }

  debugPassive(id: string, lv: number): void { this.passives[id] = lv; this.refreshStats(true) }

  /** 验收用：逐把武器的角色标签与 1 级 / 8 级 / 进化数值，探针据此比对差异 */
  debugWeaponProfiles(): Record<string, unknown> {
    const snap = (l: WeaponLevel) => ({ dmg: l.dmg, cd: l.cd, count: l.count, pierce: l.pierce, size: l.size, life: Math.round(l.life * 100) / 100 });
    const out: Record<string, unknown> = {};
    for (const def of WEAPON_DEFS) {
      out[def.id] = {
        id: def.id, name: def.name, glyph: def.glyph, role: def.role, tag: def.tag, color: def.color,
        l1: snap(def.levels[0]), l8: snap(def.levels[def.levels.length - 1]),
        evo: { name: def.evo.name, glyph: def.evo.glyph, reqPassive: def.evo.passive, reqLv: def.evo.passiveLv, stats: snap(def.evo.stats) },
      };
    }
    return out;
  }

  debugStart(charId = 'moke'): void { this.startRun(charId); }

  debugResume(): void { this.resumeGame(); }

  debugPause(): void { this.pauseGame(); }
}

/** 点到线段的距离：光柱与链的判定都用它，不用逐点采样。 */
function pointSegDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 0.0001) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
