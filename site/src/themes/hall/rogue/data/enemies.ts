/* 十种普通敌人 + 一枚分裂出来的碎墨。
 *
 * 每种敌人都写清"怎么走、怎么打、什么时候该认得出来"：
 *   · 走位（直追 / 拉开距离 / 绕圈 / 闪烁）
 *   · 出手（接触伤害 / 远程 / 自爆 / 放网 / 治疗光环）
 *   · 剪影（只画一个形状，玩家在 200 个墨点里也能一眼分出"那个是炸弹"）
 *
 * 精英不是"血厚一点的同一个东西"：血量 ×7、伤害 ×1.7、体型 ×1.6，
 * 外面套一圈脉动的环，还会掉宝箱。
 */
import type { Enemy, GameApi } from '../types';

export interface EnemyDef {
  id: string
  name: string
  hp: number
  speed: number
  dmg: number
  r: number
  xp: number
  gold: number
  /** 刷怪权重 */
  weight: number
  /** 第几分钟开始出现 */
  min: number
  color: string
  /** 一句话，Boss 登场 / 图鉴里用得上 */
  note: string
  think: (e: Enemy, g: GameApi, dt: number) => void
}

function chase(e: Enemy, g: GameApi, mul = 1) {
  const a = Math.atan2(g.player.y - e.y, g.player.x - e.x);
  e.vx = Math.cos(a) * e.speed * mul;
  e.vy = Math.sin(a) * e.speed * mul;
  e.hx = Math.cos(a);
  e.hy = Math.sin(a);
}

const MOTES: EnemyDef[] = [
  {
    id: 'mote', name: '墨卒', hp: 24, speed: 86, dmg: 8, r: 11, xp: 2, gold: 0.4,
    weight: 12, min: 0, color: '#2b2723',
    note: '最普通的一滴墨，直着走，碰到就咬一口。',
    think(e, g) { chase(e, g); },
  },
  {
    id: 'streak', name: '疾影', hp: 17, speed: 146, dmg: 6, r: 10, xp: 2, gold: 0.4,
    weight: 7, min: 1, color: '#3a3f4a',
    note: '细长的一条，忽快忽慢，专挑走位空隙钻。',
    think(e, g, dt) {
      /* 峰值 146×1.32≈193，低于角色基础移速（198~240）：
         它仍然难缠，但玩家直线跑得掉，不用靠冲刺硬换。 */
      const w = 1 + Math.sin(e.st * 5.2 + e.id * 0.7) * 0.32;
      const a = Math.atan2(g.player.y - e.y, g.player.x - e.x) + Math.sin(e.st * 6 + e.id) * 0.3;
      e.vx = Math.cos(a) * e.speed * w;
      e.vy = Math.sin(a) * e.speed * w;
      e.st += dt;
    },
  },
  {
    id: 'caster', name: '投笔', hp: 36, speed: 62, dmg: 7, r: 12, xp: 4, gold: 0.9,
    weight: 5, min: 2, color: '#3f5c86',
    note: '停在远处往你身上甩墨点，先跑到它脸上。',
    think(e, g, dt) {
      const d = Math.hypot(g.player.x - e.x, g.player.y - e.y);
      const a = Math.atan2(g.player.y - e.y, g.player.x - e.x);
      if (d < 230) { e.vx = -Math.cos(a) * e.speed; e.vy = -Math.sin(a) * e.speed; }
      else if (d > 340) { e.vx = Math.cos(a) * e.speed; e.vy = Math.sin(a) * e.speed; }
      else { e.vx = Math.cos(a + 1.6) * e.speed * 0.6; e.vy = Math.sin(a + 1.6) * e.speed * 0.6; }
      e.st -= dt;
      if (e.st <= 0 && d < 520) {
        e.st = Math.max(1.3, 2.6 - g.elapsed / 300);
        g.enemyShot(e.x, e.y, a, 230, e.dmg, '#3f5c86', 6);
      }
    },
  },
  {
    id: 'heavy', name: '重墨', hp: 130, speed: 48, dmg: 20, r: 21, xp: 8, gold: 1.5,
    weight: 4, min: 3, color: '#1e1b18',
    note: '一大块压下来的墨，走得慢，撞上很疼。',
    think(e, g) { chase(e, g); },
  },
  {
    id: 'bomber', name: '爆墨', hp: 30, speed: 112, dmg: 26, r: 13, xp: 4, gold: 1,
    weight: 5, min: 3, color: '#b5342b',
    note: '肚子里有火，贴上去就炸——别让它靠得太近。',
    think(e, g, dt) {
      chase(e, g);
      e.st += dt;
      const d = Math.hypot(g.player.x - e.x, g.player.y - e.y);
      if (d < 58) { e.hp = 0; }
    },
  },
  {
    id: 'splitter', name: '裂墨', hp: 64, speed: 74, dmg: 10, r: 16, xp: 5, gold: 1.1,
    weight: 5, min: 4, color: '#4a3b2e',
    note: '打碎它，会裂成两枚小的——清完之前别停手。',
    think(e, g) { chase(e, g); },
  },
  {
    id: 'weaver', name: '织网', hp: 48, speed: 68, dmg: 8, r: 13, xp: 4, gold: 0.9,
    weight: 4, min: 5, color: '#4f7757',
    note: '走过的地方留下墨网，踩上去人会变慢。',
    think(e, g, dt) {
      chase(e, g);
      e.st -= dt;
      if (e.st <= 0) {
        e.st = 2.6;
        g.zone(e.x, e.y, { r: 58, life: 5, dmg: 0, tick: 1, type: 'web', color: '#4f7757', slow: 0.45 });
      }
    },
  },
  {
    id: 'warder', name: '盾墨', hp: 56, speed: 72, dmg: 11, r: 14, xp: 5, gold: 1.2,
    weight: 4, min: 6, color: '#5b5751',
    note: '外面有一层墨壳，先打破壳才伤得到里面。',
    think(e, g, dt) {
      chase(e, g);
      if (e.shield <= 0) {
        e.shieldT -= dt;
        if (e.shieldT <= 0) { e.shield = e.shieldMax; e.shieldT = 6; }
      }
    },
  },
  {
    id: 'phantom', name: '幽影', hp: 42, speed: 118, dmg: 13, r: 12, xp: 6, gold: 1.4,
    weight: 4, min: 8, color: '#6d6a75',
    note: '一闪一闪地换位置，追它的时候先看它下一秒会出现在哪。',
    think(e, g, dt) {
      if (e.st > 0) {
        e.st -= dt;
        if (e.st <= 0) {
          e.st = 2.8;
          const a = g.rnd() * Math.PI * 2;
          const d = 120 + g.rnd() * 120;
          g.burst(e.x, e.y, '#6d6a75', 8, 90);
          e.x = g.player.x + Math.cos(a) * d;
          e.y = g.player.y + Math.sin(a) * d;
          e.spawnT = 0.35;
          g.burst(e.x, e.y, '#6d6a75', 8, 90);
        }
      }
      chase(e, g);
    },
  },
  {
    id: 'chanter', name: '咒者', hp: 100, speed: 54, dmg: 9, r: 17, xp: 8, gold: 1.8,
    weight: 3, min: 10, color: '#7c4a63',
    note: '不追人，站在外圈给同伴续命。它不死，这一波就清不完。',
    think(e, g, dt) {
      const d = Math.hypot(g.player.x - e.x, g.player.y - e.y);
      const a = Math.atan2(g.player.y - e.y, g.player.x - e.x);
      if (d < 250) { e.vx = -Math.cos(a) * e.speed; e.vy = -Math.sin(a) * e.speed; }
      else { e.vx = Math.cos(a + 1.5) * e.speed * 0.5; e.vy = Math.sin(a + 1.5) * e.speed * 0.5; }
      e.st -= dt;
      if (e.st <= 0) {
        e.st = 2;
        const near = g.enemiesNear(e.x, e.y, 170);
        for (const o of near) {
          if (o === e) continue;
          o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.06);
        }
        g.ring(e.x, e.y, 150, 0, 0, '#7c4a63');
      }
    },
  },
  {
    id: 'shard', name: '碎墨', hp: 14, speed: 120, dmg: 5, r: 8, xp: 1, gold: 0.2,
    weight: 0, min: 99, color: '#4a3b2e',
    note: '从裂墨身上掉下来的小片。',
    think(e, g) { chase(e, g); },
  },
];

export const ENEMY_DEFS = MOTES;
export const ENEMY_BY_ID: Record<string, EnemyDef> = {};
for (const d of MOTES) ENEMY_BY_ID[d.id] = d;

/** 按时间挑一种：只从"到点出现"的类型里按权重取。 */
export function pickEnemyKind(rnd: () => number, minutes: number): EnemyDef {
  let total = 0;
  for (const d of MOTES) {
    if (d.min <= minutes && d.weight > 0) total += d.weight;
  }
  let r = rnd() * total;
  for (const d of MOTES) {
    if (d.min > minutes || d.weight <= 0) continue;
    r -= d.weight;
    if (r <= 0) return d;
  }
  return MOTES[0];
}
