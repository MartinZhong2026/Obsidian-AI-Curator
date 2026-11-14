# AI Curator 1.0.0

**Save anything. Read what matters. / 收藏一切，只读值得读的。**

AI Curator turns Markdown clippings and bookmarks into a reading inbox, with Read / Skim / Reference / Skip decisions and actionable notes. Your original notes stay untouched.

AI Curator 把 Markdown 文章收藏与书签变成阅读收件箱：判断精读、速览、备查或跳过，并生成可执行的整理笔记，原文不改动。

## What's new / 本次发布

- English and Simplified Chinese interfaces, independently selectable from note output language.
  中英文界面，界面与笔记输出语言独立设置。
- Reliable parallel processing: unique filenames, shared analysis for duplicate saves, and full output-budget reservations.
  修复并发同名覆盖、重复分析与预算预留。
- Correct monthly rollover and visible budget limits; pause/delete checks before starting new paid work.
  跨月预算正常重置，预算提示保留，付费请求前检查暂停与删除状态。
- Serialized index snapshots with temporary/backup recovery and clear storage-failure notices.
  串行索引写入、临时与备份恢复，以及存储失败提示。
- Explicit X expansion opt-in, setup disclosure for full-text recovery, credential redaction and HTTPS for remote endpoints.
  X 补全明确主动选择，向导披露网络行为，密钥脱敏，远程接口要求 HTTPS。
- Folder rename/delete handling and on-demand curation without watched folders.
  处理文件夹重命名与删除，无监听目录时也可手动整理单篇。
- Bilingual documentation, maintainer/AI instructions, automated CI and verified install assets.
  双语文档、维护与 AI 指南、自动化 CI 和校验过的安装附件。

## Install / 安装

Requires Obsidian 1.11.4+. Download `ai-curator-1.0.0.zip` and extract its `ai-curator` folder into `<vault>/.obsidian/plugins/`, reload Obsidian and enable AI Curator. Alternatively add `MartinZhong2026/Obsidian-AI-Curator` in BRAT.

需要 Obsidian 1.11.4+。下载 ZIP，将其中 ai-curator 文件夹解压到仓库的 .obsidian/plugins/，重新加载并启用。也可用 BRAT 安装。

The three plugin files are also attached separately. `SHA256SUMS.txt` covers those files and the ZIP.
This project is not yet listed in Obsidian's community directory.
同时提供单独三件套与 SHA-256 校验文件。目前尚未进入 Obsidian 社区插件目录。

## Verification and limits / 验证与限制

- 68 automated tests, TypeScript checks, production build, dependency audit, ZIP and SHA-256 verification.
  68 项自动化测试、类型检查、生产构建、依赖审计、ZIP 与哈希校验。
- Real DeepSeek demo runs use only synthetic sample notes; see `docs/VERIFICATION-1.0.0.md` for actual results.
  真实 DeepSeek 演示仅使用虚构样例，实际结果见对应验证记录。
- Fresh native desktop/theme and iOS/Android device checks were unavailable for this release. Try a test vault first.
  本轮未能完成桌面主题与移动真机检查，建议先用测试仓库。
- Budget controls are estimates, not billing guarantees. Configure prices for unpriced models and use provider-side limits if needed.
  预算仅为估算，未知模型需配置价格；严格控费请同时使用服务商限额。
- Fully offline use requires a local model and both web recovery options disabled. HTTP endpoints are restricted to loopback.
  完全离线需本地模型并关闭两项网络补全；HTTP 仅限回环地址。

[English guide](https://github.com/MartinZhong2026/Obsidian-AI-Curator#readme) · [中文说明](https://github.com/MartinZhong2026/Obsidian-AI-Curator/blob/main/README.zh-CN.md)
