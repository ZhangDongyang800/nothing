// 清理验收截图与中间产物。
//
//   node site/scripts/clean-qa-shots.mjs          # 删 7 天前的（默认）
//   node site/scripts/clean-qa-shots.mjs --all    # 全部清掉（这一版验收结束）
//   node site/scripts/clean-qa-shots.mjs --dry    # 只列不删
//
// 保留期按文件 mtime 算，不是按目录。只清截图与临时文件，碰到 .md/.json 报告
// 一律跳过 —— 报告是结论，图才是过程。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 7);
const ALL = process.argv.includes('--all');
const DRY = process.argv.includes('--dry');

const DIRS = ['.qa', 'site/.qa', 'artifacts', 'site/artifacts', 'site/.scratch'];
const KEEP_EXT = new Set(['.md', '.txt', '.json']);

let removed = 0;
let bytes = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (KEEP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const stat = fs.statSync(full);
    const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
    if (!ALL && ageDays < KEEP_DAYS) continue;
    const rel = path.relative(ROOT, full);
    if (DRY) {
      console.log(`would remove  ${rel}  (${ageDays.toFixed(1)}d, ${(stat.size / 1024).toFixed(0)}KB)`);
    } else {
      fs.unlinkSync(full);
    }
    removed += 1;
    bytes += stat.size;
  }
}

for (const d of DIRS) walk(path.join(ROOT, d));

// 清空目录也收掉，但保留目录本身（脚本与 .gitignore 都指望它存在）
for (const d of DIRS) {
  const full = path.join(ROOT, d);
  if (fs.existsSync(full) && fs.readdirSync(full).length === 0 && !DRY) {
    fs.rmdirSync(full);
  }
}

console.log(`${DRY ? '[dry] ' : ''}${removed} 个文件 / ${(bytes / 1048576).toFixed(1)} MB${ALL ? '（全部）' : `（早于 ${KEEP_DAYS} 天）`}`);
