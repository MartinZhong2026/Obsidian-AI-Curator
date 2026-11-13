---
title: "本地运行 LLM 的工具清单：Ollama、LM Studio、llama.cpp、vLLM"
source: "[[Clippings/Local LLM tools worth knowing]]"
url: "https://example.com/lists/local-llm-tools"
author: "Demo Curator"
published: "2026-09-15"
verdict: reference
score: 23
topic: "本地 LLM 部署"
type: resource-list
tags: ["local-llm", "ollama", "llama-cpp", "vllm", "quantization"]
status: unread
completeness: full
analyzed: 2026-11-13
model: "deepseek-flash"
ai-curator: 1
---

> [!note] 备查 · 23/100 — 工具名和端口、量化规则等事实性信息可留作速查，但无实测数据，不值得读原文。
> Ollama 适合快速上手本地推理，llama.cpp 提供最强的调优能力，vLLM 适合团队共享 GPU 服务器；8B 模型在 4-bit 量化下可在 16 GB 内存的笔记本上运行。
>
> 与读者构建和评估 LLM 应用的需求相关度中等：本地推理适合低成本迭代和隐私场景，但这份清单本身不含评测数据，无法支撑选型决策。

## 摘要

这是一份为演示用途编写的简短清单，列出五个在本机运行语言模型的工具：Ollama（一条命令下载模型，并在 11434 端口提供兼容 OpenAI 的 API）、LM Studio（带 GUI 的桌面应用，本地服务器使用端口 1234）、llama.cpp（许多工具底层依赖的 C/C++ 推理引擎）、vLLM（面向 GPU 的高吞吐服务）和 Open WebUI（可连接 Ollama 或任何兼容 OpenAI 的端点的聊天界面）。清单还给出粗略的硬件经验法则：8B 参数模型量化到 4 bit 后可在多数 16 GB 内存的笔记本上运行；30B 以上模型需要强 GPU 或 32 GB 以上的 Apple Silicon；Q4_K_M 是内存占用与质量之间常见的折中点。

## 核心观点

- Ollama 的价值在于开箱即用，并提供兼容 OpenAI 的 API，便于现有代码直接切换到本地模型
- llama.cpp 是生态底层：多数工具的推理能力源自它，调优选项最多，但需要自行编译和配置
- 工具选择应由硬件决定：笔记本用 Ollama 或 LM Studio，共享 GPU 服务器才考虑 vLLM
- 量化是用少量质量损失换取内存节省，Q4_K_M 是常见的默认选择
- 模型规模决定内存门槛：8B 约需 16 GB 内存（4-bit），30B 以上需要 32 GB 内存以上或强 GPU

## 实践方法

1. 用 Ollama 下载并运行模型：下载后即可通过 11434 端口使用兼容 OpenAI 的 API
2. 偏好图形界面时改用 LM Studio：在应用内浏览模型，本地服务器默认监听 1234 端口
3. 需要极致性能调优时选用 llama.cpp，自行编译并按硬件调整参数
4. 在共享 GPU 服务器上部署 vLLM 以获得高吞吐
5. 用 Open WebUI 连接 Ollama 或任意兼容 OpenAI 的端点，作为聊天前端
6. 按硬件选择模型规模：16 GB 内存的笔记本选 8B 级模型并量化到 4 bit（如 Q4_K_M）；30B 以上需要 32 GB 内存以上或强 GPU

## 下一步行动

- [ ] 在本机用 Ollama 拉取一个 8B 级 4-bit 量化模型，测一下在 11434 端口上的兼容 OpenAI 的 API 延迟，评估能否作为开发时替代云端 API 的本地测试端点
- [ ] 若手头有 32 GB 内存以上的 Apple Silicon 或 GPU 机器，对比 Ollama 与 llama.cpp 在同一模型上的 tokens/s 差异

## 局限与存疑

- 这是为演示编写的示例清单，并非实测或评测；各工具的性能、端口和兼容性说法都未给出验证来源或基准数据；没有说明具体模型的名称、量化命令和内存占用的实测值；内容篇幅很短，许多细节（安装步骤、故障排查、各工具对比）缺失。

## 提及

- Ollama · tool
- LM Studio · tool
- llama.cpp · repo
- vLLM · tool
- Open WebUI · tool

---
来源: [[Clippings/Local LLM tools worth knowing|原始笔记]] · [打开原文](https://example.com/lists/local-llm-tools)

%% ai-curator: everything above this line is regenerated. Write your own notes below it. %%

## 我的笔记

