# 005-chat-multi-turn — 纯 API 多轮对话（三轮）

## 用途

同一会话三轮请求（历史逐轮累积），验证多轮 hash 各自命中——每轮请求体不同、各自精确匹配。

- 录制日期：2026-11-12（上游 DeepSeek，3 轮：POST 200；POST 200；POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/005-chat-multi-turn
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 按 session.jsonl 三条的 request.body 依次重发（历史需与录制一致）。

## 预期结果

三轮响应与录制一致；回放日志显示 3 次 HIT 且哈希各不相同。
