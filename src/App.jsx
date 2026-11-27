import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowClockwiseIcon, ArrowDownLeftIcon, ArrowDownRightIcon, ArrowUpLeftIcon, ArrowUpRightIcon,
  CaretLeftIcon, CaretRightIcon, CheckIcon, GearSixIcon, ListPlusIcon, PlusIcon, PushPinIcon, TimerIcon
} from '@phosphor-icons/react';
import { groupsFor, scheduleFields } from './time.mjs';
import { currentWeekFor, nextRemaining, NextLesson, Timetable } from './Timetable.jsx';
import { ScheduleEditor } from './ScheduleEditor.jsx';
import { Todos } from './Todos.jsx';
import { TodoApiSettings } from './TodoApiSettings.jsx';
import { IconButton } from './IconButton.jsx';
import { Countdowns } from './Countdowns.jsx';

const themeList = [
  ['glass', '融入桌面'],
  ['mica', '暗墨云母'],
  ['mist', '轻雾白霜'],
  ['cotton', '暖白皱笺'],
  ['liquid', '液态玻璃'],
  ['classic', '经典磨砂']
];
const defaults = {
  theme: 'glass', ink: 'light', opacity: 0, blur: 0, classicInk: 'dark', classicOpacity: 68, classicBlur: 20,
  liveBackdrop: false, pinned: false, autoSnap: true, corner: null
};
const bridge = window.clock;
const start = Date.now();
const HOUR = 3600000;
const DAY = 86400000;

const dateAnchorFmt = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'short'
});

function formatAnchorDate(now, week, compact = false) {
  const parts = dateAnchorFmt.formatToParts(now);
  const m = parts.find(p => p.type === 'month')?.value ?? '';
  const d = parts.find(p => p.type === 'day')?.value ?? '';
  const w = parts.find(p => p.type === 'weekday')?.value ?? '';
  if (compact) return `${m}/${d} ${w}${week ? ` · ${week}周` : ''}`;
  return `${m}月${d}日 ${w}${week ? ` · 第${week}周` : ''}`;
}

function previewState() {
  const courses = ['高等数学', '程序设计', '普通物理'];
  const items = ['极限与连续练习', '指针与数组实验', '实验预习报告'].map((title, i) => ({
    id: 'demo-' + i,
    title,
    course: courses[i],
    deadline: start + [5, 54, 96][i] * HOUR + 60000,
    expired: false,
    url: null
  }));
  return { status: 'ready', items, syncedAt: start, message: '' };
}

function previewTimetable() {
  const todayIso = scheduleFields(start).date;
  const todayMidnight = Date.parse(todayIso + 'T00:00:00+08:00');
  const dow = (new Date(todayMidnight + 8 * HOUR).getUTCDay() + 6) % 7; // 0 = Mon
  const week12Monday = todayMidnight - dow * DAY;
  const week1Monday = week12Monday - 11 * 7 * DAY;
  const mondayStr = scheduleFields(week1Monday).date;
  const nextStart = start + 20 * 60000;
  const laterStart = Math.max(nextStart + 3 * HOUR, todayMidnight + 19 * HOUR);
  const nextWeekMon = week12Monday + 7 * DAY;
  return {
    monday: mondayStr,
    lessons: [
      { week: 12, day: dow + 1, title: '高等数学（上）', room: '天山堂 A201', start: nextStart, end: nextStart + 100 * 60000 },
      { week: 12, day: dow + 1, title: '大学英语听说', room: '天山堂 B305', start: laterStart, end: laterStart + 100 * 60000 },
      { week: 13, day: 1, title: '程序设计基础', room: '贺兰堂 A102', start: nextWeekMon + 8.5 * HOUR, end: nextWeekMon + 10.17 * HOUR },
      { week: 13, day: 1, title: '普通物理', room: '天山堂 C204', start: nextWeekMon + 14.5 * HOUR, end: nextWeekMon + 16.17 * HOUR },
      { week: 13, day: 3, title: '高等数学（上）', room: '天山堂 A201', start: nextWeekMon + 2 * DAY + 10.5 * HOUR, end: nextWeekMon + 2 * DAY + 12.17 * HOUR }
    ]
  };
}

function previewSchedules() {
  return [
    { id: 'demo-s1', title: 'ACM 社团例会', at: start + 4 * HOUR, color: '#7db4ff' },
    { id: 'demo-s2', title: '图书馆自习占座', at: start + 19 * HOUR, color: '#8ad4b0' }
  ];
}

function previewTodos() {
  const today = scheduleFields(start).date;
  return {
    items: [
      { id: 'demo-t1', date: today, title: '带高数错题本去教室', done: true },
      { id: 'demo-t2', date: today, title: '整理社团周报 PPT', done: false }
    ],
    error: ''
  };
}

function Timeline({ groups, today, open, editSchedule, hasEntered, addHomeworkTodo, addedHomework, todosReady }) {
  const [entering, setEntering] = useState(() => !hasEntered.current);
  useEffect(() => {
    hasEntered.current = true;
    if (!entering) return;
    const timer = setTimeout(() => setEntering(false), 320);
    return () => clearTimeout(timer);
  }, [entering, hasEntered]);

  return <ol className="timeline" data-entering={entering}>
    {groups.map(group => {
      const hwTones = group.items.filter(item => !item.schedule).map(item => item.timing.tone);
      const dayTone = hwTones.includes('urgent') ? 'urgent'
        : hwTones.includes('soon') ? 'soon'
        : hwTones.length && hwTones.every(t => t === 'expired') ? 'expired' : 'normal';
      return <li className="day" key={group.key} data-tone={dayTone} data-today={group.key === today}>
      <span className="date-chip">{group.date}</span>
      <ul className="assignments">
        {group.items.map(item => {
          const added = addedHomework.has(item.id);
          return <li className="assignment-row" key={item.schedule ? 'schedule-' + item.id : item.id}>
            <button className="assignment" type="button" onClick={() => item.schedule ? editSchedule(item.schedule) : open(item.url)}
              disabled={!item.schedule && !item.url} title={item.timing.tooltip ? item.title + ' · ' + item.timing.tooltip : item.title}>
              <span className="assignment-copy">
                <span className="assignment-title-line">
                  {item.schedule && <span className="schedule-dot" style={{ backgroundColor: item.schedule.color }} aria-hidden="true" />}
                  <strong>{item.title}</strong>
                </span>
                {item.schedule
                  ? <span className="course schedule-label tnum">日程 · {item.timing.startTime}</span>
                  : <span className="course">{item.course || '学习通'}</span>}
              </span>
              <span className="countdown tnum" data-tone={item.timing.tone} data-dated={Number.isFinite(item.deadline)}>
                {item.timing.label}
              </span>
            </button>
            {!item.schedule && item.timing.tone !== 'expired' && <span
              className={'assignment-todo' + (added ? '' : ' row-action-hover')}
              data-added={added}>
              <IconButton label={(added ? '已加入今日待办：' : '添加到今日待办：') + item.title}
                onClick={() => void addHomeworkTodo(item)} disabled={added || !todosReady}>
                {added ? <CheckIcon size={14} weight="bold" /> : <ListPlusIcon size={15} />}
              </IconButton>
            </span>}
          </li>;
        })}
      </ul>
    </li>;
    })}
  </ol>;
}

const corners = [
  ['top-left', '左上角', ArrowUpLeftIcon], ['top-right', '右上角', ArrowUpRightIcon],
  ['bottom-left', '左下角', ArrowDownLeftIcon], ['bottom-right', '右下角', ArrowDownRightIcon]
];

function ResizeGrip({ corner, resize }) {
  const pointer = useRef(null);
  const left = corner?.endsWith('right');
  const top = corner?.startsWith('bottom');
  const position = (top ? 'top-' : 'bottom-') + (left ? 'left' : 'right');
  const finish = event => {
    if (event.pointerId !== pointer.current) return;
    pointer.current = null;
    resize('end');
  };
  return <button type="button" className="resize-grip" data-position={position}
    aria-label="调整组件大小" title="拖动调整大小，也可用方向键"
    onPointerDown={event => {
      if (event.button !== 0 || pointer.current !== null) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = event.pointerId;
      resize('start', event.screenX, event.screenY);
    }}
    onPointerMove={event => {
      if (event.pointerId === pointer.current) resize('move', event.screenX, event.screenY);
    }}
    onPointerUp={event => {
      if (event.pointerId !== pointer.current) return;
      resize('move', event.screenX, event.screenY);
      finish(event);
    }}
    onPointerCancel={finish} onLostPointerCapture={finish}
    onKeyDown={event => {
      const step = 12;
      const offsets = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!offsets[event.key]) return;
      event.preventDefault();
      resize('step', ...offsets[event.key]);
    }}>
    <span aria-hidden="true" />
  </button>;
}

function Settings({ settings, set, preview, close, login, logout, hide, exit, canLogout, blurSupported, dock, sizePreset, openCountdowns }) {
  const container = useRef(null);
  const [startup, setStartup] = useState(null);
  const [savingStartup, setSavingStartup] = useState(false);
  const [startupError, setStartupError] = useState('');
  useEffect(() => {
    container.current?.focus();
    const dismiss = event => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [close]);
  useEffect(() => {
    if (!bridge || preview) return;
    let active = true;
    bridge.startup().then(enabled => { if (active) setStartup(enabled); })
      .catch(() => { if (active) setStartupError('无法读取开机自启状态'); });
    return () => { active = false; };
  }, [preview]);

  async function changeStartup(enabled) {
    setSavingStartup(true);
    setStartupError('');
    try {
      const actual = await bridge.setStartup(enabled);
      setStartup(actual);
      if (actual !== enabled) setStartupError('Windows 未应用开机自启设置');
    } catch {
      setStartupError('无法更改开机自启，请重试');
    } finally {
      setSavingStartup(false);
    }
  }

  const classic = settings.theme === 'classic';
  const liquid = settings.theme === 'liquid';
  const adjustable = classic || settings.theme === 'glass';
  const inkSetting = classic ? 'classicInk' : 'ink';
  const opacity = classic ? 'classicOpacity' : 'opacity';
  const blur = classic ? 'classicBlur' : 'blur';

  return <section className="subview settings" aria-labelledby="settings-title" ref={container} tabIndex={-1}>
    <header className="subview-header">
      <button type="button" className="back-button" aria-label="返回" onClick={close}>
        <CaretLeftIcon size={14} weight="bold" /> 返回
      </button>
      <h2 className="subview-title" id="settings-title">组件设置</h2>
      <span className="subview-spacer" />
    </header>

    <div className="content settings-body">
      <button type="button" className="countdowns-entry" onClick={openCountdowns}>
        <TimerIcon size={16} /> 倒计时小组件 <CaretRightIcon size={13} />
      </button>
      <fieldset>
        <legend>外观材质</legend>
        <div className="theme-options">
          {themeList.map(([id, name]) => <button type="button" key={id} onClick={() => set('theme', id)}
            aria-pressed={settings.theme === id}><span className={'swatch ' + id} /><span>{name}</span></button>)}
        </div>
      </fieldset>

      {(adjustable || liquid) && <fieldset className="glass-options">
        <legend className="sr-only">透明效果</legend>
        <div className="ink-row">
          <span>透明文字适配</span>
          <div className="segmented" role="group" aria-label="透明文字模式">
            <button type="button" aria-pressed={settings[inkSetting] === 'light'} onClick={() => set(inkSetting, 'light')}>浅字</button>
            <button type="button" aria-pressed={settings[inkSetting] === 'dark'} onClick={() => set(inkSetting, 'dark')}>深墨</button>
          </div>
        </div>
        {adjustable && <>
          <label><span>底色微雾</span><output className="tnum">{settings[opacity]}%</output>
            <input type="range" aria-label="底色微雾" min="0" max={classic ? 85 : 45} value={settings[opacity]}
              onChange={event => set(opacity, +event.target.value)} />
          </label>
          <label><span>背景模糊</span><output className="tnum">{settings[blur]} px</output>
            <input type="range" aria-label="背景模糊" min="0" max={classic ? 32 : 16} value={settings[blur]} disabled={!blurSupported}
              onChange={event => set(blur, +event.target.value)} />
          </label>
          {!blurSupported && <small>桌面版可对桌面取样应用模糊。</small>}
        </>}
      </fieldset>}

      {blurSupported && !liquid && <fieldset className="glass-options">
        <legend className="sr-only">桌面背景更新</legend>
        <label className="snap-toggle"><span>跟随动态壁纸</span>
          <input type="checkbox" checked={settings.liveBackdrop} onChange={event => set('liveBackdrop', event.target.checked)} />
        </label>
        <small>{settings.liveBackdrop ? '取样材质随桌面更新，隐藏组件时暂停。' : '移动组件或点刷新可更新桌面取样。'}</small>
      </fieldset>}

      {bridge && <fieldset className="window-options">
        <legend>大小与位置</legend>
        <div className="corner-controls">
          <div role="group" aria-label="移动到屏幕角落">
            {corners.map(([id, label, Icon]) => <IconButton key={id} label={'移到' + label}
              pressed={settings.corner === id} onClick={() => dock(id)}><Icon size={14} /></IconButton>)}
          </div>
          <div role="group" aria-label="组件大小">
            {[['small', '小'], ['default', '默认'], ['large', '大']].map(([id, label]) =>
              <button key={id} type="button" className="preset-btn" aria-label={label + '尺寸'} onClick={() => sizePreset(id)}>{label}</button>)}
          </div>
        </div>
        <label className="snap-toggle"><span>拖动时自动吸附角落</span>
          <input type="checkbox" checked={settings.autoSnap} onChange={event => set('autoSnap', event.target.checked)} />
        </label>
      </fieldset>}

      {startup !== null && <label className="snap-toggle"><span>开机自启</span>
        <input type="checkbox" checked={startup} disabled={savingStartup}
          onChange={event => changeStartup(event.target.checked)} />
      </label>}
      {startupError && <p className="timetable-warning" role="status">{startupError}</p>}

      {!preview && bridge && <TodoApiSettings bridge={bridge} />}

      {!preview && <div className="settings-actions">
        <button type="button" className="text-button" onClick={canLogout ? logout : login}>
          {canLogout ? '退出学习通' : '登录学习通'}
        </button>
        <button type="button" className="text-button" onClick={hide}>隐藏到托盘</button>
        <button type="button" className="text-button danger-link" onClick={exit}>退出组件</button>
      </div>}
    </div>
  </section>;
}

function DesktopMaterial({ settings }) {
  const [backdrop, setBackdrop] = useState(null);
  useEffect(() => bridge?.onBackdrop(setBackdrop), []);

  const { theme, blur, opacity, classicBlur, classicOpacity } = settings;
  if (theme === 'liquid') return <div className="material liquid-material" aria-hidden="true" />;
  const glass = theme === 'glass';
  const classic = theme === 'classic';
  if (!glass && !classic && theme !== 'mica' && theme !== 'mist') return <div className="material" aria-hidden="true" />;

  const radius = glass ? blur : classic ? classicBlur : 20;
  const tint = classic ? classicOpacity : opacity;
  return <div className={'material ' + (glass ? 'desktop-material' : classic ? 'classic-material' : 'frosted-material')} aria-hidden="true">
    {radius > 0 && backdrop && <img className="desktop-backdrop" alt="" src={backdrop.image}
      style={{ left: backdrop.left, top: backdrop.top, width: backdrop.width, height: backdrop.height, '--backdrop-blur': `${radius}px` }} />}
    {glass || classic ? (tint > 0 && <div className="desktop-tint" style={{ opacity: tint / 100 }} />)
      : <div className="frosted-tint" />}
  </div>;
}

export function App() {
  const [settings, setSettings] = useState(defaults);
  const [state, setState] = useState(() => bridge ? { status: 'loading', items: [], syncedAt: null, message: '' } : previewState());
  const [blurSupported, setBlurSupported] = useState(false);
  const [preview, setPreview] = useState(!bridge);
  const [showSettings, setShowSettings] = useState(false);
  const [page, setPage] = useState('agenda');
  const [savedTimetable, setSavedTimetable] = useState(() => bridge ? null : previewTimetable());
  const [schools, setSchools] = useState([]);
  const [timetableDraft, setTimetableDraft] = useState(null);
  const [timetableError, setTimetableError] = useState('');
  const [schedules, setSchedules] = useState(() => bridge ? [] : previewSchedules());
  const [scheduleEditor, setScheduleEditor] = useState(null);
  const [schedulesReady, setSchedulesReady] = useState(!bridge);
  const [countdowns, setCountdowns] = useState([]);
  const [countdownEditor, setCountdownEditor] = useState(null);
  const [todos, setTodos] = useState(() => bridge ? null : previewTodos());
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const timeOffset = useRef(0);
  const previewRefresh = useRef(null);
  const noticeTimer = useRef(null);
  const timelineEntered = useRef(false);
  const actions = useRef(null);

  const flashNotice = useCallback(text => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    if (text) noticeTimer.current = setTimeout(() => setNotice(''), 1800);
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    requestAnimationFrame(() => actions.current?.querySelector('[aria-label="组件设置"]')?.focus());
  }, []);

  useEffect(() => {
    const update = () => setNow(Date.now() + timeOffset.current);
    const interval = setInterval(update, 1000);
    if (!bridge) return () => {
      clearInterval(interval);
      clearTimeout(previewRefresh.current);
      clearTimeout(noticeTimer.current);
    };
    let active = true;
    let gotEvent = false;
    let gotTodos = false;
    let gotCountdowns = false;
    const off = bridge.onUpdate(value => { gotEvent = true; setState(value); });
    const offCorner = bridge.onCorner(corner => setSettings(current => ({ ...current, corner })));
    const offTodos = bridge.onTodos(value => { gotTodos = true; setTodos(value); });
    const offCountdowns = bridge.onCountdowns(value => { gotCountdowns = true; setCountdowns(value); });
    const offEditCountdown = bridge.onEditCountdown(id => {
      setShowSettings(false);
      setScheduleEditor(null);
      setPage('countdowns');
      setCountdownEditor(id);
    });
    const offTimetable = bridge.onTimetable(value => {
      setTimetableError(value.error ?? '');
      if (value.draft) {
        setTimetableDraft(value.draft);
        setScheduleEditor(null);
        setShowSettings(false);
        setPage('timetable');
      }
    });

    bridge.setup().then(value => {
      if (!active) return;
      setSettings({ ...defaults, ...value.settings });
      if (!gotEvent) setState(value.state);
      setBlurSupported(value.blurSupported);
      setPreview(value.demo);
      setSavedTimetable(value.timetable ?? null);
      setSchools(value.schools);
      setSchedules(value.schedules);
      setSchedulesReady(true);
      if (!gotCountdowns) setCountdowns(value.countdowns);
      if (!gotTodos) setTodos(value.todos);
      if (value.demo) timeOffset.current = value.state.syncedAt - Date.now();
      update();
    }).catch(() => { if (active) setState({ status: 'error', items: [], syncedAt: null, message: '组件初始化失败，请重启组件' }); });
    return () => {
      active = false;
      off(); offCorner(); offTimetable(); offTodos(); offCountdowns(); offEditCountdown();
      clearInterval(interval);
      clearTimeout(noticeTimer.current);
    };
  }, []);

  function invoke(promise) {
    promise?.catch(() => flashNotice('操作暂时未完成，请重试'));
  }

  function change(key, value) {
    setSettings(current => ({ ...current, [key]: value }));
    invoke(bridge?.change(key, value).then(result => {
      if (!result.saved) flashNotice('设置已应用，暂未保存');
    }));
  }

  function refresh() {
    if (!preview) return invoke(bridge?.refresh());
    setState(current => ({ ...current, status: 'loading' }));
    clearTimeout(previewRefresh.current);
    previewRefresh.current = setTimeout(() => {
      setState(current => ({ ...current, status: 'ready', syncedAt: Date.now() }));
      flashNotice('已完成同步');
    }, 350);
  }

  function login() {
    closeSettings();
    invoke(bridge?.login());
  }

  function logout() {
    closeSettings();
    invoke(bridge?.logout());
  }

  function openPage(next) {
    setShowSettings(false);
    setScheduleEditor(null);
    setPage(next);
  }

  async function updateTodo(delta) {
    if (bridge) return bridge.updateTodo(delta);
    const entry = delta.type === 'add'
      ? { id: crypto.randomUUID(), date: delta.date, title: delta.title, done: false,
        ...(delta.homeworkId && { homeworkId: delta.homeworkId, course: delta.course }) }
      : null;
    setTodos(current => {
      const { items } = current;
      if (entry) {
        if (entry.homeworkId && items.some(item => item.date === entry.date && item.homeworkId === entry.homeworkId)) return current;
        return { ...current, items: [...items, entry] };
      }
      if (delta.type === 'mark') {
        return { ...current, items: items.map(item => item.id === delta.id ? { ...item, done: delta.done } : item) };
      }
      return { ...current, items: items.filter(item => item.id !== delta.id) };
    });
    return {};
  }

  async function addHomeworkTodo(item) {
    try {
      const result = await updateTodo({
        type: 'add', date: scheduleFields(Date.now() + timeOffset.current).date,
        homeworkId: item.id, title: item.title, course: item.course || '学习通'
      });
      flashNotice(result.error || '已加入今日待办');
    } catch {
      flashNotice('无法保存待办，请重试');
    }
  }

  function closeSchedule() {
    setScheduleEditor(null);
    requestAnimationFrame(() => document.querySelector('button[aria-label="新建日程"]')?.focus());
  }

  async function saveSchedule(event) {
    const result = bridge ? await bridge.saveSchedule(event) : { items: event.id
      ? schedules.map(item => item.id === event.id ? event : item)
      : [...schedules, { ...event, id: crypto.randomUUID() }] };
    if (result.items) {
      setSchedules(result.items);
      setScheduleEditor(current => current === scheduleEditor ? null : current);
      flashNotice(event.id ? '日程已更新' : '已新建日程');
    }
    return result;
  }

  async function removeSchedule(id) {
    const result = bridge ? await bridge.removeSchedule(id) : { items: schedules.filter(item => item.id !== id) };
    if (result.items) {
      setSchedules(result.items);
      setScheduleEditor(current => current === scheduleEditor ? null : current);
      flashNotice('已删除日程');
    }
    return result;
  }

  async function saveCountdown(item) {
    const result = bridge ? await bridge.saveCountdown(item) : { items: item.id
      ? countdowns.map(current => current.id === item.id ? { ...current, ...item } : current)
      : [...countdowns, { ...item, id: crypto.randomUUID(), visible: true }] };
    if (result.items) {
      if (!bridge) setCountdowns(result.items);
      setCountdownEditor(null);
      flashNotice(item.id ? '倒计时已更新' : '已添加倒计时');
    }
    return result;
  }

  async function removeCountdown(id) {
    const result = bridge ? await bridge.removeCountdown(id) : { items: countdowns.filter(item => item.id !== id) };
    if (result.items) {
      if (!bridge) setCountdowns(result.items);
      setCountdownEditor(null);
      flashNotice('已删除倒计时');
    }
    return result;
  }

  async function showCountdown(id, visible) {
    if (bridge) return bridge.showCountdown(id, visible);
    setCountdowns(current => current.map(item => item.id === id ? { ...item, visible } : item));
    return {};
  }

  async function saveTimetable(monday) {
    try {
      const result = await bridge.saveTimetable(monday);
      setTimetableError(result.error ?? '');
      if (result.saved) {
        setSavedTimetable(result.saved);
        setTimetableDraft(null);
      }
    } catch { setTimetableError('课表暂时无法保存，请重试。'); }
  }

  const open = url => {
    if (preview) flashNotice('当前为示例预览');
    else invoke(bridge?.open(url));
  };

  const groups = groupsFor([
    ...state.items,
    ...schedules.map(event => ({ id: event.id, title: event.title, deadline: event.at, schedule: event }))
  ], now);
  const dueCount = state.items.length;
  const today = scheduleFields(now).date;
  const todayTodos = todos?.items.filter(item => item.date === today) ?? [];
  const pendingTodos = todayTodos.filter(item => !item.done).length;
  const addedHomework = new Set(todayTodos.map(item => item.homeworkId));
  const weekNum = currentWeekFor(savedTimetable, now);
  const nextLesson = nextRemaining(savedTimetable, now);
  const statusText = state.status === 'loading' ? '正在同步'
    : state.status === 'ready' ? (now - state.syncedAt < 60000 ? '刚刚同步' : '已同步')
    : state.status === 'login' ? '需要登录' : '同步暂不可用';
  const glass = settings.theme === 'glass';
  const liquid = settings.theme === 'liquid';
  const ink = settings.theme === 'classic' ? settings.classicInk : glass || liquid ? settings.ink : undefined;
  const isHome = !showSettings && !scheduleEditor && page === 'agenda';
  const stageClass = bridge
    ? 'preview-stage native-stage'
    : `preview-stage ${ink === 'dark' ? 'preview-stage-light' : 'preview-stage-dark'}`;

  return <div className={stageClass}>
    <main className="widget" data-theme={settings.theme} data-ink={ink}>
      <DesktopMaterial settings={settings} />

      {showSettings ? <Settings settings={settings} set={change} preview={preview}
        close={closeSettings} login={login} logout={logout} hide={() => invoke(bridge?.hide())} exit={() => invoke(bridge?.close())}
        canLogout={Boolean(state.syncedAt)} blurSupported={blurSupported}
        openCountdowns={() => { setCountdownEditor(null); openPage('countdowns'); }}
        dock={corner => invoke(bridge?.dock(corner))} sizePreset={preset => invoke(bridge?.sizePreset(preset))} />
      : page === 'timetable' ? <Timetable key="timetable" saved={savedTimetable} schools={schools} draft={timetableDraft} error={timetableError} now={now}
          canImport={Boolean(bridge) && !preview} onSave={saveTimetable} close={() => openPage('agenda')}
          onImportCalendar={data => bridge.importCalendar(data)}
          onImport={id => { setTimetableError(''); return bridge.openTimetable(id); }}
          onCancel={() => { setTimetableDraft(null); setTimetableError(''); invoke(bridge.cancelTimetable()); }} />
      : page === 'todos' ? <Todos key="todos" now={now} data={todos} update={updateTodo} close={() => openPage('agenda')} />
      : page === 'countdowns' ? <Countdowns key="countdowns" items={countdowns} native={Boolean(bridge)}
          editor={typeof countdownEditor === 'string' ? countdowns.find(item => item.id === countdownEditor) : countdownEditor}
          setEditor={setCountdownEditor} save={saveCountdown} remove={removeCountdown} setVisible={showCountdown}
          close={() => openPage('agenda')} />
      : scheduleEditor ? <ScheduleEditor key="schedule" event={scheduleEditor} now={now}
          save={saveSchedule} remove={removeSchedule} close={closeSchedule} />
      : <div className="home-view" key="agenda">
        <header className="top-anchor">
          <span className="anchor-date anchor-date-full tnum">{formatAnchorDate(now, weekNum, false)}</span>
          <span className="anchor-date anchor-date-short tnum" aria-hidden="true">{formatAnchorDate(now, weekNum, true)}</span>
          <div className="actions reveal-on-hover" ref={actions}>
            {!nextLesson && <button type="button" className="nav-chip" aria-label="打开课表" onClick={() => openPage('timetable')}>课表</button>}
            <button type="button" className="nav-chip tnum" aria-label="每日待办" onClick={() => openPage('todos')}>
              待办{pendingTodos > 0 ? `·${pendingTodos}` : ''}
            </button>
            <IconButton label="新建日程" disabled={!schedulesReady} onClick={() => setScheduleEditor({})}>
              <PlusIcon size={15} weight="bold" />
            </IconButton>
            <IconButton label={settings.pinned ? '取消置顶' : '置顶组件'} pressed={settings.pinned}
              onClick={() => change('pinned', !settings.pinned)}>
              <PushPinIcon size={14} weight={settings.pinned ? 'fill' : 'regular'} />
            </IconButton>
            <IconButton label="组件设置" pressed={showSettings}
              onClick={() => { setScheduleEditor(null); setShowSettings(true); }}>
              <GearSixIcon size={14} />
            </IconButton>
          </div>
        </header>

        <NextLesson saved={savedTimetable} lesson={nextLesson} now={now} open={() => openPage('timetable')} />

        {(state.status === 'error' || state.status === 'login') && groups.length > 0 && <div className="sync-banner">
          <span>{dueCount ? '上次同步的作业' : state.status === 'login' ? '连接学习通后自动同步作业' : '作业同步暂不可用'}</span>
          <button type="button" className="text-button" onClick={state.status === 'login' ? login : refresh}>
            {state.status === 'login' ? (dueCount ? '重新登录' : '去登录') : '重试'}
          </button>
        </div>}

        <div className="content">
          {groups.length ? <Timeline groups={groups} today={today} open={open} editSchedule={setScheduleEditor} hasEntered={timelineEntered}
            addHomeworkTodo={addHomeworkTodo} addedHomework={addedHomework} todosReady={Boolean(todos && !todos.error)} /> : <section className="empty" aria-live="polite">
            <h3>{state.status === 'ready' ? '接下来很清闲' : state.status === 'loading' ? '正在同步作业' : state.status === 'login' ? '连接学习通' : '同步未完成'}</h3>
            <p>{state.message || (state.status === 'ready' ? '暂时没有待交作业或日程。' : '稍等片刻，就能看到作业倒计时。')}</p>
            {state.status === 'ready' && schedulesReady && <button type="button" className="ghost-btn" onClick={() => setScheduleEditor({})}>+ 记一条日程</button>}
            {state.status === 'login' && <button type="button" className="primary" onClick={login}>登录学习通 <ArrowUpRightIcon size={13} /></button>}
            {state.status === 'error' && <button type="button" className="primary" onClick={refresh}>重新同步</button>}
          </section>}
        </div>

        <footer className="home-footer">
          {notice ? <span className="toast-notice" role="status">✓ {notice}</span> : <>
            <button type="button" className={'sync-btn reveal-on-hover' + (state.status === 'loading' ? ' spinning' : '')}
              aria-label="刷新作业" disabled={state.status === 'loading'} onClick={refresh}
              data-status={state.status}
              title={state.syncedAt ? '上次同步 ' + new Date(state.syncedAt).toLocaleString('zh-CN') : '点击刷新'}>
              <ArrowClockwiseIcon size={12} weight="bold" aria-hidden="true" />
              <span>{statusText}</span>
            </button>
            <button className="portal-link reveal-on-hover" type="button" onClick={() => open()}
              title={preview ? '示例预览' : '打开学习通作业页'}>学习通 <ArrowUpRightIcon size={12} weight="bold" /></button>
          </>}
        </footer>
      </div>}

      {bridge && <ResizeGrip corner={settings.corner} resize={(...args) => invoke(bridge.resize(...args))} />}
    </main>
  </div>;
}
