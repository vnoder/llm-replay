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
| `-o, --out <path>` | `session.jsonl` | 以 `.jsonl` 结尾＝具体文件（追加写）；否则视为**目录**，每次启动自动取目录内最大序号 +1 生成 `NNN.jsonl`（如 `001.jsonl`、`002.jsonl`），适合按会话录制多段 |
| `--tag <label>` | | 目录模式下给录制文件加任务含义后缀：`NNN-<label>.jsonl`（如 `003-fix-calc.jsonl`；仅保留字母数字、`-`、`_`）。序号识别兼容带/不带后缀两种命名 |
| `-p, --port <port>` | `8787` | 监听端口（`0` = 随机） |
| `--host <host>` | `127.0.0.1` | 监听地址 |
| `--api-key <key>` | 透传客户端的 | 覆盖发往上游的 `Authorization: Bearer <key>`。应用端随便填个假 key，真实密钥只留在录制进程 |
| `--no-log` | | 不打印每条录制日志 |

#### 测试用例库（assets 目录）

`assets/` 是**测试用例库**：每个用例一个 `NNN-用途/` 目录，自包含可复现：

```
assets/
  001-note-qa/            ← 简单文件问答（单工具冒烟）
    README.md             ← 用途、测试步骤、回放命令、预期结果
    session.jsonl         ← 回放数据
    note.txt              ← 夹具
  002-fix-calc-tools/     ← 代码修复多工具会话（read/edit/bash + 副作用断言）
    README.md
    session.jsonl
    workspace/            ← 夹具（带 bug 的初始工作区）
```

```bash
# 录制新用例：--tag 自动创建 NNN-<tag>/{session.jsonl, README.md 骨架}
llm-replay record -p 8787 -u https://api.deepseek.com -o assets --tag codebase-qa --api-key sk-real-key
# 录完补齐 README 的「测试步骤 / 预期结果」，并把夹具放进用例目录

# 回放：单用例 或 整库
llm-replay replay -p 8788 -f assets/002-fix-calc-tools -m sequence
llm-replay replay -p 8788 -f assets -m sequence       # 按用例序号跨用例连放
llm-replay inspect -f assets
```

兼容旧的扁平命名（`NNN.jsonl` / `NNN-含义.jsonl` 与用例目录混用，序号统一续接）。

用例类型示例：文件问答冒烟、代码修复多工具、代码库问答、闲聊、subagent 编排——
按 `--tag` 持续追加即可。

目录合并后条目 id 带文件前缀（如 `001/rec-000001`），日志与 `x-llm-replay` 响应头可区分来源会话。

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
| `-f, --file <path>` | （必填） | 录制 JSONL 文件**或目录**；目录时按文件名序合并全部 `*.jsonl` |
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
llm-replay inspect -f session.jsonl     # 单文件
llm-replay inspect -f assets            # 整个录制目录
# 001/rec-000001  GET  /v1/models            -> 200 json  hash=c1d5b359e983…
# 002/rec-000001  POST /v1/chat/completions  -> 200 json  hash=6d845f759a9e…
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
- **多轮 agent 会话请用 `-m sequence`**：LLM 输出本身不可复现（实测 DeepSeek 两次生成的 tool_call ID 与措辞都不同），第二轮起的请求会嵌入模型上一轮的随机输出，哈希必然对不上。sequence 模式忽略请求内容按序回放，实测可完整重放 pi agent 的 read/edit/bash 多轮工具调用对话，且 agent 会真实重执行录制的工具调用（副作用可复现）。
- **sequence 回放的副作用依赖录制时路径**：模型生成的工具调用常含绝对路径（如 `edit D:/xxx/calc.js`），回放时这些编辑会落到录制时的原路径上；换目录运行对话仍逐字一致，但文件副作用位置不变。用例夹具需在 README 标注录制时的工作路径。
- 序列模式适合"按剧本跑一遍"的集成测试；哈希模式适合随机顺序的请求。
- 录制是**追加写**：重复使用同一 `-o` 文件会累积条目；回放时同哈希多条会轮转命中。
- Windows 提示：Git Bash 下对后台 node 进程发 `kill -INT` 常常无效，会留下占端口的僵尸服务器、甚至两个实例交错写同一 JSONL。录制/回放结束后用 `taskkill /PID <pid> /F`（或任务管理器）确认进程已退出，再进行下一步。
