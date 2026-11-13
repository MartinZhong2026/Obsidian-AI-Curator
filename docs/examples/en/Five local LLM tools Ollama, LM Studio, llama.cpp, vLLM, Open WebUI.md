---
title: "Five local LLM tools: Ollama, LM Studio, llama.cpp, vLLM, Open WebUI"
source: "[[Clippings/Local LLM tools worth knowing]]"
url: "https://example.com/lists/local-llm-tools"
author: "Demo Curator"
published: "2026-09-15"
verdict: reference
score: 24
topic: "AI Engineering"
type: resource-list
tags: ["local-llm", "ollama", "llama-cpp", "vllm", "quantization"]
status: unread
completeness: full
analyzed: 2026-11-13
model: "deepseek-flash"
ai-curator: 1
---

> [!note] Reference · 24/100 — A compact, accurate cheat sheet for picking a local runner, but too shallow and unsourced to read in full.
> Pick Ollama as the default local runner, LM Studio if you want a GUI, llama.cpp for tuning, vLLM only for shared GPU serving, and Open WebUI for a chat front-end.
>
> A quick orientation map of local inference options and memory rules of thumb, useful when you want a local model for cheap experimentation or for evaluating LLM apps without API costs.

## Summary

A short curated list of tools for running language models locally, each described in one line: Ollama (one-command downloads plus an OpenAI-compatible API on port 11434), LM Studio (desktop app with a server on port 1234), llama.cpp (the underlying C/C++ engine with the most tuning knobs), vLLM (high-throughput GPU serving for team servers) and Open WebUI (a chat UI over Ollama or any OpenAI-compatible endpoint). It closes with rough hardware rules of thumb: 8B models at 4-bit run on most 16 GB laptops, 30B+ needs a strong GPU or 32 GB+ Apple silicon, and Q4_K_M is a common quantization balance.

## Key ideas

- Most local tools converge on an OpenAI-compatible HTTP API, so a front-end like Open WebUI can point at either Ollama or vLLM without changes.
- The stack layers matter: llama.cpp is the inference engine many tools build on, while Ollama and LM Studio are convenience wrappers around it.
- Tool choice follows the deployment target: laptop default (Ollama), GUI preference (LM Studio), max performance tuning (llama.cpp), shared GPU throughput (vLLM).
- Memory, not raw parameter count, decides feasibility: 4-bit quantization is what makes 8B models fit in 16 GB RAM.
- Quantization is a deliberate trade: less memory for a small quality cost, with Q4_K_M as the usual starting point.

## How to apply

1. Install Ollama and use its default endpoint at port 11434 as an OpenAI-compatible API for local development.
2. If you prefer a GUI, run LM Studio and use its local server on port 1234 instead.
3. For maximum performance control, build llama.cpp yourself and tune its configuration.
4. For a shared GPU server, serve with vLLM rather than a laptop-oriented tool.
5. Put Open WebUI in front of Ollama or any OpenAI-compatible endpoint for a chat interface.
6. Size your model to the hardware: 8B parameters quantized to 4 bits on 16 GB RAM; 30B+ only with a strong GPU or 32 GB+ Apple silicon; start quantization at Q4_K_M.

## Next actions

- [ ] Pick one runner, install it, and confirm you can hit its OpenAI-compatible endpoint on 11434 (Ollama) or 1234 (LM Studio) from a small script.
- [ ] Use this list as a checklist when choosing a serving layer for a project: laptop, single workstation, or shared GPU server.

## Caveats

- It is a bare list: no benchmarks, no latency or throughput numbers, no setup commands, no links to the projects.
- The hardware rules of thumb are unquantified (no tokens/sec, no exact quality loss from quantization) and not attributed to a source.
- The saved text is a sample written for a demo, so treat it as an orientation aid rather than tested guidance.
- No GPU memory figures are given, and there are no evaluation or serving-quality considerations beyond throughput.

## Mentioned

- Ollama · tool
- LM Studio · tool
- llama.cpp · repo
- vLLM · tool
- Open WebUI · tool

---
Source: [[Clippings/Local LLM tools worth knowing|Original note]] · [Open original](https://example.com/lists/local-llm-tools)

%% ai-curator: everything above this line is regenerated. Write your own notes below it. %%

## My notes

