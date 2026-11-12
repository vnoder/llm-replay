import { test } from 'node:test';
import assert from 'node:assert/strict';
import http, { type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startRecordServer, type StartedServer } from '../src/server/record-server.js';
import { startReplayServer } from '../src/server/replay-server.js';
import { readJsonl, resolveRecordOut } from '../src/core/jsonl.js';

// ---------------------------------------------------------------- 假上游

const REAL_KEY = 'sk-real-key';

interface UpstreamFixture {
  server: Server;
  port: number;
  /** 各端点的命中计数，供断言 on-miss proxy 是否真的到达上游 */
  hits: Map<string, number>;
  close(): Promise<void>;
}

async function startFakeUpstream(): Promise<UpstreamFixture> {
  const hits = new Map<string, number>();
  const bump = (k: string) => hits.set(k, (hits.get(k) ?? 0) + 1);

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      // 上游校验密钥确实被代理层注入
      if (req.headers.authorization !== `Bearer ${REAL_KEY}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad key' } }));
        return;
      }

      if (url === '/v1/models') {
        bump('models');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-test' }] }));
        return;
      }

      if (url === '/v1/embeddings') {
        bump('embeddings');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }] }));
        return;
      }

      if (url === '/v1/chat/completions' && body?.stream === true) {
        bump('chat-stream');
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        const events = [
          'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
          'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
          'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"!"}}]}\n\n',
          'data: [DONE]\n\n',
        ];
        let i = 0;
        const tick = () => {
          if (i >= events.length) {
            res.end();
            return;
          }
          res.write(events[i++]);
          setTimeout(tick, 40);
        };
        res.flushHeaders();
        tick();
        return;
      }

      if (url === '/v1/chat/completions') {
        bump('chat-json');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'c2', object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `unknown path ${url}` } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    server, port, hits,
    close: () => {
      server.closeAllConnections?.();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

// ---------------------------------------------------------------- 测试客户端

/** 读取 SSE 响应为事件文本数组 + 每事件到达时间戳 */
async function readSse(res: Response): Promise<{ events: string[]; times: number[] }> {
  assert.ok(res.body, 'response body missing');
  const t0 = Date.now();
  const events: string[] = [];
  const times: number[] = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\n\n|\n\r\n/)) !== -1) {
      const sepLen = buf[i + 1] === '\n' ? 2 : 3;
      const raw = buf.slice(0, i + sepLen);
      buf = buf.slice(i + sepLen);
      if (raw.trim().length > 0) {
        events.push(raw);
        times.push(Date.now() - t0);
      }
    }
  }
  return { events, times };
}

function req(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

/** 测试里方便地取 JSON body */
async function jsonOf(res: Response): Promise<any> {
  return (await res.json()) as any;
}

function chatBody(prompt: string, stream = false): string {
  return JSON.stringify({ model: 'gpt-test', stream, messages: [{ role: 'user', content: prompt }] });
}

// ---------------------------------------------------------------- 用例

test('录制 -> 回放 全链路', async (t) => {
  const upstream = await startFakeUpstream();
  t.after(() => upstream.close());

  const dir = mkdtempSync(join(tmpdir(), 'llm-replay-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'session.jsonl');

  // ---- 录制 ----
  const rec = await startRecordServer({
    port: 0, upstream: `http://127.0.0.1:${upstream.port}`,
    file, apiKey: REAL_KEY, log: false,
  });
  t.after(() => rec.close());

  // 客户端带假 key，代理层应注入真实 key
  const fakeAuth = { authorization: 'Bearer sk-fake', 'content-type': 'application/json' };

  const streamReq = await req(rec.port, '/v1/chat/completions', { method: 'POST', headers: fakeAuth, body: chatBody('hi', true) });
  const upstreamStream = await readSse(streamReq);
  assert.equal(streamReq.status, 200);
  assert.equal(upstreamStream.events.length, 4);
  assert.ok(upstreamStream.events[3].includes('[DONE]'));

  const jsonReq = await req(rec.port, '/v1/chat/completions', { method: 'POST', headers: fakeAuth, body: chatBody('hi') });
  const upstreamJson = await jsonOf(jsonReq);
  assert.equal(jsonReq.status, 200);
  assert.equal(upstreamJson.choices[0].message.content, 'Hello!');

  const embReq = await req(rec.port, '/v1/embeddings', { method: 'POST', headers: fakeAuth, body: JSON.stringify({ model: 'e', input: 'x' }) });
  assert.equal((await jsonOf(embReq)).data[0].embedding.length, 2);

  const modelsReq = await req(rec.port, '/v1/models', { headers: { authorization: 'Bearer sk-fake' } });
  assert.equal((await jsonOf(modelsReq)).data[0].id, 'gpt-test');

  await rec.close();

  // ---- 校验 JSONL ----
  const entries = await readJsonl(file);
  assert.equal(entries.length, 4);
  const [streamEntry, jsonEntry, embEntry, modelsEntry] = entries;

  assert.equal(streamEntry.request.method, 'POST');
  assert.equal(streamEntry.request.path, '/v1/chat/completions');
  assert.equal(streamEntry.request.headers['content-type'], 'application/json');
  assert.equal((streamEntry.request.body as any).model, 'gpt-test');
  assert.equal(streamEntry.response.sse?.length, 4);
  assert.ok(streamEntry.response.sse![0].raw.startsWith('data:'));
  assert.equal(streamEntry.response.sse![0].t, 0);
  // 节奏被记录下来（后面 chunk 有正偏移且递增）
  const ts = streamEntry.response.sse!.map((c) => c.t);
  assert.ok(ts[3] >= ts[2] && ts[2] >= ts[1] && ts[1] >= ts[0]);
  assert.ok(ts[3] > 50, 'SSE 相对偏移应反映上游 40ms x3 的节奏');
  assert.ok(!('authorization' in streamEntry.request.headers), '录制不得保存 Authorization');

  assert.equal(jsonEntry.response.status, 200);
  assert.equal((jsonEntry.response.body as any).choices[0].message.content, 'Hello!');
  assert.equal(embEntry.request.path, '/v1/embeddings');
  assert.deepEqual((embEntry.response.body as any).data[0].embedding, [0.1, 0.2]);
  assert.equal(modelsEntry.request.method, 'GET');
  assert.equal(modelsEntry.request.body, null);

  // 同一请求哈希在录制端与回放端一致（隐含：回放能命中）
  // ---- 回放：哈希匹配 ----
  const rp = await startReplayServer({ port: 0, file, match: 'hash', pace: 'original', log: false });
  t.after(() => rp.close());

  const rpStream = await req(rp.port, '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: chatBody('hi', true),
  });
  assert.equal(rpStream.status, 200);
  assert.ok(rpStream.headers.get('content-type')!.includes('text/event-stream'));
  assert.equal(rpStream.headers.get('x-llm-replay')!.startsWith('hit:'), true);
  const replayedStream = await readSse(rpStream);
  assert.deepEqual(replayedStream.events, upstreamStream.events, '流式回放事件序列应与上游一致');

  const rpJson = await req(rp.port, '/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: false, model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.deepEqual(await jsonOf(rpJson), upstreamJson);

  const rpEmb = await req(rp.port, '/v1/embeddings', { method: 'POST', body: JSON.stringify({ input: 'x', model: 'e' }) });
  assert.deepEqual(await jsonOf(rpEmb), { object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }] });

  const rpModels = await req(rp.port, '/v1/models');
  assert.deepEqual(await jsonOf(rpModels), { object: 'list', data: [{ id: 'gpt-test' }] });

  // 未命中：404
  const miss = await req(rp.port, '/v1/chat/completions', { method: 'POST', body: chatBody('never-recorded') });
  assert.equal(miss.status, 404);
  assert.ok((await jsonOf(miss)).error.message.includes('no recorded response'));
  await rp.close();

  // ---- 回放：序列模式 ----
  const seq = await startReplayServer({ port: 0, file, match: 'sequence', pace: 'instant', log: false });
  t.after(() => seq.close());
  // 任意请求都按录制顺序返回：第 1 条应是流式 chat
  const s1 = await req(seq.port, '/whatever', { method: 'POST', body: 'x' });
  assert.ok(s1.headers.get('content-type')!.includes('text/event-stream'));
  assert.equal((await readSse(s1)).events.length, 4);
  const s2 = await req(seq.port, '/whatever', { method: 'POST', body: 'x' });
  assert.equal((await jsonOf(s2)).id, 'c2');
  const s3 = await req(seq.port, '/whatever', { method: 'POST', body: 'x' });
  assert.equal((await jsonOf(s3)).object, 'list');
  const s4 = await req(seq.port, '/whatever', { method: 'GET' });
  assert.equal((await jsonOf(s4)).data[0].id, 'gpt-test');
  // 放完后未命中 -> 404
  const s5 = await req(seq.port, '/whatever');
  assert.equal(s5.status, 404);
  await seq.close();

  // ---- 回放：节奏 ----
  const paced = await startReplayServer({ port: 0, file, match: 'hash', pace: 'original', log: false });
  t.after(() => paced.close());
  const p1 = await req(paced.port, '/v1/chat/completions', { method: 'POST', body: chatBody('hi', true) });
  const pacedRes = await readSse(p1);
  const span = pacedRes.times[pacedRes.times.length - 1];
  assert.ok(span >= 60, `original 节奏应接近录制间隔（${span}ms >= 60ms）`);
  await paced.close();

  const fast = await startReplayServer({ port: 0, file, match: 'hash', pace: 'instant', log: false });
  t.after(() => fast.close());
  const f1 = await req(fast.port, '/v1/chat/completions', { method: 'POST', body: chatBody('hi', true) });
  const fastRes = await readSse(f1);
  assert.ok(fastRes.times[3] <= 25, `instant 应立即发完（${fastRes.times[3]}ms <= 25ms）`);
  await fast.close();

  const spd = await startReplayServer({ port: 0, file, match: 'hash', pace: 'original', speed: 10, log: false });
  t.after(() => spd.close());
  const q1 = await req(spd.port, '/v1/chat/completions', { method: 'POST', body: chatBody('hi', true) });
  const spdRes = await readSse(q1);
  const spdSpan = spdRes.times[spdRes.times.length - 1];
  assert.ok(spdSpan < span / 2, `10 倍速应显著快于原速（${spdSpan}ms < ${span / 2}ms）`);
  await spd.close();

  // ---- 回放：未命中转发上游 ----
  const prox = await startReplayServer({
    port: 0, file, match: 'hash', onMiss: 'proxy',
    upstream: `http://127.0.0.1:${upstream.port}`, apiKey: REAL_KEY, log: false,
  });
  t.after(() => prox.close());
  const before = upstream.hits.get('chat-json') ?? 0;
  const px = await req(prox.port, '/v1/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer sk-fake' }, body: chatBody('fresh-prompt'),
  });
  assert.equal(px.status, 200);
  assert.equal((await jsonOf(px)).choices[0].message.content, 'Hello!');
  assert.equal(upstream.hits.get('chat-json'), before + 1, '未命中请求应真实到达上游');
  // 命中的请求不走上游
  const hitBefore = upstream.hits.get('models') ?? 0;
  await req(prox.port, '/v1/models');
  assert.equal(upstream.hits.get('models'), hitBefore);
  await prox.close();
});

test('多会话按序号录制到目录 + 目录整体回放', async (t) => {
  const upstream = await startFakeUpstream();
  t.after(() => upstream.close());
  const dir = mkdtempSync(join(tmpdir(), 'llm-replay-dir-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const assets = join(dir, 'assets');
  const auth = { authorization: `Bearer ${REAL_KEY}`, 'content-type': 'application/json' };

  // 会话 1：录制 models
  const f1 = await resolveRecordOut(assets);
  assert.ok(f1.endsWith(join('assets', '001.jsonl')), `首个序号文件应为 001.jsonl，得到 ${f1}`);
  const rec1 = await startRecordServer({ port: 0, upstream: `http://127.0.0.1:${upstream.port}`, file: f1, log: false });
  t.after(() => rec1.close());
  await (await req(rec1.port, '/v1/models', { headers: auth })).json();
  await rec1.close();

  // 会话 2：录制 embeddings
  const f2 = await resolveRecordOut(assets);
  assert.ok(f2.endsWith('002.jsonl'), `第二个序号文件应为 002.jsonl，得到 ${f2}`);
  const rec2 = await startRecordServer({ port: 0, upstream: `http://127.0.0.1:${upstream.port}`, file: f2, log: false });
  t.after(() => rec2.close());
  await (await req(rec2.port, '/v1/embeddings', { method: 'POST', headers: auth, body: JSON.stringify({ model: 'e', input: 'x' }) })).json();
  await rec2.close();

  // 目录合并读取：两个文件按名序加载，id 带文件前缀
  const entries = await readJsonl(assets);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id.startsWith('001/'), true);
  assert.equal(entries[0].request.path, '/v1/models');
  assert.equal(entries[1].id.startsWith('002/'), true);
  assert.equal(entries[1].request.path, '/v1/embeddings');

  // 目录回放：sequence 跨文件按序（先 models 后 embeddings）
  const seq = await startReplayServer({ port: 0, file: assets, match: 'sequence', pace: 'instant', log: false });
  t.after(() => seq.close());
  const r1 = await req(seq.port, '/anything');
  assert.equal((await jsonOf(r1)).data[0].id, 'gpt-test');
  const r2 = await req(seq.port, '/anything', { method: 'POST', body: 'x' });
  assert.deepEqual((await jsonOf(r2)).data[0].embedding, [0.1, 0.2]);
  assert.equal(r2.headers.get('x-llm-replay'), 'hit:002/rec-000001');
  await seq.close();

  // 目录回放：hash 模式同样可用
  const hash = await startReplayServer({ port: 0, file: assets, match: 'hash', log: false });
  t.after(() => hash.close());
  const hm = await req(hash.port, '/v1/models');
  assert.equal((await jsonOf(hm)).data[0].id, 'gpt-test');
  await hash.close();
});

test('resolveRecordOut 序号续接与 .jsonl 直通', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-replay-seq-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 目录里已有 007.jsonl → 下一个应是 008
  writeFileSync(join(dir, '007.jsonl'), '{}\n');
  const next = await resolveRecordOut(dir);
  assert.ok(next.endsWith('008.jsonl'), `应续接到 008，得到 ${next}`);

  // .jsonl 结尾直通不改名（父目录自动创建）
  const direct = await resolveRecordOut(join(dir, 'sub', 'x.jsonl'));
  assert.equal(direct, join(dir, 'sub', 'x.jsonl'));
  assert.ok(existsSync(join(dir, 'sub')));
});

test('resolveRecordOut 带 tag 创建用例目录与混合序号续接', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-replay-tag-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 空目录 + tag → 用例目录 001-<tag>/session.jsonl + README 骨架，非法字符被替换
  const withTag = await resolveRecordOut(dir, 'fix calc/bug!', 'https://api.deepseek.com');
  assert.ok(withTag.endsWith(join('001-fix-calc-bug', 'session.jsonl')), `应为 001-fix-calc-bug/session.jsonl，得到 ${withTag}`);
  assert.ok(existsSync(join(dir, '001-fix-calc-bug', 'README.md')), '应生成 README.md 骨架');
  const readme = readFileSync(join(dir, '001-fix-calc-bug', 'README.md'), 'utf8');
  assert.ok(readme.includes('001-fix-calc-bug') && readme.includes('api.deepseek.com'), 'README 应含用例名与上游 host');

  // 目录里已有 002-xxx.jsonl（扁平带含义）与 005-yyy/（用例目录）→ 续接到 006
  writeFileSync(join(dir, '002-note-qa.jsonl'), '{}\n');
  mkdirSync(join(dir, '005-codebase-qa'));
  const next = await resolveRecordOut(dir);
  assert.ok(next.endsWith('006.jsonl'), `应续接到 006，得到 ${next}`);
  const nextTagged = await resolveRecordOut(dir, 'embed');
  assert.ok(nextTagged.endsWith(join('006-embed', 'session.jsonl')), `应为 006-embed/session.jsonl，得到 ${nextTagged}`);
});

test('用例目录录制 -> 用例库整体回放', async (t) => {
  const upstream = await startFakeUpstream();
  t.after(() => upstream.close());
  const root = mkdtempSync(join(tmpdir(), 'llm-replay-cases-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const auth = { authorization: `Bearer ${REAL_KEY}`, 'content-type': 'application/json' };

  // 用例 1（用例目录）：录制 models
  const case1 = await resolveRecordOut(root, 'case-one', `http://127.0.0.1:${upstream.port}`);
  const rec1 = await startRecordServer({ port: 0, upstream: `http://127.0.0.1:${upstream.port}`, file: case1, log: false });
  t.after(() => rec1.close());
  await (await req(rec1.port, '/v1/models', { headers: auth })).json();
  await rec1.close();

  // 用例 2（扁平文件）：录制 embeddings —— 用例库允许混用
  const flat = await resolveRecordOut(root);
  const rec2 = await startRecordServer({ port: 0, upstream: `http://127.0.0.1:${upstream.port}`, file: flat, log: false });
  t.after(() => rec2.close());
  await (await req(rec2.port, '/v1/embeddings', { method: 'POST', headers: auth, body: JSON.stringify({ model: 'e', input: 'x' }) })).json();
  await rec2.close();

  // 用例库整体读取：用例目录（前缀=用例名）+ 扁平文件（前缀=文件名）按名称序合并
  const entries = await readJsonl(root);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id.startsWith('001-case-one/'), true);
  assert.equal(entries[0].request.path, '/v1/models');
  assert.equal(entries[1].id.startsWith('002/'), true);
  assert.equal(entries[1].request.path, '/v1/embeddings');

  // 单用例回放 与 用例库整体回放
  const one = await startReplayServer({ port: 0, file: join(root, '001-case-one'), match: 'sequence', log: false });
  t.after(() => one.close());
  assert.equal((await jsonOf(await req(one.port, '/x'))).data[0].id, 'gpt-test');
  await one.close();

  const all = await startReplayServer({ port: 0, file: root, match: 'sequence', pace: 'instant', log: false });
  t.after(() => all.close());
  assert.equal((await jsonOf(await req(all.port, '/x'))).data[0].id, 'gpt-test');
  assert.deepEqual((await jsonOf(await req(all.port, '/x', { method: 'POST', body: 'q' }))).data[0].embedding, [0.1, 0.2]);
  assert.equal((await req(all.port, '/x')).status, 404, '两条放完应 404');
  await all.close();
});
