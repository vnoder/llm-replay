import { createWriteStream } from 'node:fs';
import { open } from 'node:fs/promises';
import type { RecordEntry } from './types.js';

/**
 * JSONL 追加写入器：每个请求-响应对完成后立即落盘一行，进程中断不丢已录内容。
 */
export class JsonlWriter {
  private stream: ReturnType<typeof createWriteStream> | null = null;
  private seq = 0;
  private closed = false;

  constructor(private readonly file: string) {}

  private ensureStream() {
    if (!this.stream) {
      this.stream = createWriteStream(this.file, { flags: 'a' });
    }
    return this.stream;
  }

  /** 追加一行，返回分配的条目 id。 */
  async append(entry: Omit<RecordEntry, 'id'>): Promise<string> {
    if (this.closed) throw new Error('JsonlWriter already closed');
    this.seq += 1;
    const id = `rec-${String(this.seq).padStart(6, '0')}`;
    const line = JSON.stringify({ id, ...entry }) + '\n';
    const s = this.ensureStream();
    if (!s.write(line)) {
      await new Promise<void>((resolve, reject) => {
        s.once('drain', resolve);
        s.once('error', reject);
      });
    }
    return id;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    const s = this.stream;
    if (!s || s.destroyed || s.writableEnded) return Promise.resolve();
    this.stream = null;
    return new Promise((resolve, reject) => {
      s.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }
}

/**
 * 读入整个 JSONL 文件，返回按行序的 RecordEntry 数组（跳过空行与坏行并告警）。
 */
export async function readJsonl(file: string): Promise<RecordEntry[]> {
  const handle = await open(file, 'r');
  try {
    const entries: RecordEntry[] = [];
    let leftover = '';
    const buffer = Buffer.alloc(1 << 16);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      leftover += buffer.toString('utf8', 0, bytesRead);
      const lines = leftover.split('\n');
      leftover = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as RecordEntry);
        } catch {
          console.warn(`[llm-replay] 跳过无法解析的行: ${trimmed.slice(0, 80)}...`);
        }
      }
    }
    const tail = leftover.trim();
    if (tail) {
      try {
        entries.push(JSON.parse(tail) as RecordEntry);
      } catch {
        console.warn(`[llm-replay] 跳过无法解析的末行`);
      }
    }
    return entries;
  } finally {
    await handle.close();
  }
}
