# 002-fix-calc-tools — 代码修复多工具会话（read / edit / bash）

## 用途

验证 agent 在回放下完成**多轮工具调用 + 副作用**的完整任务链：
读取任务说明 → 检查代码 → 编辑修复（edit ×2）→ 执行验证（bash）→ 汇报。
适合测试：agent 工具执行器、文件编辑落地、命令执行与最终报告生成。

- 录制日期：2026-11-13（上游 DeepSeek `deepseek-chat`，pi v1.5.2，4 轮流式）
- 夹具：`workspace/`（task.md 任务清单 + 带 bug 的 calc.js / utils.js 初始状态）

## 回放

```bash
node dist/src/cli.js replay -p 8788 -f assets/002-fix-calc-tools -m sequence --pace instant
```

> 必须用 `-m sequence`：多轮会话中 LLM 生成的 tool_call ID / 措辞每次都不同，
> 第二轮起请求哈希必然对不上（详见 README「注意事项」）。

## 测试步骤

> **必须在录制时的工作路径 `D:/pi-test/workspace` 下运行**：录制的 edit 工具调用
> 使用绝对路径（`D:/pi-test/workspace/calc.js`），换目录运行时对话回放不受影响，
> 但文件编辑副作用会落到该绝对路径上。

1. 重置工作区为初始 bug 状态：把 `workspace/` 下的 3 个文件复制到 `D:/pi-test/workspace/`
2. 启动回放服务器（上方命令）
3. 在 `D:/pi-test/workspace` 下用 pi 以相同 prompt 运行：
   ```bash
   cd /d/pi-test/workspace
   PI_CODING_AGENT_DIR=<agent-dir> pi --print --model deepseek-chat \
     --provider deepseek-local \
     '请读取 task.md，严格按任务清单完成：修复 calc.js 的 add bug、新增并导出 multiply、检查并修复 utils.js 里同样的 bug，然后运行 node calc.js 验证，最后报告测试结果。'
   ```

## 预期结果

1. pi 退出码 0，回放日志显示 4 条 HIT（48 / 197 / 75 / 263 chunks）
2. agent 真实重执行录制的工具调用，产生副作用：
   - `calc.js`：`add` 修复为 `a + b`；新增 `multiply(a, b)`；`module.exports` 含两者
   - `utils.js`：同样的 `add` bug 被修复
   - `node calc.js` 输出 `PASS`
3. 最终报告包含全部自检断言通过（`add(1,2)===3`、`add(-1,1)===0`、`multiply(3,4)===12`、`multiply(-2,5)===-10`）

## 已知差异

- 回放执行时 agent 可能在工作区留下 `nul` 文件（录制的 bash 命令里含 cmd 风格
  `cd /d ... 2>nul`，Git Bash 会把它当普通文件创建）——不影响判定。
- 若在其他目录运行：对话与最终报告仍逐字一致，但文件编辑会落到
  `D:/pi-test/workspace`（绝对路径），当前目录文件不变。
