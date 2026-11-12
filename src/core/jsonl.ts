import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, stat, writeFile } from 'node:fs/promises';
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

export interface CaseMeta {
  /** 用例名（NNN-tag 形式，由 resolveRecordOut 分配） */
  caseName: string;
  /** 任务含义 */
  tag: string;
  /** 上游基地址（仅取 host 展示，不含任何密钥） */
  upstream: string;
}

/**
 * 为新用例目录生成 README.md 骨架（已存在时不覆盖）。
 */
export async function writeCaseReadme(caseDir: string, meta: CaseMeta): Promise<void> {
  const readme = join(caseDir, 'README.md');
  try {
    await stat(readme);
    return; // 已有说明，保留用户内容
  } catch {
    /* 不存在则生成 */
  }
  let host = meta.upstream;
  try {
    host = new URL(meta.upstream).host;
  } catch {
    /* 保持原样 */
  }
  const text = `# ${meta.caseName}

## 用途

${meta.tag}（录制于 ${new Date().toISOString().slice(0, 10)}，上游 ${host}）

## 回放

\`\`\`bash
node dist/src/cli.js replay -p 8788 -f assets/${meta.caseName} -m sequence --pace instant
\`\`\`

多轮 agent 会话用 \`-m sequence\`（LLM 输出不可复现，哈希仅首轮有效）；单轮/纯 API 用例可用默认 hash 模式。

## 测试步骤

1. （待补充：准备夹具/工作区，启动被测 agent 应用，指向 http://127.0.0.1:8788/v1）
2. （待补充：执行的操作）

## 预期结果

（待补充）

## 录制原始命令

（见回放服务器启动日志 / 由录制者补记；API key 不入库）
`;
  await writeFile(readme, text, 'utf8');
}

/**
 * 解析录制输出目标：
 * - 以 `.jsonl` 结尾 → 视为具体文件路径（父目录自动创建）
 * - 否则视为用例根目录：
 *   - 传 tag → 创建用例目录 `NNN-<tag>/`（含 session.jsonl 与 README.md 骨架）
 *   - 不传 tag → 扁平文件 `NNN.jsonl`（快速录制）
 * 序号识别兼容扁平 `NNN.jsonl`、`NNN-含义.jsonl` 与用例目录 `NNN-含义/`，续接取最大值。
 */
export async function resolveRecordOut(out: string, tag?: string, upstream?: string): Promise<string> {
  if (out.toLowerCase().endsWith('.jsonl')) {
    const dir = out.replace(/[/\\][^/\\]+$/, '');
    if (dir && dir !== out) await mkdir(dir, { recursive: true });
    return out;
  }
  await mkdir(out, { recursive: true });
  let max = 0;
  for (const ent of await readdir(out, { withFileTypes: true })) {
    const pattern = ent.isDirectory() ? /^(\d+)(?:-.*)?$/ : /^(\d+)(?:-.*)?\.jsonl$/i;
    const m = pattern.exec(ent.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const seq = String(max + 1).padStart(3, '0');
  const safeTag = tag?.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safeTag) return join(out, `${seq}.jsonl`);
  const caseName = `${seq}-${safeTag}`;
  const caseDir = join(out, caseName);
  await mkdir(caseDir, { recursive: true });
  await writeCaseReadme(caseDir, { caseName, tag: safeTag, upstream: upstream ?? '' });
  return join(caseDir, 'session.jsonl');
}

/**
 * 读入 JSONL：path 为文件则读该文件；为目录则按名称序合并：
 * - 目录内的 `*.jsonl` 扁平文件（前缀 = 文件名）
 * - 一级子目录（用例目录）内的全部 `*.jsonl`（前缀 = 用例目录名）
 */
export async function readJsonl(path: string): Promise<RecordEntry[]> {
  const st = await stat(path).catch(() => {
    throw new Error(`录制文件不存在: ${path}`);
  });
  if (!st.isDirectory()) return readJsonlFile(path);

  const all: RecordEntry[] = [];
  const ents = (await readdir(path, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const ent of ents) {
    if (ent.isFile() && ent.name.toLowerCase().endsWith('.jsonl')) {
      all.push(...(await readJsonlFile(join(path, ent.name), ent.name.replace(/\.jsonl$/i, '') + '/')));
    } else if (ent.isDirectory()) {
      // 用例目录：内部 jsonl 统一以用例名作前缀
      for (const inner of (await readdir(join(path, ent.name), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        if (inner.isFile() && inner.name.toLowerCase().endsWith('.jsonl')) {
          all.push(...(await readJsonlFile(join(path, ent.name, inner.name), ent.name + '/')));
        }
      }
    }
  }
  if (all.length === 0) throw new Error(`录制目录为空（没有 *.jsonl）: ${path}`);
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
