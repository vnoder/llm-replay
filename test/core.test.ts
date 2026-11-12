import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseParser } from '../src/core/sse.js';
import { stableStringify, hashRequest } from '../src/core/stable.js';

test('SseParser 按事件切分并保留原文（含分隔空行）', () => {
  const p = new SseParser();
  const out = [
    ...p.push('data: {"a":1}\n\n'),
    ...p.push('event: x\ndata: b\n\n'),
    ...p.finish(),
  ];
  assert.deepEqual(out, ['data: {"a":1}\n\n', 'event: x\ndata: b\n\n']);
});

test('SseParser 事件跨 chunk 边界也能切分', () => {
  const p = new SseParser();
  const out = [
    ...p.push('data: {"a'),
    ...p.push('":1}\n\nda'),
    ...p.push('ta: [DONE]\n\n'),
  ];
  assert.deepEqual(out, ['data: {"a":1}\n\n', 'data: [DONE]\n\n']);
});

test('SseParser 兼容 \\r\\n 换行', () => {
  const p = new SseParser();
  const out = p.push('data: one\r\n\r\ndata: two\r\n\r\n');
  assert.deepEqual(out, ['data: one\r\n\r\n', 'data: two\r\n\r\n']);
});

test('SseParser 忽略纯空行，保留注释行', () => {
  const p = new SseParser();
  const out = p.push('\n\n: ping\n\ndata: x\n\n\n');
  assert.deepEqual(out, [': ping\n\n', 'data: x\n\n']);
});

test('stableStringify 与 key 顺序无关', () => {
  assert.equal(stableStringify({ a: 1, b: { d: 4, c: [3, { z: 1, y: 2 }] } }),
    stableStringify({ b: { c: [3, { y: 2, z: 1 }], d: 4 }, a: 1 }));
});

test('hashRequest 对同构请求稳定，对不同请求不同', () => {
  const h1 = hashRequest('POST', '/v1/chat/completions', { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] });
  const h2 = hashRequest('post', '/v1/chat/completions', { messages: [{ content: 'hi', role: 'user' }], model: 'gpt-4' });
  const h3 = hashRequest('POST', '/v1/chat/completions', { model: 'gpt-4', messages: [{ role: 'user', content: 'ho' }] });
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});
