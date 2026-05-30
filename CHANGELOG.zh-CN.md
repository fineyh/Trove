# 更新日志

本文件记录 Trove 的所有重要变更，格式遵循
[Keep a Changelog](https://keepachangelog.com/zh-CN/)，版本号遵循
[语义化版本](https://semver.org/lang/zh-CN/)。

每个版本的中文条目会成为**软件内"检查更新"弹窗显示的说明**；英文镜像在
[CHANGELOG.md](CHANGELOG.md)，会成为 **GitHub Release 页面的说明**。运行
`npm run release x.y.z` 前，请在**两个文件**都加上对应的 `## [x.y.z]` 小节。

## [Unreleased]

## [0.3.1] - 2026-05-31
### 修复
- HEIC/HEIF 照片（iPhone 默认的格式）现在能在消息流和资料页媒体网格中正常显示，不再显示为损坏图片。

## [0.3.0] - 2026-05-30
### 新增
- 消息现在显示时间，并按天显示日期分隔；滚动时日期头吸顶，停下阅读时自动淡出。
- 右键视频或图片可在独立窗口中打开：拖出主窗、调整大小、同时查看多个。

## [0.2.0] - 2026-05-30
### 新增
- 右键消息即可删除，并可选择同时把原文件移到回收站。
- 重复点击会话可切换其选中 / 取消选中状态。

### 安全
- 将 Google OAuth 凭据移出源码，改为构建期注入。
- 轮换 updater 签名密钥。

## [0.1.0] - 2026-05-29
### 新增
- 会话、消息流、媒体导入、Lightbox 查看器与全文搜索。
- 文件夹批量导入与 `folder_watch` 实时同步。
- 卷识别与 broken/live 状态机。
- Vault 加密（SQLCipher），每会话独立密钥。
- 自动跟随文件重命名与媒体修复。
- Google 登录（PKCE），refresh_token 用 vault 加密保存。
- `.trovebackup` 导出 / 导入，带回滚安全网。
- 基于 GitHub Releases 的应用内更新。
- 设置页拆分为侧边栏 + 分区面板，新增统一的失效文件管理页。
