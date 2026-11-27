# 小游戏・TxxT・工具箱 官网

本目录是站点源码，首页只做目录，不写产品叙事。两区顺序固定：`01 / 应用` 在前，TxxT 与工具箱是**两张并列卡**，各有自己的下载入口；`02 / 小游戏` 在后，10 个游戏里《纸上军团》用 2×2 的旗舰位排在第一个，其余 9 台按内容体量从大到小排（墨潮、走墨、破砖、砖块、垒塔、叠山、稿纸、抽词、敲印）。顶部导航只有 `应用 2` 与 `小游戏 10`，没有站点级下载按钮，也没有页脚。视觉沿用 **B · Neo-brutalism Lite**（纸黄、粗边、硬阴影、`#fff8e8` 纸 + `#252525` 墨）。

10 个小游戏（点开即可玩，每个效果都能「再来一次」，支持手机与中文输入法，每一个都有「成 / 散」两头的明确收尾；《纸上军团》不设终点，只分「守住了」与「营寨被破」）。**点开是整屏游戏，不是弹窗**：`.machine` 直接 `absolute;inset:0`，没有边框、没有硬影、没有暗底。手机上**没有「横屏」按钮**：方向一变，版面自己变（`@media (pointer:coarse) and (min-aspect-ratio:1/1)`）—— 顶栏与底栏整条撤掉，只留浮在安全区里的「⟲ 重来」与「✕ 关掉」，台面按整块高度吃满（破砖 426×382，走墨 786×344）。



| 游戏   | 玩法与结果                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 纸上军团 | 唯一的单人无尽守卫模式：6×7 山道棋盘（22 格可布阵，开局 8 格），三张「招贤榜」付军粮抽兵，同名同级拖到一起合成到五级（每级换攻击机制，不是纯加数值）。8 兵种（盾 / 刀 / 枪 / 弓 / 骑 / 法 / 工 / 术）各自索敌、弹道与技能，4 名英雄占格可被击倒、Q 放主动技，敌人 8 类 + 每 10 波换机制的 5 只 Boss，局内 9 项强化、8 种道具、6 类随机事件、19 项成就与局外 10 项永久升级。没有终点，营寨被破才结算 |
| 墨潮   | 无尽肉鸽增量生存：12 把武器各 8 级与进化、19 个被动、5 个角色、5 只 Boss、11 项永久升级、18 个成就。Boss 表走完按 tier 循环，没有「最终 Boss 打完就结束」；局外成长有上限，存档只存构筑、进度与种子                                                                                                               |
| 走墨   | 无尽跑：速度从 300 抬到 760，间距按滞空配比，三连弧会撒铜钱。二段跳 + 土狼时间 + 跳跃缓冲，两层视差山与地下斜纹预渲染，固定步长 1/120                                                                                                                                                        |
| 破砖   | 七关 60 / 58 / 66 / 76 / 72 / 86 / 85 块（6 → 9 行密墙），底下是一块可拖动的板子（指针或 A/D），球撞砖一碰就反弹，落回来要拿板子接住；接球点离板心越远弹得越斜。金砖碎了掉「+1 球」、蓝砖碎了掉「×3」，掉落物也要接。球用完墙上还有砖落「散」，七关全清落「满」                                                                             |
| 砖块   | 八乘八的空盘，每轮发三块方砖；点一块拿起、点盘上格子按下（悬停先给绿 / 红预览）。整行整列填满就消，一手消两条线报「双消」、三条报「三消」，消满十行落「成」；三块都放不下落「散」                                                                                                                                           |
| 垒塔   | 砖块左右摆动，点画面或空格落砖。判定按砖块中心，连准会把下一块补宽 8px；切下来的外露块真的会掉下去，塔越高镜头越往上跟                                                                                                                                                                        |
| 叠山   | 2048 的骨、汉字的皮：尘 → 沙 → 石 → 岩 → 山 → 岭 → 峰 → 岳 → 峦 → 云 → 天，同字相撞升一级，分数按 2^(级 + 1) 记。方向键 / WASD 或滑动，一局制；叠到「天」落「成」，无路可走落「散」                                                                                                                 |
| 稿纸   | 点纸就写，回车换下一竖列；⌘/Ctrl+Enter 或写满 45 格才落印。写满时纸歪得更狠、印旁边写「满页・已收稿」                                                                                                                                                                          |
| 抽词   | 开局面板选三档（易 12 张 / 中 16 张 / 难 20 张，难档无预展）→ 三秒倒数 → 易与中档先亮一眼记位置。翻到相同的两个：描金、露勾、各自歪着飘走留虚线空位。零失误清完落「成」，步数用完落「散」                                                                                                                             |
| 敲印   | 4×3 的盘面，点掉冒出来的「印」，金印加命（上限 5），第 2 段起「墨印」是陷阱，点错扣命。每 12 次命中进一段，第 4 段起会同时亮两枚；空点只断连击，不罚命                                                                                                                                                  |

示例文本取自现代诗（顾城、北岛、海子、木心、卞之琳、张枣、余秀华……），每次进入随机取，不按固定顺序。稿纸支持「清空后自己打字」，边打边按真实排版上屏。

## 下载与安装

安装包放在本站 `/downloads`，由同一台 nginx 直出（宿主机 `/opt/txxt-sync/downloads`，独立挂载，不参与站点软链切换）。**官网按钮不再指向 GitHub Release** —— 跨域 `<a download>` 会被浏览器忽略，点击后整页跳到 [github.com](https://github.com) 的仓库页，国内链路还常被断流；同域 + `octet-stream` 才是 "点一下就开始下"。



* TxxT Windows：`/downloads/TxxT-Setup-1.4.2.exe`（NSIS，85,318,154 B，sha256 `f4af838d…`）

* TxxT Android：`/downloads/TxxT-Android-1.1.apk`（4,594,467 B，sha256 `5e1dbe05…`）

* 工具箱 Windows：`/downloads/Toolbox-Setup-0.1.3.exe`（NSIS，254,998,354 B，sha256 `104fc578…`）

上游仍保留在 `ZhangDongyang800/nothing` 的滚动 Release（客户端自动更新读那里），但网页侧只暴露本站地址。大包支持 Range 断点续传；`/downloads/` 限流 burst 给到 64，留给多线程下载器的十几个并发请求。

## 消除特效（FX）

八台里凡是 "东西没了" 的地方都走同一层粒子：`engine.ts` 顶部的 `FX` 在 `body` 上挂一张 `.fx-layer`（`position:fixed; inset:0; z-index:95; pointer-events:none`），**只用视口坐标画、不参与任何点击判定**，所以 DOM 机器和 canvas 机器能共用一套。



* `FX.burst(rect, opt)`：`shard`（带旋转 / 重力 / 深色描边的硬碎片）+ `dust`（外飘小墨点）+ `ring` 白环 + `flash` 径向高光。`count / dust / size / power / gravity / colors / ring / flash / vx / vy` 可选。

* 碎片尺寸跟主体成比例（`min(w,h) * 0.2`，钳在 3–13px）：写死 4px 会读成 "掉漆"，不是 "碎了"。

* 整行 / 整列消掉时按**整条的并集**炸（`count 30 / dust 10 / power 270 / gravity 940`）：初速压小、重力加大，碎渣落在盘内；一格一撮会甩到机台外面，像 "屏幕漏了"。

* `FX.sparks(rect, n)`：球撞砖、牌点错这种 "碰上了但没碎" 只撒火星。

* `FX.shake(el, amp)`：3–5px、330ms 衰减的短震，把冲击传给机器本身。

* 收场统一在 `showVerdict()` 里：`v-ok` 时从判词条上方撒一把纸穗（「满」更多并加一圈金环），`v-bad` 不撒。

* `prefers-reduced-motion` 下粒子减半、震屏与 flash 关闭；总量上限 460 粒。

* `window.__FX` 只给抓帧脚本单测一条特效用，不参与玩法。

## 字与标记

牌面上的字不是随机报字，是**成套的词**（`engine.ts` 顶部的 `WORDS`）：五行（金木水火土自成一圈）、三国（赵云 / 关羽 / 张飞…）、山水（青松 / 流水 / 明月）、器物（笔墨 / 纸砚 / 孤灯）。抽词每局先选一套词，再从词里拆字发牌 ——




每个字还带一枚**按字义画的象形记号**（`CHAR_FAMILY` → `data-ic`）：水是三道波纹、火是一点焰、山是一个尖、月是一弯钩、舟是一叶帆；三国那一套全部是「人」。图标是 CSS `mask` + `background-color`，所以同一个 SVG 换色就是另一族（五行五个字各按金赭 / 木绿 / 水蓝 / 火红 / 土褐）。

## 资源口径



* 破砖的墙（60–85 块砖）画进离屏 canvas，只在换关 / 砖被打穿时重画，主循环每帧 `drawImage` 一次：实测 0.24–0.31 ms / 帧 → 0.037 ms / 帧。

* `document.hidden` 时破砖的 rAF 与 FX 全部停掉；弹层打开时首页那 14 条 infinite 动画暂停（`body.is-playing`）。

* `dist` 只有 `index-*.js`（≈231 kB /gzip 77 kB）与 `index-*.css`（≈53.8 kB /gzip 11.4 kB），不带字体与图片。

* 验收口径：`#bkCanvas.__bench(n)` 返回 "逐帧重画" 与 "贴一次" 的毫秒数；`__jump(n)` 能直接跳到某一关截图。

## 手机与触屏

八台都要在手机浏览器上真能玩，不是 "缩一遍桌面"。



* **触屏等价操作**：`engine.ts` 顶部有 `bindPad(padId, onKey, holdMs)`，用 `pointerdown` 起手（避开移动端 click 的 300ms 延迟）、按下即触发、按住按 `holdMs` 连发（定时器进 `timeouts`），`pointerup/cancel/leave` 与滑出按键都停。两块条只在 `@media (pointer:coarse)` 显示，桌面不出现：


  * `#mergePad`（叠山四枚方向键）、`#breakPad`（破砖「◀ / 发球 / ▶」，`l/r` 每次挪 34 逻辑像素、按住连挪）。

  * 叠山盘面支持滑动连推；破砖拖动板子不误发球（位移 >8px 记为拖动，抬手才判断）。

* **隐藏输入**：稿纸的 `#typeIn` 放在视口左上 2×2、`opacity:0`、`font-size:16px`、`pointer-events:none`。旧版 `left:-9999px` 在 iOS 上常常聚焦不弹键盘，还会把整页顶偏；字号小于 16px 会触发聚焦缩放。

* **台面与触控条成一组**：窄屏下 08/06 的 `.stage-host` 收成 `flex:0 0 auto;height:auto`、`.pane` 垂直居中，台面和方向键贴在一起；敲印的 host 不能收，`mgFit` 要用它的可用高度算格子。

## 结构

`src/themes/hall/Hall.tsx` 只写静态结构；`hall.css` 是这台机器厅的全部样式（含响应式断点）；`engine.ts` 是 DOM 驱动的交互逻辑，包成 `attachHall()` 返回清理函数 ——React 的 StrictMode 会挂载两次，所有监听共用一个 `AbortController`、所有 `setTimeout` 进同一个数组，挂载前先清空动态容器，否则牌阵会叠成两份。

稿纸的交互从根目录 `paper.html`（早期原型）搬来；其余小游戏各自拆成 `src/themes/hall/games/*.ts`（`word / brick / break / merge / stack / tap / run / paper`），由 `engine.ts` 统一 `mountXxx(ctx)` 接入。`paper.html` 现在只是历史原型，**不再与站点一致**，改玩法请改 `games/<台>.ts`。

《纸上军团》是一套独立模块，不挤进 `engine.ts`：`legion/` 下按职责拆 `types / save / board / battle / fx / draw / ui / game / audio / index` 与 `data/`（品质、兵种、英雄、敌人、Boss、道具 + 局内强化 / 里程碑 / 成就配置）。`game.ts` 是唯一状态机与 `BattleHost/UiHost` 实现，`battle.ts` 只算战斗，`draw.ts` 只画 canvas（地形缓存到离屏画布），`ui.ts` 只碰 DOM，`index.ts` 的 `mountLegion()` 给出 `open/close/replay/escape/destroy`，由 `engine.ts` 像 `mountRogue()` 一样接入。数值改 `data/*.ts`，不要把玩法写进组件。

台面尺寸全部由 `engine.ts` 的一组 fit 函数算（`fitBox/fitBreak/fitBrick/fitPile/fitPair/onetFit/snFit/mgFit`）：先量父容器的 `clientWidth/clientHeight`，再按台面自己的长宽比取能塞进去的最大值，`refitAll()` 在 resize 与打开后 30ms / 300ms 各跑一次。**不要在 CSS 里给台面写&#x20;**`clamp(300px,52vw,660px)`**&#x20;这种死宽度** —— 窗口再高台面也不会长大，游玩区会显得很小。



中文输入法在稿纸里做了守卫：`compositionstart` 置位、`compositionend` 提交，`input` 在 `e.isComposing` 时直接返回，避免组词过程中被逐个吞字。

下载入口只在应用卡里，共 3 个：TxxT 的电脑版 `TxxT-Setup-1.4.2.exe` 与安卓版 `TxxT-Android-1.1.apk` 同在一张卡，工具箱子卡只给 `Toolbox-Setup-0.1.3.exe`。三个地址都是同域 `/downloads/...`，不带 `github.com`。两端不做 UA 分流，手机也会看到电脑版。`qa-hall.mjs` 断言两端 3 个入口都可见、HEAD 200；`scripts/probe-download.mjs` 真点一次，断言触发 download 事件且页面不离开本站。

## 运行



````
cd D:\Projects\TxxT-Play\site
npm install
npm run dev        # http://localhost:5273/
```

生产构建与本地预览：

```powershell
npm run build      # tsc --noEmit && vite build
npm run preview    # http://localhost:5274/
```

`base: './'`，构建产物可直接放进任意静态目录。

## 公网部署

线上入口：<https://115.159.51.233/>（IP 证书，HTTP 80 全部 301 到 HTTPS）。

- 静态站 root：容器内 `/usr/share/nginx/html/site/current`，宿主机 `/opt/txxt-sync/site/current`，软链指向 `releases/<时间戳>`。每次发布建新 release，再原子切换软链，不覆盖旧版本。
- 同步 API 只反代 `/v1/`（`/v1/auth/` 单独限流），根路径不再落到同步服务。
- 安装包挂 `/opt/txxt-sync/downloads`（compose 里单独挂到容器 `/usr/share/nginx/html/downloads`，切 release 不影响下载地址），nginx `location ^~ /downloads/` 直出；官网三个按钮都是同域地址，点一下直接下，不跳 GitHub。初装走官网，升级由客户端自动更新（仍读 `latest.yml`）。
- 配置备份在 `/opt/txxt-sync/backups/<时间戳>/`；证书在 `/etc/letsencrypt/live/115.159.51.233/`，由 `txxt-certbot-renew.timer` 续期。

当前安装包（全部在 `ZhangDongyang800/nothing` 的滚动 Release）：

| 平台 | 文件 | 大小 | SHA-256 |
| --- | --- | --- | --- |
| Windows | `downloads/TxxT-Setup-1.4.2.exe` | 85,318,154 | `f4af838deb1b4d9ac328627767dfd6ac10b54b866f3c82728f09393bdd480512` |
| Android | `downloads/TxxT-Android-1.1.apk` | 4,594,467 | `5e1dbe05ca2c7e9f2d169e6adaf723507900cb8c64e276d4f1a500d4b7ec2297` |
| Windows（工具箱） | `downloads/Toolbox-Setup-0.1.3.exe` | 254,998,354 | `104fc57853ba1c19c7d0329aaf1546a5b5aae38babbe691b12563e926e6c131d` |

Android 当前为 debug 签名内测包；正式分发前需要换 release keystore，并统一版本号口径。

工具箱是独立项目（`D:\Projects\工具箱`），与 TxxT 不共用数据；安装包当前没有代码签名，Windows 首次运行会出现 SmartScreen 提示。

## 安全基线

- TLS 1.2 / 1.3；HSTS、CSP、`X-Frame-Options: DENY`、`nosniff`、Referrer-Policy 全站生效；`server_tokens off`。
- 未知 Host 的 80 请求返回 444，不暴露 Nginx 默认页。
- 站点 30 r/s、API 10 r/s、认证 2 r/s、下载 2 r/s（burst 64，容多线程下载器的并发段）按 IP 限流；站点只允许 GET/HEAD。
- 反向代理只保留必要头，API 关闭 `proxy_buffering`。
- 服务器仍有与本官网无关的 Hadoop 9870 等端口对外开放，建议在腾讯云安全组收口；本轮未改动实验环境。

## 目录

```
web/
├─ index.html
├─ paper.html                  # 早期六台原型（历史留档，站点已按新玩法重写）
├─ public/
│  └─ logo.svg
├─ scripts/
│  ├─ extract-hall-css.mjs     # 从 paper.html 抽样式（只对老样式有用）
│  ├─ build-hall-ts.mjs        # 从 paper.html 抽逻辑（同上，勿重跑覆盖 engine.ts）
│  └─ qa-hall.mjs              # 公网 / 预览：10 张卡、10 个弹层、3 个下载、390px、console
└─ src/
   ├─ themes/hall/             # Hall.tsx + hall.css + engine.ts（现役首页）
   ├─ styles/base.css          # 字体栈、reset、色板变量
   └─ App.tsx / main.tsx       # 只挂 Hall
```

## 验收

```powershell
npm run build
npx vite preview --port 5280
$env:QA_URL='http://localhost:5280/'; node .qa\shot-hall.mjs
```

`shot-hall.mjs` 用 Playwright 驱动本机 Chrome，跑完前六台机器的全部关键路径：

- 稿纸：Enter 只换列不落印、中文组词（CompositionEvent）提交、落印后状态文字
- 抽词：开局面板三档可用 → 三秒倒数 → 易档 12 张整副亮起（预展）→ 盖上后 `is-live` 才可点；硬档 20 张 / 5 列 / 无预展 → 上帝视角全消「10 对全成」→ 重洗后乱翻 22 步「散了」
- 砖块：64 格 / 三块待放 / 目标 10 行；自动落子到「清了 10 行 · N 手」
- 破砖：canvas 尺寸、七关 / 60→85 块（十列、砖缝 3px、6→9 行）、板子 76px 宽；板子跟着球走、顺手接道具，第 1 关打到「成」→ 点「下一关」换到第 2 关（砖与球复位）；故意把板子拖到最左不接球 → 落「散」；`__probe()` 读 `px`（板心）、`padW`、`stay`（剩余砖的血量与坐标）、`drops`（掉落物坐标）、`balls`、`stuck`；`__jump(n)` 直接跳到第 n 关看墙面密度；指针左右推 → `px` 58 ↔ 422
- 手机 390×844：首页一屏装完、无横向溢出、牌阵与盘面不越界
- 最后汇总 `ERRORS`（console + pageerror）

新三台另有专门的探针：

```powershell
node .qa\shot-new.mjs           # 八台台面尺寸（1440×900 与 1920×1080 各量一遍）+ 手机 390
node .qa\shot-final.mjs         # 八台首页 + 五台中局定稿截图
```

特效抓帧（截图落在 `.qa/hall/fx*.png`）：

```powershell
node .qa\probe-fx2.mjs          # 叠山合并 / 破砖打穿一块砖
node .qa\probe-fx3.mjs          # 04 上帝视角配对、05 自选落点凑消行（04 必须等 #pairGrid.is-live）
node .qa\probe-fx4.mjs          # 03 照 #pile.__sol 点，靠 #pileSlot .sitem.is-pop 判定"真凑成"
node .qa\probe-fx5.mjs          # 04 打到 8 对全成，验收场纸穗（showVerdict 是八台共用的一条路）
```

抓帧要"卡在爆点上"：触发后 60–130ms 一张、再等 100–130ms 一张；04 的成双在第二张落定后 430ms 才炸，早拍等于没拍。

`.qa/shot-small.mjs` 补测 375×667 / 360×640 / 414×736 三档小屏，只看「一屏装得下」。

手机可玩性（全部 390×844 / dpr2 / `isMobile+hasTouch`，点按走 `page.touchscreen.tap`）：

```powershell
node .qa\probe-mobile.mjs        # 八台弹层不出界、没有 <26px 的小目标（pane 字段不可信，只看 over/small）
node .qa\probe-touch.mjs         # 叠山方向键与画布滑动、敲印滑动与方向键、破砖发球与拖板子
node .qa\probe-brick-touch.mjs   # 05 单点验证：拿起一块 → 点盘上格子 → on/hand/used
node .qa\probe-type-mobile.mjs   # 01 点纸面弹输入 → insertText → 字真的上屏

```


`qa-hall.mjs` 验部署后的站点：10 张卡逐个打开 10 个弹层；桌面与手机都看到 3 个下载入口（TxxT EXE / TxxT APK / 工具箱 EXE）且 HEAD 200；应用区正好 2 张产品卡；正文不含「写作之外」「十二台小机器」；390px 无横向溢出；console 0。

《纸上军团》两条探针（`window.__legion` 暴露 state / simulate / addUnit / mergeAt / perf 等调试口）：

```powershell
node .qa\probe-legion.mjs    # 首页 10 卡、进入、招募、鼠标真拖拽、同名合成、非法落点回位、8 兵种战斗、
                             # 基地扣血、波次推进、Boss 登场/三阶段/击杀、死亡结算、局外升级、刷新读档、
                             # 断点续守、重开重置、600 敌性能、内存、手机版
node .qa\probe-legion2.mjs   # 五级合成链、军需官买强化/道具、治疗/升级符/炮击真结算、四英雄主动技、
                             # 自然第 10 波 Boss、随机事件选项与结算、暂停、AudioContext、200 敌实时帧率、触屏拖拽
```

下载跳转专项（会真点三个按钮，下载一触发就 `download.cancel()`，不落 255MB 到临时目录）：

```powershell
$env:QA_BASE='https://115.159.51.233/'; node scripts\probe-download.mjs
```

需要本机 Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`。

## 设计规范

色板、字体、网格、图片规则与动效见 [`DESIGN-SYSTEMS.md`](./DESIGN-SYSTEMS.md)。
````



```
```
