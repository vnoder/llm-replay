# 07 真实 Agent 实测（pi + DeepSeek）

## 目标
- 用真实 coding agent [earendil-works/pi](https://github.com/earendil-works/pi)（v1.5.2）作为客户端
- 上游 DeepSeek（https://api.deepseek.com），录制代理注入真实 API key
- 验证：录制（含 agent 工具调用多轮流式对话）→ 回放哈希命中输出一致 → 未命中 404 / proxy 转发

## 结果（2026-11-13，全部通过）
- 录制：pi --print 经 8787 代理跑真实 DeepSeek，两轮对话（第 1 轮 read 工具调用 20 chunks / 第 2 轮最终答案 30 chunks）存入 pi-session.jsonl，节奏 875ms/858ms
- 回放（hash + instant）：同 prompt 重跑 pi，两轮全部 HIT，输出与录制时逐字一致，零上游流量（on-miss=404 证明）
- 回放（hash + original pace + --on-miss proxy）：新 prompt MISS → 转发真实 DeepSeek 正常回答；旧 prompt 仍 HIT 回放
- pi 的请求体对同一 cwd/prompt/tools 完全确定性 → 哈希模式可直接命中

## 状态
done
