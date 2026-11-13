# Releasing

## 1. Pre-flight (local only)

```bash
npm ci
npm run package        # type check, tests, production build, dist/ assets and zip
npm audit --omit=dev   # runtime dependencies only
```

Then do a manual pass in a **test vault**. Run `npm run demo:install` and open `demo/vault` in Obsidian.

- [ ] The setup guide opens the first time the plugin is enabled, and folder detection finds `Clippings` and `X Bookmarks`.
- [ ] After you paste a key, **Test** reports "Connected to deepseek-flash".
- [ ] Choosing "Newest 10" curates items and the inbox fills with cards.
- [ ] The star invitation appears once, after the first result. "No thanks" means it never appears again.
- [ ] A page saved with Web Clipper appears curated within about 30 seconds.
- [ ] **Mark read** moves the card to Done and sets `status: read` in the curated note.
- [ ] Text written below the marker survives **Curate again**.
- [ ] A wrong key pauses curation with a clear banner instead of retrying in a loop.
- [ ] The light theme, dark theme and a narrow pane (mobile layout) all look right.
- [ ] If possible, the iOS or Android app works too.

## 2. Version bump

Update `version` in `manifest.json` and `package.json`, and add `"<version>": "<minAppVersion>"` to `versions.json`. `npm run package` refuses to build if these disagree.

## 3. GitHub release (manual, one planned push)

```bash
git push origin main
git tag 1.0.0-beta.1 && git push origin 1.0.0-beta.1
gh release create 1.0.0-beta.1 --prerelease --title "AI Curator 1.0.0-beta.1" --notes-file docs/CHANGELOG.md \
  dist/1.0.0-beta.1/main.js dist/1.0.0-beta.1/manifest.json dist/1.0.0-beta.1/styles.css \
  dist/ai-curator-1.0.0-beta.1.zip
```

The tag must match the manifest version exactly, with no `v` prefix. BRAT and the community directory both read the assets attached to the release.

## 4. Community plugin directory (for 1.0.0)

Open a PR to `obsidianmd/obsidian-releases` that adds this entry to `community-plugins.json`:

```json
{ "id": "ai-curator", "name": "AI Curator", "author": "Martin Zhong",
  "description": "Save anything. Read what matters. AI triages your clippings and bookmarks, tells you what's worth reading, and turns them into connected, actionable notes.",
  "repo": "MartinZhong2026/Obsidian-AI-Curator" }
```

These review points are already handled:

- The id `ai-curator` does not contain "obsidian" and was free in the registry as of 2026-11-13.
- Network calls go through `requestUrl`.
- The code doesn't use `innerHTML`.
- There is no telemetry.
- The README includes a privacy disclosure.
- The bundle has no Node built-ins, so it is mobile-safe.

## 5. Launch posts

**X (English):**

> I save 20 articles a day and read 2. So I built AI Curator, an open-source Obsidian plugin.
>
> It reads everything you clip (Web Clipper, X bookmarks, any Markdown) and tells you honestly: Read, Skim, Reference or Skip. Then it writes the notes for you.
>
> About $0.002 per article with DeepSeek. Your originals are never touched.
>
> Public beta: github.com/MartinZhong2026/Obsidian-AI-Curator

**X (中文):**

> 收藏了几百篇文章，真正读过的不到一成？
>
> 我做了一个开源 Obsidian 插件 AI Curator：自动读你用 Web Clipper、X 书签同步或任何方式保存的内容，告诉你哪篇值得精读、哪篇看摘要就够、哪篇是噱头可以跳过，并生成带行动清单的中文笔记。
>
> 默认 DeepSeek，每篇约 ¥0.01；原文一字不改；密钥存在 Obsidian 安全存储。
>
> 公测中，欢迎试用和反馈 👉 github.com/MartinZhong2026/Obsidian-AI-Curator

Attach a 20–30 second screen recording that shows saving a page, the curated card appearing, and opening the note. Pin the post, reply with the BRAT install steps, and ask testers to report problems as GitHub issues.
