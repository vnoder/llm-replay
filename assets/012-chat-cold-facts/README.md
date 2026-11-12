# 012-chat-cold-facts — 低温度事实问答

## 用途

temperature=0.2 的短事实问答（光速），验证带显式采样参数的请求回放。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/012-chat-cold-facts
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求（含 temperature）。

## 预期结果

回答与录制一致。
