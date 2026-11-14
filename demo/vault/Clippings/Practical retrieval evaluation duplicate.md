---
title: A practical guide to evaluating retrieval systems
source: https://example.com/curator-demo-retrieval
---
# A practical guide to evaluating retrieval systems

A small evaluation set built from real user questions can reveal retrieval failures before changes reach production. Record the expected source document for each question. Measure whether the correct document appears in the top five results, then inspect failures by category. Separate retrieval quality from answer quality so a fluent answer does not hide missing evidence. Repeat the evaluation after changing chunk size, embeddings, or search ranking. Keep a few difficult examples for regression testing and review the set as documents change.
