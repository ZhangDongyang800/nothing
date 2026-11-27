import { useEffect, useRef } from 'react';
import { attachHall } from './engine';

// 三个包都从本站 /downloads 直下（nginx 挂 /opt/txxt-sync/downloads）。
// 不写 GitHub Release 直链：跨域 <a download> 会被浏览器忽略，点了会跳到
// github.com 的仓库页，国内还常被断流。同域 + octet-stream 才是"点一下就开始下"。
const DESKTOP_DOWNLOAD = '/downloads/TxxT-Setup-1.4.2.exe';
const ANDROID_DOWNLOAD = '/downloads/TxxT-Android-1.1.apk';
const TOOLBOX_DOWNLOAD = '/downloads/Toolbox-Setup-0.1.3.exe';

/**
 * 官网首页：应用在前（主产品），游戏厅在后。
 *
 * 视觉沿用单文件原型 web/paper.html 的机台语汇：一屏装得下、点开就能玩、
 * 每个效果都能重来。结构写在这里，样式在 hall.css，纯 DOM 的交互（打字、
 * 翻牌、配对、打砖）在 engine.ts —— 那部分是从原型逐字搬来再改的。
 */
export default function Hall() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => attachHall(), []);

  return (
    <div className="hall-root" ref={root}>
      <header className="bar">
        <a className="brand" href="#top" aria-label="作品目录">
          <span className="brand-box">目录</span>
        </a>
        <nav className="bar-nav" aria-label="页面分区">
          <a href="#download">
            应用 <b>2</b>
          </a>
          <a href="#games">
            小游戏 <b>10</b>
          </a>
        </nav>
        <button className="sfx" id="sfxBtn" type="button" aria-pressed="true" title="音效已开 · 点关">
          <span className="sfx-ico" aria-hidden="true">♪</span>
          <span className="sfx-txt">音效</span>
        </button>
      </header>

      <main className="hall" id="top">
        <section className="apps" id="download">
          <div className="zone-head">
            <span className="kicker">01 / 应用</span>
            <h1 className="zone-title">应用</h1>
            <p className="zone-note">Windows / Android · 双击安装 · 免注册</p>
          </div>

          <div className="apps-grid">
            <article className="app-card app-txxt">
              <div className="app-top">
                <span className="app-kicker">写作 · WINDOWS / ANDROID</span>
                <h3 className="app-name">TxxT</h3>
              </div>
              <p className="app-line">中文长篇写作，稿子存在本地文件夹。</p>
              <div className="app-facts">
                <span>本地</span>
                <span>免注册</span>
              </div>
              <div className="app-actions">
                <a className="app-dl" href={DESKTOP_DOWNLOAD} download>
                  <span>Windows · EXE</span>
                  <b>v1.4.2 · 81 MB ↓</b>
                </a>
                <a className="app-dl app-dl-alt" href={ANDROID_DOWNLOAD} download>
                  <span>Android · APK</span>
                  <b>v1.1 · 4.4 MB ↓</b>
                </a>
              </div>
            </article>

            <article className="app-card app-toolbox">
              <div className="app-top">
                <span className="app-kicker">独立工具 · WINDOWS</span>
                <h3 className="app-name">工具箱</h3>
              </div>
              <p className="app-line">音频录音棚 · 像素工厂 · 文稿工坊（完整 Markdown 编辑器）</p>
              <div className="app-facts">
                <span>3 个工具</span>
                <span>双击安装</span>
              </div>
              <div className="app-actions">
                <a className="app-dl app-dl-blue" href={TOOLBOX_DOWNLOAD} download>
                  <span>Windows · EXE</span>
                  <b>v0.1.3 · 243 MB ↓</b>
                </a>
              </div>
            </article>
          </div>
        </section>

        <section className="games" id="games">
          <div className="zone-head">
            <span className="kicker">02 / 小游戏</span>
            <h2>小游戏</h2>
            <p className="zone-note">10 个 · 点开就玩 · 横屏更佳：墨潮 / 走墨</p>
          </div>

          <div className="cabs">
          <button className="cab cab-flag" type="button" data-game="legion">
            <span className="cab-top">
              <span className="cab-no">01</span>
              <span className="cab-name">纸上军团</span>
              <span className="cab-rot">无尽守卫</span>
            </span>
            <span className="cab-screen scr-legion" aria-hidden="true">
              <span className="lg-prev">
                <i className="lg-prev-path" />
                <i className="lg-prev-cell c1">盾</i>
                <i className="lg-prev-cell c2">刀</i>
                <i className="lg-prev-cell c3">弓</i>
                <i className="lg-prev-cell c4">法</i>
                <i className="lg-prev-cell c5">骑</i>
                <i className="lg-prev-cell c6">术</i>
                <b className="lg-prev-base" />
                <em className="lg-prev-wave">第 12 波</em>
              </span>
              <span className="lg-prev-tags">
                <b>随机招募</b><b>同名合成</b><b>自动战斗</b><b>局外成长</b>
              </span>
            </span>
            <span className="cab-meta">
              <span>文字布阵 · 方格合成 · 无尽守卫</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="rogue">
            <span className="cab-top">
              <span className="cab-no">02</span>
              <span className="cab-name">墨潮</span>
              <span className="cab-rot">横屏更佳</span>
            </span>
            <span className="cab-screen scr-rogue" aria-hidden="true">
              <span className="mrg-field">
                <i className="mrg-pulse" />
                <i className="mrg-ink mrg-a" />
                <i className="mrg-ink mrg-b" />
                <i className="mrg-ink mrg-c" />
                <i className="mrg-ink mrg-d" />
                <b className="mrg-self" />
                <em className="mrg-ring" />
              </span>
              <span className="mrg-keep">活多久算多久</span>
            </span>
            <span className="cab-meta">
              <span>无尽 · 肉鸽 · 自动出手</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="run">
            <span className="cab-top">
              <span className="cab-no">03</span>
              <span className="cab-name">走墨</span>
              <span className="cab-rot">横屏更佳</span>
            </span>
            <span className="cab-screen scr-paper" aria-hidden="true">
              <span className="mrun">
                <i className="mrun-hill" />
                <span className="mrun-road">
                  <i className="mrun-block" />
                  <i className="mrun-coin" />
                </span>
                <b className="mrun-ink" />
              </span>
            </span>
            <span className="cab-meta">
              <span>无尽跑 · 空中可再跳一次</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="break">
            <span className="cab-top">
              <span className="cab-no">04</span>
              <span className="cab-name">破砖</span>
            </span>
            <span className="cab-screen scr-ink" aria-hidden="true">
              <span className="mbreak">
                <span className="mb-wall">
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                  <i className="mb-b" />
                </span>
                <b className="mb-ball" />
                <b className="mb-pad" />
              </span>
            </span>
            <span className="cab-meta">
              <span>七关 · 板子接球</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="brick">
            <span className="cab-top">
              <span className="cab-no">05</span>
              <span className="cab-name">砖块</span>
            </span>
            <span className="cab-screen scr-paper" aria-hidden="true">
              <span className="mbrk">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="cab-meta">
              <span>8×8 · 填满一行或一列就消</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="stack">
            <span className="cab-top">
              <span className="cab-no">06</span>
              <span className="cab-name">垒塔</span>
            </span>
            <span className="cab-screen scr-stack" aria-hidden="true">
              <span className="mstack">
                <i className="ms-b0" />
                <i className="ms-b1" />
                <i className="ms-b2" />
                <i className="ms-b3" />
                <i className="ms-b4" />
                <i className="ms-b5" />
              </span>
            </span>
            <span className="cab-meta">
              <span>看准时机落砖 · 对准算「准」</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="merge">
            <span className="cab-top">
              <span className="cab-no">07</span>
              <span className="cab-name">叠山</span>
            </span>
            <span className="cab-screen scr-paper" aria-hidden="true">
              <span className="mmerge">
                <i className="m-t1">尘</i>
                <i className="m-t2">石</i>
                <i className="m-t2">石</i>
                <i className="m-t3">山</i>
              </span>
            </span>
            <span className="cab-meta">
              <span>一粒尘，垒到天</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="paper">
            <span className="cab-top">
              <span className="cab-no">08</span>
              <span className="cab-name">稿纸</span>
            </span>
            <span className="cab-screen scr-paper" aria-hidden="true">
              <span className="mp">
                <span className="mp-col">黑夜给了我</span>
                <span className="mp-col">黑色的眼睛</span>
                <span className="mp-col">我却用它</span>
                <span className="mp-col">寻找光明</span>
              </span>
            </span>
            <span className="cab-meta">
              <span>A4 · 竖排</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="word">
            <span className="cab-top">
              <span className="cab-no">09</span>
              <span className="cab-name">抽词</span>
            </span>
            <span className="cab-screen scr-paper" aria-hidden="true">
              <span className="mpc">
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="cab-meta">
              <span>翻卡 · 三档成双</span>
              <span>▶</span>
            </span>
          </button>
          <button className="cab" type="button" data-game="tap">
            <span className="cab-top">
              <span className="cab-no">10</span>
              <span className="cab-name">敲印</span>
            </span>
            <span className="cab-screen scr-tap" aria-hidden="true">
              <span className="mtap">
                <i />
                <i className="is-hot">印</i>
                <i />
                <i />
                <i />
                <i />
                <i />
                <i className="is-ink">墨</i>
                <i />
                <i />
                <i className="is-hot">金</i>
                <i />
                <i />
              </span>
            </span>
            <span className="cab-meta">
              <span>反应 · 别点墨印</span>
              <span>▶</span>
            </span>
          </button>











        </div>
        </section>
      </main>

      <div className="modal" id="modal" role="dialog" aria-modal="true" aria-hidden="true" aria-label="写作机台">
        <div className="veil" data-close />
        <div className="machine">
          <div className="machine-top">
            <span className="m-no" id="mNo">
              01 / 10
            </span>
            <span className="m-name" id="mName">
              稿纸
            </span>
            <span className="m-tag" id="mTag">
              A4 · 竖排
            </span>
            {/* 原来这些在底部一条 50px 的页脚里：游玩时它既占高度又压着台面下沿。
                现在整条并进顶栏 —— 提示在右、动作按钮跟着、关闭在最右。
                元素 id 一个没改，各台写 mHint / mReplay 的代码照旧。 */}
            <div className="m-tools">
              <span className="m-hint" id="mHint">
                点纸就写，回车换列
              </span>
              <button className="m-btn" type="button" id="mReplay">
                <i>↻</i>
                <span>再来一次</span>
              </button>
              <button className="m-btn" type="button" id="mSeal" title="完成本页并盖章（Ctrl+回车）">
                <i>◉</i>
                <span>落印</span>
              </button>
              <button className="m-btn" type="button" id="mClear">
                <i>⌫</i>
                <span>清空</span>
              </button>
              <span className="m-count" id="mCount" hidden>
                01 / 10
              </span>
              <button className="m-close" type="button" data-close aria-label="关掉机台">
                ✕
              </button>
            </div>
          </div>

          <div className="machine-body">
            <section className="pane pane-paper grid-paper is-on" id="pane-paper">
              <div className="sheet" id="sheet">
                <div className="sheet-head">
                  <span>稿纸 0001</span>
                  <span>竖排</span>
                </div>
                <div className="paper" id="paper">
                  <div className="cols" id="cols" />
                </div>
                <div className="sheet-foot">
                  <span>TxxT · A4</span>
                  <span id="state">点纸就写</span>
                </div>
              </div>
              <aside className="readout" aria-hidden="true">
                <div className="ro-num" id="count">
                  000
                </div>
                <div className="ro-ticks" id="ticks" />
              </aside>
              <div className="source" id="source" />
              <input
                id="typeIn"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="在稿纸上写作"
              />
            </section>

            <section className="pane pane-brick grid-paper" id="pane-brick">
              <div className="brk-hud">
                <span title="已消行数 · 消满 10 行获胜">
                  <b id="brkRows">0</b>/<span id="brkGoal">10</span> 行
                </span>
                <span>
                  第 <b id="brkHand">0</b> 步
                </span>
                <span className="hud-score">
                  分 <b id="brkScore">0</b>
                </span>
                <span className="hud-combo">
                  <span className="combo-lab">连击</span>
                  <b id="brkCombo">×1</b>
                </span>
              </div>
              <div className="brk-main">
                <div className="brk-board" id="brkBoard" />
                <div className="brk-tray" id="brkTray" />
              </div>
              <div className="verdict" id="brkVerdict">
                <span className="verdict-text" id="brkVText" />
                <span className="verdict-seal" id="brkVSeal" />
              </div>
            </section>

            <section className="pane pane-break grid-paper" id="pane-break">
              <div className="bk-hud">
                <span>
                  第 <b id="bkLv">1</b>/<span id="bkLvn">5</span> 关
                </span>
                <span>
                  砖 <b id="bkLeft">32</b>/<span id="bkTotal">32</span>
                </span>
                <span title="备用球 · 发球消耗，接住 +1 道具可补充">
                  球 <b id="bkLife">14</b>
                </span>
                <span className="hud-score">
                  分 <b id="bkScore">0</b>
                </span>
                <span className="hud-combo">
                  <span className="combo-lab">连击</span>
                  <b id="bkCombo">×1</b>
                </span>
              </div>
              <div className="bk-wrap">
                <div className="bk-stage" id="bkStage">
                  <canvas id="bkCanvas" width="480" height="430" aria-label="球拍打砖的台面" />
                </div>
              </div>
              <div className="touch-bar" id="breakPad" aria-label="板子">
                <button className="tbtn" type="button" data-move="l" aria-label="板子左移">
                  ◀
                </button>
                <button className="tbtn tbtn-wide" type="button" data-move="fire" aria-label="发球">
                  发球
                </button>
                <button className="tbtn" type="button" data-move="r" aria-label="板子右移">
                  ▶
                </button>
              </div>
              <div className="verdict" id="bkVerdict">
                <span className="verdict-text" id="bkVText" />
                <span className="verdict-seal" id="bkVSeal" />
              </div>
            </section>

            <section className="pane pane-word grid-paper" id="pane-word">
              <div className="pair-hud">
                <span className="hud-theme" id="pairTheme">
                  三国
                </span>
                <span>
                  <b id="hudLeft">8</b>对
                </span>
                <span>
                  <b id="hudStep">0</b>/<span id="hudMax">20</span> 步
                </span>
                <span className="hud-score">
                  分 <b id="pairScore">0</b>
                </span>
                <span className="hud-combo">
                  <span className="combo-lab">连击</span>
                  <b id="pairCombo">×1</b>
                </span>
                <button className="pair-peek" type="button" id="pairPeek" title="全部亮牌 1.2 秒，消耗 2 步">
                  看一眼（2）· 耗 2 步
                </button>
              </div>
              <div className="stage-host" id="pairHost">
                <div className="pair-grid" id="pairGrid" />
              </div>
              <div className="verdict" id="pairVerdict">
                <span className="verdict-text" id="pairVText" />
                <span className="verdict-seal" id="pairVSeal" />
              </div>
              <div className="pair-count" id="pairCount" aria-hidden="true" />
              <div className="pair-start is-on" id="pairStart">
                <div className="pair-start-card">
                  <p className="g-start-kicker">09 · 翻卡成双</p>
                  <p className="g-start-title">抽词</p>
                  <p className="pair-start-tip">翻开一样的两个，成双收走</p>
                  <p className="g-start-best" id="pairStartBest" hidden />
                  <div className="pair-tier" id="pairTier">
                    <button type="button" data-tier="easy">
                      易 · 12 张
                    </button>
                    <button type="button" data-tier="mid" className="is-on">
                      中 · 16 张
                    </button>
                    <button type="button" data-tier="hard">
                      难 · 20 张
                    </button>
                  </div>
                  <button className="pair-go" type="button" id="pairGo">
                    开始
                  </button>
                  <p className="pair-start-note">
                    <span className="key-only">按 空格 开始 · </span>步数用完就散了
                  </p>
                </div>
              </div>
            </section>

            <section className="pane pane-merge grid-paper" id="pane-merge">
              <div className="merge-hud">
                <span>
                  得分 <b id="mergeScore">0</b>
                </span>
                <span>
                  最高 <b id="mergeBest">0</b>
                </span>
                <span title="当前最高等级的字">
                  最大 <b id="mergeTop">尘</b>
                </span>
                <span className="hud-combo">
                  <span className="combo-lab">连击</span>
                  <b id="mergeCombo">×1</b>
                </span>
                <span>
                  <button className="hud-btn" type="button" id="mergeUndo" title="撤销上一步（每局 3 次）">
                    回退 3
                  </button>
                </span>
              </div>
              <div className="stage-host" id="mergeHost">
                <div className="merge-stage" id="mergeStage">
                  <div className="merge-cells" id="mergeCells" />
                  <div className="merge-tiles" id="mergeTiles" />
                </div>
              </div>
              <div className="touch-bar" id="mergePad" aria-label="方向键">
                <button className="tbtn" type="button" data-dir="l" aria-label="向左推">
                  ◀
                </button>
                <div className="tcol">
                  <button className="tbtn" type="button" data-dir="u" aria-label="向上推">
                    ▲
                  </button>
                  <button className="tbtn" type="button" data-dir="d" aria-label="向下推">
                    ▼
                  </button>
                </div>
                <button className="tbtn" type="button" data-dir="r" aria-label="向右推">
                  ▶
                </button>
              </div>
              <div className="verdict" id="mergeVerdict">
                <span className="verdict-text" id="mergeVText" />
                <span className="verdict-seal" id="mergeVSeal" />
              </div>
            </section>

            <section className="pane pane-tap grid-paper" id="pane-tap">
              <div className="tap-hud">
                <span className="hud-score">
                  分 <b id="tapScore">0</b>
                </span>
                <span className="hud-combo">
                  <span className="combo-lab">连击</span>
                  <b id="tapCombo">×1</b>
                </span>
                <span>
                  第 <b id="tapLv">1</b> 关
                </span>
                <span>
                  命 <b className="tap-lives" id="tapLives">
                    印印印
                  </b>
                </span>
                <button className="g-pause" type="button" id="tapPause" aria-label="暂停">
                  ⏸
                </button>
              </div>
              <div className="tap-stage">
                <div className="tap-board" id="tapBoard" />
              </div>
              <div className="verdict" id="tapVerdict">
                <span className="verdict-text" id="tapVText" />
                <span className="verdict-seal" id="tapVSeal" />
              </div>
              <div className="g-start is-on" id="tapStart">
                <div className="g-start-card">
                  <p className="g-start-kicker">10 · 反应速度</p>
                  <p className="g-start-title">敲印</p>
                  <p className="g-start-tip">点掉冒出来的印 · 墨印点了扣命</p>
                  <p className="g-start-tip">金印 +1 命 · 漏掉好印也扣命 · 越敲越快</p>
                  <p className="g-start-best" id="tapStartBest" hidden />
                  <button className="g-go" type="button" id="tapGo">
                    开始
                  </button>
                </div>
              </div>
            </section>

            <section className="pane pane-run grid-paper" id="pane-run">
              <div className="run-hud">
                <span>
                  <b id="runDist">0</b> 米
                </span>
                <span>
                  最好 <b id="runBest">0</b>
                </span>
                <span title="吃到的字 · 每个 +8 分">
                  收字 <b id="runChars">0</b>
                </span>
                <span className="hud-combo">
                  <span className="combo-lab">连击</span>
                  <b id="runCombo">×1</b>
                </span>
                <button className="g-pause" type="button" id="runPause" aria-label="暂停">
                  ⏸
                </button>
              </div>
              <div className="run-wrap">
                <canvas id="runCanvas" width="960" height="420" aria-label="走墨台面" />
              </div>
              <div className="verdict" id="runVerdict">
                <span className="verdict-text" id="runVText" />
                <span className="verdict-seal" id="runVSeal" />
              </div>
              <div className="g-start is-on" id="runStart">
                <div className="g-start-card">
                  <p className="g-start-kicker">03 · 无尽跑</p>
                  <p className="g-start-title">走墨</p>
                  <p className="g-start-tip">空格 / 点画面跳 · 空中还能再跳一次</p>
                  <p className="g-start-tip">长按跳更高 · 红顶高墙要跳两次</p>
                  <p className="g-start-best" id="runStartBest" hidden />
                  <button className="g-go" type="button" id="runGo">
                    起跑
                  </button>
                  <p className="g-start-key">
                    按 <b>空格</b> 开始
                  </p>
                </div>
              </div>
            </section>

            <section className="pane pane-stack grid-paper" id="pane-stack">
              <div className="stack-hud">
                <span>
                  高 <b id="stackH">0</b> 层
                </span>
                <span>
                  最好 <b id="stackBest">0</b>
                </span>
                <span className="hud-score">
                  分 <b id="stackScore">0</b>
                </span>
                <span className="hud-combo">
                  <span className="combo-lab" title="连续对准次数">连准</span>
                  <b id="stackCombo">×0</b>
                </span>
                <button className="g-pause" type="button" id="stackPause" aria-label="暂停">
                  ⏸
                </button>
              </div>
              <div className="stack-wrap">
                <canvas id="stackCanvas" width="480" height="600" aria-label="垒塔台面" />
              </div>
              <div className="verdict" id="stackVerdict">
                <span className="verdict-text" id="stackVText" />
                <span className="verdict-seal" id="stackVSeal" />
              </div>
              <div className="g-start is-on" id="stackStart">
                <div className="g-start-card">
                  <p className="g-start-kicker">06 · 看准时机落砖</p>
                  <p className="g-start-title">垒塔</p>
                  <p className="g-start-tip">空格 / 点画面落砖 · 对准了砖会变宽</p>
                  <p className="g-start-tip">完全没搭上下层就塌 · 窄砖更难、宽砖更好搭</p>
                  <p className="g-start-best" id="stackStartBest" hidden />
                  <button className="g-go" type="button" id="stackGo">
                    开始
                  </button>
                  <p className="g-start-key">
                    按 <b>空格</b> 开始
                  </p>
                </div>
              </div>
            </section>

            <section className="pane pane-legion" id="pane-legion">
              <div id="legionRoot" />
            </section>

            <section className="pane pane-rogue" id="pane-rogue">
              <div id="rogueRoot" />
            </section>
          </div>

        </div>
      </div>
    </div>
  );
}
