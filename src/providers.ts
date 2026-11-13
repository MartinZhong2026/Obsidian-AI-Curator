import Anthropic from '@anthropic-ai/sdk';

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface HttpResponse {
  status: number;
  text: string;
}
export type Http = (request: HttpRequest) => Promise<HttpResponse>;
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Transport {
  http: Http;
  /** fetch-compatible function for SDK clients (wraps Obsidian's requestUrl in the plugin). */
  fetch: FetchLike;
}

export type ProviderKind = 'openai' | 'anthropic';

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  needsKey: boolean;
  keyUrl?: string;
  /** Supports response_format: {type: "json_object"}. */
  jsonMode: boolean;
  local?: boolean;
}

export const PRESETS: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'], needsKey: true, keyUrl: 'https://platform.deepseek.com/api_keys', jsonMode: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], needsKey: true, keyUrl: 'https://platform.claude.com/settings/keys', jsonMode: true },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: '', models: [],
    needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', jsonMode: true },
  { id: 'gemini', name: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: '', models: [],
    needsKey: true, keyUrl: 'https://aistudio.google.com/apikey', jsonMode: true },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: '', models: [],
    needsKey: true, keyUrl: 'https://openrouter.ai/keys', jsonMode: true },
  { id: 'ollama', name: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', defaultModel: '', models: [],
    needsKey: false, jsonMode: true, local: true },
  { id: 'lmstudio', name: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', defaultModel: '', models: [],
    needsKey: false, jsonMode: false, local: true },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', defaultModel: '', models: [],
    needsKey: false, jsonMode: false },
];

export function preset(id: string): ProviderPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[PRESETS.length - 1];
}

/** USD per million tokens, list prices verified 2026-11-13. Estimates only: providers bill. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'deepseek-flash': { input: 0.30, output: 1.20 },
  'deepseek-v4-pro': { input: 1.32, output: 3.96 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
};

export interface ProviderConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface ChatRequest {
  system: string;
  user: string;
  /** JSON Schema for structured output; omit for free-form Markdown. */
  schema?: object;
  maxTokens: number;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export class ProviderError extends Error {
  status: number;
  /** Retrying the same request later may succeed. */
  retryable: boolean;
  /** Credentials or account problem: stop the queue until the user fixes it. */
  fatal: boolean;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
    this.retryable = status === 0 || status === 408 || status === 409 || status === 429 || status >= 500;
    this.fatal = status === 401 || status === 402 || status === 403;
  }
}

function errorMessage(status: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.message || parsed?.error || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    detail = body;
  }
  detail = String(detail).replace(/\s+/g, ' ').slice(0, 220);
  return `HTTP ${status}${detail ? ': ' + detail : ''}`;
}

function assertSafeEndpoint(baseUrl: string, local: boolean) {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new ProviderError('The API address is not a valid URL.', 400); }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback && !local) {
    throw new ProviderError('For safety, remote API addresses must use https://.', 400);
  }
  if (url.username || url.password) throw new ProviderError('Do not put credentials in the API address.', 400);
}

function trimSlash(url: string) { return url.replace(/\/+$/, ''); }

async function openaiChat(cfg: ProviderConfig, req: ChatRequest, t: Transport): Promise<ChatResult> {
  const p = preset(cfg.provider);
  assertSafeEndpoint(cfg.baseUrl, !!p.local);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
    max_tokens: req.maxTokens,
    stream: false,
  };
  if (req.schema && p.jsonMode) body.response_format = { type: 'json_object' };
  if (p.id === 'deepseek') body.thinking = { type: 'disabled' };
  if (p.id === 'openrouter') headers['X-Title'] = 'AI Curator for Obsidian';
  let res = await t.http({ url: trimSlash(cfg.baseUrl) + '/chat/completions', method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status === 400 && (body.response_format || body.thinking)) {
    // Some compatible servers reject optional fields; retry once with the plain request.
    delete body.response_format; delete body.thinking;
    res = await t.http({ url: trimSlash(cfg.baseUrl) + '/chat/completions', method: 'POST', headers, body: JSON.stringify(body) });
  }
  if (res.status < 200 || res.status >= 300) throw new ProviderError(errorMessage(res.status, res.text), res.status);
  let data: any;
  try { data = JSON.parse(res.text); } catch { throw new ProviderError('The provider returned an unreadable response.', 502); }
  const choice = data?.choices?.[0];
  const text = choice?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    throw new ProviderError(choice?.finish_reason === 'length' ? 'The reply was cut off (output limit).' : 'The provider returned an empty reply.', 502);
  }
  return {
    text,
    inputTokens: Number(data?.usage?.prompt_tokens) || 0,
    outputTokens: Number(data?.usage?.completion_tokens) || 0,
    model: String(data?.model || cfg.model),
  };
}

// Server-side refusal fallbacks are available on these Claude models.
const CLAUDE_FALLBACK_MODELS = /^claude-(opus-5-5|sonnet-5-5|fable-5)/;

function anthropicClient(cfg: ProviderConfig, t: Transport) {
  assertSafeEndpoint(cfg.baseUrl || 'https://api.anthropic.com', false);
  return new Anthropic({
    apiKey: cfg.apiKey,
    baseURL: trimSlash(cfg.baseUrl || 'https://api.anthropic.com'),
    fetch: t.fetch as any,
    // Requests go through Obsidian's own network layer, not a web page; the key never leaves this device except to Anthropic.
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: cfg.timeoutMs ?? 180_000,
  });
}

async function anthropicChat(cfg: ProviderConfig, req: ChatRequest, t: Transport): Promise<ChatResult> {
  const client = anthropicClient(cfg, t);
  const params: any = {
    model: cfg.model,
    max_tokens: Math.max(req.maxTokens, 16000),
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    output_config: { effort: 'low', ...(req.schema ? { format: { type: 'json_schema', schema: req.schema } } : {}) },
  };
  if (CLAUDE_FALLBACK_MODELS.test(cfg.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  try {
    const response: any = await client.beta.messages.create(params);
    if (response.stop_reason === 'refusal') throw new ProviderError('The model declined to analyze this item.', 422);
    const text = (response.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text.trim()) throw new ProviderError('The provider returned an empty reply.', 502);
    return {
      text,
      inputTokens: Number(response.usage?.input_tokens) || 0,
      outputTokens: Number(response.usage?.output_tokens) || 0,
      model: String(response.model || cfg.model),
    };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Anthropic.APIError) {
      const status = typeof error.status === 'number' ? error.status : 0;
      const msg = (error as any).error?.error?.message || error.message;
      throw new ProviderError(`HTTP ${status || 'error'}: ${String(msg).slice(0, 220)}`, status);
    }
    throw new ProviderError(error instanceof Error ? error.message : String(error), 0);
  }
}

export async function chat(cfg: ProviderConfig, req: ChatRequest, t: Transport): Promise<ChatResult> {
  if (!cfg.model) throw new ProviderError('Choose a model in AI Curator settings.', 400);
  const p = preset(cfg.provider);
  if (p.needsKey && !cfg.apiKey) throw new ProviderError('Add your API key in AI Curator settings.', 401);
  return p.kind === 'anthropic' ? anthropicChat(cfg, req, t) : openaiChat(cfg, req, t);
}

export async function listModels(cfg: ProviderConfig, t: Transport): Promise<string[]> {
  const p = preset(cfg.provider);
  if (p.kind === 'anthropic') {
    const client = anthropicClient(cfg, t);
    const ids: string[] = [];
    for await (const model of client.models.list({ limit: 100 } as any)) ids.push(model.id);
    return ids;
  }
  assertSafeEndpoint(cfg.baseUrl, !!p.local);
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  const res = await t.http({ url: trimSlash(cfg.baseUrl) + '/models', method: 'GET', headers });
  if (res.status < 200 || res.status >= 300) throw new ProviderError(errorMessage(res.status, res.text), res.status);
  const data = JSON.parse(res.text);
  const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list.map((m) => String(m.id ?? m.name ?? '')).filter(Boolean).sort();
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number, custom?: { input: number; output: number } | null): number | null {
  const price = custom && (custom.input > 0 || custom.output > 0) ? custom : PRICES[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
