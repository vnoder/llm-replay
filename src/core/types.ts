/**
 * 录制格式定义：JSONL 每行一个 RecordEntry。
 */

/** 一个 SSE 事件：相对第一个事件的毫秒偏移 + 原始报文（含尾部空行分隔符） */
export interface SseChunk {
  /** 相对首个 chunk 的毫秒偏移（首个为 0） */
  t: number;
  /** 原始事件文本，如 `data: {...}\n\n`，回放时原样重发 */
  raw: string;
}

/** 已捕获的请求负载 */
export interface RequestPayload {
  method: string;
  /** 含查询串的路径，如 /v1/chat/completions */
  path: string;
  /** 精选的请求头（content-type 等，不含 Authorization） */
  headers: Record<string, string>;
  /** 解析后的 JSON body；无法解析时为原始字符串；无 body 时为 null */
  body: unknown;
}

/** 已捕获的响应负载 */
export interface ResponsePayload {
  status: number;
  /** 精选的响应头（content-type 等，不含 hop-by-hop 头） */
  headers: Record<string, string>;
  /** 非流式响应体（优先解析为 JSON，否则原始字符串） */
  body?: unknown;
  /** 流式响应（text/event-stream）按序捕获的 SSE chunk */
  sse?: SseChunk[];
}

/** JSONL 一行：一个请求-响应对 */
export interface RecordEntry {
  /** 递增序号，如 rec-000001 */
  id: string;
  /** 请求哈希：sha256(method + "\n" + path + "\n" + stableBody) 的 hex */
  hash: string;
  /** 录制完成时刻的 Unix 毫秒 */
  ts: number;
  request: RequestPayload;
  response: ResponsePayload;
}

/** 回放服务器的匹配模式 */
export type MatchMode = 'hash' | 'sequence';

/** 流式回放节奏 */
export type PaceMode = 'original' | 'instant';

/** 未命中处理策略 */
export type OnMissMode = '404' | 'proxy';
