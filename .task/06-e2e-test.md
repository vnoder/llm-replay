# 06 端到端验证

## 目标
- `test/e2e.test.ts`（node:test）：
  - 假上游（SSE 流式 + 非流式 + embeddings + models）
  - record 模式录制 → JSONL 校验（含 SSE chunk 与 t 偏移）
  - replay 哈希匹配：流式/非流式响应体与上游一致
  - replay sequence 模式逐条回放
  - 节奏：instant 立即完成，original 耗时≈录制间隔
  - 未命中：404 与 proxy 两种策略
- npm test 全绿

## 状态
done
