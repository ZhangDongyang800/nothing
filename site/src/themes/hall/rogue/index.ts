/* 墨潮的挂载入口。
 *
 * 机台弹层只认三个动作：打开、关掉、重开；Esc 单独返回 true 表示"这一层吃掉了"。
 * 调试接口挂在 window.__rogue 上，验收脚本靠它推进时间、放敌人、给武器，
 * 这样探针不需要在画面上点来点去。
 */
import { Game } from './game'
import './rogue.css'

export interface RogueHandle {
  open(): void
  close(): void
  replay(): void
  escape(): boolean
  game: Game
}

export function mountRogue(hostEl: HTMLElement | null): RogueHandle | null {
  if (!hostEl) return null
  const game = new Game(hostEl)

  const api = {
    state: () => game.debugState(),
    warp: (s: number) => game.debugWarp(s),
    spawn: (n: number, kind?: string) => game.debugSpawn(n, kind),
    killAll: () => game.debugKillAll(),
    addXp: (n: number) => game.debugAddXp(n),
    give: (id: string, level?: number, evolved?: boolean) => game.debugGive(id, level, evolved),
    passive: (id: string, lv: number) => game.debugPassive(id, lv),
    evolve: (id: string) => game.debugEvolve(id),
    hurt: (n: number) => game.debugHurt(n),
    hitBoss: (n: number) => game.debugHitBoss(n),
    boss: () => game.debugBoss(),
    pickup: (kind: string) => game.debugPickup(kind),
    event: (id: string) => game.debugEvent(id),
    gold: (n: number) => game.debugGold(n),
    god: (on: boolean) => game.debugGod(on),
    stats: () => game.debugStats(),
    profiles: () => game.debugWeaponProfiles(),
    start: (charId?: string) => game.debugStart(charId),
    resume: () => game.debugResume(),
    pause: () => game.debugPause(),
    clearSave: () => { try { localStorage.removeItem('txxt.rogue.v3') } catch { /* ignore */ } },
  }
  ;(window as unknown as Record<string, unknown>).__rogue = api

  return {
    open: () => game.open(),
    close: () => game.close(),
    replay: () => game.replay(),
    escape: () => game.escape(),
    game,
  }
}
