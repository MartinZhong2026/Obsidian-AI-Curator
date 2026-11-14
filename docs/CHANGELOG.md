# Changelog / 更新记录

## 1.0.0 — 2026-11-14

The first stable GitHub release focuses on reliable daily use and equal English/Chinese support.
首个稳定 GitHub 版本，重点是日常可靠性与中英文同等支持。

- Bilingual inbox, setup, settings, commands and notices; interface/output languages are independent.
  收件箱、向导、设置、命令与提示双语化，界面和笔记语言独立。
- Prevent same-title overwrites and concurrent duplicate calls; reserve the full output ceiling.
  防止同名覆盖与并发重复扣费，预留完整输出额度。
- Correct monthly rollover, persistent budget banners, pause/delete checks and manual-only curation.
  修复跨月、预算提示、暂停/删除检查及单篇手动整理。
- Serialize index snapshots, recover from temporary/backup files, handle folder renames/deletes.
  串行索引快照、临时/备份恢复及文件夹事件处理。
- Keep X expansion opt-in, disclose web recovery, redact keys and require remote HTTPS.
  X 补全主动选择、网络行为披露、密钥脱敏、远程 HTTPS。
- Bilingual guides, AGENTS.md, contribution/report templates, CI and verified ZIP/checksum assets.
  双语文档、AI 维护指南、贡献/反馈模板、CI 与校验过的附件。

Validation: 68 automated tests plus production build, package/hash verification and dependency audit. Native UI/device checks were unavailable; see VERIFICATION-1.0.0.md.
验证：68 项自动化测试、构建、打包校验与依赖审计；原生界面及真机检查未完成，详见验证记录。

## 1.0.0-beta.1 — first public beta

This is a full rewrite as a native TypeScript Obsidian plugin. The 0.1 prototype needed Python, a local engine and a scheduled task; this version needs none of them.

- **Automatic curation** of new notes in the folders you choose. It waits for files to settle and handles the newest saves first.
- **Verdicts and scores.** Each item is marked Read, Skim, Reference or Skip, with a one-line reason and a 0–100 score computed locally from five weighted criteria.
- **Curated notes** contain a TL;DR, summary, key ideas, how-to steps, next actions, caveats, mentions and related links. Anything you write below the marker survives regeneration.
- **Reading inbox** view with tabs, search, topic filter, mark-read and archive, a backlog banner with a cost estimate, and error recovery.
- **Setup guide** that finds your Web Clipper and X bookmark folders, connects and tests the AI provider, and asks how to handle existing notes.
- **Providers:** DeepSeek (default), Anthropic Claude (official SDK, structured outputs, refusal fallbacks), OpenAI, Gemini, OpenRouter, Ollama, LM Studio, and any OpenAI-compatible endpoint.
- **API keys** live in Obsidian SecretStorage and are never written to settings.
- **Spending limits:** a monthly USD cap and a daily item limit. Parallel calls reserve their estimated cost up front, to reduce overspending; provider billing is authoritative.
- **Robustness:**
  - Duplicates, matched by canonical URL or content hash, are skipped without an AI call.
  - Authentication and balance errors pause curation instead of retrying in a loop.
  - Temporary errors back off before retrying.
  - Replies that can't be parsed are retried once.
  - Interrupted work is recovered on reload. Version 1.0.0 adds serialized snapshots and recovery copies.
- **Full-text recovery** fetches the original page when a note is only a teaser. Expanding X posts and Articles through FxTwitter is opt-in.
- **Weekly digest**, a **Bases** reading list, a **status bar** item, and commands, including "Curate the current note".
- Output in English or Simplified Chinese. Targets desktop and mobile APIs; native device validation is recorded per release.
