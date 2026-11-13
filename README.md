# AI Curator for Obsidian

**Save anything. Read what matters.**

You clip articles, bookmark threads and save "read later" links far faster than you can read them. AI Curator reads every new save in your vault and tells you, honestly, which ones deserve your time. It writes a short, dense note for each one so you get the value even if you never open the original.

- **Triage, not just summaries.** Every item gets a verdict (**Read**, **Skim**, **Reference** or **Skip**), a 0–100 score and a one-line reason. Hype and engagement bait get called out.
- **Notes you can use.** TL;DR, key ideas, step-by-step methods, caveats, and next actions as checkboxes, written in English or Simplified Chinese.
- **A reading inbox.** One view with "Read next", search and topic filters, and mark-as-read, plus a Bases table and a weekly digest.
- **Connections for free.** Related notes are linked by shared tags, topics and tools, computed locally without extra AI calls.
- **Works with what you already use.** Obsidian Web Clipper, X Bookmarks Sync, Readwise or Omnivore exports, or any Markdown in a folder. No other plugin is required.
- **No setup chores.** Install it, pick a folder, paste an API key. There's no Python, terminal, YAML or script to deal with.

> Status: **1.0.0-beta.1** (public beta). Desktop and mobile. Feedback is very welcome: [open an issue](https://github.com/MartinZhong2026/Obsidian-AI-Curator/issues).

---

## A real example

These results come from an actual run on the [demo vault](demo/vault) in this repository (five sample saves); the full output is in [docs/examples](docs/examples/en/). The model was DeepSeek `deepseek-flash`, and the run cost **$0.005 in total**.

| Saved item | Verdict | Score | What the curator said |
|---|---|---:|---|
| A blog post on evaluating RAG with a 50-question golden set | **Read** | 70 | "Short and directly implementable eval recipe." |
| A Chinese X post on learning AI engineering through projects | Skim | 38 | "Sensible but generic learning-order advice; the distillation captures essentially all of it." |
| A list of local LLM tools | Reference | 24 | "A compact, accurate cheat sheet for picking a local runner, but too shallow to read in full." |
| "This AI tool will replace 90% of developers 🚨" | Skip | 0 | "Unsourced hype with no tool name, method or evidence." |
| A clipping that only contains an image | — | — | Skipped without an AI call (nothing to analyze). |

Here is part of the curated note for the first item ([full note](docs/examples/en/), [Chinese version](docs/examples/zh/)):

```markdown
> [!tip] Read · 70/100 — Short and directly implementable eval recipe; the original likely
> adds the grader prompt and code detail this text only describes.
> A 50-question golden set built from real support tickets, with retrieval scored separately
> from generation, caught regressions a 5,000-question synthetic set missed.

## How to apply
1. Collect ~50 real questions from support tickets rather than generating them.
2. For each question, record the document that must be retrieved and 2-3 facts the answer must contain.
3. Run the set on every PR that touches retrieval, chunking, prompts or models.
…
## Next actions
- [ ] Build a 50-question golden set from your own app's real user questions.
```

## Install

### Option A: BRAT (recommended during the beta)

1. Install **BRAT** from *Settings → Community plugins → Browse*.
2. Run the command **BRAT: Add a beta plugin for testing** and enter `MartinZhong2026/Obsidian-AI-Curator`.
3. Enable **AI Curator** in *Settings → Community plugins*.

BRAT keeps the plugin updated as new beta versions come out.

### Option B: Manual

1. Download `ai-curator-1.0.0-beta.1.zip` from the [latest release](https://github.com/MartinZhong2026/Obsidian-AI-Curator/releases).
2. Unzip it into `<your vault>/.obsidian/plugins/`. You should end up with `.obsidian/plugins/ai-curator/main.js`.
3. Reload Obsidian and enable **AI Curator** in *Settings → Community plugins*.

Requires Obsidian **1.11.4** or newer.

## Set up (about two minutes)

The setup guide opens the first time you enable the plugin.

1. **Choose your folders.** AI Curator finds the folders where your clippings land (for example `Clippings`, which is Web Clipper's default, or your X bookmarks folder). It only reads those folders and never changes the notes inside them.
2. **Connect an AI model.** DeepSeek is preselected. Paste a key from [platform.deepseek.com](https://platform.deepseek.com/api_keys) and click **Test**.
3. **Make it yours (optional).** Pick the output language and write a sentence about what you work on. Recommendations get much sharper when you do.
4. **Decide about existing saves.** New saves are always curated automatically. For notes that were already there, you can start with the newest 10, curate all of them (you see the estimated cost first), or leave them alone.

From then on, new saves are usually curated within a minute while Obsidian is open. Open the **Reading inbox** from the ✦ ribbon icon or the status bar.

## AI providers

| Provider | Typical cost per article | Notes |
|---|---|---|
| **DeepSeek** (default) | ~$0.001–0.003 | Fast and inexpensive, and strong in both English and Chinese. `deepseek-flash` is recommended; `deepseek-v4-pro` costs more. |
| Anthropic (Claude) | higher | Use it if the Claude API is available in your region. Uses the official SDK with structured outputs. |
| OpenAI, Google Gemini, OpenRouter | varies | Any model name works. Use **Load models** to see the list. |
| Ollama, LM Studio | free | Runs on your own computer, so nothing leaves it. Quality depends on the model you choose. |
| Custom | varies | Any OpenAI-compatible `/chat/completions` endpoint. |

Spending is capped by a **monthly budget** (default $3) and a **daily item limit** (default 100). Costs are estimated from token usage and list prices. Your provider's bill is the authoritative number.

## How the verdicts work

The model rates each item from 1 to 5 on five criteria. The plugin then computes the score locally:

| Criterion | Weight | What it measures |
|---|---:|---|
| Relevance | 30 | How directly the item matters to you, based on your profile |
| Depth | 20 | Does it explain how and why? |
| Actionability | 20 | Can you do something with it? |
| Evidence | 15 | Opinion, examples, or reproducible data and code |
| Originality | 15 | Recycled or genuinely new |

Likes, follower counts and the author's fame play no part. Teasers and cut-off posts are labeled as such and capped at 55, so they never top your list. The verdict is kept consistent with the score: a "Read" needs a score of at least 40, and anything scoring 70 or more can't be marked "Skip".

## Privacy and safety

- **Your originals are never modified.** Curated notes go to a separate folder (`AI Curator/` by default). Each curated note links back to its source, so the source shows it as a backlink.
- **Only the folders you choose are read.** Each item's text goes only to the provider you configured. Nothing else in your vault is sent anywhere.
- **API keys are stored in Obsidian's secret storage**, not in plugin files, settings JSON or your notes.
- **There is no telemetry or analytics,** and no account is required. The GitHub star invitation appears once, after your first real result, and only opens a link.
- **Full-text recovery** (on by default) fetches the original web page only when a saved note is a teaser, using the URL already in the note. **X post expansion** (opt-in) reads public posts through the third-party FxTwitter API. Both can be turned off.
- **Content you save is treated as untrusted.** The prompt instructs the model never to follow instructions found inside saved content.
- **Your own writing is preserved.** Anything you write below the marker line in a curated note survives re-curation, and so does a `status:` value you change by hand.

See [docs/PRIVACY.md](docs/PRIVACY.md) for a complete list of network requests.

## Commands

| Command | What it does |
|---|---|
| Open reading inbox | Opens the main view |
| Process queue now | Rescans your folders and starts curating, even when automatic mode is off |
| Pause or resume automatic curation | Stops or restarts background curation |
| Curate the current note | Curates any single note, even one outside your folders |
| Create weekly reading digest | Writes `AI Curator/Digests/<date>.md` with the week's best items (no AI call) |
| Refresh related links in curated notes | Rebuilds links between notes (no AI call) |
| Retry failed items | Queues failed items again |
| Open setup guide | Runs the setup guide again |

## What gets created

```
AI Curator/
├── Notes/            one curated note per saved item (frontmatter: verdict, score, topic, tags, status…)
├── Digests/          weekly digests, when you ask for one
└── Reading list.base a Bases table with "Read next", "Unread", "All curated" and "Reference" views
```

## Troubleshooting

- **Nothing happens after saving.** New files wait a few seconds to settle, because clippers often write in several steps. Check the status bar or the inbox's **Queue** tab.
- **"Paused: HTTP 401" or "Insufficient Balance".** Fix the key or add balance, then click **Resume**. The plugin stops on these errors instead of retrying in a loop.
- **An item says "No content".** The note only holds a link, image or embed. Turn on **Fetch full text** (and **Expand X posts** for X bookmarks), then use **Curate** on that item.
- **I edited the original and the summary is outdated.** The card shows **changed**. Choose **⋯ → Curate again**. If a sync tool later fills in the full text of a teaser, re-curation happens automatically.

## Known limitations (beta)

- Curation runs while Obsidian is open. Saves made while it's closed are picked up the next time you open it.
- Images, videos and PDFs inside a note are not analyzed, only the text.
- Topic grouping and related links are local heuristics. There's no cross-article AI synthesis yet.
- The interface is in English. Curated notes can be in English or Simplified Chinese.

## Development

```bash
npm ci
npm run dev          # watch build
npm test             # 49 unit and engine tests (Node 22+)
npm run build        # type check + production bundle
npm run package      # build, test, and write dist/ release assets + zip
npm run demo:install # install into demo/vault for manual testing
DEEPSEEK_API_KEY=... npm run demo:real -- --fresh   # real end-to-end run on the demo vault (~$0.005)
```

The engine (`src/curator.ts`) talks to Obsidian through a small `VaultPort` interface. That makes the whole pipeline (scan → settle → dedupe → full text → AI → note) testable in Node with an in-memory vault (`tests/helpers.ts`). See [docs/RELEASING.md](docs/RELEASING.md) for the release checklist.

## 中文简介

**AI Curator：收藏一切，只读值得读的。** 它会自动整理 Web Clipper、X Bookmarks Sync 或任何 Markdown 收藏。每一篇都会得到「精读 / 速览 / 备查 / 跳过」的判断和打分，并生成一篇包含摘要、核心观点、实践方法和下一步行动的笔记。默认使用 DeepSeek，每篇大约 ¥0.01–0.02。原始笔记不会被改动，API Key 保存在 Obsidian 的安全存储中。在设置里把「Language of curated notes」选为「简体中文」，就会输出中文笔记。

## Support

AI Curator is free and MIT-licensed. If it saves you time, a ⭐ on [GitHub](https://github.com/MartinZhong2026/Obsidian-AI-Curator) helps other readers find it. Bug reports and ideas are just as welcome.
