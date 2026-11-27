import React, { useEffect, useState } from 'react';
import { CaretLeftIcon, MinusIcon, PencilSimpleIcon, PlusIcon, TimerIcon } from '@phosphor-icons/react';
import { IconButton } from './IconButton.jsx';
import { CountdownDigits } from './CountdownLayouts.jsx';
import { ScheduleEditor } from './ScheduleEditor.jsx';
import { scheduleFields } from './time.mjs';
import countdownSizes from '../electron/countdown-sizes.json';

function targetLabel(at) {
  const { date, time } = scheduleFields(at);
  return date.replaceAll('-', '/') + ' ' + time;
}

function CountdownCard({ item, now, edit, hide, backdrop }) {
  const seconds = Math.max(0, Math.ceil((item.at - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const digits = [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
  const units = digits.map(value => String(value).padStart(2, '0'));
  const clock = units.join(':');
  const layout = item.layout ?? 'standard';
  const { width, height } = countdownSizes[layout];
  const [targetDate, targetClock] = targetLabel(item.at).split(' ');

  return <article className="countdown-card" data-theme={item.theme ?? 'midnight'} data-ink={item.ink ?? 'light'}
    data-layout={layout} data-finished={!seconds} style={{
      '--countdown-accent': item.color, '--countdown-card-width': `${width}px`, '--countdown-card-height': `${height}px`
    }}>
    {item.theme === 'frost' && backdrop?.image && <div className="countdown-frost-wallpaper" aria-hidden="true">
      <img src={backdrop.image} alt="" draggable={false}
        style={{ left: backdrop.left, top: backdrop.top, width: backdrop.width, height: backdrop.height }} />
    </div>}
    <header className="countdown-card-header">
      <TimerIcon size={15} weight="bold" aria-hidden="true" />
      <h1 title={item.title}>{item.title}</h1>
      {edit && <IconButton label="编辑倒计时" onClick={edit}><PencilSimpleIcon size={14} /></IconButton>}
      {hide && <IconButton label="隐藏倒计时" onClick={hide}><MinusIcon size={14} /></IconButton>}
    </header>
    <div className="countdown-remaining" role="timer" aria-live="off"
      aria-label={seconds ? `剩余 ${days} 天 ${digits[0]} 小时 ${digits[1]} 分钟 ${digits[2]} 秒` : '已到时间'}>
      <CountdownDigits layout={layout} days={days} units={units} clock={clock}
        finished={seconds === 0} remainingFraction={Math.min(1, seconds / 86400)} />
    </div>
    <time className="countdown-target" dateTime={new Date(item.at).toISOString()} title="目标时间（北京时间）">
      <span className="countdown-target-date">{targetDate}</span>{' '}
      <span className="countdown-target-clock">{targetClock}</span>
    </time>
  </article>;
}

export function CountdownWindow() {
  const [item, setItem] = useState(null);
  const [backdrop, setBackdrop] = useState(null);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState('');
  const bridge = window.countdown;

  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = bridge.onUpdate(value => { updated = true; setItem(value); });
    const unsubscribeBackdrop = bridge.onBackdrop(setBackdrop);
    bridge.setup().then(value => { if (active && !updated) setItem(value); })
      .catch(() => { if (active) setError('无法打开倒计时'); });
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000) * 1000), 250);
    return () => { active = false; unsubscribe(); unsubscribeBackdrop(); clearInterval(interval); };
  }, [bridge]);

  return <main className="countdown-window">
    {item && <CountdownCard item={item} now={now} backdrop={backdrop} edit={() => bridge.edit().catch(() => setError('无法打开编辑页面'))}
      hide={async () => {
        try {
          const result = await bridge.hide();
          if (result.error) setError(result.error);
        } catch { setError('无法隐藏倒计时'); }
      }} />}
    {error && <p className="countdown-window-error" role="alert">{error}</p>}
  </main>;
}

export function Countdowns({ items, editor, setEditor, save, remove, setVisible, close, native }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (editor) return <ScheduleEditor key={editor.id ?? 'new'} event={editor} now={Date.now()}
    renderCountdownPreview={item => <CountdownCard item={item} now={Date.now()} />}
    save={save} remove={remove} close={() => setEditor(null)} />;

  async function toggle(item) {
    setBusy(true);
    setError('');
    try {
      const result = await setVisible(item.id, !item.visible);
      if (result.error) setError(result.error);
    } catch { setError('倒计时状态暂未保存，请重试'); }
    finally { setBusy(false); }
  }

  return <section className="subview" aria-labelledby="countdowns-title">
    <header className="subview-header">
      <button type="button" className="back-button" aria-label="返回首页" onClick={close}>
        <CaretLeftIcon size={14} weight="bold" /> 返回
      </button>
      <h2 className="subview-title" id="countdowns-title">倒计时小组件</h2>
      <IconButton label="新建倒计时" onClick={() => setEditor({})}><PlusIcon size={16} weight="bold" /></IconButton>
    </header>
    <div className="content countdowns-content">
      {items.length === 0 && <div className="countdowns-empty">
        <TimerIcon size={29} weight="light" aria-hidden="true" />
        <button type="button" className="primary" onClick={() => setEditor({})}>添加倒计时</button>
      </div>}
      <ul className="countdowns-list">
        {items.map(item => <li key={item.id}>
          <span className="countdowns-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
          <button type="button" className="countdowns-item" aria-label={'编辑倒计时：' + item.title} onClick={() => setEditor(item)}>
            <strong>{item.title}</strong><small>{targetLabel(item.at)}</small>
          </button>
          <button type="button" className="preset-btn" aria-label={(item.visible ? '隐藏' : '显示') + '倒计时：' + item.title}
            disabled={busy} onClick={() => void toggle(item)}>{item.visible ? '隐藏' : '显示'}</button>
          {!native && item.visible && <div className="countdown-preview"><CountdownCard item={item} now={Date.now()} /></div>}
        </li>)}
      </ul>
      {error && <p className="timetable-warning" role="alert">{error}</p>}
    </div>
  </section>;
}
