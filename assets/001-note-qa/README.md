# 001-note-qa — 简单文件问答（单工具冒烟用例）

## 用途

验证 agent 能通过回放服务器完成最简单的"读取文件 → 回答问题"链路：
单轮工具调用 + 流式回答。适合作为回放基础设施的**冒烟测试**——
跑通即说明回放服务器、agent 接入、SSE 流式都正常。

- 录制日期：2026-11-13（上游 DeepSeek `deepseek-chat`，pi v1.5.2，2 轮流式）
- 夹具：`note.txt`（含固定秘密代码与天气）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/001-note-qa --pace instant
```

本用例共 2 轮（读文件 / 回答），请求由用户输入驱动、无 LLM 随机性介入的分支，
`hash` 模式首轮即可命中；但为通用起见推荐 `-m sequence`。

## 测试步骤

1. 夹具就位：把 `note.txt` 复制到被测工作区（录制时位于 `D:/pi-test/workspace`）
2. 启动回放服务器（上方命令）
3. 用 pi 以相同 prompt 指向回放服务器运行：
   ```bash
   PI_CODING_AGENT_DIR=<agent-dir> pi --print --model deepseek-chat \
     --provider deepseek-local --tools read \
     '请用 read 工具读取当前目录的 note.txt，然后只回答两点：1) 文件里的秘密代码 2) 文件里说的天气。'
   ```
   （agent-dir 的 models.json 将 baseUrl 指到 `http://127.0.0.1:8788/v1`）

## 预期结果

输出恰好为：

```
1) 秘密代码：`PI-REPLAY-2026`
2) 天气：北京今天晴（sunny）
```

回放服务器日志显示 2 条 HIT（20 chunks + 30 chunks），0 次上游流量。
