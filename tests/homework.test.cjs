const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWork, parseCourses, schoolUrl } = require('../electron/homework.cjs');

const now = Date.parse('2026-11-09T17:59:00+08:00');
const item = (id, title, status, time) =>
  '<li data="/work/stu-work?courseId=5&amp;taskrefId=' + id + '"><p>' + title +
  '</p><span>《高等数学》</span><span>' + status + '</span><span>' + time + '</span></li>';

test('作业抓取排除已交项，并保留逾期与缺少截止时间的待办', () => {
  const html = '<h2>作业列表</h2>' +
    item(1, '极限 &amp; 连续', '未提交', '剩余 6 小时') +
    item(2, '微分', '已提交', '剩余 2 天') +
    item(3, '函数', '已截止', '') +
    item(4, '积分', '待重做', '');
  const result = parseWork(html, now);
  assert.deepEqual(result.map(({ title, deadline, expired }) => ({ title, deadline, expired })), [
    { title: '极限 & 连续', deadline: now + 21600000, expired: false },
    { title: '函数', deadline: null, expired: true },
    { title: '积分', deadline: null, expired: false }
  ]);
  assert.equal(result[0].course, '高等数学');
  assert.equal(parseCourses('{"channelList":[{"content":{"course":{"data":[{"courseId":5,"name":"高等数学A"}]}}}]}').get('5'), '高等数学A');
  assert.deepEqual(parseWork('<h2>作业列表</h2>', now), []);
  assert.throws(() => parseWork('<html>连接异常</html>', now));
  assert.throws(() => parseWork(item(1, '新格式', '未知状态', ''), now));
});

test('地址仅允许学习通 HTTPS，日期按北京时间合并和排序', async () => {
  assert.equal(schoolUrl('https://chaoxing.com.example.org/'), null);
  assert.equal(schoolUrl('https://chaoxing.com:8443/'), null);
  assert.equal(schoolUrl('https://fake@chaoxing.com/'), null);
  assert.equal(schoolUrl('javascript:alert(1)'), null);
  assert.match(schoolUrl('/work/stu-work'), /^https:\/\/mooc1-api\.chaoxing\.com/);
  const { remaining, groupsFor } = await import('../src/time.mjs');
  assert.equal(remaining({ deadline: now + 21600000 }, now).date, '今天 · 11月9日');
  assert.equal(remaining({ deadline: now + 21600000 }, now).label, '剩 6 小时');
  assert.equal(remaining({ deadline: now + 120000 }, now + 120001).label, '已截止');
  assert.deepEqual(groupsFor([
    { id: 'expired', deadline: now - 1 },
    { id: 'later', deadline: now + 21600000 },
    { id: 'unknown', deadline: null },
    { id: 'first', deadline: now + 60000 }
  ], now).map(group => group.items.map(row => row.id)), [['first', 'later'], ['unknown'], ['expired']]);
});

test('倒计时进入 72 小时后显示天和小时，不足一小时显示分钟', async () => {
  const { remaining } = await import('../src/time.mjs');
  const hour = 3600000;
  const label = delta => remaining({ deadline: now + delta }, now).label;
  assert.equal(label(72 * hour + 1), '剩 3 天');
  assert.equal(label(72 * hour), '剩 3 天 0 小时');
  assert.equal(label(71 * hour + 30 * 60000), '剩 2 天 23 小时');
  assert.equal(label(24 * hour), '剩 1 天 0 小时');
  assert.equal(label(23 * hour), '剩 23 小时');
  assert.equal(label(39 * 60000), '剩 39 分钟');
  const tone = delta => remaining({ deadline: now + delta }, now).tone;
  assert.equal(tone(72 * hour + 1), 'normal');
  assert.equal(tone(72 * hour), 'soon');
  assert.equal(tone(24 * hour), 'soon');
  assert.equal(tone(24 * hour - 1), 'urgent');
  assert.equal(tone(0), 'expired');
});
