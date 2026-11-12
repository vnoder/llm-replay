# agent-grep-find — 代码库检索问答（grep/find/read 只读）

## 用途

agent 只读检索用例：在多文件小代码库中定位负责某功能的函数并引用代码，全程不修改文件。适合测试 agent 的检索工具链与引用准确性。

- 录制日期：2026-11-12（上游 DeepSeek deepseek-chat，pi v1.5.2）
- 回放数据：session.jsonl（3 轮）
- 夹具：本目录 `workspace/`（录制时的初始状态）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/agent-grep-find -m sequence --pace instant
```

## 测试步骤

1. **副作用复现需在录制路径运行**：把 `workspace/` 夹具复制到 `D:\pi-test\staging\agent-grep-find`
2. 启动回放服务器（上方命令）
3. 在该目录用 pi 以相同 prompt 运行（prompt 见 prompt.txt）：
   ```bash
   cd D:\pi-test\staging\agent-grep-find
   PI_CODING_AGENT_DIR=<agent-dir 指向 http://127.0.0.1:8788/v1> pi --print \
     --model deepseek-chat --provider deepseek-local --tools read,grep,find '<prompt.txt 内容>'
   ```

## 预期结果

回答指出 src/strings.js 的 reverseString 并给出函数体；工作区文件无任何改动。

## 已知差异

- 工具调用参数烧入录制时的绝对路径（`D:\pi-test\staging\agent-grep-find`），换目录运行对话一致但文件副作用落到该路径
- pi 生成的 tool_call ID / 命令措辞每次不同——这正是必须用 sequence 模式的原因
