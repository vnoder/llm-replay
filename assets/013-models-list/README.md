# 013-models-list — GET /v1/models 模型列表

## 用途

models 端点用例：无请求体的 GET，验证非 chat 端点与空 body 哈希回放。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：GET 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/013-models-list
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. GET 回放服务器的 /v1/models。

## 预期结果

模型列表 JSON 与录制一致（含 deepseek-chat / deepseek-reasoner）。
