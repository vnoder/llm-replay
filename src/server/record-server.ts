import http, { type Server } from 'node:http';
import { JsonlWriter } from '../core/jsonl.js';
import { hashRequest } from '../core/stable.js';
import {
  normalizeBody,
  readBody,
  selectRequestHeaders,
  sendJsonError,
} from '../core/http-util.js';
import type { RecordEntry } from '../core/types.js';
import { proxyRequest } from './proxy.js';

export interface RecordServerOptions {
  port: number;
  host?: string;
  /** 上游基地址，如 https://api.openai.com */
  upstream: string;
  /** 录制输出 JSONL 文件路径 */
  file: string;
  /** 覆盖发往上游的 Authorization Bearer */
  apiKey?: string;
  /** 打印每条录制日志（默认 true） */
  log?: boolean;
}

export interface StartedServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

/**
 * 录制模式服务器：反向代理到真实上游，把每个请求-响应对
 * （含 SSE chunk 与相对毫秒节奏）追加写入 JSONL。
 */
export function startRecordServer(opts: RecordServerOptions): Promise<StartedServer> {
  const log = opts.log !== false;
  const writer = new JsonlWriter(opts.file);
  let live = 0;

  const server = http.createServer(async (req, res) => {
    live += 1;
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    try {
      const rawBody = await readBody(req);
      const body = normalizeBody(rawBody, String(req.headers['content-type'] ?? ''));
      const hash = hashRequest(method, path, body);

      const upstreamAbort = new AbortController();
      res.on('close', () => upstreamAbort.abort());

      const proxied = await proxyRequest({
        upstream: opts.upstream,
        method,
        path,
        headers: req.headers,
        body: rawBody,
        clientRes: res,
        apiKey: opts.apiKey,
        abortSignal: upstreamAbort.signal,
      });

      const response: RecordEntry['response'] = {
        status: proxied.status,
        headers: proxied.headers,
      };
      if (proxied.sse) {
        response.sse = proxied.sse;
      } else if (proxied.body) {
        const ct = proxied.contentType;
        const text = proxied.body.toString('utf8');
        try {
          response.body = ct.includes('json') || text.trimStart().startsWith('{') || text.trimStart().startsWith('[')
            ? JSON.parse(text)
            : text;
        } catch {
          response.body = text;
        }
      }

      const id = await writer.append({
        hash,
        ts: Date.now(),
        request: {
          method,
          path,
          headers: selectRequestHeaders(req.headers),
          body,
        },
        response,
      });
      if (log) {
        const kind = response.sse ? `sse x${response.sse.length}` : typeof response.body;
        console.log(`[llm-replay record] #${id} ${method} ${path} -> ${proxied.status} (${kind})`);
      }
    } catch (err) {
      if (!res.headersSent) {
        sendJsonError(res, 502, `llm-replay record failed: ${err instanceof Error ? err.message : String(err)}`);
      } else {
        res.end();
      }
    } finally {
      live -= 1;
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({
        server,
        port,
        close: async () => {
          // 等在途请求收尾，保证录制完整落盘
          const deadline = Date.now() + 10_000;
          while (live > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
          await writer.close();
          server.closeAllConnections?.();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}
