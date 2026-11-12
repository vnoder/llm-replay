# 03 录制模式：反向代理

## 目标
- `src/server/record-server.ts`
- 接收任意 OpenAI 协议请求（chat/completions 流式与非流式、embeddings、models 等），转发到 --upstream
- 响应体 tee：一边原样回给客户端，一边按 content-type 捕获
  - text/event-stream：逐事件记录相对毫秒偏移 t + raw
  - 其他：整包缓冲（解析 JSON）
- 每完成一个请求-响应对，追加一行 JSONL
- Authorization 头替换（--api-key 可选，用于注入真实密钥）

## 状态
done
