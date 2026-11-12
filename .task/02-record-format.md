# 02 JSONL 录制格式与核心模块

## 目标
- `src/core/types.ts`：RecordEntry / SseChunk / RequestPayload / ResponsePayload 类型
- `src/core/stable.ts`：stableStringify（递归排序 key），请求哈希 sha256(method + path + stableBody)
- `src/core/sse.ts`：SSE 流解析（按事件切分，保留 raw 原文）
- `src/core/jsonl.ts`：JSONL 追加写 / 读入索引
- 录制行格式：`{ id, hash, ts, request:{method,path,headers,body}, response:{status,headers,body?,sse?:[{t,raw}]} }`

## 状态
done
