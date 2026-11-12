import type { SseChunk } from './types.js';

/**
 * 增量 SSE 解析器：喂入文本片段，按事件边界（空行）切分并产出完整事件的原始文本。
 * 保留原始字节（含 data:/event:/注释行与 `\n`/`\r\n` 换行），回放时原样重发。
 */
export class SseParser {
  private buffer = '';
  private done = false;

  /** 喂入一段解码后的文本，返回本次切出的完整事件（raw 含最后一行的换行符）。 */
  push(chunk: string): string[] {
    if (this.done) throw new Error('SseParser already finished');
    this.buffer += chunk;
    const events: string[] = [];
    let end: number | null;
    while ((end = findEventEnd(this.buffer)) !== null) {
      // raw 含结尾空行分隔符，回放时原样重发即是合法 SSE 帧
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      // 纯空行不是事件；注释行（: ping）等非空内容都算事件
      if (raw.trim().length > 0) events.push(raw);
    }
    return events;
  }

  /** 流结束：冲刷残留缓冲（兼容上游不写结尾空行的情况）。 */
  finish(): string[] {
    this.done = true;
    const rest = this.buffer;
    this.buffer = '';
    return rest.trim().length > 0 ? [rest] : [];
  }
}

/**
 * 找到缓冲中第一个事件的结束空行，返回含分隔符在内的事件总长度。
 * SSE 规范：事件由若干行组成，以空行（`\n` 或 `\r\n`）结尾，
 * 因此分隔符是 `\n\n` 或 `\n\r\n`。
 */
function findEventEnd(buf: string): number | null {
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] !== '\n') continue;
    if (buf[i + 1] === '\n') return i + 2;
    if (buf[i + 1] === '\r' && buf[i + 2] === '\n') return i + 3;
  }
  return null;
}

/**
 * 把一批带时间戳的原始事件文本规整为 SseChunk：以首事件为 t=0。
 */
export function toSseChunks(rawEvents: Array<{ t: number; raw: string }>): SseChunk[] {
  if (rawEvents.length === 0) return [];
  const base = rawEvents[0].t;
  return rawEvents.map((e) => ({ t: Math.max(0, e.t - base), raw: e.raw }));
}
