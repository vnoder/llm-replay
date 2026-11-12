import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
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
 * 解析录制输出目标：
 * - 以 `.jsonl` 结尾 → 视为具体文件路径（父目录自动创建）
 * - 否则视为目录 → 自动取目录内最大序号 +1，命名 `NNN.jsonl`；
 *   传入 tag 时命名 `NNN-<tag>.jsonl`（任务含义，仅保留安全字符）
 * 目录内序号识别兼容 `NNN.jsonl` 与 `NNN-含义.jsonl` 两种形式。
 */
export async function resolveRecordOut(out: string, tag?: string): Promise<string> {
  if (out.toLowerCase().endsWith('.jsonl')) {
    const dir = out.replace(/[/\\][^/\\]+$/, '');
    if (dir && dir !== out) await mkdir(dir, { recursive: true });
    return out;
  }
  await mkdir(out, { recursive: true });
  let max = 0;
  for (const name of await readdir(out)) {
    const m = /^(\d+)(?:-.*)?\.jsonl$/i.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const seq = String(max + 1).padStart(3, '0');
  const safeTag = tag?.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return join(out, safeTag ? `${seq}-${safeTag}.jsonl` : `${seq}.jsonl`);
}

/**
 * 读入 JSONL：path 为文件则读该文件，为目录则按文件名序合并读取全部 `*.jsonl`。
 */
export async function readJsonl(path: string): Promise<RecordEntry[]> {
  const st = await stat(path).catch(() => {
    throw new Error(`录制文件不存在: ${path}`);
  });
  if (!st.isDirectory()) return readJsonlFile(path);

  const files = (await readdir(path)).filter((f) => f.toLowerCase().endsWith('.jsonl')).sort();
  if (files.length === 0) throw new Error(`录制目录为空（没有 *.jsonl）: ${path}`);
  const all: RecordEntry[] = [];
  for (const f of files) {
    // 合并时给 id 加文件名前缀（各文件内部 id 均从 rec-000001 起，避免重复）
    const prefix = f.replace(/\.jsonl$/i, '') + '/';
    all.push(...(await readJsonlFile(join(path, f), prefix)));
  }
  return all;
}

/**
 * 读入单个 JSONL 文件，返回按行序的 RecordEntry 数组（跳过空行与坏行并告警）。
 * idPrefix 用于目录合并时区分来源文件。
 */
async function readJsonlFile(file: string, idPrefix = ''): Promise<RecordEntry[]> {
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
          const e = JSON.parse(trimmed) as RecordEntry;
          if (idPrefix) e.id = idPrefix + e.id;
          entries.push(e);
        } catch {
          console.warn(`[llm-replay] 跳过无法解析的行: ${trimmed.slice(0, 80)}...`);
        }
      }
    }
    const tail = leftover.trim();
    if (tail) {
      try {
        const e = JSON.parse(tail) as RecordEntry;
        if (idPrefix) e.id = idPrefix + e.id;
        entries.push(e);
      } catch {
        console.warn(`[llm-replay] 跳过无法解析的末行`);
      }
    }
    return entries;
  } finally {
    await handle.close();
  }
}
