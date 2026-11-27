import React, { useMemo, useRef, useState } from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';

const DAY = 86400000;
const WEEK = DAY * 7;
const CHINA_OFFSET = 8 * 3600000;
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const SCHOOL_PAGE_SIZE = 20;
const SCHOOL_MODE = { direct: '自动导入', portal: '打开教务', search: '查找教务' };
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
const upcomingDate = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' });
const period = (start, end) => `${clock.format(start)}–${clock.format(end)}`;
const timeLabel = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const localDay = value => Math.floor((value + CHINA_OFFSET) / DAY);
const lessonDate = lesson => `${DAYS[lesson.day - 1]} ${clock.format(lesson.start)}`;
const fullLessonDate = lesson => `${upcomingDate.format(lesson.start)} ${DAYS[lesson.day - 1]}`;
export const nextRemaining = (saved, now) => saved?.lessons.find(lesson => lesson.end > now);

function todayRemaining(saved, now) {
  return saved?.lessons.filter(item => item.end > now && localDay(item.start) === localDay(now)) ?? [];
}

export function currentWeekFor(saved, now) {
  if (!saved?.monday) return null;
  const parsed = Date.parse(saved.monday + 'T00:00:00+08:00');
  if (!Number.isFinite(parsed)) return null;
  const week = Math.floor((now - parsed) / WEEK) + 1;
  return week >= 1 && week <= 30 ? week : null;
}

function formatDuration(minutes) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  if (days) return `${days}天${hours ? `${hours}时` : ''}`;
  if (hours) return `${hours}小时${minutes % 60 ? `${minutes % 60}分` : ''}`;
  return `${minutes}分`;
}

export function NextLesson({ saved, lesson, now, open }) {
  if (!lesson) return null;
  const isToday = localDay(lesson.start) === localDay(now);
  const inProgress = lesson.start <= now;
  const remaining = Math.max(1, Math.ceil(((inProgress ? lesson.end : lesson.start) - now) / 60000));
  const duration = formatDuration(remaining);
  const todayList = todayRemaining(saved, now);
  const extraToday = isToday ? Math.max(0, todayList.length - 1) : 0;

  const rightLabel = inProgress
    ? `还剩 ${duration}`
    : isToday
      ? `${duration}后`
      : lessonDate(lesson);

  const subLabel = inProgress
    ? `正在上课${lesson.room ? ` · ${lesson.room}` : ''}`
    : isToday
      ? `${period(lesson.start, lesson.end)}${lesson.room ? ` · ${lesson.room}` : ''}`
      : `今日课毕${lesson.room ? ` · ${lesson.room}` : ''}`;

  return <button
    type="button"
    className="next-lesson"
    data-live={inProgress}
    data-today={isToday}
    aria-label="打开课表"
    onClick={open}>
    <span className="next-lesson-top">
      <span className="next-lesson-title">
        <span className="next-lesson-dot" aria-hidden="true" />
        <strong>{lesson.title}</strong>
      </span>
      <b data-soon={inProgress || (isToday && remaining <= 30)}>{rightLabel}</b>
    </span>
    <span className="next-lesson-sub">
      <small>{subLabel}</small>
      {extraToday > 0 && <span className="next-lesson-extra">+{extraToday}节</span>}
    </span>
  </button>;
}

export function Timetable({ saved, schools, draft, error, now, onImport, onImportCalendar, onCancel, onSave, canImport, close }) {
  const currentWeek = saved ? Math.floor((now - Date.parse(saved.monday + 'T00:00:00+08:00')) / WEEK) + 1 : 1;
  const lastWeek = saved?.lessons.at(-1)?.week ?? 1;
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [showWeek, setShowWeek] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleSchools, setVisibleSchools] = useState(SCHOOL_PAGE_SIZE);
  const [opening, setOpening] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const calendarInput = useRef(null);
  const week = Math.min(lastWeek, Math.max(1, selectedWeek ?? currentWeek));
  const calendarDraft = draft?.type === 'calendar';
  const schoolView = canImport && (searching || !saved);
  const keyword = query.normalize('NFKC').trim().toLowerCase();
  const choices = useMemo(() => {
    if (!keyword) return schools;
    const exact = [], partial = [];
    const words = keyword.split(/\s+/);
    for (const school of schools) {
      const terms = `${school.name} ${school.aliases}`.normalize('NFKC').toLowerCase().split(/\s+/);
      if (terms.includes(keyword)) exact.push(school);
      else {
        const text = `${terms.join(' ')} ${school.region ?? ''}`;
        if (words.every(word => text.includes(word))) partial.push(school);
      }
    }
    return exact.concat(partial);
  }, [keyword, schools]);
  const schoolHint = selectedSchool && {
    direct: `已打开${selectedSchool.name}教务。请在学校页面完成登录。`,
    portal: `已在浏览器打开${selectedSchool.name}教务。此入口可用 .ics 导入课表。`,
    search: `已搜索${selectedSchool.name}官方教务。找到学校入口后，可用 .ics 导入课表。`
  }[selectedSchool.mode];

  async function openSchool(school) {
    setOpening(true);
    setFileError('');
    setSelectedSchool(null);
    try {
      const response = await onImport(school.id);
      if (response?.error) setFileError(response.error);
      else if (response?.mode) setSelectedSchool({ name: school.name, mode: response.mode });
    } catch { setFileError('教务窗口暂时打不开，请稍后重试。'); }
    finally { setOpening(false); }
  }

  async function loadCalendar(event) {
    const [file] = event.currentTarget.files;
    event.currentTarget.value = '';
    if (!file) return;
    setFileError('');
    if (!/\.ics$/i.test(file.name) || file.size > 4 * 1024 * 1024) {
      setFileError('请选择小于 4 MB 的 .ics 日历文件。');
      return;
    }
    setReading(true);
    try {
      const { readCalendarFile } = await import('./timetable-ical.mjs');
      const { error: importError } = await onImportCalendar(readCalendarFile(await file.text()));
      if (importError) setFileError(importError);
    } catch (problem) { setFileError(problem.message.includes('。') ? problem.message : '无法读取 .ics 日历文件。'); }
    finally { setReading(false); }
  }

  const fileButton = className => <button type="button" className={className} disabled={reading}
    onClick={() => calendarInput.current.click()}>{reading ? '正在读取日历' : '导入 .ics'}</button>;

  if (draft) return <div className="subview">
    <header className="subview-header">
      <button type="button" className="back-button" onClick={onCancel} disabled={saving}>
        <CaretLeftIcon size={14} weight="bold" /> 取消
      </button>
      <h2 className="subview-title">核对课表</h2>
      <span className="subview-spacer" />
    </header>
    <div className="content">
      <form className="timetable-content" onSubmit={async event => {
        event.preventDefault();
        const monday = new FormData(event.currentTarget).get('monday');
        setSaving(true);
        try { await onSave(monday); setSelectedWeek(null); setShowWeek(false); setSearching(false); setSelectedSchool(null); }
        finally { setSaving(false); }
      }}>
        <p className="timetable-hint">识别到 {(calendarDraft ? draft.occurrences : draft.meetings).length} 条上课安排，确认后将替换本地课表。</p>
        {draft.skipped > 0 && <p className="timetable-warning" role="status">另有 {draft.skipped} 条未识别，请和源课表核对。</p>}
        <label className="timetable-date">第一教学周的周一
          <input name="monday" type="date" defaultValue={draft.monday} required />
        </label>
        <p className="timetable-hint">{calendarDraft ? '按最早一节课推算第一周，可按校历调整。课程日期和时间保持原值。' : draft.mondaySource === 'calendar' ? '已从兰大校历自动识别，可核对或调整。'
          : draft.mondaySource === 'saved' ? '已填入本地同学期课表的日期。' : '请选择学校校历的第一教学周周一。'}</p>
        {error && <p className="timetable-warning" role="alert">{error}</p>}
        <div className="timetable-controls">
          <button type="submit" className="primary" disabled={saving}>确认保存</button>
          <button type="button" className="text-button" onClick={onCancel} disabled={saving}>取消</button>
        </div>
        <ul className="lesson-list">
          {calendarDraft ? draft.occurrences.map((lesson, index) => <li key={index}>
            <strong>{lesson.title}</strong>
            <small>{upcomingDate.format(lesson.start)} · {period(lesson.start, lesson.end)} {lesson.room}</small>
          </li>) : draft.meetings.map((lesson, index) => <li key={index}>
            <strong>{lesson.title}</strong>
            <small>{DAYS[lesson.day - 1]} {timeLabel(lesson.start)}–{timeLabel(lesson.end)} {lesson.room}</small>
            <small>第 {lesson.weeks.join('、')} 周</small>
          </li>)}
        </ul>
      </form>
    </div>
  </div>;

  return <div className="subview">
    {canImport && <input type="file" accept=".ics,text/calendar" ref={calendarInput} onChange={loadCalendar} hidden />}
    <header className="subview-header">
      <button type="button" className="back-button" aria-label={saved && searching ? '返回课表' : '返回首页'}
        onClick={() => {
          if (schoolView) onCancel();
          if (saved && searching) setSearching(false);
          else close();
        }}>
        <CaretLeftIcon size={14} weight="bold" /> 返回
      </button>
      {saved && showWeek && !schoolView ? <div className="subview-nav" role="group" aria-label="选择课表周次">
        <button type="button" className="mini-icon-button" aria-label="上一周" disabled={week <= 1} onClick={() => setSelectedWeek(week - 1)}>
          <CaretLeftIcon size={13} weight="bold" />
        </button>
        <span className="subview-title tnum">第 {week} 周</span>
        <button type="button" className="mini-icon-button" aria-label="下一周" disabled={week >= lastWeek} onClick={() => setSelectedWeek(week + 1)}>
          <CaretRightIcon size={13} weight="bold" />
        </button>
      </div> : <h2 className="subview-title tnum">{schoolView ? '搜索学校' : saved ? `第 ${currentWeek} 周` : '我的课表'}</h2>}
      {saved && !schoolView ? <button type="button" className="pill-toggle" onClick={() => setShowWeek(!showWeek)}>
        {showWeek ? '看今日' : '周课表'}
      </button> : <span className="subview-spacer" />}
    </header>

    <div className="content">
      <div className="timetable-content">
        {(fileError || error) && <p className="timetable-warning" role="status">{fileError || error}</p>}
        {schoolView ? <>
          <label className="timetable-date">学校名称或简称
            <input type="search" placeholder="例如：兰大、河南工业大学" aria-label="搜索学校" value={query}
              onChange={event => {
                setQuery(event.target.value);
                setVisibleSchools(SCHOOL_PAGE_SIZE);
                setSelectedSchool(null);
                setFileError('');
              }} />
          </label>
          <p className="timetable-hint" role="status">{schoolHint || (keyword
            ? `找到 ${choices.length.toLocaleString('zh-CN')} 所学校`
            : `可搜索 ${schools.length.toLocaleString('zh-CN')} 所高校`)}</p>
          {choices.length ? <ul className="lesson-list">
            {choices.slice(0, visibleSchools).map(school => <li key={school.id}>
              <button type="button" className="lesson-card school-result" disabled={opening} onClick={() => void openSchool(school)}>
                <span className="lesson-card-main"><strong>{school.name}</strong>{school.region && <small>{school.region}</small>}</span>
                <span className="lesson-card-tag">{SCHOOL_MODE[school.mode]}</span>
              </button>
            </li>)}
          </ul> : <p className="timetable-hint">暂未收录这所学校，可使用 .ics 导入。</p>}
          {choices.length > visibleSchools && <button type="button" className="text-button"
            onClick={() => setVisibleSchools(count => count + SCHOOL_PAGE_SIZE)}>显示更多学校</button>}
        </> : saved ? (showWeek ? <Week saved={saved} week={week} now={now} /> : <Today saved={saved} now={now} />)
          : <p className="timetable-hint">课表导入可在 Windows 桌面应用中使用。</p>}
      </div>
    </div>

    {(saved || schoolView) && <footer className="subview-footer">
      {saved && !schoolView && <span>{saved.source === 'calendar' ? '日历课表' : `${saved.schoolName ?? '兰大'}教务课表`}</span>}
      {canImport && fileButton('text-button')}
      {canImport && saved && !schoolView && <button type="button" className="text-button"
        onClick={() => { setSearching(true); setQuery(''); setVisibleSchools(SCHOOL_PAGE_SIZE); setSelectedSchool(null); }}>重新导入</button>}
    </footer>}
  </div>;
}

function Today({ saved, now }) {
  const lessons = todayRemaining(saved, now);
  if (!lessons.length) {
    const next = nextRemaining(saved, now);
    return next ? <section className="lesson-day">
      <h3>今日课毕 · 下一节 {fullLessonDate(next)}</h3>
      <LessonList lessons={[next]} now={now} highlightFirst />
    </section> : <p className="timetable-hint">本学期没有后续课程安排。</p>;
  }
  return <section className="lesson-day" data-today="true">
    <h3>今天剩余课程 · {date.format(now)}</h3>
    <LessonList lessons={lessons} now={now} highlightFirst />
  </section>;
}

function LessonList({ lessons, now, highlightFirst = false }) {
  return <ul className="lesson-list">
    {lessons.map((lesson, index) => {
      const live = lesson.start <= now && now < lesson.end;
      const active = live || (highlightFirst && index === 0);
      const mins = Math.max(1, Math.ceil(((live ? lesson.end : lesson.start) - now) / 60000));
      const tag = live ? `还剩 ${formatDuration(mins)}` : active && localDay(lesson.start) === localDay(now) ? `${formatDuration(mins)}后` : '';
      return <li key={index} className="lesson-card" data-active={active} data-live={live}>
        <div className="lesson-card-main">
          <strong>{lesson.title}</strong>
          <small className="tnum">{period(lesson.start, lesson.end)}{lesson.room ? ` · ${lesson.room}` : ''}</small>
        </div>
        {tag && <span className="lesson-card-tag tnum" data-live={live}>{tag}</span>}
      </li>;
    })}
  </ul>;
}

function Week({ saved, week, now }) {
  const lessons = saved.lessons.filter(item => item.week === week);
  if (!lessons.length) return <p className="timetable-hint">这一周没有课程安排。</p>;
  return DAYS.map((day, index) => {
    const list = lessons.filter(item => item.day === index + 1);
    if (!list.length) return null;
    const isToday = localDay(list[0].start) === localDay(now);
    return <section className="lesson-day" key={day} data-today={isToday}>
      <h3>{day} · {date.format(list[0].start)}{isToday && ' · 今天'}</h3>
      <LessonList lessons={list} now={now} />
    </section>;
  });
}
