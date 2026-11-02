#!/usr/bin/env node
// Prompt Forge — 零依赖本地服务：静态页 + OpenAI 兼容流式代理
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMessages, TARGETS } from './meta.mjs';
import { MOCK as MOCK_TEXTS } from './mock.mjs';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const MOCK = process.env.MOCK === '1';
const ENV_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function chatEndpoint(base) {
  const b = (base || '').trim().replace(/\/+$/, '');
  if (!b) return 'https://api.deepseek.com/v1/chat/completions';
  if (/\/chat\/completions$/.test(b)) return b;
  return `${b}/chat/completions`;
}

async function handleGenerate(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return send(res, 400, { error: `请求体解析失败：${e.message}` });
  }

  const { target = 'claude', requirement = '', notes = '', config = {} } = body;
  if (!TARGETS[target]) return send(res, 400, { error: `未知目标模型：${target}` });
  if (!requirement.trim()) return send(res, 400, { error: '需求不能为空' });
  if (requirement.length > 8000) return send(res, 400, { error: '需求过长（上限 8000 字）' });

  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
  });
  const emit = (obj) => res.write(JSON.stringify(obj) + '\n');

  // MOCK：无 key 也能端到端验收 UI 与流式链路
  if (MOCK) {
    for (const ch of (MOCK_TEXTS[target] || MOCK_TEXTS.claude).match(/[\s\S]{1,24}/g) || []) {
      emit({ type: 'delta', text: ch });
      await new Promise((r) => setTimeout(r, 12));
    }
    emit({ type: 'done', mock: true });
    return res.end();
  }

  const apiKey = (config.apiKey || ENV_KEY || '').trim();
  if (!apiKey) {
    emit({ type: 'error', error: '缺少 API Key：点右上角设置填入，或启动时设 DEEPSEEK_API_KEY' });
    return res.end();
  }

  const endpoint = chatEndpoint(config.baseUrl);
  const model = (config.model || 'deepseek-chat').trim();
  const messages = buildMessages(target, requirement, notes);

  const ac = new AbortController();
  const onClose = () => ac.abort();
  req.on('close', onClose);

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.4,
        max_tokens: 2000,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const raw = await upstream.text().catch(() => '');
      let msg = raw.slice(0, 600);
      try {
        const j = JSON.parse(raw);
        msg = j.error?.message || j.message || msg;
      } catch { /* 保持原文 */ }
      emit({ type: 'error', error: `上游 ${upstream.status}：${msg || '无响应体'}` });
      return res.end();
    }

    const reader = upstream.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let chars = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta?.content;
          if (delta) {
            chars += delta.length;
            emit({ type: 'delta', text: delta });
          }
        } catch { /* 忽略心跳/不完整帧 */ }
      }
    }

    if (!chars) emit({ type: 'error', error: '上游返回空内容：检查 model 名称与 endpoint 是否正确' });
    else emit({ type: 'done', chars });
    res.end();
  } catch (e) {
    if (e.name !== 'AbortError') emit({ type: 'error', error: `请求失败：${e.message}` });
    res.end();
  } finally {
    req.off('close', onClose);
  }
}

async function handleStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  const file = normalize(join(PUBLIC, path));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, {
        ok: true,
        mock: MOCK,
        hasEnvKey: Boolean(ENV_KEY),
        targets: Object.values(TARGETS).map((t) => ({
          id: t.id,
          label: t.label,
          sub: t.sub,
          accent: t.accent,
          tagline: t.tagline,
          hint: t.hint,
          placeholder: t.placeholder,
        })),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      return await handleGenerate(req, res);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return await handleStatic(req, res);
    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Prompt Forge → http://${HOST}:${PORT}`);
  console.log(`  mock=${MOCK}  envKey=${ENV_KEY ? 'set' : 'none'}`);
});
