# 04 回放模式：假服务器

## 目标
- `src/server/replay-server.ts`
- 匹配模式 --match：
  - hash（默认）：按请求哈希精确匹配；同一哈希多条录制按序轮转
  - sequence：忽略请求内容，按录制顺序逐条回放
- 流式回放节奏 --pace original|instant、--speed N（0<N，除以延时）
- 未命中策略 --on-miss 404|proxy（proxy 需 --upstream，透传并转发）
- 非流式 JSON 直接回放；SSE 按 Content-Type: text/event-stream 重发 raw 事件

## 状态
done
