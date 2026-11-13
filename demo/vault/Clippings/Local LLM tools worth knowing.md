---
title: "Local LLM tools worth knowing"
source: "https://example.com/lists/local-llm-tools"
author:
  - "[[Demo Curator]]"
published: 2026-09-15
tags:
  - "clippings"
---
*Sample list written for the AI Curator demo.*

A short list of tools for running language models on your own machine.

- **Ollama** — one-command model downloads and a local OpenAI-compatible API on port 11434. Good default for macOS, Windows and Linux.
- **LM Studio** — desktop app with a model browser and a local server on port 1234. Friendly for people who prefer a GUI.
- **llama.cpp** — the C/C++ inference engine many other tools build on. Best performance tuning options, but you compile and configure it yourself.
- **vLLM** — high-throughput serving for GPUs; overkill for a laptop, great for a shared team server.
- **Open WebUI** — a chat interface that connects to Ollama or any OpenAI-compatible endpoint.

Rules of thumb: 8B-parameter models run on most recent laptops with 16 GB RAM when quantized to 4 bits. 30B+ models need a strong GPU or Apple silicon with 32 GB or more. Quantization saves memory at a small quality cost; Q4_K_M is a common balance.
