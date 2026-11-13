---
title: "Small hand-built golden sets catch RAG regressions better than 5k synthetic tests"
source: "[[Clippings/Small golden sets catch most RAG regressions]]"
url: "https://example.com/blog/small-golden-sets-rag?utm_source=newsletter"
author: "Demo Author"
published: "2026-10-02"
verdict: read
score: 70
topic: "AI Engineering"
type: case-study
tags: ["evaluation", "rag", "golden-set", "llm-as-judge", "retrieval"]
status: unread
completeness: full
analyzed: 2026-11-13
model: "deepseek-flash"
ai-curator: 1
---

> [!tip] Read · 70/100 — Short and directly implementable eval recipe; the original likely adds the grader prompt and code detail this text only describes.
> A 50-question golden set built from real support tickets, with retrieval scored separately from generation, caught regressions a 5,000-question synthetic set missed.
>
> Directly matches the reader's goal of practical, evidence-backed LLM evaluation: a cheap, concrete eval design for RAG with separation of retrieval and generation metrics.

## Summary

A team describes replacing a 5,000-question synthetic RAG test suite with 50 real support-ticket questions, each annotated with the document that must be retrieved and 2-3 facts the answer must contain. The suite runs on every PR touching retrieval, chunking, prompts or models; retrieval is scored as recall@5 and generation by a model grader using a 4-level rubric, with any drop from 'all facts' blocking the merge. They report that retrieval caused 70% of caught regressions, chunk-size changes were the most dangerous edits, and the model grader agreed with humans on 46/50 questions.

## Key ideas

- Synthetic questions are too clean: real user questions are phrased badly, so synthetic sets miss retrieval failures that real phrasings expose.
- Score retrieval and generation separately (e.g. recall@5 for the required document, fact coverage for the answer) so a failure immediately points to the responsible component.
- Gate merges on regressions: any question dropping from 'all facts present' to a lower rubric level blocks the PR until a human reviews.
- Annotate each question with required facts, not just a reference answer, so grading reduces to a short rubric: all / some / none present / contradicts source.
- Chunk-size tradeoffs are concrete: 800→400 tokens improved recall on short FAQ questions but broke multi-step how-to answers.
- Small sets are for fast regression signal, not rare-failure coverage; sample production conversations weekly to complement them.

## How to apply

1. Collect ~50 real questions from support tickets rather than generating them.
2. For each question, record the document that must be retrieved and 2-3 facts the answer must contain (two people, one afternoon).
3. Run the set on every PR that touches retrieval, chunking, prompts or models.
4. Compute recall@5: did the required document appear in the top 5 retrieved chunks?
5. Grade answers with a second model against the required facts using the rubric: all facts present, some present, none present, contradicts the source.
6. Block merges on any question dropping from 'all facts' until a human inspects it.
7. Keep sampling production conversations weekly to catch rare failures the small set cannot.

## Next actions

- [ ] Build a 50-question golden set from your own app's real user questions, annotating required documents and facts.
- [ ] Split your existing eval into retrieval (recall@k) and generation (fact-coverage rubric) metrics and check which component causes your recent failures.
- [ ] Re-run your chunk-size setting against multi-step how-to questions, not just short FAQ ones.

## Caveats

- Single product, single document set (~2,000 pages); no evidence it generalizes.
- A 50-question set cannot detect rare failures by the author's own admission.
- Multilingual content untested.
- The 46/50 grader-human agreement is a single unaudited number; no details on the grader model, prompt, or how ambiguity was adjudicated.
- The grader code is described (~120 lines around an LLM call) but not provided in the text.

## Related

- [[AI Curator/Notes/Learning AI engineering by building one project, then evaluating it|Learning AI engineering by building one project, then evaluating it]]

---
Source: [[Clippings/Small golden sets catch most RAG regressions|Original note]] · [Open original](https://example.com/blog/small-golden-sets-rag?utm_source=newsletter)

%% ai-curator: everything above this line is regenerated. Write your own notes below it. %%

## My notes

