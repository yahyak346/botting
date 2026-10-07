import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, parseMonitor } from '../src/validate.ts';
import { isDiscordWebhook } from '../src/notify/discord.ts';

test('fills sensible defaults', () => {
  const m = parseMonitor({ kind: 'shopify', url: 'https://shop.test', include: 'dunk, jordan ,' });
  assert.equal(m.name, 'shop.test');
  assert.equal(m.intervalSec, 60);
  assert.equal(m.enabled, true);
  assert.deepEqual(m.include, ['dunk', 'jordan']);
});

test('rejects bad input', () => {
  assert.throws(() => parseMonitor({ kind: 'nope', url: 'https://a.test' }), ValidationError);
  assert.throws(() => parseMonitor({ kind: 'shopify', url: 'file:///etc/passwd' }), ValidationError);
  assert.throws(() => parseMonitor({ kind: 'shopify', url: 'https://a.test', intervalSec: 5 }), /intervalSec/);
  assert.throws(() => parseMonitor({ kind: 'page', url: 'https://a.test', pageMode: 'appears' }), /needs a keyword/);
  assert.throws(() => parseMonitor({ kind: 'shopify', url: 'https://a.test', webhookUrl: 'https://evil.test/x' }), /Discord/);
});

test('editing keeps the id and merges fields', () => {
  const m = parseMonitor({ kind: 'shopify', url: 'https://shop.test' });
  const edited = parseMonitor({ enabled: false }, m);
  assert.equal(edited.id, m.id);
  assert.equal(edited.enabled, false);
  assert.equal(edited.url, m.url);
});

test('recognises Discord webhooks', () => {
  assert.ok(isDiscordWebhook('https://discord.com/api/webhooks/123/abc_DEF-1'));
  assert.ok(isDiscordWebhook('https://discordapp.com/api/webhooks/123/abc'));
  assert.ok(!isDiscordWebhook('https://discord.com.evil.test/api/webhooks/123/abc'));
});
