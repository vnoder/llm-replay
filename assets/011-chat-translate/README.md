# 011-chat-translate — 中译英翻译

## 用途

翻译用例：固定中文输入翻译为英文，回放提供稳定译文给依赖翻译的应用测试。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/011-chat-translate
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求。

## 预期结果

译文与录制一致。
