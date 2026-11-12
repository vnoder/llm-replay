#!/usr/bin/env node
/**
 * 批量录制 Agent 级测试用例（016-020）到 assets/，客户端为 pi coding agent。
 *
 *   DEEPSEEK_API_KEY=sk-xxx node scripts/record-agent-cases.mjs
 *
 * 每个用例：准备夹具到固定 staging 目录 → 程序化启动录制服务器(8787) →
 * spawn pi --print 运行 → 关闭落盘 → 写 README。
 * 注意：pi 工具调用会烧入 staging 绝对路径，README 会标注复现路径。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
const STAGING_ROOT = 'D:/pi-test/staging';
const AGENT_DIR = 'D:/pi-test/agent-record'; // models.json baseUrl → http://127.0.0.1:8787/v1
const PORT = 8787;

// ---------------------------------------------------------------- 用例定义

const CASES = [
  {
    tag: 'agent-grep-find',
    title: '代码库检索问答（grep/find/read 只读）',
    purpose: 'agent 只读检索用例：在多文件小代码库中定位负责某功能的函数并引用代码，全程不修改文件。适合测试 agent 的检索工具链与引用准确性。',
    tools: 'read,grep,find',
    files: {
      'src/strings.js': `export function reverseString(s) {\n  return s.split('').reverse().join('');\n}\n\nexport function capitalizeWords(s) {\n  return s.replace(/\\b\\w/g, (c) => c.toUpperCase());\n}\n`,
      'src/math.js': `export function gcd(a, b) {\n  return b === 0 ? a : gcd(b, a % b);\n}\n\nexport function lcm(a, b) {\n  return (a * b) / gcd(a, b);\n}\n`,
      'src/main.js': `import { reverseString, capitalizeWords } from './strings.js';\nimport { lcm } from './math.js';\n\nconsole.log(reverseString('replay'));\nconsole.log(capitalizeWords('hello world'));\nconsole.log(lcm(4, 6));\n`,
    },
    prompt: '这个项目里哪个文件的哪个函数负责字符串反转？请引用该函数的完整代码作为证据。只允许使用 grep、find、read 工具，不要修改任何文件。',
    expect: '回答指出 src/strings.js 的 reverseString 并给出函数体；工作区文件无任何改动。',
  },
  {
    tag: 'agent-write-file',
    title: '从零创建文件并运行（write/bash）',
    purpose: 'agent 创建型用例：用 write 从零创建 hello.js 并用 bash 运行验证输出，验证回放下文件创建副作用可复现。',
    tools: 'write,bash',
    files: {},
    prompt: '在当前目录创建文件 hello.js，内容为一个输出 Hello Replay 2026 的 Node 程序，然后用 node 运行它并贴出真实输出。',
    expect: '生成 hello.js 且 node 运行输出 Hello Replay 2026。',
  },
  {
    tag: 'agent-bash-pipeline',
    title: 'bash 文本处理管道（词频统计）',
    purpose: 'agent 命令型用例：用 bash 管道（sort/uniq 等）统计词频 Top3，验证命令执行与输出解析回放。',
    tools: 'read,bash',
    files: {
      'data.txt': 'apple\nbanana\napple\ncherry\nbanana\napple\ncherry\nbanana\ndate\n',
    },
    prompt: '统计 data.txt 中每个单词出现的次数，按次数从高到低输出前 3 名，格式为 单词:次数，每行一个。',
    expect: 'banana:3、apple:3、cherry:2 的排序结果（banana 与 apple 并列时的顺序以录制的回答为准）。',
  },
  {
    tag: 'agent-read-edit-run',
    title: '读改跑综合（修复非法 JSON 配置）',
    purpose: 'agent 综合用例：读取带错的 config.json → edit 修复非法语法并把端口改为数字 → bash 运行 node 验证，验证读/改/跑三段式副作用。',
    tools: 'read,edit,bash',
    files: {
      'config.json': '{\n  "host": "127.0.0.1",\n  "port": "8080",\n}\n',
    },
    prompt: 'config.json 目前无法被 JSON.parse。请修复其中的语法错误，并把 port 的值改成数字 8080，最后用 node -e 运行一段脚本验证能成功解析并打印出 port。',
    expect: 'config.json 变为合法 JSON 且 port 为数字 8080；验证脚本输出 8080。',
  },
];

// 两阶段编排（subagent 模式）：A 规划 → B 按规划执行，两个 session 文件
const TWO_PHASE = {
  tag: 'agent-two-phase',
  title: '两阶段编排：planner → executor（subagent 模式）',
  purpose: 'subagent 编排用例：模拟编排器先调 planner 会话产出执行计划，再把计划注入 executor 会话执行。用例目录含 1-plan.jsonl 与 2-execute.jsonl 两个 session，验证"多会话接力"的回放。',
  files: {
    'data.csv': 'name,score\nalice,90\nbob,75\ncarol,88\ndave,62\neve,95\n',
  },
  planPrompt: '读取 data.csv，然后只输出一个把该 CSV 转成 markdown 表格的分步执行计划（不超过 4 步，每步一句话）。不要执行任何修改或命令。',
  execPromptPrefix: '按以下计划执行，完成后展示最终的 markdown 表格：\n\n',
  planTools: 'read',
  execTools: 'read,bash',
  expect: 'executor 输出包含 5 行数据的 markdown 表格；两个 session 按文件名序被 sequence 模式依次回放。',
};

// ---------------------------------------------------------------- 工具函数

function stage(tag, files) {
  const dir = join(STAGING_ROOT, tag);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(target.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return dir;
}

function runPi(cwd, prompt, tools) {
  // 必须用异步 spawn：录制服务器与本脚本同进程，spawnSync 会阻塞事件循环，
  // 服务器将无法响应 pi 的请求，导致 pi 挂起直到超时。
  const cmd = `pi --print --model deepseek-chat --provider deepseek-local --tools ${tools} "${prompt.replace(/"/g, "'")}"`;
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn('bash', ['-lc', cmd], {
      cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR },
      stdio: ['ignore', 'pipe', 'pipe'], // 关闭 stdin：--print 模式下 pi 等待 stdin EOF
    });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => p.kill('SIGTERM'), 550_000);
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`pi 退出码 ${code} 信号 ${signal ?? '-'} 耗时 ${Date.now() - t0}ms：${(out + err).slice(0, 300)}`));
        return;
      }
      console.log(`    pi 完成（${Date.now() - t0}ms）`);
      resolve(out.trim());
    });
    p.on('error', reject);
  });
}

async function recordSession(file, cwd, prompt, tools) {
  const server = await startRecordServer({ port: PORT, upstream: UPSTREAM, file, apiKey: KEY, log: false });
  try {
    const answer = await runPi(cwd, prompt, tools);
    if (!answer) throw new Error('pi 无输出');
    return answer;
  } finally {
    await server.close();
  }
}

function writeReadme(caseDir, tag, title, purpose, sessions, staging, expect, tools) {
  const sessionDesc = sessions.map(([f, n]) => `${f}（${n} 轮）`).join('、');
  writeFileSync(join(caseDir, 'README.md'), `# ${tag} — ${title}

## 用途

${purpose}

- 录制日期：${new Date().toISOString().slice(0, 10)}（上游 DeepSeek deepseek-chat，pi v1.5.2）
- 回放数据：${sessionDesc}
- 夹具：本目录 \`workspace/\`（录制时的初始状态）

## 回放

\`\`\`bash
node dist/src/cli.js replay -p 8788 -f assets/${tag} -m sequence --pace instant
\`\`\`

## 测试步骤

1. **副作用复现需在录制路径运行**：把 \`workspace/\` 夹具复制到 \`${staging}\`
2. 启动回放服务器（上方命令）
3. 在该目录用 pi 以相同 prompt 运行（prompt 见 prompt.txt）：
   \`\`\`bash
   cd ${staging}
   PI_CODING_AGENT_DIR=<agent-dir 指向 http://127.0.0.1:8788/v1> pi --print \\
     --model deepseek-chat --provider deepseek-local --tools ${tools} '<prompt.txt 内容>'
   \`\`\`

## 预期结果

${expect}

## 已知差异

- 工具调用参数烧入录制时的绝对路径（\`${staging}\`），换目录运行对话一致但文件副作用落到该路径
- pi 生成的 tool_call ID / 命令措辞每次不同——这正是必须用 sequence 模式的原因
`, 'utf8');
}

function saveWorkspaceFixture(caseDir, stagingDir) {
  // 递归拷贝 staging 复制初始态由调用方处理；这里只建目录说明
  mkdirSync(join(caseDir, 'workspace'), { recursive: true });
}

async function countEntries(file) {
  const es = await readJsonl(file);
  return es.length;
}

// ---------------------------------------------------------------- 主流程

const only = process.argv[2];

for (const c of CASES) {
  if (only && c.tag !== only) continue;
  const file = await resolveRecordOut(ASSETS, c.tag, UPSTREAM);
  const caseDir = file.replace(/[\\/][^\\/]+$/, '');
  const staging = stage(c.tag, c.files);
  // 夹具：初始状态拷入用例目录
  saveWorkspaceFixture(caseDir, staging);
  for (const [rel, content] of Object.entries(c.files)) {
    const target = join(caseDir, 'workspace', rel);
    mkdirSync(target.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  await recordSession(file, staging, c.prompt, c.tools);
  const rounds = await countEntries(file);
  writeReadme(caseDir, c.tag, c.title, c.purpose, [['session.jsonl', rounds]], staging, c.expect, c.tools);
  writeFileSync(join(caseDir, 'prompt.txt'), c.prompt + '\n', 'utf8');
  console.log(`[ok] ${c.tag} → ${rounds} 轮`);
}

// 两阶段编排用例
if (!only || only === TWO_PHASE.tag) {
  const file = await resolveRecordOut(ASSETS, TWO_PHASE.tag, UPSTREAM);
  const caseDir = file.replace(/[\\/][^\\/]+$/, '');
  const staging = stage(TWO_PHASE.tag, TWO_PHASE.files);
  mkdirSync(join(caseDir, 'workspace'), { recursive: true });
  for (const [rel, content] of Object.entries(TWO_PHASE.files)) {
    writeFileSync(join(caseDir, 'workspace', rel), content, 'utf8');
  }
  const planFile = join(caseDir, '1-plan.jsonl');
  const execFile = join(caseDir, '2-execute.jsonl');
  // 阶段 A：planner
  const plan = await recordSession(planFile, staging, TWO_PHASE.planPrompt, TWO_PHASE.planTools);
  // 阶段 B：executor（把 A 的真实输出注入 prompt）
  const execPrompt = TWO_PHASE.execPromptPrefix + plan;
  await recordSession(execFile, staging, execPrompt, TWO_PHASE.execTools);
  const n1 = await countEntries(planFile);
  const n2 = await countEntries(execFile);
  writeReadme(caseDir, TWO_PHASE.tag, TWO_PHASE.title, TWO_PHASE.purpose,
    [['1-plan.jsonl', n1], ['2-execute.jsonl', n2]], staging, TWO_PHASE.expect, 'read,bash');
  writeFileSync(join(caseDir, 'prompt.txt'),
    `# 阶段 A（planner）\n${TWO_PHASE.planPrompt}\n\n# 阶段 B（executor，含阶段 A 实际输出）\n${TWO_PHASE.execPromptPrefix}${plan}\n`, 'utf8');
  console.log(`[ok] ${TWO_PHASE.tag} → plan ${n1} 轮 + execute ${n2} 轮`);
}

console.log('\n全部 Agent 级用例录制完成');
