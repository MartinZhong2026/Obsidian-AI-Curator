import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat, estimateCost, listModels, ProviderError } from '../src/providers.ts';
import { ANALYSIS_SCHEMA } from '../src/analysis.ts';
import { deepseekReply, fakeTransport } from './helpers.ts';

const req = { system: 'sys', user: 'hello', schema: ANALYSIS_SCHEMA, maxTokens: 4000 };
const deepseek = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'sk-secret' };

test('DeepSeek request: JSON mode, thinking off, bearer key, no streaming', async () => {
  const t = fakeTransport(() => deepseekReply('{"ok":true}'));
  const r = await chat(deepseek, req, t);
  assert.equal(r.text, '{"ok":true}');
  assert.equal(r.inputTokens, 1800);
  const call = t.calls[0];
  assert.equal(call.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(call.headers!.Authorization, 'Bearer sk-secret');
  const body = JSON.parse(call.body!);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, 'system');
});

test('optional fields are dropped once if a compatible server rejects them', async () => {
  let n = 0;
  const t = fakeTransport((r) => (n++ === 0 ? { status: 400, text: '{"error":{"message":"unknown field thinking"}}' } : deepseekReply('{}')));
  await chat(deepseek, req, t);
  assert.equal(t.calls.length, 2);
  const second = JSON.parse(t.calls[1].body!);
  assert.equal(second.thinking, undefined);
  assert.equal(second.response_format, undefined);
});

test('errors are classified: auth is fatal, rate limits retryable, key never echoed', async () => {
  const t401 = fakeTransport(() => ({ status: 401, text: '{"error":{"message":"Authentication Fails (sk-secret is invalid)"}}' }));
  await assert.rejects(chat(deepseek, req, t401), (e: ProviderError) => e.fatal && !e.retryable && e.status === 401);
  const t429 = fakeTransport(() => ({ status: 429, text: 'slow down' }));
  await assert.rejects(chat(deepseek, req, t429), (e: ProviderError) => !e.fatal && e.retryable);
  const t402 = fakeTransport(() => ({ status: 402, text: '{"error":{"message":"Insufficient Balance"}}' }));
  await assert.rejects(chat(deepseek, req, t402), (e: ProviderError) => e.fatal && /Insufficient Balance/.test(e.message));
});

test('empty or truncated replies are retryable errors', async () => {
  const t = fakeTransport(() => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }) }));
  await assert.rejects(chat(deepseek, req, t), /cut off/);
});

test('remote endpoints must be https; localhost is allowed for local models', async () => {
  const t = fakeTransport(() => deepseekReply('{}'));
  await assert.rejects(chat({ ...deepseek, provider: 'custom', baseUrl: 'http://evil.example/v1' }, req, t), /https/);
  await assert.rejects(chat({ ...deepseek, provider: 'custom', baseUrl: 'https://user:pw@host/v1' }, req, t), /credentials/);
  await chat({ provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3', apiKey: '' }, req, t);
  assert.equal(t.calls.at(-1)!.headers!.Authorization, undefined);
});

test('missing key or model is reported before any network call', async () => {
  const t = fakeTransport(() => deepseekReply('{}'));
  await assert.rejects(chat({ ...deepseek, apiKey: '' }, req, t), (e: ProviderError) => e.fatal);
  await assert.rejects(chat({ ...deepseek, model: '' }, req, t), /model/);
  assert.equal(t.calls.length, 0);
});

test('Claude via the Anthropic SDK: structured output, low effort, refusal fallbacks', async () => {
  const t = fakeTransport(() => ({
    status: 200,
    text: JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"title":"x"}' }],
      usage: { input_tokens: 1200, output_tokens: 300 },
    }),
  }));
  const r = await chat({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', apiKey: 'sk-ant' }, req, t);
  assert.equal(r.text, '{"title":"x"}');
  assert.equal(r.outputTokens, 300);
  const call = t.calls[0];
  assert.match(call.url, /\/v1\/messages/);
  const auth = call.headers!['x-api-key'] ?? call.headers!['authorization'];
  assert.match(auth ?? '', /sk-ant/);
  assert.match(call.headers!['anthropic-beta'] ?? '', /server-side-fallback-2026-07-01/);
  const body = JSON.parse(call.body!);
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.thinking, undefined);
});

test('Claude refusals and HTTP errors map to ProviderError', async () => {
  const refusal = fakeTransport(() => ({ status: 200, text: JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }) }));
  await assert.rejects(chat({ provider: 'anthropic', baseUrl: '', model: 'claude-opus-5-5', apiKey: 'k' }, req, refusal), /declined/);
  const forbidden = fakeTransport(() => ({ status: 403, text: JSON.stringify({ type: 'error', error: { type: 'permission_error', message: 'Region not supported' } }) }));
  await assert.rejects(chat({ provider: 'anthropic', baseUrl: '', model: 'claude-opus-5-5', apiKey: 'k' }, req, forbidden), (e: ProviderError) => e.fatal && /Region/.test(e.message));
});

test('model listing and cost estimates', async () => {
  const t = fakeTransport(() => ({ status: 200, text: JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] }) }));
  assert.deepEqual(await listModels(deepseek, t), ['a', 'b']);
  assert.equal(estimateCost('deepseek-flash', 1_000_000, 1_000_000), 1.5);
  assert.equal(estimateCost('unknown-model', 10, 10), null);
  assert.equal(estimateCost('unknown-model', 1_000_000, 0, { input: 2, output: 0 }), 2);
});
