# 1.0.0 verification / 验证记录

Date: 2026-11-14. Environment: Windows, Node 24.21.0, npm 11.19.0.
日期与环境如上，以下记录实际完成的检查。

## Automated / 自动化

- Clean `npm ci` completed.
- `npm run package` passed: TypeScript, browser production build, 68 tests, version agreement, ZIP contents and four SHA-256 hashes.
- `npm audit` reported zero known vulnerabilities.
- Packaging and demo-install scripts also passed from a directory containing spaces and Chinese characters.
- Existing tracked demo source notes remained unchanged.
- 英文与中文翻译占位符、设置迁移、预算、并发去重与同名写入、暂停/删除、索引损坏恢复等回归测试均通过。
- 打包额外检查了空格与中文路径，原有演示原文未发生修改。

## Real provider / 真实服务

Both runs used DeepSeek `deepseek-flash`, synthetic demo notes, disabled web/X recovery,
an estimated US$0.05 budget and an 8-item limit per run.

| Output language | Successful analyses | Input tokens | Output tokens | Estimated USD |
|---|---:|---:|---:|---:|
| English | 5 | 6,627 | 3,515 | 0.0062061 |
| 简体中文 | 5 | 6,727 | 3,426 | 0.0061293 |

Each run also skipped one duplicate and one empty note without an analysis.
Total estimated spend: **US$0.0123354**. These are token-based estimates, not a verified provider invoice.
两种语言各完成 5 篇分析，另各跳过一篇重复和一篇空内容。合计估算约 0.0123 美元，并非服务商账单核对结果。

## Unavailable / 未完成

Fresh Obsidian native UI checks could not run because the desktop automation connection was unavailable.
No fresh dark/light/narrow-pane or iOS/Android device check is claimed.
Only DeepSeek had a real network run; the other provider protocols were tested with fake transports.
No community-directory submission or social-media post was made by this release task.

本轮桌面自动化连接不可用，未声称通过新版原生界面、明暗主题、窄屏或移动真机测试。
真实联网测试仅覆盖 DeepSeek，其他协议使用模拟网络测试。本次未提交社区目录，也未发布社交媒体帖子。
