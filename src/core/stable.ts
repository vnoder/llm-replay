import { createHash } from 'node:crypto';
import type { RequestPayload } from './types.js';

/**
 * 递归排序 key 后的 JSON 序列化，保证同构对象哈希一致。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * 请求哈希：sha256(method + "\n" + path + "\n" + stableStringify(body))。
 * body 为 null/字符串时直接序列化，保证任意请求都能得到稳定哈希。
 */
export function hashRequest(method: string, path: string, body: unknown): string {
  const h = createHash('sha256');
  h.update(method.toUpperCase() + '\n');
  h.update(path + '\n');
  h.update(typeof body === 'string' ? JSON.stringify(body) : stableStringify(body ?? null));
  return h.digest('hex');
}

/** 便捷封装：对 RequestPayload 计算哈希。 */
export function hashPayload(req: Pick<RequestPayload, 'method' | 'path' | 'body'>): string {
  return hashRequest(req.method, req.path, req.body);
}
