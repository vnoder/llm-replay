# 008-chat-json-mode — JSON 结构化输出（response_format）

## 用途

response_format=json_mode 用例：验证结构化输出请求的回放，适合测试依赖 JSON 解析的应用。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/008-chat-json-mode
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求并 JSON.parse 响应。

## 预期结果

返回与录制一致的合法 JSON 对象。
