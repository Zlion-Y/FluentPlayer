# FluentPlayer

一个简洁的 Windows / Linux / macOS 桌面音乐播放器，基于 Tauri 2 + Vue 3 构建，界面风格参考 Fluent Design。

![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)

## UI 展示

<img width="1465" height="1033" alt="image" src="https://github.com/user-attachments/assets/91394be2-8cdb-4c59-8549-ee6f1167fb69" />
<img width="1374" height="945" alt="image" src="https://github.com/user-attachments/assets/43dac708-e5af-4ab6-872f-428825cc5a55" />
<img width="1375" height="944" alt="image" src="https://github.com/user-attachments/assets/b4afb461-0230-41cb-be78-c38e4f4ff82e" />

## 功能特性

- 本地音乐播放：文件夹监控、歌单管理、封面/歌词自动读取
- 在线音乐：搜索、歌单/专辑/排行榜、多音质（128K ~ Hi-Res）自动降级
- Apple Music 风格逐字歌词、全屏播放页、桌面歌词
- 播放队列、多种播放模式（顺序 / 单曲循环 / 逆序 / 随机 / 播完就停）
- 系统媒体控制（SMTC / Now Playing / MPRIS）、全局热键、系统托盘
- 歌曲信息编辑、在线下载、识别歌曲

> ⚠️ 软件需要音源才能使用！音源：https://github.com/guoyue2010/lxmusic-

## 开发 & 构建

```bash
npm install        # 安装前端依赖
npm run tauri dev  # 开发调试（需要 Rust 工具链）
npm run tauri build
```

推送 `v*` tag 会通过 GitHub Actions 自动构建三平台安装包并发布 Release。

## 开源协议

本项目基于 [GPL-3.0](LICENSE) 协议开源，继承自原项目。

## 赞助作者

如果 FluentPlayer 对你有帮助，欢迎请作者喝杯奶茶 ☕

<div align="center">
  <img src="src/assets/sponsor-wechat.png" alt="微信赞赏码" width="220" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="src/assets/sponsor-alipay.png" alt="支付宝收款码" width="220" />
  <p><sub>微信扫一扫（左） · 支付宝扫一扫（右）</sub></p>
</div>
