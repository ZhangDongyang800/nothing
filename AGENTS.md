# TxxT-Play 仓库约定

站点源码在 `site/`，构建产物与测试截图都不入库。

## 截图与中间产物：只在本机活 7 天

每一次视觉验收都会产出几十上百张截图。它们是过程证据，不是交付物 —— 一旦这一版验收完、
结论写进文档，图就没有再看的必要了。所以：

- 截图、抓帧、探针脚本一律落在 `site/.qa/`（或根 `.qa/`、`artifacts/`），这些目录已在 `.gitignore` 里。
- **保留期 7 天**。任务收尾当天就该清，跨版本更不该留：同一个页面三代截图混在一起，
  下一次验收时没人分得清哪张是现行版本。
- 清理命令：

```powershell
node site/scripts/clean-qa-shots.mjs          # 删 7 天前的
node site/scripts/clean-qa-shots.mjs --all    # 全部清掉（这一版验收已结束）
node site/scripts/clean-qa-shots.mjs --dry    # 只列不删
```

- 需要长期留档的，只留**一张**代表图，放进 `site/.qa/keep/` 之外的地方（例如文档 `docs/`），
  并在文档里写明它对应哪个版本 —— 带版本号的单张图，比一堆无名的 `d12-break.png` 有用。

## 提交

- 提交前先 `git status --short`：`.qa/`、`dist/`、`_*.mjs` 不该出现在列表里。
- 只提交源码、文档与可复跑的 QA 脚本（`scripts/qa-*.mjs`、`scripts/probe-*.mjs`）。
- 部署时间戳（`site/.deploy-ts.txt`）与临时 CSS 快照不进仓库。
