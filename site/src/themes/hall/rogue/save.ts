/* 存档。
 *
 * localStorage['txxt.rogue.v3'] —— 一个版本号 + 一组合并过默认值的字段。
 * 读到旧版本（或读到一半坏掉的 JSON）时，不是丢掉玩家的东西，而是：
 *   ① 认得出来的字段照搬；② 认不出来的字段用默认补；③ 版本号升到当前。
 * 战斗恢复（checkpoint）单独一段，存的是"构筑与进度"，不存敌人位置 ——
 * 恢复之后敌人重新从屏幕外涌进来，等于"暂停之后接着打"，不会把一屏怪冻在原地。
 */
export interface WeaponSave { id: string; level: number; evolved: boolean }
export interface Checkpoint {
  at: number
  charId: string
  elapsed: number
  level: number
  xp: number
  xpNext: number
  hp: number
  gold: number
  kills: number
  dmg: number
  seed: number
  weapons: WeaponSave[]
  passives: Record<string, number>
  rerolls: number
  bossKills: number
  evolutions: number
  bonusDust: number
}

export interface SaveData {
  v: number
  dust: number
  meta: Record<string, number>
  chars: string[]
  lastChar: string
  records: {
    bestTime: number
    bestLevel: number
    bestKills: number
    bestDamage: number
    runs: number
  }
  achievements: Record<string, number>
  settings: {
    sfx: number
    bgm: number
    quality: 'high' | 'low'
    dmgNumbers: boolean
  }
  checkpoint: Checkpoint | null
}

export const SAVE_KEY = 'txxt.rogue.v3';
export const SAVE_VERSION = 3;

export function defaultSave(): SaveData {
  return {
    v: SAVE_VERSION,
    dust: 0,
    meta: {},
    chars: [],
    lastChar: 'moke',
    records: { bestTime: 0, bestLevel: 0, bestKills: 0, bestDamage: 0, runs: 0 },
    achievements: {},
    settings: { sfx: 0.7, bgm: 0.45, quality: 'high', dmgNumbers: true },
    checkpoint: null,
  };
}

function num(n: unknown, fallback: number): number {
  return typeof n === 'number' && isFinite(n) ? n : fallback;
}

function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  d.dust = Math.max(0, num(o.dust, 0));
  d.records.bestTime = Math.max(0, num((o.records as Record<string, unknown>)?.bestTime, 0));
  d.records.bestLevel = Math.max(0, num((o.records as Record<string, unknown>)?.bestLevel, 0));
  d.records.bestKills = Math.max(0, num((o.records as Record<string, unknown>)?.bestKills, 0));
  d.records.bestDamage = Math.max(0, num((o.records as Record<string, unknown>)?.bestDamage, 0));
  d.records.runs = Math.max(0, num((o.records as Record<string, unknown>)?.runs, 0));
  if (o.meta && typeof o.meta === 'object') {
    for (const [k, v] of Object.entries(o.meta as Record<string, unknown>)) {
      if (typeof v === 'number' && v > 0) d.meta[k] = Math.min(99, Math.floor(v));
    }
  }
  if (Array.isArray(o.chars)) d.chars = o.chars.filter((x): x is string => typeof x === 'string');
  d.lastChar = typeof o.lastChar === 'string' ? o.lastChar : 'moke';
  if (o.achievements && typeof o.achievements === 'object') {
    for (const k of Object.keys(o.achievements as Record<string, unknown>)) {
      d.achievements[k] = 1;
    }
  }
  const st = o.settings as Record<string, unknown> | undefined;
  if (st) {
    d.settings.sfx = Math.max(0, Math.min(1, num(st.sfx, d.settings.sfx)));
    d.settings.bgm = Math.max(0, Math.min(1, num(st.bgm, d.settings.bgm)));
    d.settings.quality = st.quality === 'low' ? 'low' : 'high';
    d.settings.dmgNumbers = st.dmgNumbers !== false;
  }
  const cp = o.checkpoint as Record<string, unknown> | null | undefined;
  if (cp && typeof cp === 'object' && Array.isArray(cp.weapons)) {
    const weapons: WeaponSave[] = [];
    for (const w of cp.weapons as unknown[]) {
      if (!w || typeof w !== 'object') continue;
      const wo = w as Record<string, unknown>;
      if (typeof wo.id === 'string' && typeof wo.level === 'number') {
        weapons.push({ id: wo.id, level: Math.max(1, Math.min(8, Math.floor(wo.level))), evolved: !!wo.evolved });
      }
    }
    if (weapons.length) {
      d.checkpoint = {
        at: num(cp.at, 0),
        charId: typeof cp.charId === 'string' ? cp.charId : 'moke',
        elapsed: Math.max(0, num(cp.elapsed, 0)),
        level: Math.max(1, num(cp.level, 1)),
        xp: Math.max(0, num(cp.xp, 0)),
        xpNext: Math.max(1, num(cp.xpNext, 10)),
        hp: Math.max(1, num(cp.hp, 100)),
        gold: Math.max(0, num(cp.gold, 0)),
        kills: Math.max(0, num(cp.kills, 0)),
        dmg: Math.max(0, num(cp.dmg, 0)),
        seed: Math.floor(num(cp.seed, 1)),
        weapons,
        passives: (cp.passives && typeof cp.passives === 'object')
          ? Object.fromEntries(Object.entries(cp.passives as Record<string, unknown>).filter(([, v]) => typeof v === 'number') as [string, number][])
          : {},
        rerolls: Math.max(0, num(cp.rerolls, 0)),
        bossKills: Math.max(0, num(cp.bossKills, 0)),
        evolutions: Math.max(0, num(cp.evolutions, 0)),
        bonusDust: Math.max(0, num(cp.bonusDust, 0)),
      };
    }
  }
  d.v = SAVE_VERSION;
  return d;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    data.v = SAVE_VERSION;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* 存不进去（隐私模式 / 配额满）：这一局照常能打完，只是下次进来从头 */
  }
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
