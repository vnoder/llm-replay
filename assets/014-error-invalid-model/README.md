# 014-error-invalid-model — 无效模型名 → 400 错误响应

## 用途

错误通道用例：请求不存在的模型，录下上游 400 错误体，用于测试应用的错误处理分支。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 400）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/014-error-invalid-model
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求。

## 预期结果

回放返回 400 与录制的错误 JSON（error.message 指明 Model Not Exist）。
