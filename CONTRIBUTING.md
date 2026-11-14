# Contributing / 参与贡献

English and Chinese issues, translations and pull requests are equally welcome.
欢迎中文与英文的问题反馈、翻译和代码贡献。

Read [AGENTS.md](AGENTS.md) first for architecture, privacy boundaries and release rules.
请先阅读该文件中的架构、隐私边界与发布规则。

Use Node 24+, run `npm ci` and `npm run dev`. Use `demo/vault` or a disposable test vault.
Run `npm run package` and `npm audit` before proposing a release.
使用 Node 24+，测试请用演示或可丢弃仓库，发布前完整打包并审计依赖。

Add a regression test for behavior changes. Keep both READMEs and interface translations in sync.
Real API tests are optional and paid; never send private vault content.
行为变更需补回归测试，中英文文档与界面同步维护；真实 API 测试可选且收费，不得发送私人笔记。

Reports should include plugin/Obsidian versions, OS, interface/output language, provider/model,
reproduction steps and a small synthetic Markdown sample.
反馈请包括版本、系统、界面与输出语言、服务商/模型、复现步骤及虚构的最小样例。

Remove keys, private URLs and personal notes from logs and screenshots.
For security issues, use private vulnerability reporting if available; otherwise request a private contact channel without disclosing secrets.
日志和截图请先脱敏。安全问题优先用私密漏洞报告，或以最少信息请求私下联系渠道。
