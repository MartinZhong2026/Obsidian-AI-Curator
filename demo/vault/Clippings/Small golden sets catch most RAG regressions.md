---
title: "Small golden sets catch most RAG regressions"
source: "https://example.com/blog/small-golden-sets-rag?utm_source=newsletter"
author:
  - "[[Demo Author]]"
published: 2026-10-02
created: 2026-11-10
description: "Why a 50-question evaluation set beat our 5,000-question one."
tags:
  - "clippings"
---
*Sample article written for the AI Curator demo.*

For a year our team evaluated our retrieval-augmented generation (RAG) assistant with a synthetic test set of about 5,000 generated questions. Scores moved by fractions of a percent between releases, and nobody trusted them. Then a reranker change silently broke answers for every question about pricing, and the big test set did not notice.

We replaced it with 50 real questions taken from support tickets. For each question we wrote down the document that must be retrieved and two or three facts the answer must contain. Building the set took two people one afternoon.

## How we run it

1. Every pull request that touches retrieval, chunking, prompts or models runs the 50 questions.
2. Retrieval is scored separately from generation: did the required document appear in the top 5 chunks (recall@5)?
3. Answers are graded by a second model against the required facts, with a short rubric: all facts present, some present, none present, or contradicts the source.
4. Any question that drops from "all facts" to anything lower blocks the merge until a human looks at it.

## What we learned

- Retrieval caused 70% of regressions we caught. Measuring it separately told us where to look immediately.
- Chunk size changes were the most dangerous edits. Going from 800 to 400 tokens improved recall on short FAQ questions but broke multi-step how-to answers.
- The model-graded rubric agreed with human graders on 46 of 50 questions. The four disagreements were all cases where the source document itself was ambiguous.
- Real questions are phrased badly. Synthetic questions were too clean, which is why they never exposed retrieval problems.

## Limits

This is one product with one document set of about 2,000 pages. A 50-question set will not detect rare failures, so we still sample production conversations weekly. We have not tested this approach on multilingual content.

The code for our grader is about 120 lines of Python around an LLM call and a JSON rubric. The hard part is not code; it is choosing questions that represent what users actually ask.
