import type { ServerResponse } from 'node:http';
import { TextDecoder } from 'node:util';
import { SseParser, toSseChunks } from '../core/sse.js';
import type { SseChunk } from '../core/types.js';
import { filterHeaders, sendJsonError } from '../core/http-util.js';

/** 上游转发时捕获到的响应（capture=false 时字段为空壳） */
export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  contentType: string;
  /** 响应为 text/event-stream 时按序捕获的 chunk（含相对毫秒） */
  sse: SseChunk[] | null;
  /** 非流式响应的完整 body */
  body: Buffer | null;
}

export interface ProxyParams {
  /** 上游基地址，如 https://api.openai.com（会与请求 path 拼接） */
  upstream: string;
  method: string;
  /** 含查询串的路径，如 /v1/chat/completions */
  path: string;
  /** 客户端原始请求头 */
  headers: Record<string, string | string[] | undefined>;
  /** 已缓冲的请求体（可为空 Buffer） */
  body: Buffer;
  /** 要把响应写给谁的 ServerResponse */
  clientRes: ServerResponse;
  /** 覆盖上游 Authorization（--api-key）；不传则透传客户端的 */
  apiKey?: string;
  /** 客户端断开时中止上游请求 */
  abortSignal?: AbortSignal;
}

const base = (upstream: string) => upstream.replace(/\/+$/, '');

/**
 * 把请求转发到上游并把响应原样回给客户端；
 * 同时（对录制模式）按 content-type 捕获完整响应。
 * 上游错误（网络/5xx 前的失败）写 502 并抛出。
 */
export async function proxyRequest(params: ProxyParams): Promise<ProxyResult> {
  const { upstream, method, path, headers, body, clientRes, apiKey, abortSignal } = params;
  const url = base(upstream) + path;

  const outHeaders = filterHeaders(headers);
  if (apiKey !== undefined) {
    outHeaders['authorization'] = `Bearer ${apiKey}`;
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(url, {
      method,
      headers: outHeaders,
      body: body.length > 0 ? body : undefined,
      signal: abortSignal,
      redirect: 'manual',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJsonError(clientRes, 502, `llm-replay: upstream request failed: ${msg}`, 'api_error');
    throw err;
  }

  const contentType = String(upstreamRes.headers.get('content-type') ?? '');
  const resHeaders = filterHeaders(Object.fromEntries(upstreamRes.headers));

  const result: ProxyResult = {
    status: upstreamRes.status,
    headers: resHeaders,
    contentType,
    sse: null,
    body: null,
  };

  const isSse = contentType.includes('text/event-stream');

  if (!upstreamRes.body) {
    clientRes.writeHead(upstreamRes.status, resHeaders);
    clientRes.end();
    return result;
  }

  if (isSse) {
    // 流式：边透传边按事件切分捕获；t0 取响应可读时刻
    clientRes.writeHead(upstreamRes.status, resHeaders);
    const t0 = Date.now();
    const parser = new SseParser();
    const timed: Array<{ t: number; raw: string }> = [];
    const decoder = new TextDecoder('utf-8');
    const reader = upstreamRes.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.length > 0) clientRes.write(text);
        for (const raw of parser.push(text)) timed.push({ t: Date.now() - t0, raw });
      }
      const tail = decoder.decode();
      if (tail.length > 0) clientRes.write(tail);
      for (const raw of parser.push(tail).concat(parser.finish())) timed.push({ t: Date.now() - t0, raw });
      clientRes.end();
      result.sse = toSseChunks(timed);
    } catch (err) {
      // 上游中途断流：尽量把已收到的内容交付/记录
      clientRes.end();
      result.sse = toSseChunks(timed);
      throw err;
    }
    return result;
  }

  // 非流式：整包缓冲后回给客户端
  const buf = Buffer.from(await upstreamRes.arrayBuffer());
  clientRes.writeHead(upstreamRes.status, resHeaders);
  clientRes.end(buf);
  result.body = buf;
  return result;
}
