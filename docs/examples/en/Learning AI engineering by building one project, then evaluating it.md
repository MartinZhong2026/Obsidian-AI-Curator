---
title: "Learning AI engineering by building one project, then evaluating it"
source: "[[X Bookmarks/2026-11-10-demo_dev-普通人学习 AI 工程的顺序]]"
url: "https://x.com/demo_dev/status/1987000000000000002"
author: "Demo Dev"
published: "2026-11-10"
verdict: skim
score: 38
topic: "AI Engineering"
type: thread
tags: ["ai-engineering", "learning-path", "evaluation", "rag", "llm-apps"]
status: unread
completeness: full
analyzed: 2026-11-13
model: "deepseek-flash"
ai-curator: 1
---

> [!info] Skim · 38/100 — Sensible but generic learning-order advice; the distillation captures essentially all of it.
> Learn AI engineering project-first: build a notes Q&A bot, then build a small personal eval set of ~30 questions before touching agents or fine-tuning.
>
> Directly matches the reader's stated goal of practical, evidence-backed LLM app building with little patience for hype — though it is a starting map rather than deep technique.

## Summary

A short thread giving an opinionated learning order for AI engineering: first get comfortable with Python, HTTP and Git, then build a Q&A bot over your own notes so you hit chunking, vector retrieval and prompting problems for real. Only after that set up evaluation with ~30 questions you would actually ask, re-run on every change, and learn to diagnose whether a bad answer came from retrieval or from the model. The author claims this sequence took them three months and that evaluation was the most valuable step.

## Key ideas

- Learning order matters: fundamentals (Python, HTTP, Git) → one real project → evaluation → agents/fine-tuning, not a topic checklist.
- Building the notes Q&A bot deliberately exposes real problems — chunking, vector retrieval, prompt design — that tutorials abstract away.
- Evaluation is the turning point: without it you cannot tell whether a change made the system better or worse.
- Diagnostic skill is the gate for advanced topics: being able to say whether a wrong answer came from retrieval failure or model misunderstanding shows you understand the pipeline.

## How to apply

1. Get comfortable with Python, HTTP and Git — enough to write a small script that calls an API.
2. Build a Q&A bot over your own notes; work through chunking, vector retrieval and prompting as they come up.
3. Write ~30 questions you would genuinely ask your own data, and use them as your eval set.
4. Re-run the eval set on every change and compare results to see what got worse.
5. For each wrong answer, classify the cause (retrieval miss vs. model misunderstanding) before moving on.
6. Only then start on agents and fine-tuning.

## Next actions

- [ ] Start a personal eval set of ~30 real questions against a dataset you care about, and record baseline results before changing anything.
- [ ] Build the notes Q&A bot as a first project, and log each failure as either a retrieval miss or a model error.

## Caveats

- This is a demo/example post written for an AI Curator demonstration, so the claims and the 'three months' figure are illustrative and unsourced. No specific tools, metrics, code or scoring method for the eval set are given; the 30-question number is a heuristic, not evidence.

---
Source: [[X Bookmarks/2026-11-10-demo_dev-普通人学习 AI 工程的顺序|Original note]] · [Open original](https://x.com/demo_dev/status/1987000000000000002)

%% ai-curator: everything above this line is regenerated. Write your own notes below it. %%

## My notes

