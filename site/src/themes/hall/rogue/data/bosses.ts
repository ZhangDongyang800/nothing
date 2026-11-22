/* 五个 Boss。
 *
 * Boss 不是"血量特别高的墨卒"：每个都有独立剪影、独立招式表、独立阶段变化，
 * 招式之前一定先给预警（一条线 / 一圈 / 一片地的形状），玩家至少有一次闪开的机会。
 * 时间表：05 墨牛 / 10 纸鸢 / 15 碑灵 / 22 墨龙 / 30 执笔人；
 * 之后每 12 分钟再轮一圈，同一只 Boss 会带着「潮」的强化回来（数值与招式频率一起抬）。
 */
import type { Enemy, GameApi } from '../types';

export interface BossDef {
  id: string
  name: string
  title: string
  hp: number
  r: number
  color: string
  /** 第一次登场的分钟数 */
  at: number
  intro: string
  note: string
  think: (b: Enemy, g: GameApi, dt: number) => void
}

function toward(b: Enemy, g: GameApi) {
  const a = Math.atan2(g.player.y - b.y, g.player.x - b.x);
  b.hx = Math.cos(a);
  b.hy = Math.sin(a);
  return a;
}

/* ================= 05 墨牛 ================= */
const NIU: BossDef = {
  id: 'niu', name: '墨牛', title: '一角顶穿纸面', hp: 2500, r: 46, color: '#1e1b18', at: 5,
  intro: '墨积成牛，低着头从纸的背面顶上来。',
  note: '蓄力冲锋、贴地踏圈、撞完会喘一口气。',
  think(b, g, dt) {
    b.st -= dt;
    const fast = b.enrage ? 1.35 : 1;
    if (b.pattern === 0) {
      /* 抬头蓄力：一条线，看清楚往哪冲 */
      toward(b, g);
      b.vx = 0; b.vy = 0;
      if (b.st <= 0) { b.pattern = 1; b.st = 0.5 / fast; }
    } else if (b.pattern === 1) {
      b.vx = b.hx * 640 * fast;
      b.vy = b.hy * 640 * fast;
      if (b.st <= 0) { b.pattern = 2; b.st = 1.1; g.ring(b.x, b.y, 90, 16, 200, '#1e1b18'); }
    } else if (b.pattern === 2) {
      b.vx *= 0.86; b.vy *= 0.86;
      if (b.st <= 0) { b.pattern = 3; b.st = 0.85; }
    } else {
      b.vx = 0; b.vy = 0;
      if (b.st <= 0) {
        g.ring(b.x, b.y, 175, b.enrage ? 38 : 28, 300, '#1e1b18');
        g.burst(b.x, b.y, '#1e1b18', 18, 200);
        if (b.enrage) {
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2;
            g.spawnEnemy('mote', b.x + Math.cos(a) * 60, b.y + Math.sin(a) * 60);
          }
        }
        b.pattern = 0; b.st = 1.15 / fast;
      }
    }
    /* 背上偶尔甩两滴墨 */
    b.st2 -= dt;
    if (b.st2 <= 0) {
      b.st2 = 2.4;
      const a = Math.random() * Math.PI * 2;
      g.enemyShot(b.x, b.y, a, 210, b.dmg * 0.6, '#1e1b18', 8);
    }
  },
};

/* ================= 10 纸鸢 ================= */
const ZHIYUAN: BossDef = {
  id: 'zhiyuan', name: '纸鸢', title: '线在手里，刃在天上', hp: 3600, r: 38, color: '#3f5c86', at: 10,
  intro: '一张折起来的纸，边角全是锋，绕着你转圈。',
  note: '扇形纸刃、螺旋弹幕、绕着你游走。',
  think(b, g, dt) {
    b.st -= dt;
    const d = Math.hypot(g.player.x - b.x, g.player.y - b.y);
    const a = toward(b, g);
    const keep = 250;
    if (d > keep + 40) { b.vx = Math.cos(a) * 120; b.vy = Math.sin(a) * 120; }
    else if (d < keep - 40) { b.vx = -Math.cos(a) * 140; b.vy = -Math.sin(a) * 140; }
    else { b.vx = Math.cos(a + 1.57) * 90; b.vy = Math.sin(a + 1.57) * 90; }
    if (b.pattern === 0) {
      if (b.st <= 0) {
        b.st = b.enrage ? 1.4 : 2.3;
        const n = b.enrage ? 11 : 7;
        for (let i = 0; i < n; i++) {
          g.enemyShot(b.x, b.y, a + (i - (n - 1) / 2) * 0.16, 260, b.dmg * 0.55, '#3f5c86', 7);
        }
        b.pattern = 1; b.st2 = 0.9;
      }
    } else if (b.pattern === 1) {
      b.st2 -= dt;
      if (b.st2 <= 0) {
        if (b.enrage) {
          const off = b.phaseT * 2.2;
          for (let i = 0; i < 14; i++) {
            g.enemyShot(b.x, b.y, off + i * (Math.PI * 2 / 14), 210, b.dmg * 0.4, '#6f8bc0', 6);
          }
        }
        b.pattern = 2; b.st2 = 0.9;
      }
    } else if (b.pattern === 2) {
      b.st2 -= dt;
      if (b.st2 <= 0) {
        b.pattern = 0; b.st = b.enrage ? 1.0 : 1.8;
      }
    }
    b.phaseT += dt;
  },
};

/* ================= 15 碑灵 ================= */
const BEILING: BossDef = {
  id: 'beiling', name: '碑灵', title: '一块不肯倒的碑', hp: 5200, r: 44, color: '#5b5751', at: 15,
  intro: '碑从地里长出来，碑上的字开始一个个往外走。',
  note: '召唤字鬼、三圈震荡、碑下点符。',
  think(b, g, dt) {
    b.st -= dt;
    b.vx *= 0.9; b.vy *= 0.9;
    if (b.pattern === 0) {
      if (b.st <= 0) {
        b.pattern = 1; b.st = 0.7;
      }
    } else if (b.pattern === 1) {
      if (b.st <= 0) {
        g.ring(b.x, b.y, 130, b.dmg * 0.9, 260, '#5b5751');
        b.pattern = 2; b.st = 0.35;
      }
    } else if (b.pattern === 2) {
      if (b.st <= 0) {
        g.ring(b.x, b.y, 200, b.dmg * 0.9, 300, '#7a756c');
        b.pattern = 3; b.st = 0.35;
      }
    } else if (b.pattern === 3) {
      if (b.st <= 0) {
        g.ring(b.x, b.y, 275, b.dmg * 0.9, 340, '#5b5751');
        b.pattern = 4; b.st = b.enrage ? 1.2 : 2.2;
      }
    } else {
      if (b.st <= 0) {
        const n = b.enrage ? 7 : 4;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          g.spawnEnemy(i % 2 ? 'mote' : 'caster', b.x + Math.cos(a) * 80, b.y + Math.sin(a) * 80);
        }
        g.zone(g.player.x, g.player.y, {
          r: 90, life: 2.2, dmg: b.dmg * 0.5, tick: 0.5, type: 'rune', color: '#5b5751', slow: 0.25,
        });
        b.pattern = 0; b.st = 1.4;
      }
    }
  },
};

/* ================= 22 墨龙 ================= */
const MOLONG: BossDef = {
  id: 'molong', name: '墨龙', title: '一竖下来，纸就裂了', hp: 7200, r: 52, color: '#26221e', at: 22,
  intro: '墨顺着纸纹流成一条龙，身子还在纸上拖着。',
  note: '横扫墨柱、龙身压路、一路留下墨沼。',
  think(b, g, dt) {
    b.st -= dt;
    b.phaseT += dt;
    const a = toward(b, g);
    const d = Math.hypot(g.player.x - b.x, g.player.y - b.y);
    if (b.pattern === 0) {
      /* 横着游，慢慢靠近 */
      b.vx = Math.cos(a + Math.sin(b.phaseT * 1.5) * 0.8) * 150;
      b.vy = Math.sin(a + Math.cos(b.phaseT * 1.5) * 0.8) * 150;
      if (b.st <= 0) { b.pattern = 1; b.st = 0.75; }
    } else if (b.pattern === 1) {
      /* 预警：以 Boss 为起点，朝玩家拉一条长线 */
      b.vx = 0; b.vy = 0;
      if (b.st <= 0) {
        g.enemyBeam(b.x, b.y, b.x + b.hx * 1200, b.y + b.hy * 1200, 54, b.dmg * 1.1, '#26221e');
        g.burst(b.x + b.hx * 300, b.y + b.hy * 300, '#26221e', 20, 220);
        b.pattern = 2; b.st = b.enrage ? 2.2 : 3.4;
      }
    } else {
      /* 追人 + 身后留墨沼 */
      b.vx = Math.cos(a) * 210;
      b.vy = Math.sin(a) * 210;
      b.st2 -= dt;
      if (b.st2 <= 0) {
        b.st2 = 0.35;
        g.zone(b.x, b.y, { r: 60, life: 4, dmg: 3, tick: 0.5, type: 'poison', color: '#26221e', slow: 0.4 });
      }
      if (b.st <= 0) { b.pattern = 0; b.st = 1.5; }
    }
    if (d < 110 && b.pattern !== 1) {
      /* 龙身擦过也疼 */
      b.atkCd = Math.max(b.atkCd, 0.4);
    }
  },
};

/* ================= 30 执笔人 ================= */
const ZHIBI: BossDef = {
  id: 'zhibi', name: '执笔人', title: '写这页的人来了', hp: 9800, r: 54, color: '#b5342b', at: 30,
  intro: '一个没有脸的人，手里那管笔比你整个人还长。',
  note: '笔锋落地、四向横扫、写到第三阶段会同时做所有事。',
  think(b, g, dt) {
    b.st -= dt;
    b.phaseT += dt;
    const a = toward(b, g);
    const d = Math.hypot(g.player.x - b.x, g.player.y - b.y);
    if (b.pattern === 0) {
      b.vx = Math.cos(a) * (d > 220 ? 120 : -60);
      b.vy = Math.sin(a) * (d > 220 ? 120 : -60);
      if (b.st <= 0) { b.pattern = 1; b.st = 0.8; }
    } else if (b.pattern === 1) {
      /* 笔锋砸下：正前方一条宽线 */
      b.vx = 0; b.vy = 0;
      if (b.st <= 0) {
        g.enemyBeam(b.x, b.y, b.x + b.hx * 900, b.y + b.hy * 900, 92, b.dmg * 1.2, '#b5342b');
        g.explode(b.x + b.hx * 120, b.y + b.hy * 120, 90, b.dmg * 0.6, '#b5342b');
        b.pattern = 2; b.st = 0.6;
      }
    } else if (b.pattern === 2) {
      if (b.st <= 0) {
        /* 四向横扫：十字，两道错开 */
        for (let k = 0; k < 4; k++) {
          const aa = b.phaseT * 0.4 + k * Math.PI / 2;
          g.enemyBeam(b.x, b.y, b.x + Math.cos(aa) * 1100, b.y + Math.sin(aa) * 1100, 46, b.dmg * 0.8, '#7c4a63');
        }
        b.pattern = 3; b.st = 0.7;
      }
    } else if (b.pattern === 3) {
      if (b.st <= 0) {
        /* 召唤一排字鬼 + 笔下留墨 */
        const n = b.enrage ? 8 : 5;
        for (let i = 0; i < n; i++) {
          const aa = (i / n) * Math.PI * 2;
          g.spawnEnemy(i % 3 === 0 ? 'caster' : 'mote', b.x + Math.cos(aa) * 100, b.y + Math.sin(aa) * 100);
        }
        g.zone(b.x + b.hx * 180, b.y + b.hy * 180, {
          r: 130, life: 4, dmg: 4, tick: 0.4, type: 'poison', color: '#7c4a63', slow: 0.35,
        });
        b.pattern = 0; b.st = b.enrage ? 1.1 : 1.8;
      }
    }
  },
};

export const BOSS_DEFS: BossDef[] = [NIU, ZHIYUAN, BEILING, MOLONG, ZHIBI];
export const BOSS_BY_ID: Record<string, BossDef> = {};
for (const d of BOSS_DEFS) BOSS_BY_ID[d.id] = d;

/** 第 n 只 Boss（0 起）是哪一只：前五只按表，之后每轮循环并加强。 */
export function bossForIndex(i: number): { def: BossDef; tier: number } {
  const def = BOSS_DEFS[i % BOSS_DEFS.length];
  const tier = Math.floor(i / BOSS_DEFS.length);
  return { def, tier };
}

export const BOSS_TIMES = [5, 10, 15, 22, 30, 40, 50, 60, 72, 86, 100, 116, 134, 154, 176];
