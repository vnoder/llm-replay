#!/usr/bin/env node
/**
 * 用例库回归验证：遍历 assets/ 每个用例，启动 hash 回放服务器，
 * 按录制的每条 request 原样重发，断言响应与录制逐字节一致。
 *
 *   node scripts/verify-cases.mjs
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonl } from '../dist/src/core/jsonl.js';
import { startReplayServer } from '../dist/src/server/replay-server.js';

const ASSETS = new URL('../assets/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let failed = 0;
let totalEntries = 0;
const dirs = readdirSync(ASSETS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d+/.test(d.name))
  .map((d) => d.name)
  .sort();

for (const name of dirs) {
  const caseDir = join(ASSETS, name);
  const entries = await readJsonl(caseDir);
  const server = await startReplayServer({ port: 0, file: caseDir, match: 'hash', pace: 'instant', log: false });
  const base = `http://127.0.0.1:${server.port}`;
  const problems = [];
  try {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      totalEntries += 1;
      const headers = { 'content-type': 'application/json', authorization: 'Bearer verify' };
      const res = await fetch(base + e.request.path, {
        method: e.request.method,
        headers,
        body: e.request.body === null || e.request.body === undefined ? undefined : JSON.stringify(e.request.body),
      });
      if (res.status !== e.response.status) {
        problems.push(`第 ${i + 1} 轮 status ${res.status} ≠ 录制 ${e.response.status}`);
        continue;
      }
      if (e.response.sse) {
        // 流式：拼接全部事件原文比对
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let text = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += dec.decode(value, { stream: true });
        }
        const recorded = e.response.sse.map((c) => c.raw).join('');
        if (text !== recorded) {
          problems.push(`第 ${i + 1} 轮 SSE 不一致（回放 ${text.length} 字符 ≠ 录制 ${recorded.length} 字符）`);
        }
      } else {
        const got = await res.json();
        const want = e.response.body;
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          problems.push(`第 ${i + 1} 轮 JSON body 不一致`);
        }
      }
    }
  } finally {
    await server.close();
  }
  if (problems.length) {
    failed += 1;
    console.log(`✖ ${name}（${entries.length} 轮）`);
    for (const p of problems) console.log(`    ${p}`);
  } else {
    console.log(`✔ ${name}（${entries.length} 轮全部一致）`);
  }
}

console.log(`\n共 ${dirs.length} 个用例 / ${totalEntries} 轮，失败 ${failed} 个`);
process.exit(failed ? 1 : 0);
