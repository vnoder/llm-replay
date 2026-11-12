# 09 复杂多工具 Agent 会话录制（read/edit/bash）

## 目标
- 用 pi + DeepSeek 录制包含检索文件、编辑文件、执行命令的多轮工具调用会话，存入 assets/002.jsonl
- 验证 sequence 模式完整回放多轮会话及工具副作用

## 结果（2026-11-13，通过）
- 工作区任务：修 calc.js add bug + 新增 multiply + 修 utils.js 同 bug + node 验证
- assets/002.jsonl 录制 4 轮（48/197/75/263 SSE chunks）：read task.md + bash ls → edit×2 → bash 验证 → 最终报告
- sequence 回放：4 轮全 HIT，pi 重执行全部工具（read/bash/edit×2/bash），calc.js/utils.js 被正确修复，node calc.js → PASS，零上游流量

## 关键发现
1. **LLM 输出非确定性**：DeepSeek 两次运行生成的 tool_call ID（call_00_Pt13… vs call_00_4fM3…）与命令措辞均不同 → 第二轮起请求哈希必然不同；哈希模式只对第一轮（纯用户输入）有效 → 多轮 agent 会话必须用 sequence 模式
2. **Windows 后台进程坑**：Git Bash 的 kill -INT 杀不死后台 node 服务器，僵尸进程占端口 + 两个实例交错写同一 JSONL 造成过脏数据（混入后续运行的请求、丢失一轮）；用 taskkill /PID /F 强杀解决
3. pi 对同一 cwd/prompt/tools 的第一轮请求完全确定（跨运行、跨 agent 配置目录哈希一致）

## 状态
done
