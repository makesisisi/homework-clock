'use strict';

const { createHash } = require('node:crypto');

// 作业列表解析改编自 gujialei628/chaoxing-homework（MIT，见 LICENSE.chaoxing）。
const WORK_URL = 'https://mooc1-api.chaoxing.com/work/stu-work';
const COURSE_URL = 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&mcode=';
const LOGIN_URL = 'https://passport2.chaoxing.com/login?fid=0&newversion=true&refer=' + encodeURIComponent(WORK_URL);
const TODO = new Set(['未提交', '未交', '待提交', '未完成', '待重做', '已驳回']);
const EXPIRED = new Set(['已过期', '已截止', '已结束']);
const DONE = new Set(['待批阅', '已完成', '已提交', '已互评', '已通过', '已批阅']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text) {
  return String(text).replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi, (token, numeric, named) => {
    if (named) return ENTITIES[named.toLowerCase()] ?? token;
    const value = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : Number(numeric);
    return value <= 0x10ffff ? String.fromCodePoint(value) : token;
  });
}

function plain(text = '') {
  return decode(text.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function schoolUrl(value, base = WORK_URL) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    const school = url.hostname === 'chaoxing.com' || url.hostname.endsWith('.chaoxing.com');
    return url.protocol === 'https:' && school && !url.username && !url.password && !url.port ? url.href : null;
  } catch {
    return null;
  }
}

function remaining(text) {
  if (/已(?:截止|过期|结束)/.test(text)) return -1;
  const units = [[/(\d+)\s*天/, 86400000], [/(\d+)\s*(?:小时|时)/, 3600000],
    [/(\d+)\s*分/, 60000], [/(\d+)\s*秒/, 1000]];
  const parts = units.map(([pattern, unit]) => {
    const match = text.match(pattern);
    return match ? Number(match[1]) * unit : null;
  }).filter(value => value !== null);
  const total = parts.reduce((sum, value) => sum + value, 0);
  return parts.length && Number.isSafeInteger(total) ? total : null;
}

function parseWork(html, observedAt) {
  const rows = [...html.matchAll(/<li\b[^>]*\sdata\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/li>/gi)];
  if (!rows.length && !/作业列表/.test(html)) {
    throw new Error('学习通返回了无法识别的作业页面');
  }
  const items = new Map();
  let recognized = 0;
  for (const [, , data, body] of rows) {
    const title = plain(body.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    if (!title) continue;
    const labels = [...body.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map(match => plain(match[1]));
    const status = labels.find(label => TODO.has(label) || EXPIRED.has(label) || DONE.has(label));
    if (!status) continue;
    recognized++;
    if (DONE.has(status)) continue;
    const rawUrl = decode(data);
    const url = rawUrl.trim() ? schoolUrl(rawUrl) : null;
    const params = url ? new URL(url).searchParams : new URLSearchParams();
    const courseId = params.get('courseId') || '';
    const id = params.get('taskrefId') || params.get('workId') || createHash('sha256').update(url || title).digest('hex');
    const course = labels.find(label => /^《.*》$/.test(label))?.slice(1, -1) || '';
    const timeLabel = labels.find(label => /剩余|已截止|已过期|已结束/.test(label)) || '';
    const left = EXPIRED.has(status) ? -1 : remaining(timeLabel);
    items.set(courseId + ':' + id, {
      id: courseId + ':' + id, source: 'chaoxing', title, courseId, course, url,
      expired: left === -1, deadline: left !== null && left >= 0 ? observedAt + left : null
    });
  }
  if (rows.length && !recognized) throw new Error('未能识别学习通作业状态，请稍后重试');
  return [...items.values()];
}

function parseCourses(html) {
  const names = new Map();
  for (const channel of JSON.parse(html).channelList || []) {
    for (const course of channel.content?.course?.data || []) {
      const id = course.courseId || course.id;
      if (id && typeof course.name === 'string') names.set(String(id), course.name);
    }
  }
  return names;
}

function demoItems(now) {
  const day = 86400000;
  return [
    ['极限与连续练习', '高等数学', now + 6 * 3600000 + 60000],
    ['指针与数组', '程序设计', now + 2 * day + 7 * 3600000 + 60000],
    ['实验预习报告', '普通物理', now + 4 * day + 60000]
  ].map(([title, course, deadline], i) => ({
    id: 'demo-' + i, source: 'chaoxing', title, course, deadline, expired: false, url: null
  }));
}

module.exports = { WORK_URL, COURSE_URL, LOGIN_URL, schoolUrl, parseWork, parseCourses, demoItems };
