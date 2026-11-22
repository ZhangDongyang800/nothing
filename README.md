# 工具箱 · TxxT · 小游戏

一个仓库，三样东西：官网与小游戏的源码（`site/`）、两个 Windows 应用的安装包、自动更新用的元数据。

## 下载

安装包都在 [Releases](https://github.com/ZhangDongyang800/nothing/releases)，按 tag 找：

- 工具箱 → `toolbox-v*`
- TxxT → `txxt-v*`

只支持 Windows x64，只有安装版能自动更新；装过一次之后，新版本会在应用内提示，重启即完成升级。历史版本全部保留，想退回旧版直接下对应 tag。

## 站点

`site/` 是官网 + 12 台小游戏的 Vite 源码：

```bash
cd site
npm install
npm run dev   # http://localhost:5273
```

## 许可

个人非商业使用，商用需授权，详见 [LICENSE](LICENSE)（CC BY-NC 4.0）。
