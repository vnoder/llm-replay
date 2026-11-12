# agent-write-file — 从零创建文件并运行（write/bash）

## 用途

agent 创建型用例：用 write 从零创建 hello.js 并用 bash 运行验证输出，验证回放下文件创建副作用可复现。

- 录制日期：2026-11-12（上游 DeepSeek deepseek-chat，pi v1.5.2）
- 回放数据：session.jsonl（4 轮）
- 夹具：本目录 `workspace/`（录制时的初始状态）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/agent-write-file -m sequence --pace instant
```

## 测试步骤

1. **副作用复现需在录制路径运行**：把 `workspace/` 夹具复制到 `D:\pi-test\staging\agent-write-file`
2. 启动回放服务器（上方命令）
3. 在该目录用 pi 以相同 prompt 运行（prompt 见 prompt.txt）：
   ```bash
   cd D:\pi-test\staging\agent-write-file
   PI_CODING_AGENT_DIR=<agent-dir 指向 http://127.0.0.1:8788/v1> pi --print \
     --model deepseek-chat --provider deepseek-local --tools write,bash '<prompt.txt 内容>'
   ```

## 预期结果

生成 hello.js 且 node 运行输出 Hello Replay 2026。

## 已知差异

- 工具调用参数烧入录制时的绝对路径（`D:\pi-test\staging\agent-write-file`），换目录运行对话一致但文件副作用落到该路径
- pi 生成的 tool_call ID / 命令措辞每次不同——这正是必须用 sequence 模式的原因
