# 015-chat-fewshot — few-shot 情感分类

## 用途

少样本分类用例：两条示例 + 一条待分类评论，验证多 message 结构回放的稳定性。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/015-chat-fewshot
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求。

## 预期结果

分类结论与录制一致。
