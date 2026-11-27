'use strict';

const { BrowserWindow, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { ENTRY, schoolPage, timetablePage, readTables, readCalendar, calendarMonday, publishedMonday, parseTables, expand, calendarDraft, datedLessons } = require('./timetable.cjs');
const { schoolIndex, schoolAddress, externalSchoolAddress, ZF_PAGE } = require('./timetable-schools.cjs');
const { readZhengfang, parseZhengfang } = require('./timetable-zhengfang.cjs');

function createTimetable(userData, send) {
  const file = path.join(userData, 'timetable.json');
  let saved = null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data.lessons) && typeof data.monday === 'string') saved = data;
  } catch {}

  const configured = new Set();
  let active, draft;

  function portalSession(school) {
    const partition = session.fromPartition('persist:homework-clock-' + school.id.replaceAll(':', '-'));
    if (configured.has(partition)) return partition;
    configured.add(partition);
    partition.setPermissionRequestHandler((_contents, _permission, done) => done(false));
    partition.setPermissionCheckHandler(() => false);
    partition.on('will-download', event => event.preventDefault());
    if (school.type === 'lzu') {
      partition.webRequest.onBeforeRequest({ urls: ['http://*.lzu.edu.cn/*'] }, (details, done) => {
        const url = schoolPage(details.url);
        if (!url) return done({ cancel: true });
        url.protocol = 'https:';
        done({ redirectURL: url.href });
      });
    }
    return partition;
  }

  async function findMonday(contents, frame, term) {
    if (!term) return '';
    const main = contents.mainFrame;
    const menu = main.framesInSubtree.find(item => item.name === 'menuFrame' && item.origin === new URL(ENTRY).origin);
    const dates = await Promise.all([...new Set([menu, main, frame].filter(Boolean))].map(async source => {
      try {
        const code = `(${readCalendar})()`;
        const rows = source === main
          ? await contents.executeJavaScriptInIsolatedWorld(1001, [{ code }])
          : await source.executeJavaScript(code);
        return calendarMonday(rows, term);
      } catch { return ''; }
    }));
    const distinct = new Set(dates.filter(Boolean));
    return distinct.size === 1 ? [...distinct][0] : publishedMonday(term);
  }

  async function capture(flow, contents, processId, routingId) {
    if (active !== flow || draft || contents.isDestroyed()) return;
    const frame = contents.mainFrame.framesInSubtree.find(item => item.processId === processId && item.routingId === routingId);
    const address = frame?.url;
    const { school } = flow;
    const lzu = school.type === 'lzu';
    if (lzu ? !timetablePage(address) : address?.split('?')[0] !== school.base + ZF_PAGE) return;
    try {
      const args = lzu ? [address] : [address, school.base];
      const code = `(${lzu ? readTables : readZhengfang})(...${JSON.stringify(args)})`;
      const data = frame === contents.mainFrame
        ? await contents.executeJavaScriptInIsolatedWorld(1001, [{ code }])
        : await frame.executeJavaScript(code);
      if (active !== flow || draft || contents.isDestroyed() || frame.isDestroyed() || frame.url !== address) return;
      const parsed = data && (lzu ? parseTables(data) : parseZhengfang(data));
      if (!parsed?.meetings.length) {
        send({ error: '尚未识别到课程和作息时间。请在教务窗口确认已登录并打开学生个人课表。' });
        return;
      }
      parsed.school = school.id;
      parsed.schoolName = school.name;
      draft = parsed;
      const fromCalendar = lzu ? await findMonday(contents, frame, parsed.term) : '';
      if (active !== flow || draft !== parsed) return;
      if (contents.isDestroyed()) { draft = null; return; }
      const sameSchool = saved?.school === school.id || (lzu && !saved?.school && saved?.source !== 'calendar');
      const fromSaved = sameSchool && parsed.term && saved?.term === parsed.term ? saved.monday : '';
      for (const window of flow.windows) if (!window.isDestroyed()) window.hide();
      send({ draft: {
        ...draft,
        monday: fromCalendar || fromSaved,
        mondaySource: fromCalendar ? 'calendar' : fromSaved ? 'saved' : ''
      } });
    } catch {
      if (!lzu && active === flow && !contents.isDestroyed() && !frame.isDestroyed() && frame.url === address) {
        send({ error: '暂时无法读取这页个人课表。可在教务窗口刷新，或使用 .ics 导入。' });
      }
    }
  }

  function protect(contents) {
    const flow = active;
    if (!flow || contents.session !== flow.partition) return;
    const { school } = flow;
    const allowed = url => school.type === 'lzu' ? schoolPage(url) : schoolAddress(school, url);
    contents.on('will-frame-navigate', event => {
      if (!allowed(event.url) && event.url !== 'about:blank') event.preventDefault();
    });
    contents.on('will-redirect', event => {
      if (!allowed(event.url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => allowed(url)
      ? { action: 'allow', overrideBrowserWindowOptions: flow.options } : { action: 'deny' });
    contents.on('did-create-window', window => track(flow, window));
    contents.on('did-frame-finish-load', (_event, isMain, processId, routingId) => {
      if (active !== flow || draft) return;
      // Some sign-in flows return to the dashboard instead of the requested timetable.
      const url = contents.getURL();
      if (isMain && school.type === 'zhengfang' && !flow.returnedToSchedule
        && url.split('?')[0] === school.base + '/xtgl/index_initMenu.html') {
        flow.returnedToSchedule = true;
        void contents.loadURL(school.course).catch(() => {
          if (active === flow) send({ error: '请在教务窗口打开「学生课表查询」。' });
        });
        return;
      }
      void capture(flow, contents, processId, routingId);
    });
  }

  function track(flow, window) {
    flow.windows.add(window);
    window.once('closed', () => flow.windows.delete(window));
  }

  function close() {
    const flow = active;
    active = null;
    for (const window of flow?.windows ?? []) if (!window.isDestroyed()) window.destroy();
  }

  return {
    protect,
    get saved() { return saved; },
    async open(id) {
      const school = schoolIndex.get(id);
      if (!school) return { error: '请选择目录中的学校。' };
      draft = null;
      close();
      if (school.type === 'portal' || school.type === 'search') {
        try {
          const address = externalSchoolAddress(school);
          if (!address) return { error: '教务入口暂时不可用。' };
          await shell.openExternal(address);
          return { mode: school.type };
        } catch { return { error: '无法打开系统浏览器。' }; }
      }
      const partition = portalSession(school);
      const options = {
        title: school.name + '教务 · 个人课表', width: 1050, height: 750, skipTaskbar: true, autoHideMenuBar: true,
        webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false }
      };
      const flow = { school, partition, options, windows: new Set() };
      active = flow;
      const root = new BrowserWindow(options);
      track(flow, root);
      root.show();
      root.focus();
      void root.loadURL(school.course || school.entry).catch(async error => {
        if (active !== flow || root.isDestroyed() || error.code === 'ERR_ABORTED') return;
        if (school.course) {
          try { await root.loadURL(school.entry); return; }
          catch (fallback) { if (fallback.code === 'ERR_ABORTED' || active !== flow) return; }
        }
        send({ error: `${school.name}教务页面暂时打不开，请检查校园网或稍后重试。` });
      });
      return { mode: 'direct' };
    },
    importCalendar(data) {
      const parsed = calendarDraft(data);
      if (!parsed) return { error: '无法读取这个日历，请选择包含单学期课程的 .ics 文件。' };
      draft = parsed;
      close();
      send({ draft });
      return {};
    },
    cancel() { draft = null; close(); },
    save(monday) {
      if (!draft) return { error: '请重新读取课表。' };
      const calendar = draft.type === 'calendar';
      const lessons = calendar ? datedLessons(draft.occurrences, monday) : expand(draft.meetings, monday);
      if (!lessons) return { error: calendar ? '请选择能覆盖全部课程的第一教学周周一（最多 30 周）。' : '请选择教务校历第一教学周的周一。' };
      const data = calendar ? { source: 'calendar', monday, lessons }
        : { school: draft.school, schoolName: draft.schoolName, term: draft.term, monday, lessons };
      try {
        fs.writeFileSync(file + '.tmp', JSON.stringify(data), 'utf8');
        fs.renameSync(file + '.tmp', file);
      } catch { return { error: '课表暂时无法保存，请重试。' }; }
      saved = data;
      draft = null;
      close();
      return { saved };
    }
  };
}

module.exports = { createTimetable };
