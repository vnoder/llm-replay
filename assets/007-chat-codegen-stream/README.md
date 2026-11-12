# 007-chat-codegen-stream — 长代码生成（流式）

## 用途

长输出压力用例：流式生成 TypeScript 快排实现，验证多 chunk 长流与节奏偏移记录/回放。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200 sse×1045）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/007-chat-codegen-stream
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求并完整消费 SSE 流。

## 预期结果

生成代码与录制逐字节一致（chunk 数与内容不变）。
