# Releasing / 发布

Read [AGENTS.md](../AGENTS.md) and applicable personal GitHub safeguards before remote writes.
先阅读项目与个人 GitHub 规则。没有对应授权时，只做本地工作。

## Local verification / 本地验证

```bash
npm ci
npm run package
npm audit
npm run demo:install
```

Packaging checks matching package/lock/manifest/versions, the browser bundle's external dependencies,
ZIP entries and SHA-256 hashes. Use Node 24+.
打包会校验版本一致性、运行时依赖、ZIP 内容和哈希。

In an isolated test vault, inspect setup, both interface languages and output languages, read/archive,
re-curation preserving user text, errors, dark/light themes and a narrow pane. Test real mobile devices when available.
Record unavailable checks honestly. Never use a personal vault as a disposable test fixture.
测试双语设置与输出、阅读状态、个人笔记保留、错误、明暗主题与窄屏，有条件时测试移动真机。未完成的检查如实记录。

Optional paid demo (synthetic notes only):
可选付费 API 演示，仅使用演示素材：

```powershell
# Set DEEPSEEK_API_KEY privately in your environment; never paste it into a committed file.
npm run demo:real -- --fresh
npm run demo:real -- --fresh --zh
```

`--fresh` deletes only generated `demo/vault/AI Curator/`. The script sets a US$0.05 estimated budget and
an 8-item daily limit. It is not a provider-side billing guarantee. Never print credentials.
该参数只重置演示输出目录。脚本限制估算预算与篇数，实际账单仍以服务商为准。

## Version and one milestone push / 版本与集中推送

Update `package.json`, `package-lock.json`, `manifest.json`, `versions.json` and the bilingual changelog.
Create a tag exactly matching the version, with no `v` prefix. Review the complete diff before committing.
同步版本文件与双语更新记录，标签与版本完全一致，不加 v，提交前检查完整差异。

```bash
git tag VERSION
git push --atomic origin main VERSION
```

CI triggers on pushes to main and pull requests to main. Release tags do not trigger a second build.
Check the exact head SHA once work has had time to complete; do not poll continuously or push to rerun CI.
预计 main 推送触发一次 CI，标签不重复触发；确认对应 SHA，避免持续轮询或空提交重跑。

## Publish after CI / CI 后发布

Create a draft release for the exact tag, attach these assets, then publish after checking all uploads:
先创建对应标签的草稿，上传并核对附件后发布：

- `dist/<version>/main.js`
- `dist/<version>/manifest.json`
- `dist/<version>/styles.css`
- `dist/ai-curator-<version>.zip`
- `dist/SHA256SUMS-<version>.txt`

Use `docs/RELEASE-<version>.md` as the bilingual release body for this version.
Verify the public release tag/head, asset names and downloaded hashes.
发布后检查公开标签、提交、附件名与下载内容哈希。

For the existing community listing, confirm that the new version appears on the published listing. If detection is delayed, open the entry in the Community directory and select **... → Check for new releases**.
Social posts in [LAUNCH.md](LAUNCH.md) are drafts; publishing them requires explicit authorization.
检查社区目录的公开页面是否显示新版本。若尚未检测到，可在目录的插件管理页选择 **… → Check for new releases**。社交文案仅为草稿，发帖需明确授权。

Report exact SHA, local/native checks, push/PR/release operation counts, CI event and actual conclusion.
报告准确 SHA、实测与未测项、远程操作次数、CI 事件及真实结果。
