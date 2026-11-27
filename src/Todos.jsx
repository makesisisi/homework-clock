import React, { useRef, useState } from 'react';
import { CaretLeftIcon, CaretRightIcon, TrashIcon } from '@phosphor-icons/react';
import { scheduleFields } from './time.mjs';
import { IconButton } from './IconButton.jsx';

const shortDayFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short'
});

export function Todos({ now, data, update, close }) {
  const today = scheduleFields(now).date;
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  const date = selected ?? today;
  const day = new Date(date + 'T00:00:00Z');
  const items = data?.items.filter(item => item.date === date) ?? [];
  const done = items.filter(item => item.done).length;
  const message = data?.error || error;
  const locked = !data || Boolean(data.error) || busy;

  function move(offset) {
    day.setUTCDate(day.getUTCDate() + offset);
    const next = day.toISOString().slice(0, 10);
    setSelected(next === today ? null : next);
    setError('');
  }

  async function apply(change) {
    if (locked) return false;
    setBusy(true);
    setError('');
    try {
      const result = await update(change);
      if (result.error) setError(result.error);
      return !result.error;
    } catch {
      setError('无法保存待办，请重试');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(event) {
    event.preventDefault();
    const field = input.current;
    const title = field.value.trim();
    if (!title) {
      setError('请输入待办内容');
      field.focus();
      return;
    }
    if (await apply({ type: 'add', title, date })) {
      field.value = '';
      if (field.isConnected) field.focus();
    }
  }

  return <section className="subview todos-view" aria-label="待办清单">
    <header className="subview-header">
      <button type="button" className="back-button" aria-label="返回首页" onClick={close}>
        <CaretLeftIcon size={14} weight="bold" /> 返回
      </button>
      <div className="subview-nav">
        <button type="button" className="mini-icon-button" aria-label="前一天" disabled={busy} onClick={() => move(-1)}>
          <CaretLeftIcon size={13} weight="bold" />
        </button>
        <time className="subview-title tnum" dateTime={date}>
          {date === today ? '今天 · ' : ''}{shortDayFormat.format(day)}
        </time>
        <button type="button" className="mini-icon-button" aria-label="后一天" disabled={busy} onClick={() => move(1)}>
          <CaretRightIcon size={13} weight="bold" />
        </button>
      </div>
      <span className="subview-meta tnum" role="status">{done}/{items.length}</span>
    </header>

    <form className="todo-add" onSubmit={add}>
      <input ref={input} name="title" aria-label="待办内容" placeholder="写下一项待办，回车添加…" maxLength={100} required readOnly={locked} />
      <button className="todo-add-btn" type="submit" disabled={locked}>添加</button>
    </form>

    {message && <p className="timetable-warning" role="alert">{message}</p>}

    <div className="content">
      {!data ? <p className="todo-empty">正在加载待办…</p> : items.length ? <ul className="todo-list">
        {items.map(item => <li key={item.id} className="todo-row">
          <label>
            <input type="checkbox" className="todo-check" checked={item.done} aria-disabled={locked}
              onChange={event => void apply({ type: 'mark', id: item.id, done: event.currentTarget.checked })} />
            <span className="todo-item-copy">
              <span>{item.title}</span>
              {item.course && <small>{item.course}</small>}
            </span>
          </label>
          <span className="row-action-hover">
            <IconButton label={'删除待办：' + item.title} disabled={locked}
              onClick={async () => { if (await apply({ type: 'remove', id: item.id })) input.current?.focus(); }}>
              <TrashIcon size={15} />
            </IconButton>
          </span>
        </li>)}
      </ul> : !message && <p className="todo-empty">这一天还没有待办。</p>}
    </div>

    {date !== today && <footer className="subview-footer subview-footer-center">
      <button className="text-button" type="button" disabled={busy}
        onClick={() => { setSelected(null); setError(''); }}>回到今天</button>
    </footer>}
  </section>;
}
