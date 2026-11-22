/* 十二件武器。
 *
 * 一件武器 = 一张数据表（八级成长 + 一个进化形态）+ 一个 fire()。
 * fire() 里只写"这一件怎么打"，命中、暴击、掉落、对象池全在 game.ts 里统一处理。
 * 这样加一件武器不需要碰主循环，也不会出现"十二件只是换颜色"。
 *
 * 进化的条件写在 evo.passive / passiveLv：武器满八级 + 指定被动到三级，
 * 升级卡里才会出现那张金色的进化卡。
 */
import type { WeaponDef, WeaponInst, WeaponLevel } from '../types';

function mk(
  d0: number, ds: number,
  cd0: number, cds: number,
  counts: number[],
  pierce0: number, ps: number,
  size: number, life: number,
  texts: string[],
): WeaponLevel[] {
  const out: WeaponLevel[] = [];
  for (let i = 0; i < 8; i++) {
    out.push({
      dmg: Math.round((d0 + ds * i) * 10) / 10,
      cd: Math.max(0.16, Math.round((cd0 + cds * i) * 100) / 100),
      count: counts[i],
      pierce: pierce0 + ps * i,
      size,
      life,
      text: texts[Math.min(i, texts.length - 1)],
    });
  }
  return out;
}

/** 一件武器当前的等级表：进化后整张表换成进化表（不是"数值变大一点"）。 */
export function statsOf(w: WeaponInst, def: WeaponDef): WeaponLevel {
  if (w.evolved) return def.evo.stats;
  const i = Math.max(0, Math.min(def.levels.length - 1, w.level - 1));
  return def.levels[i];
}

const C = {
  ink: '#26221e',
  red: '#b5342b',
  gold: '#b8892f',
  jade: '#4f7757',
  indigo: '#3f5c86',
  plum: '#7c4a63',
  bronze: '#8a6a3a',
  ash: '#5b5751',
  teal: '#3f6f70',
};

/* ================= 1. 飞白 ================= */
const FEIBAI: WeaponDef = {
  id: 'feibai', name: '飞白', glyph: '白', color: C.ink, tag: '直线 · 穿透',
  intro: '朝最近的一枚墨点甩出一道笔锋，笔尖穿过不止一个。',
  levels: mk(9, 5.4, 1.05, -0.1, [1, 1, 2, 2, 3, 3, 4, 5], 1, 0.5, 7, 1.05,
    ['一道笔锋 · 穿 1 个', '笔锋更硬', '两道齐发', '笔锋能穿 2 个', '三道', '穿 3 个 · 更快',
      '四道', '五道 · 穿透风暴']),
  evo: {
    id: 'pomo', name: '泼墨', glyph: '泼', tag: '进化 · 分裂',
    intro: '笔锋落点炸开两滴墨，墨滴各自再找下一个目标。',
    passive: 'area', passiveLv: 3,
    stats: { dmg: 34, cd: 0.22, count: 6, pierce: 6, size: 11, life: 1.25, text: '六道泼墨 · 命中分裂' },
  },
  fire(g, w) {
    const L = statsOf(w, FEIBAI);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const t = g.nearest(px, py, 980);
    const base = t ? Math.atan2(t.y - py, t.x - px) : g.player.face;
    const n = L.count + st.extraProj;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.075;
      g.shot({
        x: px, y: py, vx: Math.cos(a) * 620, vy: Math.sin(a) * 620,
        r: L.size, dmg: L.dmg, pierce: L.pierce, life: L.life,
        kind: w.evolved ? 'stroke-e' : 'stroke', color: C.ink,
        split: w.evolved ? 2 : 0, width: L.size * 1.4, trail: true,
      });
    }
    g.burst(px, py, C.ink, 4, 90);
  },
};

/* ================= 2. 惊雷 ================= */
const THUNDER: WeaponDef = {
  id: 'thunder', name: '惊雷', glyph: '雷', color: C.indigo, tag: '连锁 · 多目标',
  intro: '雷从最近的一枚墨点起跳，在敌群里连成一条折线。',
  levels: mk(14, 7.5, 1.7, -0.11, [2, 2, 3, 3, 4, 4, 5, 6], 0, 0, 0, 0,
    ['连 2 个', '雷更重', '连 3 个', '连 3 个 · 更快', '连 4 个', '连 4 个 · 雷更宽',
      '连 5 个', '连 6 个']),
  evo: {
    id: 'tianfa', name: '天罚', glyph: '罚', tag: '进化 · 雷暴',
    intro: '每一击都带一片雷云：六道落雷同时砸下，落点还会炸开一圈。',
    passive: 'cdr', passiveLv: 3,
    stats: { dmg: 40, cd: 0.75, count: 8, pierce: 0, size: 0, life: 0, text: '八道落雷 · 落点炸环' },
  },
  fire(g, w) {
    const L = statsOf(w, THUNDER);
    const px = g.player.x, py = g.player.y;
    const t = g.nearest(px, py, 900);
    if (!t) return;
    g.chain(px, py, L.count, L.dmg, 240, C.indigo);
    g.burst(px, py, C.indigo, 6, 120);
    if (w.evolved) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.random() * 0.3;
        const d = 90 + Math.random() * 280;
        const x = t.x + Math.cos(a) * d, y = t.y + Math.sin(a) * d;
        g.chain(x, y, 2, L.dmg * 0.7, 170, '#6f8bc0');
        g.ring(x, y, 34, L.dmg * 0.5, 60, '#6f8bc0');
      }
    }
  },
};

/* ================= 3. 炭火 ================= */
const EMBER: WeaponDef = {
  id: 'ember', name: '炭火', glyph: '炭', color: C.red, tag: '抛射 · 爆炸',
  intro: '一枚炭火落在敌群中间炸开，火星还会在地上烧一阵。',
  levels: mk(20, 11, 2.1, -0.13, [1, 1, 1, 2, 2, 2, 3, 3], 0, 0, 30, 1.5,
    ['一枚 · 炸开 30', '火更旺', '爆得更宽', '两枚', '两枚 · 火圈更大', '三枚的可能',
      '三枚', '三枚 · 地上留火']),
  evo: {
    id: 'liaoyuan', name: '燎原', glyph: '燎', tag: '进化 · 燃地',
    intro: '四枚火种落地成片，火不只在炸的那一下，而是一直烧。',
    passive: 'damage', passiveLv: 3,
    stats: { dmg: 62, cd: 1.1, count: 4, pierce: 0, size: 58, life: 1.6, text: '四枚火种 · 落地成片' },
  },
  fire(g, w) {
    const L = statsOf(w, EMBER);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const n = L.count + Math.min(2, st.extraProj);
    for (let i = 0; i < n; i++) {
      const t = g.randomEnemyNear(px, py, 560);
      const tx = t ? t.x + (Math.random() - 0.5) * 60 : px + (Math.random() - 0.5) * 320;
      const ty = t ? t.y + (Math.random() - 0.5) * 60 : py + (Math.random() - 0.5) * 320;
      const d = Math.hypot(tx - px, ty - py);
      const a = Math.atan2(ty - py, tx - px);
      const speed = Math.min(660, 230 + d * 1.15);
      g.shot({
        x: px, y: py, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: L.size * 0.5, dmg: L.dmg, pierce: 0, life: Math.max(0.45, d / speed),
        kind: w.evolved ? 'ember-e' : 'ember', color: C.red,
        explodeR: L.size * st.area, explodeDmg: L.dmg * 0.9,
      });
    }
  },
};

/* ================= 4. 环锋 ================= */
const ORBIT: WeaponDef = {
  id: 'orbit', name: '环锋', glyph: '环', color: C.jade, tag: '环绕 · 持续',
  intro: '几片墨刃绕着人转，碰到就割一下。不瞄准，也不停。',
  levels: mk(7, 4.2, 0.3, 0, [1, 1, 2, 2, 3, 3, 3, 4], 0, 0, 13, 0,
    ['一片绕身', '转得更快', '两片', '刃更长', '三片', '转得更快', '三片 · 更远', '四片 · 刃轮']),
  evo: {
    id: 'renlun', name: '刃轮', glyph: '轮', tag: '进化 · 甩刃',
    intro: '四片墨刃绕成一个轮，每转一圈就甩出一枚刃影追最近的敌人。',
    passive: 'move', passiveLv: 3,
    stats: { dmg: 30, cd: 0.32, count: 4, pierce: 4, size: 26, life: 0.5, text: '刃轮 · 每转甩刃' },
  },
  fire(g, w) {
    const L = statsOf(w, ORBIT);
    const st = g.stats();
    g.syncOrbit(w, L.count + st.extraProj, 80 * st.area, w.evolved ? 7.4 : 4.2, L.dmg);
    if (w.evolved) {
      const o = w.orbit;
      if (!o) return;
      const px = g.player.x + Math.cos(o.ang) * o.r;
      const py = g.player.y + Math.sin(o.ang) * o.r;
      const t = g.nearest(px, py, 460);
      const a = t ? Math.atan2(t.y - py, t.x - px) : o.ang;
      g.shot({
        x: px, y: py, vx: Math.cos(a) * 480, vy: Math.sin(a) * 480,
        r: 9, dmg: L.dmg * 1.2, pierce: 4, life: 0.7,
        kind: 'blade', color: C.jade, width: 12,
      });
    }
  },
};

/* ================= 5. 追魂 ================= */
const SEEK: WeaponDef = {
  id: 'seek', name: '追魂', glyph: '追', color: C.gold, tag: '追踪 · 多弹',
  intro: '几根墨针自己会拐弯，追着最近的墨点扎。',
  levels: mk(6, 3.6, 0.85, -0.06, [2, 2, 3, 4, 4, 5, 6, 7], 1, 0.2, 5, 1.7,
    ['两根', '针更利', '三根', '四根', '四根 · 更快', '五根', '六根', '七根']),
  evo: {
    id: 'wanjian', name: '万箭', glyph: '箭', tag: '进化 · 螺旋',
    intro: '墨针不再一根根发，而是从身周螺旋着泼出去，落在谁身上算谁。',
    passive: 'attackSpeed', passiveLv: 3,
    stats: { dmg: 18, cd: 0.26, count: 5, pierce: 2, size: 6, life: 1.9, text: '螺旋 · 每次五根' },
  },
  fire(g, w) {
    const L = statsOf(w, SEEK);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const n = L.count + st.extraProj;
    for (let i = 0; i < n; i++) {
      const a = w.evolved
        ? (w.level * 0.62) + i * (Math.PI * 2 / n)
        : Math.random() * Math.PI * 2;
      g.shot({
        x: px, y: py, vx: Math.cos(a) * 230, vy: Math.sin(a) * 230,
        r: L.size, dmg: L.dmg, pierce: L.pierce, life: L.life,
        kind: 'needle', color: C.gold, homing: w.evolved ? 900 : 700, trail: true,
      });
    }
    g.burst(px, py, C.gold, 3, 60);
  },
};

/* ================= 6. 一线 ================= */
const LASER: WeaponDef = {
  id: 'laser', name: '一线', glyph: '线', color: C.indigo, tag: '贯穿 · 直线',
  intro: '一道细光沿直线射出去，路径上所有墨点一起断。',
  levels: mk(24, 14, 2.6, -0.14, [1, 1, 1, 1, 1, 2, 2, 2], 0, 0, 15, 0.18,
    ['一道', '光更利', '更宽', '更快', '更快 · 更宽', '十字两道', '十字 · 更宽', '十字 · 常亮']),
  evo: {
    id: 'tianguang', name: '天光', glyph: '光', tag: '进化 · 四向',
    intro: '一次落四道天光，十字交错，扫过的地方留下一道烧痕。',
    passive: 'pierce', passiveLv: 3,
    stats: { dmg: 100, cd: 1.1, count: 4, pierce: 99, size: 26, life: 0.3, text: '四道天光 · 路径烧灼' },
  },
  fire(g, w) {
    const L = statsOf(w, LASER);
    const px = g.player.x, py = g.player.y;
    const t = g.nearest(px, py, 1000);
    const base = t ? Math.atan2(t.y - py, t.x - px) : g.player.face;
    const beams = w.evolved ? 4 : (L.count >= 2 ? 2 : 1);
    const spread = w.evolved ? Math.PI / 2 : (L.count >= 2 ? 0.5 : 0);
    for (let i = 0; i < beams; i++) {
      const a = base + (beams > 1 ? (i - (beams - 1) / 2) * spread : 0);
      const len = 980;
      g.beam(px, py, px + Math.cos(a) * len, py + Math.sin(a) * len, {
        dmg: L.dmg, width: L.size, life: L.life, color: C.indigo,
        kind: w.evolved ? 'light' : 'laser',
      });
    }
  },
};

/* ================= 7. 墨塔 ================= */
const TURRET: WeaponDef = {
  id: 'turret', name: '墨塔', glyph: '塔', color: C.bronze, tag: '召唤 · 自动',
  intro: '在身边垒一座小墨塔，它自己找最近的墨点打。',
  levels: mk(7, 4.1, 4.4, -0.26, [1, 1, 2, 2, 2, 3, 3, 4], 0, 0, 12, 16,
    ['一座 · 每 0.8 秒一发', '更重', '两座', '两座 · 更密', '两座 · 更久', '三座',
      '三座 · 更久', '四座']),
  evo: {
    id: 'shuangta', name: '双塔', glyph: '双', tag: '进化 · 双管',
    intro: '每座塔变成双管，一次两发，塔下还压着一圈减速的墨。',
    passive: 'xp', passiveLv: 3,
    stats: { dmg: 26, cd: 1.4, count: 4, pierce: 0, size: 16, life: 22, text: '四座双管塔 · 塔下带墨' },
  },
  fire(g, w) {
    const L = statsOf(w, TURRET);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const max = L.count + Math.min(2, st.extraProj);
    const have = g.turretCount('turret');
    for (let i = have; i < max; i++) {
      const a = (i / Math.max(1, max)) * Math.PI * 2 + 0.3;
      const r = 52 + i * 8;
      g.turret(px + Math.cos(a) * r, py + Math.sin(a) * r, {
        life: L.life, cd: 0.8, dmg: L.dmg, range: 320 * st.area,
        color: C.bronze, kind: 'turret', src: 'turret', r: 13, double: w.evolved ? 1 : 0,
      });
      if (w.evolved) {
        g.zone(px + Math.cos(a) * r, py + Math.sin(a) * r, {
          r: 46, life: L.life, dmg: 2, tick: 0.7, type: 'slow', color: C.bronze, slow: 0.32,
        });
      }
    }
  },
};

/* ================= 8. 毒瘴 ================= */
const POISON: WeaponDef = {
  id: 'poison', name: '毒瘴', glyph: '瘴', color: C.jade, tag: '地面 · 持续',
  intro: '在墨点脚下摊开一片绿雾，站在里面的人一直在掉血。',
  levels: mk(6, 3.4, 2.2, -0.1, [1, 1, 1, 2, 2, 2, 3, 3], 0, 0, 46, 3.2,
    ['一片 · 半径 46', '更毒', '摊得更开', '两片', '两片 · 更久', '两片 · 更毒',
      '三片', '三片 · 毒海']),
  evo: {
    id: 'yihai', name: '疫海', glyph: '疫', tag: '进化 · 扩散',
    intro: '一片毒雾会自己生出第二片，范围大得能盖住半个屏。',
    passive: 'luck', passiveLv: 3,
    stats: { dmg: 26, cd: 0.9, count: 3, pierce: 0, size: 96, life: 4.6, text: '三片巨雾 · 自行扩散' },
  },
  fire(g, w) {
    const L = statsOf(w, POISON);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const n = L.count + Math.min(2, st.extraProj);
    for (let i = 0; i < n; i++) {
      const t = g.randomEnemyNear(px, py, 480);
      const x = (t ? t.x : px) + (Math.random() - 0.5) * 70;
      const y = (t ? t.y : py) + (Math.random() - 0.5) * 70;
      g.zone(x, y, {
        r: L.size * st.area, life: L.life, dmg: L.dmg, tick: 0.45,
        type: 'poison', color: C.jade, slow: 0.35,
      });
      if (w.evolved) {
        g.zone(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 120, {
          r: L.size * st.area * 0.85, life: L.life * 0.8, dmg: L.dmg * 0.8, tick: 0.45,
          type: 'poison', color: '#6f8f6a', slow: 0.35,
        });
      }
    }
  },
};

/* ================= 9. 影身 ================= */
const CLONE: WeaponDef = {
  id: 'clone', name: '影身', glyph: '影', color: C.ash, tag: '召唤 · 近战',
  intro: '放出一道影，它自己会扑向墨点，替你在外圈挡一下。',
  levels: mk(10, 6, 7.5, -0.5, [1, 1, 1, 2, 2, 2, 3, 3], 0, 0, 10, 8,
    ['一道影 · 8 秒', '影更利', '影更久', '两道影', '两道 · 更快', '两道 · 更利',
      '三道影', '三道 · 影卫']),
  evo: {
    id: 'sanying', name: '三影', glyph: '三', tag: '进化 · 三重',
    intro: '三道影同时出门，每一下都是一片墨刃的横扫。',
    passive: 'hp', passiveLv: 3,
    stats: { dmg: 34, cd: 3.2, count: 3, pierce: 0, size: 15, life: 14, text: '三道影卫 · 横扫' },
  },
  fire(g, w) {
    const L = statsOf(w, CLONE);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const max = L.count;
    const living = g.turretCount('clone');
    for (let i = living; i < max; i++) {
      const a = (i / max) * Math.PI * 2;
      g.turret(px + Math.cos(a) * 60, py + Math.sin(a) * 60, {
        life: L.life, cd: w.evolved ? 0.55 : 0.9, dmg: L.dmg, range: 260 * st.area,
        color: C.ash, kind: 'clone', src: 'clone', r: w.evolved ? 15 : 12,
      });
    }
  },
};

/* ================= 10. 陨石 ================= */
const METEOR: WeaponDef = {
  id: 'meteor', name: '陨石', glyph: '陨', color: C.plum, tag: '天降 · 大范围',
  intro: '天上落一块墨石，落点先亮一下——站远点，那是给敌人的。',
  levels: mk(32, 17, 4.6, -0.24, [1, 1, 2, 2, 2, 3, 3, 4], 0, 0, 58, 0.9,
    ['一块 · 半径 58', '更重', '两块', '两块 · 更大', '落得更快', '三块', '三块 · 更重', '四块 · 天坠']),
  evo: {
    id: 'tianzhui', name: '天坠', glyph: '坠', tag: '进化 · 连坠',
    intro: '一次落下六块，最后一块把整片地砸出一圈冲击波。',
    passive: 'crit', passiveLv: 3,
    stats: { dmg: 120, cd: 2.2, count: 6, pierce: 0, size: 82, life: 0.8, text: '六块连坠 · 收尾震地' },
  },
  fire(g, w) {
    const L = statsOf(w, METEOR);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const t = g.randomEnemyNear(px, py, 600);
    const cx = t ? t.x : px + (Math.random() - 0.5) * 300;
    const cy = t ? t.y : py + (Math.random() - 0.5) * 300;
    const n = L.count;
    for (let i = 0; i < n; i++) {
      const x = cx + (Math.random() - 0.5) * (i ? 140 : 0);
      const y = cy + (Math.random() - 0.5) * (i ? 140 : 0);
      g.meteor(x, y, L.life, L.dmg, L.size * st.area, C.plum);
    }
    if (w.evolved) {
      g.ring(cx, cy, L.size * st.area * 1.25, L.dmg * 0.6, 260, C.plum);
    }
  },
};

/* ================= 11. 折扇 ================= */
const FAN: WeaponDef = {
  id: 'fan', name: '折扇', glyph: '扇', color: C.teal, tag: '回旋 · 往返',
  intro: '扇子甩出去会自己回来，去一趟、回来一趟都割人。',
  levels: mk(8, 4.6, 1.5, -0.1, [1, 1, 2, 2, 2, 3, 3, 4], 6, 0.5, 12, 1.4,
    ['一把 · 去一回', '扇骨更硬', '两把', '两把 · 更宽', '转得更快', '三把', '三把 · 更远', '四把 · 八风']),
  evo: {
    id: 'bafeng', name: '八风', glyph: '风', tag: '进化 · 三向',
    intro: '三把大扇呈扇形撒出去，回来时扇面展开，扫过一整条路。',
    passive: 'critMul', passiveLv: 3,
    stats: { dmg: 36, cd: 0.65, count: 3, pierce: 12, size: 20, life: 1.8, text: '三把巨扇 · 去回两次' },
  },
  fire(g, w) {
    const L = statsOf(w, FAN);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    const t = g.nearest(px, py, 900);
    const base = t ? Math.atan2(t.y - py, t.x - px) : g.player.face;
    const n = L.count + Math.min(2, st.extraProj);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.24;
      g.shot({
        x: px, y: py, vx: Math.cos(a) * 470, vy: Math.sin(a) * 470,
        r: L.size, dmg: L.dmg, pierce: L.pierce, life: L.life,
        kind: 'fan', color: C.teal, returnAt: 0.42, width: L.size,
      });
    }
  },
};

/* ================= 12. 钟鸣 ================= */
const BELL: WeaponDef = {
  id: 'bell', name: '钟鸣', glyph: '钟', color: C.bronze, tag: '范围 · 击退',
  intro: '敲一下，一圈声浪从脚下推开，近身的墨点连人带墨一起退。',
  levels: mk(9, 5.2, 1.5, -0.11, [1, 1, 1, 1, 2, 2, 2, 2], 0, 0, 82, 0,
    ['一圈 · 半径 82', '声更沉', '推得更远', '更快', '两圈', '两圈 · 更大', '两圈 · 更重', '丧钟']),
  evo: {
    id: 'sangzhong', name: '丧钟', glyph: '丧', tag: '进化 · 双响',
    intro: '两圈叠着响，钟声里每震到一个敌人就回一点血。',
    passive: 'armor', passiveLv: 3,
    stats: { dmg: 34, cd: 0.55, count: 2, pierce: 0, size: 150, life: 0.4, text: '双响丧钟 · 震到回血' },
  },
  fire(g, w) {
    const L = statsOf(w, BELL);
    const st = g.stats();
    const px = g.player.x, py = g.player.y;
    g.ring(px, py, L.size * st.area, L.dmg, 340, C.bronze, w.evolved ? 1.4 : 0);
    if (w.evolved || L.count >= 2) {
      g.ring(px, py, L.size * st.area * 0.72, L.dmg * 0.7, 220, '#c7a45a', w.evolved ? 1.4 : 0);
    }
    g.burst(px, py, C.bronze, 10, 160);
  },
};

export const WEAPON_DEFS: WeaponDef[] = [
  FEIBAI, THUNDER, EMBER, ORBIT, SEEK, LASER,
  TURRET, POISON, CLONE, METEOR, FAN, BELL,
];

export const WEAPON_BY_ID: Record<string, WeaponDef> = {};
for (const d of WEAPON_DEFS) WEAPON_BY_ID[d.id] = d;

export function isEvolvedAvailable(w: WeaponInst, def: WeaponDef, passives: Record<string, number>): boolean {
  if (w.evolved || w.level < def.levels.length) return false;
  return (passives[def.evo.passive] || 0) >= def.evo.passiveLv;
}

/* 让"每件武器的初始等级表"可被外部读取（升级卡展示用） */
export function levelTextOf(def: WeaponDef, level: number, evolved = false): string {
  if (evolved) return def.evo.stats.text;
  return def.levels[Math.max(0, Math.min(def.levels.length - 1, level - 1))].text;
}
