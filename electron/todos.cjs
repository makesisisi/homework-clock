'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' });

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validTodo(todo) {
  if (!validDate(todo?.date) || typeof todo.title !== 'string' || !todo.title.trim()) return false;
  if (todo.homeworkId === undefined) return todo.title.length <= 100;
  return typeof todo.homeworkId === 'string' && todo.homeworkId.length > 0 && typeof todo.course === 'string';
}

function createTodos(userData, onChange = () => {}) {
  const file = path.join(userData, 'todos.json');
  let items = [];
  let error = '';
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(stored) || !stored.every(item => validTodo(item)
      && typeof item.id === 'string' && typeof item.done === 'boolean')) {
      throw new Error('Invalid todos');
    }
    items = stored;
  } catch (readError) {
    if (readError.code !== 'ENOENT') error = '无法读取本地待办文件';
  }

  function write(next) {
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify(next), 'utf8');
      fs.renameSync(file + '.tmp', file);
      items = next;
    } catch {
      return { error: '无法保存待办，请重试' };
    }
    onChange({ items, error });
    return { items };
  }

  function add(change, id) {
    if (!validTodo(change)) return { error: '请填写有效的待办内容和日期', status: 400 };
    const entry = { id, date: change.date, title: change.title.trim(), done: false };
    if (change.homeworkId !== undefined) {
      if (items.some(item => item.date === entry.date && item.homeworkId === change.homeworkId)) return { items };
      entry.homeworkId = change.homeworkId;
      entry.course = change.course;
    }
    const result = write([...items, entry]);
    return result.error ? result : { ...result, entry };
  }

  return {
    get state() { return { items, error }; },
    addFromApi({ title, date }, key) {
      if (error) return { error };
      const id = key ? 'api-' + createHash('sha256').update(key).digest('hex') : randomUUID();
      const existing = key && items.find(item => item.id === id);
      const change = { title, date: date === undefined ? existing?.date ?? dateKey.format(Date.now()) : date };
      if (existing) {
        if (!validTodo(change) || existing.title !== title.trim() || existing.date !== change.date) {
          return { error: '此请求标识已用于另一条待办', status: 409 };
        }
        return { entry: existing, repeated: true };
      }
      return add(change, id);
    },
    update(change) {
      if (error) return { error };
      if (change?.type === 'add') return add(change, randomUUID());
      if (typeof change?.id !== 'string' || !items.some(item => item.id === change.id)) {
        return { error: '找不到这条待办' };
      }
      if (change.type === 'mark' && typeof change.done === 'boolean') {
        return write(items.map(item => item.id === change.id ? { ...item, done: change.done } : item));
      }
      if (change.type === 'remove') return write(items.filter(item => item.id !== change.id));
      return { error: '无法更新待办' };
    }
  };
}

module.exports = { createTodos };
