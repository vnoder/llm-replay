import type { IncomingMessage, ServerResponse } from 'node:http';

/** hop-by-hop 头与按长度/编码相关的头，转发与录制时一律剔除 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'content-encoding',
]);

/** 读取并拼接请求体（请求体都很小，整包缓冲）。 */
export function readBody(req: IncomingMessage, limitBytes = 32 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/**
 * 请求体归一化：能解析成 JSON 就解析（哈希时 key 顺序无关），
 * 否则保留原始字符串；空 body 为 null。录制端与回放端共用此逻辑，
 * 保证同一请求在两端得到相同哈希。
 */
export function normalizeBody(body: Buffer, _contentType?: string): unknown {
  if (body.length === 0) return null;
  const text = body.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 过滤掉 hop-by-hop / 逐跳相关头。 */
export function filterHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/** 从录制条目里挑选要保存的请求头（脱敏：不含 Authorization）。 */
export function selectRequestHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['content-type', 'accept']) {
    const v = headers[key];
    if (v !== undefined) out[key] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/** 以 OpenAI 风格返回一个 JSON 错误响应。 */
export function sendJsonError(
  res: ServerResponse,
  status: number,
  message: string,
  type = 'invalid_request_error',
): void {
  const payload = JSON.stringify({ error: { message, type, param: null, code: null } });
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

/** 解析 body 为对象后的值序列化（录制响应/回放响应共用）。 */
export function bodyToBuffer(body: unknown, contentType?: string): Buffer {
  if (body === null || body === undefined) return Buffer.alloc(0);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(JSON.stringify(body), 'utf8');
}
