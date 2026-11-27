import React, { useState } from 'react';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { CountdownThemePicker } from './CountdownThemePicker.jsx';
import { CountdownLayoutPicker } from './CountdownLayouts.jsx';
import { scheduleFields } from './time.mjs';

const PRESET_COLORS = ['#7db4ff', '#8ad4b0', '#f5c278', '#f29489', '#c2a6f7'];
const COUNTDOWN_THEMES = [
  ['desktop', '融入桌面'], ['liquid', '液态玻璃'], ['frost', '经典磨砂'], ['paper', '暖纸'], ['midnight', '夜蓝']
];
function targetTime(fields, initial, initialAt) {
  const date = fields.get('date');
  const time = fields.get('time');
  return date === initial.date && time === initial.time ? initialAt : Date.parse(date + 'T' + time + ':00+08:00');
}

export function ScheduleEditor({ event, now, save, remove, close, renderCountdownPreview }) {
  const countdown = Boolean(renderCountdownPreview);
  const name = countdown ? '倒计时' : '日程';
  const [initialAt] = useState(() => event.at ?? Math.ceil((now + (countdown ? 86400000 : 0)) / 900000) * 900000);
  const initial = scheduleFields(initialAt);
  const [color, setColor] = useState(event.color ?? PRESET_COLORS[0]);
  const [theme, setTheme] = useState(event.theme ?? (event.id ? 'midnight' : 'desktop'));
  const [ink, setInk] = useState(event.ink ?? 'light');
  const [layout, setLayout] = useState(event.layout ?? 'standard');
  const [draft, setDraft] = useState({ title: event.title ?? '', at: initialAt });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function apply(operation, failureAction) {
    setBusy(true);
    setError('');
    try {
      const result = await operation();
      if (result.error) setError(result.error);
    } catch {
      setError(name + '暂时无法' + failureAction + '，请重试');
    } finally {
      setBusy(false);
    }
  }

  return <div className="subview">
    <header className="subview-header">
      <button type="button" className="back-button" aria-label={countdown ? '返回倒计时列表' : '返回首页'} disabled={busy} onClick={close}>
        <CaretLeftIcon size={14} weight="bold" /> 返回
      </button>
      <h2 className="subview-title">{(event.id ? '编辑' : '新建') + name}</h2>
      <span className="subview-spacer" />
    </header>

    <form className="schedule-editor" onChange={countdown ? change => {
      const fields = new FormData(change.currentTarget);
      const at = targetTime(fields, initial, initialAt);
      setDraft(current => ({ title: fields.get('title').trim(), at: Number.isFinite(at) ? at : current.at }));
    } : undefined} onSubmit={submit => {
      submit.preventDefault();
      const fields = new FormData(submit.currentTarget);
      const title = fields.get('title').trim();
      const at = targetTime(fields, initial, initialAt);
      const picked = fields.get('color') || color;
      if (!title || !Number.isFinite(at)) {
        setError('请填写' + name + '名称并选择有效的日期和时间');
        return;
      }
      void apply(() => save({ id: event.id, title, at, color: picked, ...(countdown && { theme, ink, layout }) }), '保存');
    }} onKeyDown={key => { if (key.key === 'Escape' && !busy) close(); }}>
      <div className="content schedule-editor-fields">
        <label><span>{name}名称</span>
          <input name="title" autoFocus required maxLength={100} placeholder={countdown ? '例如：期末考试、材料截止' : '例如：社团例会、实验答辩'} defaultValue={event.title ?? ''} />
        </label>
        <div className="schedule-time-fields">
          <label><span>{countdown ? '目标日期' : '日期'}</span>
            <input type="date" name="date" required min="1970-01-02" max="9999-12-31" defaultValue={initial.date} />
          </label>
          <label><span>时间（北京时间）</span>
            <input type="time" name="time" required defaultValue={initial.time} />
          </label>
        </div>
        <div className="schedule-color-block">
          <span>标记色点</span>
          <div className="schedule-swatches">
            {PRESET_COLORS.map(preset => (
              <button
                key={preset}
                type="button"
                className="color-dot-btn"
                data-active={color.toLowerCase() === preset.toLowerCase()}
                style={{ backgroundColor: preset }}
                aria-label={'选择颜色 ' + preset}
                onClick={() => setColor(preset)}
              />
            ))}
            <label className="color-custom-wrap" title="自定义颜色">
              <input type="color" name="color" aria-label="自定义颜色" value={color} onChange={e => setColor(e.target.value)} />
            </label>
          </div>
        </div>
        {countdown && <>
          <CountdownLayoutPicker layout={layout} onLayout={setLayout} />
          <CountdownThemePicker themes={COUNTDOWN_THEMES} theme={theme} ink={ink} onTheme={setTheme} onInk={setInk} />
          <details className="countdown-style-preview">
            <summary>预览卡片</summary>
            <div className="countdown-preview-stage" data-ink={ink}>
              {renderCountdownPreview({ ...draft, title: draft.title || '倒计时', theme, ink, color, layout })}
            </div>
          </details>
        </>}
      </div>
      {error && <p className="timetable-warning" role="alert">{error}</p>}
      <footer className="schedule-actions">
        <button className="primary" type="submit" disabled={busy}>{'保存' + name}</button>
        <button className="text-button" type="button" disabled={busy} onClick={close}>取消</button>
        {event.id && <button className="text-button schedule-delete" type="button" disabled={busy}
          onClick={() => confirmDelete ? void apply(() => remove(event.id), '删除') : setConfirmDelete(true)}>
          {confirmDelete ? '确认删除' : countdown ? '删除倒计时' : '删除'}
        </button>}
      </footer>
    </form>
  </div>;
}
