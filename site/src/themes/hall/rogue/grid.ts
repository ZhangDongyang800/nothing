/* 均匀网格 —— 只服务"弹体找敌人"这一件事。
 *
 * 一帧最多 260 个敌人、500 发弹体，朴素两两比较是 13 万次/帧；
 * 网格把每次查询压到周围九格（高密度时也就几十个）。每帧重建一次，
 * 桶数组复用（只把 length 归零），不在战斗中分配新数组。
 */
import type { Enemy } from './types'

export class Grid {
  readonly cell = 104
  private buckets = new Map<number, Enemy[]>()

  private key(cx: number, cy: number): number {
    return (cx + 4096) * 8192 + (cy + 4096)
  }

  build(list: Enemy[]): void {
    for (const b of this.buckets.values()) b.length = 0
    for (const e of list) {
      if (!e.active || e.dead) continue
      const k = this.key(Math.floor(e.x / this.cell), Math.floor(e.y / this.cell))
      let b = this.buckets.get(k)
      if (!b) { b = []; this.buckets.set(k, b) }
      b.push(e)
    }
  }

  /** 把 (x,y,r) 周围的敌人塞进 out（out 由调用方复用，函数内先清空）。 */
  query(x: number, y: number, r: number, out: Enemy[]): Enemy[] {
    out.length = 0
    const c = this.cell
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c)
    const y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.buckets.get(this.key(cx, cy))
        if (!b) continue
        for (let i = 0; i < b.length; i++) out.push(b[i])
      }
    }
    return out
  }
}
