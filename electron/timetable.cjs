'use strict';

const DAY = 86400000;
const CHINA_OFFSET = 8 * 3600000;
const ENTRY = 'https://jwk.lzu.edu.cn/academic/student/currcourse/currcourse.jsdo';
const HOSTS = new Set(['jwk.lzu.edu.cn', 'sso.lzu.edu.cn', 'my.lzu.edu.cn']);

function schoolPage(address) {
  try {
    const url = new URL(address);
    return HOSTS.has(url.hostname) && ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

function timetablePage(address) {
  const url = schoolPage(address);
  return url?.origin === 'https://jwk.lzu.edu.cn' && (
    url.pathname === new URL(ENTRY).pathname ||
    (url.pathname === '/academic/manager/coursearrange/showTimetable.do' && url.searchParams.get('timetableType') === 'STUDENT')
  );
}

// Runs in the confirmed timetable frame and returns table data only.
function readTables(address) {
  if (location.href !== address) return null;
  const result = { courses: [], times: [], term: '' };
  for (const table of document.querySelectorAll('table')) {
    const header = [...table.rows].slice(0, 3).find(row => [...row.cells].some(cell => /课程名称|^课程名$/.test(cell.innerText.trim())));
    if (header) {
      const labels = [...header.cells].map(cell => cell.innerText.replace(/\s/g, ''));
      const name = labels.findIndex(label => /^(课程名称|课程名)$/.test(label));
      const time = labels.findIndex(label => /时间(?:及|与|和)?地点|上课信息|上课安排|上课时间/.test(label));
      if (name >= 0 && time >= 0) {
        for (const row of [...table.rows].slice(header.rowIndex + 1, header.rowIndex + 301)) {
          const title = row.cells[name]?.innerText.trim();
          if (title && row.cells[time]) result.courses.push([title.slice(0, 160), row.cells[time].innerText.slice(0, 3000)]);
        }
      }
    }
    for (const row of [...table.rows].slice(0, 100)) {
      const cells = [...row.cells];
      const time = cells.find(cell => /^\s*\d{1,2}:\d{2}\s*(?:[-–—－~～]+|至)\s*\d{1,2}:\d{2}\s*$/.test(cell.innerText));
      if (time) {
        for (const cell of cells.slice(0, cells.indexOf(time))) {
          const label = cell.innerText.trim();
          if (label && !(cell === cells[0] && cells.indexOf(time) > 1 && /^\d+$/.test(label))) {
            result.times.push([label.slice(0, 80), time.innerText.trim()]);
          }
        }
      }
    }
  }
  const metadata = document.querySelector('eduaffair\\:ctrt');
  if (metadata && /^\d+$/.test(metadata.getAttribute('year')) && /^[1-4]$/.test(metadata.getAttribute('term'))) {
    result.term = `${metadata.getAttribute('year')}/${metadata.getAttribute('term')}`;
  }
  if (!result.term) {
    const params = new URL(address).searchParams;
    const year = params.get('yearid');
    const term = params.get('termid');
    if (/^\d{1,3}$/.test(year) && /^[1-4]$/.test(term)) result.term = `${year}/${term}`;
  }
  return result;
}

// Discover the school calendar through the official menu in the same signed-in session.
async function readCalendar() {
  if (location.origin !== 'https://jwk.lzu.edu.cn') return [];
  const link = [...document.querySelectorAll('a[href]')].find(anchor => /^(?:查看|教务|教学|学校)?校[历曆](?:查询|查看)?$/.test(anchor.textContent.replace(/\s/g, '')));
  if (!link) return [];
  const url = new URL(link.href);
  if (url.hostname === location.hostname && url.protocol === 'http:') url.protocol = 'https:';
  if (url.origin !== location.origin || !url.pathname.startsWith('/academic/') || url.username || url.password) return [];
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(4500) });
  if (!response.ok) return [];
  const html = await response.text();
  if (html.length > 500000) return [];
  const page = new DOMParser().parseFromString(html, 'text/html');
  return [...page.querySelectorAll('table.datalist tr')].slice(0, 100).map(row =>
    [...row.cells].slice(0, 6).map(cell => cell.textContent.trim().slice(0, 60)));
}

function calendarMonday(rows, term) {
  const match = term.match(/^(\d{1,3})\/([12])$/);
  if (!match) return '';
  const year = 1980 + Number(match[1]);
  const season = match[2] === '1' ? '春' : '秋';
  const dates = new Set();
  for (const [rowYear, rowSeason, , start, , weekStart] of rows) {
    if (rowYear !== String(year) || !rowSeason?.startsWith(season) || !/^(周|星期)一$/.test(weekStart)) continue;
    const day = start?.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
    if (!day || Number(day[1]) !== year) continue;
    const date = [day[1], day[2].padStart(2, '0'), day[3].padStart(2, '0')].join('-');
    if (mondayDate(date) !== null) dates.add(date);
  }
  return dates.size === 1 ? [...dates][0] : '';
}

function publishedMonday(term) {
  // 2026–2027 兰大校历第 1 学期。只匹配对应教务学期。
  // https://jwc.lzu.edu.cn/jiaowufuwu/xiaolianpai/2026/0717/334905.html
  return term === '46/2' ? '2026-08-31' : '';
}

function parseWeeks(input) {
  const value = input.normalize('NFKC').replace(/\s/g, '').replace(/[–—~～至]/g, '-').replace(/、/g, ',');
  const match = value.match(/^第?([\d,-]+)周?(?:\(?([单双全])周?\)?)?$/);
  if (!match) return [];
  const weeks = new Set();
  for (const part of match[1].split(',')) {
    const range = part.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
    if (!range) return [];
    const first = Number(range[1]);
    const last = Number(range[2] ?? range[1]);
    if (first < 1 || last > 30 || first > last) return [];
    for (let week = first; week <= last; week++) {
      if (match[2] === '单' && week % 2 === 0 || match[2] === '双' && week % 2 === 1) continue;
      weeks.add(week);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

function timeRange(value) {
  const match = value.match(/^(\d{1,2}):([0-5]\d)\s*(?:[-–—－~～]+|至)\s*(\d{1,2}):([0-5]\d)$/);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return Number(match[1]) < 24 && Number(match[3]) < 24 && start < end ? { start, end } : null;
}

function parseTables(data) {
  const times = new Map();
  const ambiguous = new Set();
  for (const [label, value] of data.times) {
    const time = timeRange(value);
    if (!time) continue;
    const key = label.normalize('NFKC').replace(/\s/g, '');
    const old = times.get(key);
    if (old && (old.start !== time.start || old.end !== time.end)) ambiguous.add(key);
    times.set(key, time);
  }
  const meetings = new Map();
  let skipped = 0;
  for (const [title, text] of data.courses) {
    for (const line of text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
      const match = line.match(/^(.+?)\s*(?:星期|周)([一二三四五六日天])\s*(.+)$/);
      if (!match) { skipped++; continue; }
      const weeks = parseWeeks(match[1]);
      const day = '一二三四五六日'.indexOf(match[2].replace('天', '日')) + 1;
      const fields = match[3].includes('\t') ? match[3].split(/\t+/) : match[3].split(/\s+/);
      const label = fields.shift().normalize('NFKC').trim().replace(/\s/g, '');
      const time = timeRange(label) ?? (!ambiguous.has(label) && times.get(label));
      if (!weeks.length || !time) { skipped++; continue; }
      const room = fields.join(' ').trim().slice(0, 160);
      const item = { title, day, weeks, ...time, room };
      meetings.set(JSON.stringify(item), item);
    }
  }
  return { meetings: [...meetings.values()], skipped, term: data.term };
}

function mondayDate(value) {
  if (typeof value !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return date.getUTCDay() === 1 && date.toISOString().slice(0, 10) === value ? date.getTime() : null;
}

function expand(meetings, firstMonday) {
  const monday = mondayDate(firstMonday);
  if (monday === null) return null;
  const lessons = new Map();
  for (const { title, day, weeks, start, end, room } of meetings) {
    for (const week of weeks) {
      const midnight = monday + ((week - 1) * 7 + day - 1) * DAY - CHINA_OFFSET;
      const lesson = { title, room, week, day, start: midnight + start * 60000, end: midnight + end * 60000 };
      lessons.set(JSON.stringify(lesson), lesson);
    }
  }
  return [...lessons.values()].sort((a, b) => a.start - b.start);
}

function datedLessons(occurrences, firstMonday) {
  const monday = mondayDate(firstMonday);
  if (monday === null) return null;
  const lessons = new Map();
  for (const { title, room, start, end } of occurrences) {
    const offset = Math.floor((start + CHINA_OFFSET - monday) / DAY);
    if (offset < 0 || offset >= 30 * 7) return null;
    const lesson = { title, room, week: Math.floor(offset / 7) + 1, day: offset % 7 + 1, start, end };
    lessons.set(JSON.stringify(lesson), lesson);
  }
  return [...lessons.values()].sort((a, b) => a.start - b.start);
}

function calendarDraft(data) {
  if (!Array.isArray(data?.occurrences) || !data.occurrences.length || data.occurrences.length > 3000) return null;
  const occurrences = [];
  for (const item of data.occurrences) {
    if (typeof item?.title !== 'string' || !item.title.trim() || item.title.length > 160
      || typeof item.room !== 'string' || item.room.length > 160 || !Number.isSafeInteger(item.start)
      || !Number.isSafeInteger(item.end) || item.start < Date.UTC(2000, 0, 1) || item.end >= Date.UTC(2100, 0, 1)
      || item.end <= item.start || item.end - item.start > DAY) return null;
    occurrences.push({ title: item.title, room: item.room, start: item.start, end: item.end });
  }
  occurrences.sort((a, b) => a.start - b.start);
  const day = new Date(Math.floor((occurrences[0].start + CHINA_OFFSET) / DAY) * DAY);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  const monday = day.toISOString().slice(0, 10);
  const lessons = datedLessons(occurrences, monday);
  if (!lessons) return null;
  const skipped = Number.isSafeInteger(data.skipped) && data.skipped > 0 ? data.skipped : 0;
  return { type: 'calendar', monday, skipped, occurrences: lessons.map(({ title, room, start, end }) => ({ title, room, start, end })) };
}

module.exports = { ENTRY, schoolPage, timetablePage, readTables, readCalendar, calendarMonday, publishedMonday, parseWeeks, parseTables, expand, calendarDraft, datedLessons };
