#!/usr/bin/env node
/**
 * 演示用假 OpenAI 上游：无需真实 API key 即可体验 llm-replay 录制/回放全流程。
 *
 *   node demo/fake-upstream.mjs 9000
 */
import http from 'node:http';

const port = Number(process.argv[2] ?? 9000);

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const url = req.url ?? '';

    if (url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model' }] }));
      return;
    }

    if (url === '/v1/embeddings') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ object: 'embedding', index: 0, embedding: [0.1, -0.2, 0.3] }] }));
      return;
    }

    if (url === '/v1/chat/completions' && body?.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      const pieces = ['你好', '，这是', '假的', '流式回复', '。'];
      let i = 0;
      const tick = () => {
        if (i >= pieces.length) {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(`data: ${JSON.stringify({ id: 'fake', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: pieces[i++] } }] })}\n\n`);
        setTimeout(tick, 80);
      };
      res.flushHeaders();
      tick();
      return;
    }

    if (url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'fake', object: 'chat.completion', model: body?.model ?? 'fake-model',
        choices: [{ index: 0, message: { role: 'assistant', content: '你好，这是假的非流式回复。' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `unknown path: ${url}` } }));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[fake-upstream] listening on http://127.0.0.1:${port}`);
});
