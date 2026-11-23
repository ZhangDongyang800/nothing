/* 挂载入口：跟 rogue 的写法保持一致 —— 返回 Handle，并把调试接口挂到 window.__legion。 */
import './legion.css'
import './legion-v6.css'
import './legion-v7.css'
import { LegionGame } from './game'

export interface LegionHandle {
  open(): void
  close(): void
  replay(): void
  escape(): boolean
  destroy(): void
  game: LegionGame
}

export function mountLegion(hostEl: HTMLElement): LegionHandle {
  const game = new LegionGame(hostEl)
  const api = {
    ...game.debug,
    state: (): Record<string, unknown> => game.debugState(),
    game,
  }
  ;(window as unknown as Record<string, unknown>).__legion = api
  return {
    open: () => game.open(),
    close: () => game.close(),
    replay: () => game.startRun(game.hero, false),
    escape: () => game.escape(),
    destroy: () => {
      game.destroy()
      delete (window as unknown as Record<string, unknown>).__legion
    },
    game,
  }
}
