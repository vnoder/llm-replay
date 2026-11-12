# 010-chat-summarize — 长文本摘要

## 用途

输入长文本做三句话摘要，验证长 prompt 的回放（哈希覆盖完整请求体）。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/010-chat-summarize
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求（含完整长文本）。

## 预期结果

三句摘要与录制一致。
