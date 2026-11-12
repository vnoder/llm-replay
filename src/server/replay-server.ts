import http, { type Server, type ServerResponse } from 'node:http';
import { readJsonl } from '../core/jsonl.js';
import { hashRequest } from '../core/stable.js';
import { bodyToBuffer, normalizeBody, readBody, sendJsonError } from '../core/http-util.js';
import type { MatchMode, OnMissMode, PaceMode, RecordEntry } from '../core/types.js';
import { proxyRequest } from './proxy.js';
import type { StartedServer } from './record-server.js';

export interface ReplayServerOptions {
  port: number;
  host?: string;
  /** 录制文件路径 */
  file: string;
  /** hash：按请求哈希精确匹配（同哈希多条按序轮转）；sequence：按录制顺序逐条回放 */
  match?: MatchMode;
  /** original：按录制节奏；instant：立即全量发出 */
  pace?: PaceMode;
  /** 节奏加速倍率（delay / speed），仅 pace=original 时生效 */
  speed?: number;
  /** 未命中策略：404 或转发上游 */
  onMiss?: OnMissMode;
  /** onMiss=proxy 时的上游地址 */
  upstream?: string;
  /** onMiss=proxy 时覆盖上游 Authorization */
  apiKey?: string;
  log?: boolean;
}

/**
 * 回放模式服务器：不连真实上游，从 JSONL 里按哈希或序列回放录制内容。
 */
export async function startReplayServer(opts: ReplayServerOptions): Promise<StartedServer> {
  const log = opts.log !== false;
  const match: MatchMode = opts.match ?? 'hash';
  const pace: PaceMode = opts.pace ?? 'original';
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const onMiss: OnMissMode = opts.onMiss ?? '404';

  if (onMiss === 'proxy' && !opts.upstream) {
    throw new Error(`--on-miss proxy 需要 --upstream 指定真实上游地址`);
  }

  const entries = await readJsonl(opts.file);
  if (entries.length === 0) {
    throw new Error(`录制文件为空或不存在: ${opts.file}`);
  }

  // 哈希索引：同哈希多条录制保持录制顺序，轮转消费
  const byHash = new Map<string, RecordEntry[]>();
  for (const e of entries) {
    const list = byHash.get(e.hash);
    if (list) list.push(e);
    else byHash.set(e.hash, [e]);
  }
  const rrCursor = new Map<string, number>();
  let seqCursor = 0;

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const path = req.url ?? '/';
    try {
      const rawBody = await readBody(req);
      const body = normalizeBody(rawBody, String(req.headers['content-type'] ?? ''));

      let entry: RecordEntry | undefined;
      if (match === 'sequence') {
        entry = seqCursor < entries.length ? entries[seqCursor++] : undefined;
      } else {
        const hash = hashRequest(method, path, body);
        const list = byHash.get(hash);
        if (list && list.length > 0) {
          const used = rrCursor.get(hash) ?? 0;
          entry = list[used % list.length];
          rrCursor.set(hash, used + 1);
        }
      }

      if (entry) {
        if (log) {
          const kind = entry.response.sse ? `sse x${entry.response.sse.length}` : 'body';
          console.log(`[llm-replay replay] HIT ${entry.id} ${method} ${path} -> ${entry.response.status} (${kind})`);
        }
        await sendEntry(entry, res, pace, speed);
        return;
      }

      // ---- 未命中 ----
      if (log) console.log(`[llm-replay replay] MISS ${method} ${path}`);
      if (onMiss === 'proxy' && opts.upstream) {
        const abort = new AbortController();
        res.on('close', () => abort.abort());
        await proxyRequest({
          upstream: opts.upstream,
          method,
          path,
          headers: req.headers,
          body: rawBody,
          clientRes: res,
          apiKey: opts.apiKey,
          abortSignal: abort.signal,
        });
        return;
      }
      sendJsonError(
        res,
        404,
        `llm-replay: no recorded response for ${method} ${path} (match=${match}${
          match === 'sequence' ? `, replayed ${entries.length}/${entries.length}` : ''
        })`,
      );
    } catch (err) {
      if (!res.headersSent) {
        sendJsonError(res, 500, `llm-replay replay failed: ${err instanceof Error ? err.message : String(err)}`);
      } else {
        res.end();
      }
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
        close: () => {
          server.closeAllConnections?.();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

/** 把一条录制响应对给客户端：SSE 按节奏重放，非流式整包返回。 */
async function sendEntry(entry: RecordEntry, res: ServerResponse, pace: PaceMode, speed: number): Promise<void> {
  const headers: Record<string, string> = { ...entry.response.headers };
  headers['x-llm-replay'] = `hit:${entry.id}`;

  const chunks = entry.response.sse;
  if (chunks && chunks.length > 0) {
    headers['content-type'] = headers['content-type'] ?? 'text/event-stream';
    delete headers['content-length'];
    res.writeHead(entry.response.status, headers);
    let aborted = false;
    res.on('close', () => {
      aborted = true;
    });
    let prev = 0;
    for (const c of chunks) {
      if (aborted) return; // 客户端断开，停止后续 chunk
      if (pace === 'original') {
        const delay = Math.max(0, c.t - prev) / speed;
        if (delay > 1) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, delay);
            function done() {
              clearTimeout(timer);
              res.off('close', done);
              resolve();
            }
            res.on('close', done);
          });
          if (aborted) return;
        }
      }
      prev = c.t;
      res.write(c.raw);
    }
    res.end();
    return;
  }

  const buf = bodyToBuffer(entry.response.body, headers['content-type']);
  if (buf.length > 0) headers['content-length'] = String(buf.length);
  res.writeHead(entry.response.status, headers);
  res.end(buf);
}
