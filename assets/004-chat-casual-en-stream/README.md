# 004-chat-casual-en-stream — 英文闲聊（单轮流式 SSE）

## 用途

最基础的流式冒烟：英文单问，验证 SSE 逐字节回放与 data: 帧序列。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200 sse×35）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/004-chat-casual-en-stream
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 以 stream=true 重发相同请求，按 SSE 读取全部事件。

## 预期结果

事件序列（含 data: [DONE]）与录制逐字节一致。
