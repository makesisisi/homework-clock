import ICAL from 'ical.js';

const HOUR = 3600000;
const MAX_EVENTS = 3000;
const BEIJING_ZONE = `BEGIN:VTIMEZONE
TZID:Asia/Shanghai
BEGIN:STANDARD
DTSTART:19920101T000000
TZOFFSETFROM:+0800
TZOFFSETTO:+0800
END:STANDARD
END:VTIMEZONE`;

function toTimestamp(time) {
  if (!time || time.isDate) return NaN;
  return time.toUnixTime() * 1000 - (time.zone === ICAL.Timezone.localTimezone ? 8 * HOUR : 0);
}

export function readCalendarFile(text) {
  const calendar = new ICAL.Component(ICAL.parse(text.replace(/^\uFEFF/, '')));
  if (calendar.name !== 'vcalendar') throw new Error('请选择有效的 .ics 日历文件。');
  ICAL.TimezoneService.reset();
  for (const timezone of calendar.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(timezone);
  if (!ICAL.TimezoneService.has('Asia/Shanghai')) {
    ICAL.TimezoneService.register(new ICAL.Component(ICAL.parse(BEIJING_ZONE)));
  }

  const components = calendar.getAllSubcomponents('vevent');
  if (components.length > MAX_EVENTS) throw new Error('日历条目过多，请只导出一个学期的课程。');
  const exceptions = new Map();
  const series = new Set(components.filter(event => !event.hasProperty('recurrence-id')).map(event => event.getFirstPropertyValue('uid')));
  for (const event of components) {
    if (!event.hasProperty('recurrence-id')) continue;
    const uid = event.getFirstPropertyValue('uid');
    if (!exceptions.has(uid)) exceptions.set(uid, []);
    exceptions.get(uid).push(event);
  }

  const occurrences = [];
  let skipped = 0;
  function append(event, startDate, endDate) {
    if (event.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    for (const field of ['dtstart', 'dtend']) {
      const zone = event.component.getFirstProperty(field)?.getParameter('tzid');
      if (zone && !ICAL.TimezoneService.has(zone)) { skipped++; return; }
    }
    const title = event.summary?.trim();
    const start = toTimestamp(startDate);
    const end = toTimestamp(endDate);
    if (!title || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 24 * HOUR) {
      skipped++;
      return;
    }
    occurrences.push({ title: title.slice(0, 160), room: (event.location || '').slice(0, 160), start, end });
    if (occurrences.length > MAX_EVENTS) throw new Error('日历条目过多，请只导出一个学期的课程。');
  }

  for (const component of components) {
    const uid = component.getFirstPropertyValue('uid');
    const isException = component.hasProperty('recurrence-id');
    if (isException && series.has(uid)) continue;
    const event = new ICAL.Event(component, { exceptions: isException ? [] : exceptions.get(uid) ?? [] });
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    if (!event.startDate || event.startDate.isDate) { skipped++; continue; }
    const zone = component.getFirstProperty('dtstart')?.getParameter('tzid');
    if (zone && !ICAL.TimezoneService.has(zone)) { skipped++; continue; }
    if (!event.isRecurring()) {
      append(event, event.startDate, event.endDate);
      continue;
    }
    const shortInterval = component.getAllProperties('rrule').some(rule => ['SECONDLY', 'MINUTELY', 'HOURLY'].includes(rule.getFirstValue().freq));
    if (shortInterval) { skipped++; continue; }
    const dates = event.iterator();
    for (let count = 0, date; (date = dates.next()); count++) {
      if (count >= 300) throw new Error('重复日程跨度过长，请导出有结束日期的单学期课表。');
      const detail = event.getOccurrenceDetails(date);
      append(detail.item, detail.startDate, detail.endDate);
    }
  }
  if (!occurrences.length) throw new Error('文件中没有识别到带开始和结束时间的课程。');
  return { occurrences, skipped };
}
