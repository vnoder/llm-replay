#!/usr/bin/env node
/**
 * 批量录制 API 级测试用例（003-015）到 assets/。
 *
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/record-api-cases.mjs
 *
 * 每个用例：程序化启动录制服务器（无后台进程）→ 顺序发出请求 → 正常关闭落盘
 * → 写入用例 README（用途/回放/测试步骤/预期）。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRecordOut, readJsonl } from '../dist/src/core/jsonl.js';
import { startRecordServer } from '../dist/src/server/record-server.js';

const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error('缺少环境变量 DEEPSEEK_API_KEY');
  process.exit(1);
}
const UPSTREAM = 'https://api.deepseek.com';
const ASSETS = new URL('../assets/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const chatMsgs = (messages, extra = {}) => ({ model: 'deepseek-chat', messages, ...extra });

const SUMMARY_TEXT = [
  '星尘智能助手是一款面向家庭用户的桌面机器人，具备语音交互、日程提醒与家居控制三大功能。',
  '它采用模块化设计，头部可更换摄像头与投影模块，续航约八小时，支持 Type-C 快充。',
  '配套手机应用提供远程看家、儿童模式与固件升级，用户数据默认仅保存在本机。',
  '产品定价一千二百九十九元起，教育版提供开源 Scratch 编程接口。',
].join('');

// ---------------------------------------------------------------- 用例定义

const CASES = [
  {
    tag: 'chat-casual-zh',
    title: '中文闲聊（单轮非流式）',
    purpose: '最基础的非流式 chat/completions 冒烟：中文单问单答，验证 hash 命中与 JSON 响应一致性。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([{ role: 'user', content: '用一句话介绍你自己，不超过 30 个字。' }])],
    ],
    steps: '对回放服务器重发完全相同的请求体（见 session.jsonl 第一条 request.body）。',
    expect: '返回与录制完全一致的 choices[0].message.content。',
  },
  {
    tag: 'chat-casual-en-stream',
    title: '英文闲聊（单轮流式 SSE）',
    purpose: '最基础的流式冒烟：英文单问，验证 SSE 逐字节回放与 data: 帧序列。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([{ role: 'user', content: 'Tell me one fun fact about the Moon in a single sentence.' }], { stream: true })],
    ],
    steps: '以 stream=true 重发相同请求，按 SSE 读取全部事件。',
    expect: '事件序列（含 data: [DONE]）与录制逐字节一致。',
  },
  {
    tag: 'chat-multi-turn',
    title: '纯 API 多轮对话（三轮）',
    purpose: '同一会话三轮请求（历史逐轮累积），验证多轮 hash 各自命中——每轮请求体不同、各自精确匹配。',
    multiTurn: [
      '我马上要去杭州出差两天，帮我列一个随身物品清单。',
      '再帮我按出行前打包顺序重新组织这份清单。',
      '最后用一句话总结这份清单的核心原则。',
    ],
    steps: '按 session.jsonl 三条的 request.body 依次重发（历史需与录制一致）。',
    expect: '三轮响应与录制一致；回放日志显示 3 次 HIT 且哈希各不相同。',
  },
  {
    tag: 'chat-reasoner',
    title: 'deepseek-reasoner 思维链（流式）',
    purpose: '推理模型用例：响应含 reasoning_content 思维链 delta 与最终 content，验证回放保留完整推理流。',
    reqs: () => [
      ['POST', '/v1/chat/completions', { model: 'deepseek-reasoner', stream: true, messages: [{ role: 'user', content: '9.11 和 9.9 哪个更大？请一步步推理后给结论。' }] }],
    ],
    steps: '以 stream=true 重发相同请求。',
    expect: 'reasoning_content 与 content 的完整 delta 序列与录制一致。',
  },
  {
    tag: 'chat-codegen-stream',
    title: '长代码生成（流式）',
    purpose: '长输出压力用例：流式生成 TypeScript 快排实现，验证多 chunk 长流与节奏偏移记录/回放。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([{ role: 'user', content: '用 TypeScript 写一个带注释的快速排序函数 quickSort，并给出一个使用示例。' }], { stream: true })],
    ],
    steps: '重发相同请求并完整消费 SSE 流。',
    expect: '生成代码与录制逐字节一致（chunk 数与内容不变）。',
  },
  {
    tag: 'chat-json-mode',
    title: 'JSON 结构化输出（response_format）',
    purpose: 'response_format=json_mode 用例：验证结构化输出请求的回放，适合测试依赖 JSON 解析的应用。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([
        { role: 'system', content: 'You must output valid JSON only.' },
        { role: 'user', content: '生成一个虚构人物档案，字段：name, dynasty, known_for。人物以诗闻名，酒量好。' },
      ], { response_format: { type: 'json_object' } })],
    ],
    steps: '重发相同请求并 JSON.parse 响应。',
    expect: '返回与录制一致的合法 JSON 对象。',
  },
  {
    tag: 'chat-roleplay',
    title: '角色扮演（system 人设）',
    purpose: 'system 人设用例：海盗船长口吻回答，验证带人设的对话回放一致性。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([
        { role: 'system', content: '你是一位说话简洁粗犷的海盗船长，每句话不超过 20 字，喜欢用航海比喻。' },
        { role: 'user', content: '介绍一下你的船。' },
      ])],
    ],
    steps: '重发相同请求。',
    expect: '回复口吻与录制完全一致。',
  },
  {
    tag: 'chat-summarize',
    title: '长文本摘要',
    purpose: '输入长文本做三句话摘要，验证长 prompt 的回放（哈希覆盖完整请求体）。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([{ role: 'user', content: `请把下面的产品介绍压缩成三句话摘要：\n\n${SUMMARY_TEXT}` }])],
    ],
    steps: '重发相同请求（含完整长文本）。',
    expect: '三句摘要与录制一致。',
  },
  {
    tag: 'chat-translate',
    title: '中译英翻译',
    purpose: '翻译用例：固定中文输入翻译为英文，回放提供稳定译文给依赖翻译的应用测试。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([{ role: 'user', content: '把下面的话翻译成地道的英文，只输出译文：工欲善其事，必先利其器；磨刀不误砍柴工。' }])],
    ],
    steps: '重发相同请求。',
    expect: '译文与录制一致。',
  },
  {
    tag: 'chat-cold-facts',
    title: '低温度事实问答',
    purpose: 'temperature=0.2 的短事实问答（光速），验证带显式采样参数的请求回放。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([{ role: 'user', content: '光速大约是多少 km/s？只回答数字。' }], { temperature: 0.2 })],
    ],
    steps: '重发相同请求（含 temperature）。',
    expect: '回答与录制一致。',
  },
  {
    tag: 'models-list',
    title: 'GET /v1/models 模型列表',
    purpose: 'models 端点用例：无请求体的 GET，验证非 chat 端点与空 body 哈希回放。',
    reqs: () => [['GET', '/v1/models', null]],
    steps: 'GET 回放服务器的 /v1/models。',
    expect: '模型列表 JSON 与录制一致（含 deepseek-chat / deepseek-reasoner）。',
  },
  {
    tag: 'error-invalid-model',
    title: '无效模型名 → 400 错误响应',
    purpose: '错误通道用例：请求不存在的模型，录下上游 400 错误体，用于测试应用的错误处理分支。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([{ role: 'user', content: 'hi' }], { model: 'nonexistent-model-xyz' })],
    ],
    steps: '重发相同请求。',
    expect: '回放返回 400 与录制的错误 JSON（error.message 指明 Model Not Exist）。',
  },
  {
    tag: 'chat-fewshot',
    title: 'few-shot 情感分类',
    purpose: '少样本分类用例：两条示例 + 一条待分类评论，验证多 message 结构回放的稳定性。',
    reqs: () => [
      ['POST', '/v1/chat/completions', chatMsgs([
        { role: 'user', content: '分类这条评论的情感（正面/负面/中性）：物流很快，包装完好。' },
        { role: 'assistant', content: '正面' },
        { role: 'user', content: '分类这条评论的情感（正面/负面/中性）：客服态度差，再也不买了。' },
        { role: 'assistant', content: '负面' },
        { role: 'user', content: '分类这条评论的情感（正面/负面/中性）：这台手机续航真差，但屏幕还行。' },
      ])],
    ],
    steps: '重发相同请求。',
    expect: '分类结论与录制一致。',
  },
];

// ---------------------------------------------------------------- 工具函数

async function readRes(res) {
  if (!res.ok && res.status >= 500) throw new Error(`upstream ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('event-stream')) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    return { sseText: text };
  }
  return { json: await res.json().catch(() => null), raw: await res.text().catch(() => '') };
}

function assistantContent(sseText) {
  let content = '';
  for (const m of sseText.matchAll(/^data: (.*)$/gm)) {
    if (m[1] === '[DONE]') continue;
    try {
      const j = JSON.parse(m[1]);
      content += j.choices?.[0]?.delta?.content ?? '';
    } catch { /* 忽略坏行 */ }
  }
  return content;
}

function writeReadme(caseDir, c, entryCount, roundInfo) {
  writeFileSync(join(caseDir, 'README.md'), `# ${caseDir.split(/[\\/]/).pop()} — ${c.title}

## 用途

${c.purpose}

- 录制日期：${new Date().toISOString().slice(0, 10)}（上游 DeepSeek，${entryCount} 轮：${roundInfo}）

## 回放

\`\`\`bash
node dist/src/cli.js replay -p 8788 -f assets/${caseDir.split(/[\\/]/).pop()}
\`\`\`

## 测试步骤

1. 启动回放服务器（上方命令）
2. ${c.steps}

## 预期结果

${c.expect}
`, 'utf8');
}

// ---------------------------------------------------------------- 主流程

const only = process.argv[2]; // 可选：只录指定 tag

for (const c of CASES) {
  if (only && c.tag !== only) continue;
  const caseFile = await resolveRecordOut(ASSETS, c.tag, UPSTREAM);
  const caseDir = caseFile.replace(/[\\/][^\\/]+$/, '');
  const server = await startRecordServer({ port: 0, upstream: UPSTREAM, file: caseFile, apiKey: KEY, log: false });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    if (c.multiTurn) {
      const history = [];
      for (const turn of c.multiTurn) {
        history.push({ role: 'user', content: turn });
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
          body: JSON.stringify(chatMsgs(history)),
        });
        const r = await readRes(res);
        const answer = r.json?.choices?.[0]?.message?.content ?? '';
        if (!answer) throw new Error(`多轮第 ${history.length} 轮未取到回复`);
        history.push({ role: 'assistant', content: answer });
      }
    } else {
      for (const [method, path, body] of c.reqs()) {
        const res = await fetch(base + path, {
          method,
          headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
          body: body === null ? undefined : JSON.stringify(body),
        });
        await readRes(res);
      }
    }
  } finally {
    await server.close();
  }
  const entries = await readJsonl(caseDir);
  const roundInfo = entries.map((e) => `${e.request.method} ${e.response.status}${e.response.sse ? ` sse×${e.response.sse.length}` : ''}`).join('；');
  writeReadme(caseDir, c, entries.length, roundInfo);
  console.log(`[ok] ${c.tag} → ${entries.length} 轮（${roundInfo}）`);
}

console.log('\n全部 API 级用例录制完成');
