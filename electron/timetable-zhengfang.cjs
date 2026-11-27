'use strict';

const { parseWeeks } = require('./timetable.cjs');

// Executed only in the selected school's authenticated personal timetable page.
async function readZhengfang(address, base) {
  if (location.href !== address || new URL(base).origin !== location.origin) return null;
  const value = key => document.querySelector(`[name="${key}"], #${key}`)?.value;
  const year = value('xnm');
  const term = value('xqm');
  if (!/^20\d{2}$/.test(year) || !/^\d{1,3}$/.test(term)) return null;
  const menu = new URL(address).searchParams.get('gnmkdm');
  const menuCode = /^N\d{4,8}$/i.test(menu) ? menu : 'N2151';
  const fields = { xnm: year, xqm: term };

  async function read(name, form) {
    try {
      const response = await fetch(base + '/kbcx/' + name + '.html?gnmkdm=' + menuCode, {
        method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams(form),
        signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) return null;
      const body = await response.text();
      if (body.length > 2_000_000 || !/^\s*[\[{]/.test(body)) return null;
      return JSON.parse(body);
    } catch { return null; }
  }

  const [schedule, periods] = await Promise.all([
    read('xskbcx_cxXsgrkb', { ...fields, kzlx: 'ck', xsdm: '', kclbdm: '' }),
    read('xskbcx_cxRjc', { ...fields, xqh_id: value('xqh_id') || '1' })
  ]);
  const rows = (Array.isArray(schedule?.kbList) ? schedule : await read('xskbcx_cxXsKb', fields))?.kbList;
  if (!Array.isArray(rows) || rows.length > 600 || !Array.isArray(periods) || periods.length > 40) return null;
  return {
    term: `${year}/${term}`,
    rows: rows.filter(Boolean).map(row => ({
      title: String(row.kcmc ?? '').slice(0, 160), room: String(row.cdmc ?? '').slice(0, 160),
      day: String(row.xqj ?? ''), weeks: String(row.zcd ?? '').slice(0, 150), periods: String(row.jcs ?? '').slice(0, 80)
    })),
    periods: periods.filter(Boolean).map(row => [String(row.jc ?? ''), String(row.qssj ?? ''), String(row.jssj ?? '')])
  };
}

function minutes(value) {
  const match = /^(\d{1,2}):?([0-5]\d)$/.exec(value.trim());
  return match && Number(match[1]) < 24 ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

function parseZhengfang(data) {
  const times = new Map(data.periods.map(([label, start, end], index) => [Number(label) || index + 1, [minutes(start), minutes(end)]]));
  const meetings = [];
  let skipped = 0;
  for (const row of data.rows) {
    const day = Number(row.day);
    const title = row.title.trim();
    const weekText = row.weeks.normalize('NFKC').replace(/[，、]/g, ',');
    const weekGroups = weekText.split(/[,;；]/).map(parseWeeks);
    const weeks = [...new Set(weekGroups.flat())].sort((a, b) => a - b);
    const sections = /^(\d{1,2})(?:\s*[-–—至]\s*(\d{1,2}))?(?:节)?$/.exec(row.periods.normalize('NFKC').trim());
    const first = Number(sections?.[1]);
    const last = Number(sections?.[2] ?? sections?.[1]);
    const start = times.get(first)?.[0];
    const end = times.get(last)?.[1];
    if (!title || !Number.isInteger(day) || day < 1 || day > 7 || !weeks.length || weekGroups.some(group => !group.length)
      || first > last || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) { skipped++; continue; }
    meetings.push({ title, room: row.room.trim(), day, weeks, start, end });
  }
  return { term: data.term, meetings, skipped };
}

module.exports = { readZhengfang, parseZhengfang };
