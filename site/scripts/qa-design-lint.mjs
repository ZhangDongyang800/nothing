#!/usr/bin/env node
/* 纸上军团 · 设计系统静态检查
 * ---------------------------------------------------------------
 * 检查"能不能靠规矩造界面"，不检查画得好不好看。
 * 用法：
 *   node site/scripts/qa-design-lint.mjs            常规模式（旧文件只告警）
 *   node site/scripts/qa-design-lint.mjs --strict   严格模式（旧文件也算错，P4 之后用）
 *   node site/scripts/qa-design-lint.mjs --json     机器可读输出
 *
 * 规则来源：docs/纸上军团-UI设计系统-2026-11-24.md 第 7 节
 * --------------------------------------------------------------- */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..')
const LEGION = path.join(ROOT, 'src/themes/hall/legion')
const DESIGN = path.join(LEGION, 'design')
const SAMPLE = path.join(ROOT, 'design/legion-ui.html')
const RARITY = path.join(LEGION, 'data/rarity.ts')

const ARGS = new Set(process.argv.slice(2))
const STRICT = ARGS.has('--strict')
const JSON_OUT = ARGS.has('--json')

/* ---------- 规则表 ---------- */
const ALLOWED_RADIUS = /^(0|2px|4px|999px|var\(--lg-r-[012]|var\(--lg-r-full\))/
/* 这些文件是"新写的"，永远按严格标准 */
const STRICT_FILES = []
const LEGACY_FILES = ['legion.css', 'legion-v6.css', 'legion-v7.css']

/* 逐条检查只看 CSS 声明，避免把注释里的示例算进来 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

const issues = []
function add(level, rule, file, line, detail) {
  issues.push({ level, rule, file: path.relative(ROOT, file), line, detail })
}

/* ---------- 1. CSS 检查 ---------- */
function checkCss(file, { strict }) {
  const raw = fs.readFileSync(file, 'utf8')
  const src = stripComments(raw)
  const rel = path.relative(ROOT, file)
  const isDesign = file.startsWith(DESIGN) || rel.includes('design/')
  const level = strict ? 'error' : 'warn'
  // tokens.css 的职责就是"声明字面量"，它的裸值不算违规
  const isTokenFile = path.basename(file) === 'tokens.css'

  // 1.1 裸颜色
  if (!isTokenFile) {
    for (const m of src.matchAll(/(#[0-9a-fA-F]{3,8})|((?:rgb|rgba|hsl|hsla)\([^)]*\))/g)) {
      add(level, 'bare-color', file, lineOf(src, m.index), m[0])
    }
  }

  // 1.2 裸字号（容器/视口相对单位允许，它们随容器走）
  if (!isTokenFile) {
    for (const m of src.matchAll(/font-size:\s*([^;{}]+)/g)) {
      const v = m[1].trim()
      if (/var\(--lg-fs|inherit|calc\(|cqw|cqh|cqi|vw|vh|vmin|vmax/.test(v)) continue
      add(level, 'bare-font-size', file, lineOf(src, m.index), v)
    }
  }

  // 1.3 圆角越界
  for (const m of src.matchAll(/border-radius:\s*([^;{}]+)/g)) {
    const parts = m[1].trim().split(/\s+/)
    const bad = parts.filter((p) => !ALLOWED_RADIUS.test(p) && !p.startsWith('var('))
    if (bad.length) add(level, 'radius', file, lineOf(src, m.index), bad.join(' '))
  }

  // 1.4 阴影越界（有模糊半径或层数 > 2）
  for (const m of src.matchAll(/box-shadow:\s*([^;{}]+)/g)) {
    const v = m[1].trim()
    if (v === 'none' || v.includes('var(--lg-shadow') || v.includes('var(--lg-ring') || v.includes('inset')) continue
    const layers = v.split(/,(?![^(]*\))/).length
    const blurred = /(\d+)px\s+\d+px\s+(\d+)px/.test(v) && !/(\d+)px\s+\d+px\s+0/.test(v)
    if (layers > 2 || blurred) add(level, 'shadow', file, lineOf(src, m.index), v)
  }

  // 1.5 !important（components.css 的 box-sizing 兜底白名单）
  for (const m of src.matchAll(/!important/g)) {
    const l = lineOf(src, m.index)
    const line = raw.split('\n')[l - 1] || ''
    const prev = raw.split('\n').slice(Math.max(0, l - 3), l).join(' ')
    if (/box-sizing/.test(prev) || /\.ds-readout > \.ds-chip/.test(prev)) continue
    add(level, 'important', file, l, line.trim())
  }

  // 1.6 emoji
  for (const m of src.matchAll(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)) {
    add(level, 'emoji', file, lineOf(src, m.index), m[0])
  }

  // 1.7 字号低于 10px
  for (const m of src.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    if (Number(m[1]) < 10) add('warn', 'font-size-floor', file, lineOf(src, m.index), m[0])
  }

  // 1.8 重复选择器（同文件 > 3 次）
  const counts = new Map()
  for (const m of src.matchAll(/(^|\})\s*([.\w][^{}]*?)\s*\{/g)) {
    const sel = m[2].trim().replace(/\s+/g, ' ')
    if (!sel || sel.startsWith('@') || sel.includes('%')) continue
    counts.set(sel, (counts.get(sel) || 0) + 1)
  }
  for (const [sel, n] of counts) {
    if (n > 3) add('warn', 'duplicate-selector', file, '—', `${sel} ×${n}`)
  }

  // 1.9 旧文件冻结标记
  if (LEGACY_FILES.includes(path.basename(file))) {
    if (!raw.slice(0, 200).includes('FROZEN')) {
      add('warn', 'not-frozen', file, 1, '旧文件未标 FROZEN: 迁移期只删不加')
    }
  }
  void isDesign
}

/* ---------- 2. 品质色一致性 ---------- */
function checkRarity() {
  const tokensRaw = fs.readFileSync(path.join(DESIGN, 'tokens.css'), 'utf8')
  const rarityRaw = fs.readFileSync(RARITY, 'utf8')
  const tokenMap = {}
  for (const m of tokensRaw.matchAll(/--lg-rar-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)) tokenMap[m[1]] = m[2].toLowerCase()
  const rarityMap = {}
  for (const m of rarityRaw.matchAll(/(common|fine|rare|epic|legend)[^\n]*?(#[0-9a-fA-F]{6})/gi)) {
    if (!rarityMap[m[1].toLowerCase()]) rarityMap[m[1].toLowerCase()] = m[2].toLowerCase()
  }
  const keys = new Set([...Object.keys(tokenMap), ...Object.keys(rarityMap)])
  for (const k of keys) {
    if (tokenMap[k] !== rarityMap[k]) {
      add('error', 'rarity-drift', path.join(DESIGN, 'tokens.css'), '—', `${k}: token ${tokenMap[k] || '(缺)'} vs rarity.ts ${rarityMap[k] || '(缺)'}`)
    }
  }
}

/* ---------- 3. 样板 HTML 检查 ---------- */
function checkSample() {
  if (!fs.existsSync(SAMPLE)) return
  const src = fs.readFileSync(SAMPLE, 'utf8')
  for (const m of src.matchAll(/style="[^"]*(#[0-9a-fA-F]{3,8})/g)) {
    add('error', 'bare-color', SAMPLE, lineOf(src, m.index), m[1])
  }
  for (const m of src.matchAll(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)) {
    add('error', 'emoji', SAMPLE, lineOf(src, m.index), m[0])
  }
}

/* ---------- 执行 ---------- */
const cssFiles = fs.readdirSync(LEGION).filter((f) => f.endsWith('.css')).map((f) => path.join(LEGION, f))
const designCss = fs.readdirSync(DESIGN).filter((f) => f.endsWith('.css')).map((f) => path.join(DESIGN, f))
const designTs = fs.readdirSync(DESIGN).filter((f) => f.endsWith('.ts')).map((f) => path.join(DESIGN, f))

for (const f of designCss) checkCss(f, { strict: true })
for (const f of cssFiles) checkCss(f, { strict: STRICT })
for (const f of designTs) STRICT_FILES.push(f)
checkRarity()
checkSample()

const errors = issues.filter((i) => i.level === 'error')
const warns = issues.filter((i) => i.level === 'warn')

if (JSON_OUT) {
  console.log(JSON.stringify({ errors: errors.length, warns: warns.length, issues }, null, 1))
} else {
  const byRule = new Map()
  for (const i of issues) {
    const k = `${i.level}|${i.rule}`
    byRule.set(k, [...(byRule.get(k) || []), i])
  }
  for (const [k, list] of [...byRule].sort()) {
    const [level, rule] = k.split('|')
    console.log(`\n[${level}] ${rule}  ×${list.length}`)
    for (const i of list.slice(0, 6)) console.log(`   ${i.file}:${i.line}  ${i.detail}`)
    if (list.length > 6) console.log(`   … 另有 ${list.length - 6} 处`)
  }
  console.log(`\n合计：${errors.length} error / ${warns.length} warn   模式=${STRICT ? 'strict' : 'legacy-tolerant'}`)
}

process.exit(errors.length ? 1 : 0)
