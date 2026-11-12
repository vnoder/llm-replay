# agent-bash-pipeline — bash 文本处理管道（词频统计）

## 用途

agent 命令型用例：用 bash 管道（sort/uniq 等）统计词频 Top3，验证命令执行与输出解析回放。

- 录制日期：2026-11-12（上游 DeepSeek deepseek-chat，pi v1.5.2）
- 回放数据：session.jsonl（3 轮）
- 夹具：本目录 `workspace/`（录制时的初始状态）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/agent-bash-pipeline -m sequence --pace instant
```

## 测试步骤

1. **副作用复现需在录制路径运行**：把 `workspace/` 夹具复制到 `D:\pi-test\staging\agent-bash-pipeline`
2. 启动回放服务器（上方命令）
3. 在该目录用 pi 以相同 prompt 运行（prompt 见 prompt.txt）：
   ```bash
   cd D:\pi-test\staging\agent-bash-pipeline
   PI_CODING_AGENT_DIR=<agent-dir 指向 http://127.0.0.1:8788/v1> pi --print \
     --model deepseek-chat --provider deepseek-local --tools read,bash '<prompt.txt 内容>'
   ```

## 预期结果

banana:3、apple:3、cherry:2 的排序结果（banana 与 apple 并列时的顺序以录制的回答为准）。

## 已知差异

- 工具调用参数烧入录制时的绝对路径（`D:\pi-test\staging\agent-bash-pipeline`），换目录运行对话一致但文件副作用落到该路径
- pi 生成的 tool_call ID / 命令措辞每次不同——这正是必须用 sequence 模式的原因
