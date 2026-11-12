# agent-read-edit-run — 读改跑综合（修复非法 JSON 配置）

## 用途

agent 综合用例：读取带错的 config.json → edit 修复非法语法并把端口改为数字 → bash 运行 node 验证，验证读/改/跑三段式副作用。

- 录制日期：2026-11-12（上游 DeepSeek deepseek-chat，pi v1.5.2）
- 回放数据：session.jsonl（4 轮）
- 夹具：本目录 `workspace/`（录制时的初始状态）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/agent-read-edit-run -m sequence --pace instant
```

## 测试步骤

1. **副作用复现需在录制路径运行**：把 `workspace/` 夹具复制到 `D:\pi-test\staging\agent-read-edit-run`
2. 启动回放服务器（上方命令）
3. 在该目录用 pi 以相同 prompt 运行（prompt 见 prompt.txt）：
   ```bash
   cd D:\pi-test\staging\agent-read-edit-run
   PI_CODING_AGENT_DIR=<agent-dir 指向 http://127.0.0.1:8788/v1> pi --print \
     --model deepseek-chat --provider deepseek-local --tools read,edit,bash '<prompt.txt 内容>'
   ```

## 预期结果

config.json 变为合法 JSON 且 port 为数字 8080；验证脚本输出 8080。

## 已知差异

- 工具调用参数烧入录制时的绝对路径（`D:\pi-test\staging\agent-read-edit-run`），换目录运行对话一致但文件副作用落到该路径
- pi 生成的 tool_call ID / 命令措辞每次不同——这正是必须用 sequence 模式的原因
