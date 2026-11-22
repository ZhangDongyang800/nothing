// 一次性：把 paper.html 的 <script> 逻辑搬成可挂载的 engine.ts
// 注意：engine.ts 现在已是现役真源（塔罗、配对、判词都在里面），重跑会把它们盖回六台那版。
import fs from 'node:fs';

const OUT = 'src/themes/hall/engine.ts';
if (fs.existsSync(OUT) && !process.argv.includes('--force')){
  console.error(`${OUT} 已存在（现役逻辑早已超出原型）。重跑会覆盖塔罗翻牌与翻卡配对。`);
  console.error('确需从 paper.html 重新抽一遍，请加 --force，并在之后把新玩法补回来。');
  process.exit(1);
}

const src = fs.readFileSync('paper.html', 'utf8');
const m = src.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('no script');
let js = m[1].trim();
js = js.replace(/^\(function\(\)\{\s*'use strict';/, '');
js = js.replace(/\}\)\(\);\s*$/, '');
js = js.trim();

// 常量：document.getElementById('x').addEventListener(...) → on(...)
js = js.replace(/document\.getElementById\('([^']+)'\)\.addEventListener\(/g, "on(document.getElementById('$1'), ");
js = js.replace(/(^|[^\w.$])([A-Za-z_$][\w$]*)\.addEventListener\(/g, '$1on($2, ');

const head = `/* 首页「六台机器」的交互逻辑。
 *
 * 从 web/paper.html 的 <script> 原样搬来（同一个人写的同一套状态机），只做三件事：
 *   ① 包成 attachHall() 返回清理函数 —— React 的 StrictMode 会挂载两次，
 *      所有监听走同一个 AbortController，卸载时 abort()，定时器同批清掉；
 *   ② 每次挂载前先清空动态容器，避免第二次挂载把演示内容叠成两份；
 *   ③ 文案与常量一个没改：Enter 换列、⌘/Ctrl+Enter 落印、45 格落印、组词守卫……
 *
 * 因为是原型移植（几百个 DOM 操作、没有一个状态交给 React），这里关掉类型检查：
 * 交互行为以原型为准，不为了类型去重写状态机。结构在 Hall.tsx，样式在 hall.css。
 */
// @ts-nocheck
export function attachHall() {
  const ac = new AbortController();
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });

  /* 挂载前清场：动态生成的格子 / 页 / 行 / 卡都不进 JSX，重挂时先抹掉 */
  (function resetDynamic() {
    ['cols', 'ticks', 'focusBlock', 'cutBlock', 'orderList', 'wordLine'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    const wrap = document.getElementById('stackWrap');
    if (wrap) wrap.querySelectorAll('.leaf').forEach(function (n) { n.remove(); });
    const paper = document.getElementById('paper');
    if (paper) paper.querySelectorAll('.seal').forEach(function (n) { n.remove(); });
  })();

`;

const tail = `
  return function cleanup() {
    ac.abort();
    if (typeof typingTimer !== 'undefined' && typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    if (typeof focusTimer !== 'undefined' && focusTimer) { clearInterval(focusTimer); focusTimer = null; }
    if (typeof stackTimer !== 'undefined' && stackTimer) { clearTimeout(stackTimer); stackTimer = null; }
  };
}
`;

fs.writeFileSync('src/themes/hall/engine.ts', head + js + tail, 'utf8');
console.log('lines', (head + js + tail).split('\n').length, 'addEventListener left', (js.match(/addEventListener/g) || []).length);

