#!/usr/bin/env node
/**
 * llm-replay CLI
 *
 *   llm-replay record  -p 9000 -u https://api.openai.com -o session.jsonl [--api-key KEY]
 *   llm-replay replay  -p 9000 -f session.jsonl [--match hash|sequence] [--pace original|instant]
 *                      [--speed 2] [--on-miss 404|proxy] [-u URL] [--api-key KEY]
 *   llm-replay inspect -f session.jsonl
 */
import { existsSync } from 'node:fs';
import { startRecordServer } from './server/record-server.js';
import { startReplayServer } from './server/replay-server.js';
import { readJsonl } from './core/jsonl.js';
import type { MatchMode, OnMissMode, PaceMode } from './core/types.js';

const USAGE = `llm-replay — OpenAI 协议兼容的 LLM 录制/回放服务器

用法:
  llm-replay record  [选项]        录制模式：反向代理真实上游，保存请求-响应对
  llm-replay replay  [选项]        回放模式：独立假服务器，从录制文件回放
  llm-replay inspect [选项]        查看录制文件内容概要

record 选项:
  -u, --upstream <url>     真实上游基地址，如 https://api.openai.com（必填）
  -o, --out <file>         录制输出 JSONL 路径（默认 session.jsonl）
  -p, --port <port>        监听端口（默认 8787，0=随机）
      --host <host>        监听地址（默认 127.0.0.1）
      --api-key <key>      覆盖发往上游的 Authorization: Bearer <key>
                            （客户端可用任意假 key，代理层注入真实 key）
      --no-log             不打印每条录制日志

replay 选项:
  -f, --file <file>        录制 JSONL 文件（必填）
  -p, --port <port>        监听端口（默认 8788，0=随机）
      --host <host>        监听地址（默认 127.0.0.1）
  -m, --match <mode>       匹配模式：hash=按请求哈希精确匹配（默认，同哈希多条
                            按录制顺序轮转）；sequence=忽略请求内容按录制顺序逐条回放
      --pace <mode>        流式回放节奏：original=按录制原始节奏（默认）；
                            instant=立即全量发出
      --speed <n>          节奏加速倍率，延时/n（默认 1；仅 pace=original 生效）
      --on-miss <mode>     未命中策略：404（默认）或 proxy=转发到 --upstream
  -u, --upstream <url>     --on-miss proxy 时的真实上游地址
      --api-key <key>      proxy 转发时覆盖上游 Authorization
      --no-log             不打印命中/未命中日志

inspect 选项:
  -f, --file <file>        要查看的录制 JSONL 文件（必填）

示例:
  # 录制：应用把 base_url 指到 http://127.0.0.1:8787/v1
  llm-replay record -p 8787 -u https://api.openai.com -o chatgpt.jsonl --api-key sk-real-key

  # 回放：哈希匹配 + 原始节奏
  llm-replay replay -f chatgpt.jsonl -p 8788

  # 回放：序列模式 + 10 倍速
  llm-replay replay -f chatgpt.jsonl -m sequence --pace original --speed 10

  # 回放：未命中转发上游（录制文件里没有的请求透传真实 API）
  llm-replay replay -f chatgpt.jsonl --on-miss proxy -u https://api.openai.com --api-key sk-real-key

支持的端点（录制透传一切路径，回放取决于录制内容）:
  POST /v1/chat/completions   （stream=true 流式 SSE / 非流式）
  POST /v1/embeddings
  GET  /v1/models
  以及其他 OpenAI 兼容路径
`;

interface Args {
  _: string[];
  flags: Map<string, string | boolean>;
}

function parseArgv(argv: string[]): Args {
  const _: string[] = [];
  const flags = new Map<string, string | boolean>();
  const valueOpts = new Set([
    'u', 'upstream', 'o', 'out', 'p', 'port', 'host', 'api-key', 'api_key',
    'f', 'file', 'm', 'match', 'pace', 'speed', 'on-miss', 'on_miss',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) {
      _.push(a);
      continue;
    }
    let name = a.replace(/^--?/, '');
    let inlineVal: string | undefined;
    const eq = name.indexOf('=');
    if (eq !== -1) {
      inlineVal = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    name = name.toLowerCase();
    if (name === 'h' || name === 'help') {
      flags.set('help', true);
      continue;
    }
    if (valueOpts.has(name)) {
      const v = inlineVal ?? argv[++i];
      if (v === undefined) fail(`选项 --${name} 需要一个值`);
      flags.set(name, v);
    } else {
      flags.set(name, true); // 布尔旗标，如 --no-log（值 no-log=true）
    }
  }
  return { _, flags };
}

function needFile(flags: Map<string, string | boolean>): string {
  const f = flags.get('f') ?? flags.get('file');
  if (typeof f !== 'string' || f.length === 0) fail(`缺少 -f/--file 参数\n\n${USAGE}`);
  if (!existsSync(f)) fail(`录制文件不存在: ${f}`);
  return f;
}

function getPort(flags: Map<string, string | boolean>, dflt: number): number {
  const v = flags.get('p') ?? flags.get('port');
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) fail(`无效端口: ${v}`);
  return n;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function holdForever(servers: Array<() => Promise<void>>): void {
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    for (const close of servers) await close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help') {
    console.log(USAGE);
    return;
  }
  const { _, flags } = parseArgv(argv);
  const command = _[0];

  if (flags.get('help') === true) {
    console.log(USAGE);
    return;
  }

  if (command === 'record') {
    const upstream = flags.get('u') ?? flags.get('upstream');
    if (typeof upstream !== 'string' || upstream.length === 0) fail(`record 需要 -u/--upstream 参数\n\n${USAGE}`);
    const outRaw = (flags.get('o') ?? flags.get('out')) ?? 'session.jsonl';
    if (typeof outRaw !== 'string' || outRaw.length === 0) fail(`无效的 -o/--out 参数`);
    const out = outRaw;
    const port = getPort(flags, 8787);
    const host = typeof flags.get('host') === 'string' ? String(flags.get('host')) : undefined;
    const apiKey = typeof flags.get('api-key') === 'string' ? String(flags.get('api-key')) : undefined;
    const log = flags.get('no-log') !== true;

    const started = await startRecordServer({ port, host, upstream, file: out, apiKey, log });
    console.log(
      `[llm-replay] 录制模式已启动 http://${host ?? '127.0.0.1'}:${started.port} -> ${upstream}  (输出: ${out})`,
    );
    console.log(`[llm-replay] 把应用的 base_url 指到 http://${host ?? '127.0.0.1'}:${started.port}/v1 ，Ctrl+C 结束录制`);
    holdForever([started.close]);
    return;
  }

  if (command === 'replay') {
    const file = needFile(flags);
    const port = getPort(flags, 8788);
    const host = typeof flags.get('host') === 'string' ? String(flags.get('host')) : undefined;
    const matchRaw = flags.get('m') ?? flags.get('match');
    if (typeof matchRaw === 'boolean' || (matchRaw !== undefined && matchRaw !== 'hash' && matchRaw !== 'sequence')) {
      fail(`--match 只能是 hash 或 sequence，收到: ${matchRaw}`);
    }
    const match = (matchRaw ?? 'hash') as MatchMode;
    const paceRaw = flags.get('pace');
    if (paceRaw !== undefined && paceRaw !== 'original' && paceRaw !== 'instant') {
      fail(`--pace 只能是 original 或 instant，收到: ${paceRaw}`);
    }
    const pace = (paceRaw ?? 'original') as PaceMode;
    let speed = 1;
    const speedRaw = flags.get('speed');
    if (speedRaw !== undefined) {
      speed = Number(speedRaw);
      if (!Number.isFinite(speed) || speed <= 0) fail(`--speed 需为正数，收到: ${speedRaw}`);
    }
    const missRaw = flags.get('on-miss') ?? flags.get('on_miss');
    if (missRaw !== undefined && missRaw !== '404' && missRaw !== 'proxy') {
      fail(`--on-miss 只能是 404 或 proxy，收到: ${missRaw}`);
    }
    const onMiss = (missRaw ?? '404') as OnMissMode;
    const upstream = flags.get('u') ?? flags.get('upstream');
    const apiKey = typeof flags.get('api-key') === 'string' ? String(flags.get('api-key')) : undefined;
    const log = flags.get('no-log') !== true;

    const started = await startReplayServer({
      port, host, file, match, pace, speed, onMiss,
      upstream: typeof upstream === 'string' && upstream.length > 0 ? upstream : undefined,
      apiKey, log,
    });
    const missDesc = onMiss === 'proxy' ? `未命中转发 ${upstream}` : '未命中返回 404';
    console.log(
      `[llm-replay] 回放模式已启动 http://${host ?? '127.0.0.1'}:${started.port}  ` +
        `(文件: ${file}, match=${match}, pace=${pace}${pace === 'original' && speed !== 1 ? ` x${speed}` : ''}, ${missDesc})`,
    );
    holdForever([started.close]);
    return;
  }

  if (command === 'inspect') {
    const file = needFile(flags);
    const entries = await readJsonl(file);
    console.log(`录制文件: ${file}  共 ${entries.length} 条\n`);
    for (const e of entries) {
      const kind = e.response.sse
        ? `sse(${e.response.sse.length} chunks, ${(e.response.sse[e.response.sse.length - 1]?.t ?? 0)}ms)`
        : typeof e.response.body === 'object' && e.response.body !== null
          ? 'json'
          : 'text';
      console.log(
        `${e.id}  ${e.request.method.padEnd(4)} ${e.request.path.padEnd(34)} -> ${String(e.response.status).padEnd(3)} ${kind.padEnd(10)} hash=${e.hash.slice(0, 12)}…`,
      );
    }
    return;
  }

  fail(`未知命令: ${command}\n\n${USAGE}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
