# 009-chat-roleplay — 角色扮演（system 人设）

## 用途

system 人设用例：海盗船长口吻回答，验证带人设的对话回放一致性。

- 录制日期：2026-11-12（上游 DeepSeek，1 轮：POST 200）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/009-chat-roleplay
```

## 测试步骤

1. 启动回放服务器（上方命令）
2. 重发相同请求。

## 预期结果

回复口吻与录制完全一致。
