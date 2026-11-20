# Contributing / 参与贡献

English and Chinese contributions are welcome. Open an issue for a larger change so we can discuss the workflow first. Small documentation and translation fixes can go directly to a PR.

欢迎中英文贡献。较大的变更请先开 Issue 讨论使用场景，小的文档或翻译修正可直接提交 PR。

## Develop locally / 本地开发

Use Node 24 or newer. Run the following from the repository root.

使用 Node 24 或更新版本，在仓库根目录运行以下命令。

```bash
npm ci
npm run package
npm run demo:install
```

Open `demo/vault` as a separate vault in Obsidian and enable AI Curator there. For iterative work, use `npm run dev` to rebuild on changes and copy the rebuilt files to the demo plugin folder before reloading.

在 Obsidian 中将 `demo/vault` 作为单独的仓库打开，并在其中启用 AI Curator。反复修改时可运行 `npm run dev`，再把重新生成的文件复制到演示插件目录并重新加载。

## Before opening a PR / 提交 PR 前

- Read [AGENTS.md](AGENTS.md) for architecture and data boundaries. 阅读项目约定，了解架构和数据保护要求。
- Add a focused regression test for behavior changes. Keep both READMEs and interface translations aligned. 行为变更请补充回归测试，并同步维护双语文档与界面。
- Run `npm run package` and `npm audit`. In the PR, describe how you verified the change and include a demo-vault screenshot for UI changes where available. 在 PR 中说明验证方式，界面有变化时尽量附演示仓库截图。

For bugs, include versions, platform, and a minimal synthetic reproduction. Remove API keys, private URLs, and personal notes from examples and logs. For security issues, use private vulnerability reporting if available, or request a private contact channel without disclosing the issue publicly.

反馈问题时，请附版本、平台和最小虚构复现样例，从样例与日志中移除密钥、私人链接和笔记。安全问题请优先使用私密漏洞报告，或请求私下沟通渠道。
