# agent-two-phase — 两阶段编排：planner → executor（subagent 模式）

## 用途

subagent 编排用例：模拟编排器先调 planner 会话产出执行计划，再把计划注入 executor 会话执行。用例目录含 1-plan.jsonl 与 2-execute.jsonl 两个 session，验证"多会话接力"的回放。

- 录制日期：2026-11-12（上游 DeepSeek deepseek-chat，pi v1.5.2）
- 回放数据：1-plan.jsonl（2 轮）、2-execute.jsonl（5 轮）
- 夹具：本目录 `workspace/`（录制时的初始状态）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/agent-two-phase -m sequence --pace instant
```

## 测试步骤

1. **副作用复现需在录制路径运行**：把 `workspace/` 夹具复制到 `D:\pi-test\staging\agent-two-phase`
2. 启动回放服务器（上方命令）
3. 在该目录用 pi 以相同 prompt 运行（prompt 见 prompt.txt）：
   ```bash
   cd D:\pi-test\staging\agent-two-phase
   PI_CODING_AGENT_DIR=<agent-dir 指向 http://127.0.0.1:8788/v1> pi --print \
     --model deepseek-chat --provider deepseek-local --tools read,bash '<prompt.txt 内容>'
   ```

## 预期结果

executor 输出包含 5 行数据的 markdown 表格；两个 session 按文件名序被 sequence 模式依次回放。

## 已知差异

- 工具调用参数烧入录制时的绝对路径（`D:\pi-test\staging\agent-two-phase`），换目录运行对话一致但文件副作用落到该路径
- pi 生成的 tool_call ID / 命令措辞每次不同——这正是必须用 sequence 模式的原因
