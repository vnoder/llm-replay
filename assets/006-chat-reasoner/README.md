# 006-chat-reasoner — deepseek-reasoner 思维链（流式）

## 用途

推理模型用例：响应含 reasoning_content 思维链 delta 与最终 content，验证回放保留完整推理流。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200 sse×467）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/006-chat-reasoner
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 以 stream=true 重发相同请求。

## 预期结果

reasoning_content 与 content 的完整 delta 序列与录制一致。
