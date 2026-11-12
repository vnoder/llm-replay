# 003-chat-casual-zh — 中文闲聊（单轮非流式）

## 用途

最基础的非流式 chat/completions 冒烟：中文单问单答，验证 hash 命中与 JSON 响应一致性。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/003-chat-casual-zh
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 对回放服务器重发完全相同的请求体（见 session.jsonl 第一条 request.body）。

## 预期结果

返回与录制完全一致的 choices[0].message.content。
