'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function valid(event) {
  return typeof event?.title === 'string' && event.title.trim().length > 0 && event.title.length <= 100
    && Number.isSafeInteger(event.at) && event.at >= 0 && event.at < Date.UTC(10000, 0, 1)
    && typeof event.color === 'string' && /^#[0-9a-f]{6}$/i.test(event.color);
}

function createSchedules(userData) {
  const file = path.join(userData, 'schedules.json');
  let items = [];
  let readable = true;
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(stored) || !stored.every(item => valid(item) && typeof item.id === 'string')) {
      throw new Error('Invalid schedules');
    }
    items = stored;
  } catch (error) {
    readable = error.code === 'ENOENT';
  }

  function write(next) {
    if (!readable) return { error: '无法读取本地日程文件' };
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify(next), 'utf8');
      fs.renameSync(file + '.tmp', file);
      items = next;
      return { items };
    } catch { return { error: '无法保存日程，请重试' }; }
  }

  return {
    get items() { return items; },
    save(event) {
      if (!valid(event)) return { error: '请填写有效的标题、日期、时间和颜色' };
      const entry = { id: randomUUID(), title: event.title.trim(), at: event.at, color: event.color.toLowerCase() };
      if (event.id == null) return write([...items, entry]);
      if (typeof event.id !== 'string' || !items.some(item => item.id === event.id)) return { error: '找不到这条日程' };
      entry.id = event.id;
      return write(items.map(item => item.id === entry.id ? entry : item));
    },
    remove(id) {
      if (typeof id !== 'string') return { error: '找不到这条日程' };
      return write(items.filter(item => item.id !== id));
    }
  };
}

module.exports = { createSchedules };
