import test from 'node:test';
import assert from 'node:assert/strict';
import { ZH, setUiLanguage, translate } from '../src/i18n.ts';
import { migrateSettings } from '../src/settings.ts';

test('English and Chinese interfaces interpolate values without translating saved content', () => {
  setUiLanguage('en-US');
  assert.equal(translate('Reading inbox'), 'Reading inbox');
  assert.equal(translate('Connected to {0}.', 'local model'), 'Connected to local model.');
  setUiLanguage('zh-TW');
  assert.equal(translate('Reading inbox'), '阅读收件箱');
  assert.equal(translate('Connected to {0}.', 'Read next'), '已连接到 Read next。');
  assert.equal(translate('Unknown provider diagnostic'), 'Unknown provider diagnostic');
  setUiLanguage('en');
});

test('Chinese translations preserve every interpolation placeholder', () => {
  const tokens = (s: string) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
  for (const [key, value] of Object.entries(ZH)) assert.deepEqual(tokens(value), tokens(key), key);
});

test('settings migration keeps only known settings and provider fields', () => {
  const settings = migrateSettings({
    uiLanguage: 'zh', language: 'en', apiKey: 'private', customSecret: 'private',
    providers: { deepseek: { apiKey: 'private', model: 'my-model', secretId: 'vault-secret' } },
  });
  assert.equal(settings.uiLanguage, 'zh');
  assert.equal(settings.language, 'en');
  assert.equal(settings.providers.deepseek.model, 'my-model');
  assert.equal(JSON.stringify(settings).includes('private'), false);
  assert.equal(migrateSettings({ uiLanguage: 'invalid' }).uiLanguage, 'auto');
});
