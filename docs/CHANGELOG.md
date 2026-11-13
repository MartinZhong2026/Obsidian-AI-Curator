# Changelog

## 1.0.0-beta.1 — first public beta

This is a full rewrite as a native TypeScript Obsidian plugin. The 0.1 prototype needed Python, a local engine and a scheduled task; this version needs none of them.

- **Automatic curation** of new notes in the folders you choose. It waits for files to settle and handles the newest saves first.
- **Verdicts and scores.** Each item is marked Read, Skim, Reference or Skip, with a one-line reason and a 0–100 score computed locally from five weighted criteria.
- **Curated notes** contain a TL;DR, summary, key ideas, how-to steps, next actions, caveats, mentions and related links. Anything you write below the marker survives regeneration.
- **Reading inbox** view with tabs, search, topic filter, mark-read and archive, a backlog banner with a cost estimate, and error recovery.
- **Setup guide** that finds your Web Clipper and X bookmark folders, connects and tests the AI provider, and asks how to handle existing notes.
- **Providers:** DeepSeek (default), Anthropic Claude (official SDK, structured outputs, refusal fallbacks), OpenAI, Gemini, OpenRouter, Ollama, LM Studio, and any OpenAI-compatible endpoint.
- **API keys** live in Obsidian SecretStorage and are never written to settings.
- **Spending limits:** a monthly USD cap and a daily item limit. Parallel calls reserve their estimated cost up front, so together they can't overshoot.
- **Robustness:**
  - Duplicates, matched by canonical URL or content hash, are skipped without an AI call.
  - Authentication and balance errors pause curation instead of retrying in a loop.
  - Temporary errors back off before retrying.
  - Replies that can't be parsed are retried once.
  - The index survives crashes and is written atomically.
- **Full-text recovery** fetches the original page when a note is only a teaser. Expanding X posts and Articles through FxTwitter is opt-in.
- **Weekly digest**, a **Bases** reading list, a **status bar** item, and commands, including "Curate the current note".
- Output in English or Simplified Chinese. Works on desktop and mobile.
