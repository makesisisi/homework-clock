const DAY = 86400000;
const HOUR = 3600000;
const MINUTE = 60000;
const EMPHASIS_WINDOW = 3 * DAY;
const ZONE = 'Asia/Shanghai';
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONE, dateStyle: 'short' });
const dateText = date => {
  const [, month, day] = dateKey.format(date).split('-');
  return Number(month) + '月' + Number(day) + '日';
};
const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, weekday: 'short' });
const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function scheduleFields(at) {
  return { date: dateKey.format(at), time: clock.format(at) };
}

export function remaining(item, now) {
  if (item.expired || (item.deadline !== null && item.deadline <= now)) {
    return { tone: 'expired', label: '已截止', group: 'expired', date: '已截止' };
  }
  if (item.deadline === null) return { tone: 'normal', label: '待交', group: 'unknown', date: '未提供截止时间' };
  const delta = item.deadline - now;
  const group = dateKey.format(item.deadline);
  const day = group === dateKey.format(now) ? '今天'
    : group === dateKey.format(now + DAY) ? '明天' : weekday.format(item.deadline);
  let label = '不足 1 分钟';
  if (delta >= DAY) {
    const days = Math.floor(delta / DAY);
    label = '剩 ' + days + ' 天';
    if (delta <= EMPHASIS_WINDOW) label += ' ' + Math.floor((delta % DAY) / HOUR) + ' 小时';
  } else if (delta >= HOUR) label = '剩 ' + Math.floor(delta / HOUR) + ' 小时';
  else if (delta >= MINUTE) label = '剩 ' + Math.floor(delta / MINUTE) + ' 分钟';
  return {
    tone: delta < DAY ? 'urgent' : delta <= EMPHASIS_WINDOW ? 'soon' : 'normal', label, group,
    date: day + ' · ' + dateText(item.deadline),
    tooltip: '预计截止 ' + dateText(item.deadline) + ' ' + clock.format(item.deadline) + '（北京时间）'
  };
}

export function groupsFor(items, now) {
  const groups = new Map();
  const sorted = items.map(item => {
    const timing = remaining(item, now);
    if (!item.schedule) return { ...item, timing };
    const past = item.deadline <= now;
    const exactTime = dateText(item.deadline) + ' ' + clock.format(item.deadline);
    return { ...item, timing: {
      ...timing,
      group: past ? 'past-schedules' : timing.group,
      date: past ? '过往日程' : timing.date,
      label: past ? '已到时间' : timing.label,
      startTime: past ? exactTime : clock.format(item.deadline),
      tooltip: exactTime + '（北京时间）'
    } };
  }).sort((a, b) => {
    const rank = item => ['unknown', 'expired', 'past-schedules'].indexOf(item.timing.group);
    return rank(a) - rank(b) || (a.deadline ?? 0) - (b.deadline ?? 0);
  });
  for (const item of sorted) {
    const { group, date, tone } = item.timing;
    if (!groups.has(group)) groups.set(group, { key: group, date, tone, items: [] });
    groups.get(group).items.push(item);
  }
  return [...groups.values()];
}
