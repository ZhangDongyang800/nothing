// 一次性：把 paper.html 的三块 <style> 合并成站点用的 hall.css
// 注意：hall.css 现在已是现役真源（塔罗、配对、判词都在里面），重跑会把它们盖回六台那版。
import fs from 'node:fs';

const OUT = 'src/themes/hall/hall.css';
if (fs.existsSync(OUT) && !process.argv.includes('--force')){
  console.error(`${OUT} 已存在（现役样式早已超出原型）。重跑会覆盖塔罗 / 配对 / 判词样式。`);
  console.error('确需从 paper.html 重新抽一遍，请加 --force，并在之后把新样式补回来。');
  process.exit(1);
}

const src = fs.readFileSync('paper.html', 'utf8');
const blocks = [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1].trim());
const head = `/* TxxT 官网首页「六台机器」的样式。
   来源：web/paper.html（单文件原型），由 scripts/extract-hall-css.mjs 抽出。
   令牌与 neo-brutalism 同一套：纸黄 #fff8e8 / 纸面 #fffdf7 / 墨 #252525 /
   黄 #ffd166 / 蓝 #9cc7f5 / 珊瑚 #f28b82 / 绿 #a8c7a0，3px 黑边 + 硬色偏移阴影。
   改样式请改这里（不要再回头改 paper.html，它只是原型留档）。 */\n`;

const extra = `
/* —— 站点挂载补充：整页单屏、不滚 —— */
html,
body {
  height: 100%;
  overflow: hidden;
  background: var(--nb-paper);
}
.hall {
  height: calc(100svh - var(--barh));
}
`;

fs.mkdirSync('src/themes/hall', { recursive: true });
fs.writeFileSync(OUT, head + blocks.join('\n\n') + extra, 'utf8');
console.log('blocks', blocks.length, 'bytes', (head + blocks.join('') + extra).length);
