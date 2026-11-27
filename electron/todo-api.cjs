'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { safeStorage } = require('electron');

const HOST = '127.0.0.1';
const TODOS = '/v1/todos';
const COUNTDOWNS = '/v1/countdowns';
const DATA = '/v1/data';
const MAX_BODY = 4096;
const TOKEN = /^[a-f0-9]{64}$/;

function respond(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
  res.end(JSON.stringify(data));
}

function authorized(header, token) {
  const value = /^Bearer ([a-f0-9]{64})$/i.exec(header ?? '')?.[1];
  return value && timingSafeEqual(Buffer.from(value), Buffer.from(token));
}

function isoTime(value) {
  if (!Number.isFinite(value)) return null;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}

function parseTarget(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?:(:\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const local = match[1] + (match[2] ?? ':00');
  if (isoTime(Date.parse(local + 'Z'))?.slice(0, 19) !== local) return NaN;
  return Date.parse(value);
}

function countdownRecord({ id, title, at, color, theme, ink, layout, visible }) {
  return { id, title, at: isoTime(at), color, theme, ink, layout, visible };
}

const readers = new Map([
  ['todos', ({ todos }) => ({
    error: todos.error,
    items: todos.items.map(({ id, title, date, done, course, homeworkId }) => ({ id, title, date, done, course, homeworkId }))
  })],
  ['countdowns', ({ countdowns }) => countdowns.map(countdownRecord)],
  ['schedules', ({ schedules }) => schedules.map(({ id, title, at, color }) => ({ id, title, at: isoTime(at), color }))],
  ['homework', ({ homework }) => ({
    status: homework.status, syncedAt: isoTime(homework.syncedAt),
    items: homework.items.map(({ id, title, course, deadline, expired }) => ({
      id, title, course, deadline: isoTime(deadline), expired: expired || (Number.isFinite(deadline) && deadline <= Date.now())
    }))
  })],
  ['timetable', ({ timetable }) => timetable ? {
    monday: timetable.monday, schoolName: timetable.schoolName,
    lessons: timetable.lessons.map(({ title, room, week, day, start, end }) => ({
      title, room, week, day, start: isoTime(start), end: isoTime(end)
    }))
  } : null]
]);

function createTodoApi(profile, { addTodo, addCountdown, readState }, port = 47831) {
  const file = path.join(profile, 'todo-api.bin');
  let server;
  let token;
  let error = '';
  let pending = Promise.resolve();
  const baseUrl = () => `http://${HOST}:${server?.address()?.port ?? port}`;
  const status = () => ({ enabled: Boolean(server), url: baseUrl() + TODOS, baseUrl: baseUrl(), error });
  const writes = new Map([
    [TODOS, { type: 'todo', fields: ['title', 'date'], add: addTodo, record: entry => entry }],
    [COUNTDOWNS, {
      type: 'countdown', fields: ['title', 'at', 'color', 'theme', 'ink', 'layout'], record: countdownRecord,
      add(data, key) {
        const at = parseTarget(data.at);
        if (!Number.isFinite(at)) return { error: 'at 必须是包含时区的有效 ISO 8601 时间', status: 400 };
        return addCountdown({ ...data, at }, key);
      }
    }]
  ]);

  function serialize(operation) {
    const task = pending.then(operation);
    pending = task.catch(() => {});
    return task;
  }

  function receive(req, res) {
    const fail = (code, message) => respond(res, code, { error: message });
    req.on('error', () => fail(400, '请求未完整接收'));
    if (req.headers.host !== `${HOST}:${server?.address()?.port}` || req.headers.origin) {
      return fail(403, '请使用本机 HTTP 客户端调用');
    }
    const resource = req.url?.startsWith('/v1/') ? req.url.slice(4) : '';
    const canRead = req.url === DATA || readers.has(resource);
    const writer = writes.get(req.url);
    if (!canRead && !writer) return fail(404, '接口不存在');
    if (!((req.method === 'GET' && canRead) || (req.method === 'POST' && writer))) {
      res.setHeader('Allow', canRead && writer ? 'GET, POST' : canRead ? 'GET' : 'POST');
      return fail(405, '接口不支持此请求方法');
    }
    const activeToken = token;
    if (!activeToken || !authorized(req.headers.authorization, activeToken)) return fail(401, '接口密钥无效');
    if (req.method === 'GET') {
      try {
        const state = readState();
        const view = req.url === DATA ? Object.fromEntries([...readers].map(([name, project]) => [name, project(state)]))
          : { [resource]: readers.get(resource)(state) };
        return respond(res, 200, { timeZone: 'Asia/Shanghai', ...view });
      } catch { return fail(500, '无法读取课隙数据'); }
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return fail(415, '请提交 JSON');
    if (Number(req.headers['content-length']) > MAX_BODY) return fail(413, '请求内容太长');
    const key = req.headers['idempotency-key'];
    if (key !== undefined && !/^[a-zA-Z0-9._:-]{1,80}$/.test(key)) return fail(400, '请求标识无效');

    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      if (res.writableEnded) return;
      size += chunk.length;
      if (size > MAX_BODY) fail(413, '请求内容太长');
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded || res.destroyed) return;
      if (token !== activeToken) return fail(401, '接口密钥已失效');
      let data;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return fail(400, '无法读取 JSON 请求'); }
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !writer.fields.includes(key))) {
        return fail(400, 'JSON 字段无效，可用字段为 ' + writer.fields.join(', '));
      }
      try {
        const result = writer.add(data, key);
        if (result.error) return fail(result.status ?? 500, result.error);
        respond(res, result.repeated ? 200 : 201, { [writer.type]: writer.record(result.entry), repeated: Boolean(result.repeated) });
      } catch { fail(500, '无法保存请求的数据，请重试'); }
    });
  }

  function close() {
    const current = server;
    server = undefined;
    token = undefined;
    if (!current) return Promise.resolve();
    return new Promise(resolve => {
      current.close(resolve);
      current.closeAllConnections();
    });
  }

  async function start(restore) {
    error = '';
    if (server) return status();
    const saved = fs.existsSync(file);
    if (restore && !saved) return status();
    let candidate;
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('Encryption unavailable');
      let key;
      if (saved) {
        try {
          const { result: stored } = await safeStorage.decryptStringAsync(fs.readFileSync(file));
          if (TOKEN.test(stored)) key = stored;
        } catch { /* An unreadable key can be replaced by explicitly enabling the API. */ }
      }
      if (restore && !key) { error = '无法恢复接口密钥，请重新开启'; return status(); }
      let encrypted;
      if (!key) {
        key = randomBytes(32).toString('hex');
        encrypted = await safeStorage.encryptStringAsync(key);
      }
      candidate = createServer({ requestTimeout: 10000, headersTimeout: 5000, maxHeaderSize: 8192 }, receive);
      candidate.setTimeout(8000, socket => socket.destroy());
      await new Promise((resolve, reject) => {
        candidate.on('error', reject);
        candidate.listen(port, HOST, resolve);
      });
      if (encrypted) {
        fs.mkdirSync(profile, { recursive: true });
        fs.writeFileSync(file + '.tmp', encrypted);
        fs.renameSync(file + '.tmp', file);
      }
      token = key;
      server = candidate;
    } catch (cause) {
      if (candidate?.listening) { candidate.close(); candidate.closeAllConnections(); }
      error = cause.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : '无法启动 AI 接口';
    }
    return status();
  }

  return {
    status,
    restore: () => serialize(() => start(true)),
    configure: enabled => serialize(async () => {
      if (enabled === true) return start(false);
      if (enabled !== false) return status();
      try {
        fs.rmSync(file, { force: true });
        await close();
        error = '';
      } catch { error = '无法停用 AI 接口，请重试'; }
      return status();
    }),
    config: () => server && {
      url: baseUrl() + TODOS, baseUrl: baseUrl(), token,
      endpoints: Object.fromEntries(['data', ...readers.keys()].map(name => [name, `${baseUrl()}/v1/${name}`]))
    },
    close
  };
}

module.exports = { createTodoApi };
