# llm-replay

OpenAI 协议兼容的 LLM **录制 / 回放**服务器。Node.js + TypeScript，**零运行时依赖**（Node ≥ 18.17）。

- **录制模式**：反向代理，把请求原样转发到真实上游（如 `https://api.openai.com`），把每个请求-响应对——包括流式 SSE 的每个 chunk 及其相对到达时间——逐行存入 JSONL。
- **回放模式**：独立假服务器，不连任何真实 API。按**请求哈希精确匹配**，或**按录制顺序逐条**回放；流式响应可按**原始节奏**或**加速**重放；未命中时可报 404 或转发真实上游。

支持端点（录制透传一切路径，回放取决于录制内容）：

| 端点 | 说明 |
|---|---|
| `POST /v1/chat/completions` | `stream: true` 流式 SSE 与非流式 |
| `POST /v1/embeddings` | 非流式 |
| `GET /v1/models` | 非流式 |
| 其他 OpenAI 兼容路径 | 录制模式照常透传 |

## 安装与构建

```bash
npm install
npm run build     # tsc -> dist/
npm test          # 单元 + 端到端测试
```

CLI 入口：`node dist/src/cli.js`（下文简写 `llm-replay`，可 `npm link` 后直接使用）。

## 快速上手（无需真实 API key）

```bash
# 终端 1：假上游
node demo/fake-upstream.mjs 8901

# 终端 2：录制（把请求打到 8902，代理层注入假 key 也可）
node dist/src/cli.js record -p 8902 -u http://127.0.0.1:8901 -o demo.jsonl --api-key anything

# 终端 3：随便发几个请求
curl -N -X POST http://127.0.0.1:8902/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"fake-model","stream":true,"messages":[{"role":"user","content":"hi"}]}'
curl http://127.0.0.1:8902/v1/models
# Ctrl+C 结束录制

# 终端 2：回放（打到 8903 的请求会得到与上游一模一样的响应）
node dist/src/cli.js replay -p 8903 -f demo.jsonl
```

## CLI 用法

```
llm-replay record  [选项]        录制模式：反向代理真实上游，保存请求-响应对
llm-replay replay  [选项]        回放模式：独立假服务器，从录制文件回放
llm-replay inspect [选项]        查看录制文件内容概要
```

### record

```bash
llm-replay record -p 8787 -u https://api.openai.com -o session.jsonl --api-key sk-real-key
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `-u, --upstream <url>` | （必填） | 真实上游基地址，请求 path 原样拼接其后 |
| `-o, --out <file>` | `session.jsonl` | 录制输出 JSONL 路径（追加写，Ctrl+C 落盘） |
| `-p, --port <port>` | `8787` | 监听端口（`0` = 随机） |
| `--host <host>` | `127.0.0.1` | 监听地址 |
| `--api-key <key>` | 透传客户端的 | 覆盖发往上游的 `Authorization: Bearer <key>`。应用端随便填个假 key，真实密钥只留在录制进程 |
| `--no-log` | | 不打印每条录制日志 |

把应用的 `base_url` 指到 `http://127.0.0.1:8787/v1`，正常跑一遍业务即完成录制。`Ctrl+C` 结束，录制内容即时落盘。

### replay

```bash
llm-replay replay -f session.jsonl -p 8788                     # 哈希匹配 + 原始节奏
llm-replay replay -f session.jsonl -m sequence --speed 10      # 序列模式 + 10 倍速
llm-replay replay -f session.jsonl --on-miss proxy \
                -u https://api.openai.com --api-key sk-real-key  # 未命中转发真实上游
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `-f, --file <file>` | （必填） | 录制 JSONL 文件 |
| `-p, --port <port>` | `8788` | 监听端口 |
| `--host <host>` | `127.0.0.1` | 监听地址 |
| `-m, --match <mode>` | `hash` | `hash`：按请求哈希（method + path + 归一化 body）精确匹配；同一哈希有多条录制时按录制顺序轮转。`sequence`：忽略请求内容，按录制顺序逐条回放，放完即未命中 |
| `--pace <mode>` | `original` | `original`：流式按录制的 chunk 间隔重放；`instant`：立即全量发出 |
| `--speed <n>` | `1` | 节奏加速倍率（延时 ÷ n，n > 0），仅 `pace=original` 生效 |
| `--on-miss <mode>` | `404` | `404`：返回 OpenAI 风格错误 JSON；`proxy`：转发到 `-u` 指定的真实上游（响应不录制） |
| `-u, --upstream <url>` | | `--on-miss proxy` 时的上游地址 |
| `--api-key <key>` | | proxy 转发时覆盖上游 Authorization |
| `--no-log` | | 不打印命中/未命中日志 |

回放命中的响应带 `x-llm-replay: hit:<id>` 响应头，便于调试。

### inspect

```bash
llm-replay inspect -f session.jsonl
# rec-000001  POST /v1/chat/completions  -> 200 sse(6 chunks, 452ms) hash=73e15b5682a3…
# rec-000002  GET  /v1/models            -> 200 json                    hash=c1d5b359e983…
```

## 录制格式（JSONL）

每行一个请求-响应对：

```jsonc
{
  "id": "rec-000001",
  "hash": "sha256hex…",            // method + path + 归一化 body（key 排序后序列化）
  "ts": 1760000000000,
  "request": {
    "method": "POST",
    "path": "/v1/chat/completions",
    "headers": { "content-type": "application/json" },  // 不含 Authorization
    "body": { "model": "gpt-4", "stream": true, "messages": [ … ] }
  },
  "response": {
    "status": 200,
    "headers": { "content-type": "text/event-stream; charset=utf-8" },
    "sse": [                        // 流式响应：事件原文 + 相对毫秒
      { "t": 0,   "raw": "data: {…delta…}\n\n" },
      { "t": 41,  "raw": "data: {…delta…}\n\n" },
      { "t": 128, "raw": "data: [DONE]\n\n" }
    ]
    // 非流式响应则为 "body": { …OpenAI JSON… }
  }
}
```

要点：

- **哈希稳定**：body 解析为 JSON 后递归排序 key 再序列化，录制与回放两端对同一请求得到相同哈希；请求参数 key 顺序不同不影响匹配。
- **SSE 保真**：chunk 保留原始字节（含 `data:`/`event:` 行、`\r\n` 换行、注释行与分隔空行），回放时原样重发，客户端看到的事件序列与上游逐字节一致；`t` 偏移用于还原节奏。
- **脱敏**：请求头只存 `content-type`/`accept`，绝不落盘 `Authorization`。

## 与 OpenAI SDK 配合

```python
# 录制 / 回放时都只需换 base_url（key 随便填）
client = OpenAI(base_url="http://127.0.0.1:8788/v1", api_key="sk-any")
```

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8788/v1   # openai-cli 等工具
```

典型用途：测试 / 演示不花钱、不耗配额；离线复现线上对话；回归测试固定 LLM 输出。

## 项目结构

```
src/
  cli.ts                  CLI 入口：record / replay / inspect
  core/
    types.ts              录制格式与枚举类型
    stable.ts             stableStringify + 请求哈希
    sse.ts                增量 SSE 解析（保留原文）
    jsonl.ts              JSONL 追加写 / 读入
    http-util.ts          请求体缓冲、归一化、头过滤、错误响应
  server/
    record-server.ts      录制模式：反向代理 + 捕获落盘
    replay-server.ts      回放模式：哈希/序列匹配 + 节奏 + 未命中策略
    proxy.ts              共用上游转发（tee 捕获 SSE 计时）
test/
  core.test.ts            SSE 解析 / 哈希稳定性单元测试
  e2e.test.ts             假上游 → 录制 → 回放全链路断言
demo/
  fake-upstream.mjs       演示用假 OpenAI 上游
.task/                    子任务拆解与进度
```

## 注意事项

- 回放哈希包含**完整请求 body**：`temperature`、`max_tokens` 等参数变了就匹配不上（可用 `--on-miss proxy` 兜底）。time-sensitive 的字段（如 `user`、时间戳类参数）建议在应用端固定。
- 序列模式适合"按剧本跑一遍"的集成测试；哈希模式适合随机顺序的请求。
- 录制是**追加写**：重复使用同一 `-o` 文件会累积条目；回放时同哈希多条会轮转命中。
