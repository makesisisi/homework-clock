'use strict';

const { ENTRY } = require('./timetable.cjs');
const directory = require('./timetable-school-directory.json');
const ZF_PAGE = '/kbcx/xskbcx_cxXskbcxIndex.html';

const lzu = { id: 'lzu', name: '兰州大学', aliases: '兰大 lzu lanzhoudaxue', type: 'lzu', entry: ENTRY, domain: 'lzu.edu.cn' };

function zhengfang(id, name, aliases, domain, base) {
  return { id, name, aliases, domain, base, type: 'zhengfang', entry: base + '/', course: base + ZF_PAGE + '?gnmkdm=N2151' };
}

// School-published teaching-system hosts. No accounts or per-student paths are stored here.
const existing = [
  lzu,
  zhengfang('haut', '河南工业大学', '河工大 haut henangongyedaxue', 'haut.edu.cn', 'https://jwglxt.haut.edu.cn/jwglxt'),
  zhengfang('uzz', '枣庄学院', '枣院 uzz zaozhuangxueyuan', 'uzz.edu.cn', 'https://jwgl.uzz.edu.cn/jwglxt'),
  zhengfang('gpnu', '广东技术师范大学', '广师大 广技师 gpnu', 'gpnu.edu.cn', 'https://jwglxt1.gpnu.edu.cn/jwglxt'),
  zhengfang('gzist', '广州理工学院', '广理 gzist guangzhouligongxueyuan', 'gzist.edu.cn', 'https://jw.gzist.edu.cn/jwglxt'),
  zhengfang('zzjc', '浙江工业大学之江学院', '之江学院 zzjc', 'zzjc.edu.cn', 'https://jw.zzjc.edu.cn/jwglxt'),
  zhengfang('gwng', '广东外语外贸大学南国商学院', '广外南国 南国商学院 gwng', 'gwng.edu.cn', 'https://jwgl.gwng.edu.cn/jwglxt'),
  zhengfang('situ', '沈阳工学院', '沈工 situ shenyanggongxueyuan', 'situ.edu.cn', 'https://jwglxt.situ.edu.cn/jwglxt')
];

const publicPortals = new Map([
  ['北京大学', ['https://portal.pku.edu.cn/', '北大']], // dean.pku.edu.cn/web/rules_info.php?id=65
  ['香港大學', ['https://hkuportal.hku.hk/', '港大 hku']], // its.hku.hk/kb/user-guide-on-hku-portal/
  ['澳門大學', ['https://myum.um.edu.mo/', '澳门大学 澳大 um']], // um.edu.mo/students/
  ['國立臺灣大學', ['https://course.ntu.edu.tw/', '台大 台湾大学 台灣大學 ntu']],
]);

const entriesByName = new Map(directory.map(entry => [entry.name, entry]));
const existingNames = new Set(existing.map(school => school.name));
const schools = existing.map(school => ({ ...entriesByName.get(school.name), ...school }));
for (const { id, name, region, aliases, entry, base } of directory) {
  if (existingNames.has(name)) continue;
  if (base) {
    const domain = new URL(base).hostname.split('.').slice(-3).join('.');
    schools.push({ ...zhengfang(id, name, aliases, domain, base), region, entry });
  } else {
    const [portal, extra] = publicPortals.get(name) ?? [entry, ''];
    schools.push({ id, name, region, aliases: `${aliases} ${extra}`.trim(), entry: portal, type: portal ? 'portal' : 'search' });
  }
}

function schoolAddress(school, address) {
  try {
    const url = new URL(address);
    const institutional = url.hostname === school.domain || url.hostname.endsWith('.' + school.domain);
    return institutional && url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch { return null; }
}

const schoolIndex = new Map(schools.map(school => [school.id, school]));
const schoolChoices = schools.map(({ id, name, region, aliases, type }) => ({
  id, name, region, aliases, mode: type === 'lzu' || type === 'zhengfang' ? 'direct' : type
}));

function externalSchoolAddress(school) {
  if (school.type === 'portal') {
    const url = new URL(school.entry);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : '';
  }
  if (school.type !== 'search') return '';
  const search = new URL('https://cn.bing.com/search');
  search.searchParams.set('q', `${school.name} 官方 教务系统 学生课表`);
  return search.href;
}

module.exports = { schoolIndex, schoolChoices, schoolAddress, externalSchoolAddress, ZF_PAGE };
