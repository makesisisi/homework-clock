'use strict';

const { app, BrowserWindow, clipboard, ipcMain, Menu, net, screen, session, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { WORK_URL, COURSE_URL, LOGIN_URL, schoolUrl, parseWork, parseCourses, demoItems } = require('./homework.cjs');
const { blurSupported, createBackdrop } = require('./backdrop.cjs');
const { createTimetable } = require('./timetable-window.cjs');
const { schoolChoices } = require('./timetable-schools.cjs');
const { createSchedules } = require('./schedules.cjs');
const { createCountdowns } = require('./countdowns.cjs');
const { createTodos } = require('./todos.cjs');
const { createTodoApi } = require('./todo-api.cjs');
const { createSessionRestore } = require('./session-restore.cjs');

const { DEFAULT_SIZE, CORNERS, fitBounds, rememberPosition, restorePosition, placeCorner, nearestCorner, resizeFrom } = require('./window-layout.cjs');
const PROFILE_NAME = 'Homework Clock';
const INTERVAL = 5 * 60 * 1000;
const THEMES = new Set(['glass', 'mica', 'mist', 'cotton', 'liquid', 'classic']);
const LEGACY_THEMES = { apricot: 'cotton', sage: 'mist' };
const INKS = new Set(['light', 'dark']);
const APPEARANCE_VERSION = 2;
const DEFAULTS = {
  theme: 'glass', ink: 'light', opacity: 0, blur: 0, classicInk: 'dark', classicOpacity: 68, classicBlur: 20,
  liveBackdrop: false, pinned: false, autoSnap: true, corner: null
};
const DEMO = process.argv.includes('--demo');
const QA = !app.isPackaged && process.env.HOMEWORK_CLOCK_QA;
const STARTUP_NAME = 'cn.homeworkclock.widget';
const startupPath = process.platform === 'win32' && app.isPackaged && !DEMO
  ? process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  : null;
const PARTITION = 'persist:homework-clock-chaoxing';
const html = path.join(__dirname, '../dist/client/index.html');
const widgetUrl = pathToFileURL(html).href;
let widget, portal, chaoxing, sessionRestore, configPath, timetable, schedules, todos, todoApi, tray, backdrop;
let countdowns, displayTimer;
const portalWindows = new Set();
let settings = { ...DEFAULTS };
let state = { status: 'loading', items: [], syncedAt: null, message: '' };
let pendingRefresh, timer, moveTimer, resizeGesture;
let manualMove = false;
let signingOut = false;
let quitting = false;

app.setName(PROFILE_NAME);
const profileName = DEMO ? 'Homework Clock Preview' : PROFILE_NAME;
const profilePath = QA ? path.resolve(QA, 'profile') : path.join(app.getPath('appData'), profileName);
// Keep preferences and Chromium storage independent of the executable's name and extraction directory.
app.setPath('userData', profilePath);
app.setPath('sessionData', profilePath);

function update(key, value) {
  if (key === 'theme') {
    const mapped = LEGACY_THEMES[value] ?? value;
    if (THEMES.has(mapped)) settings.theme = mapped;
  }
  if (key === 'ink' && INKS.has(value)) settings.ink = value;
  if (key === 'classicInk' && INKS.has(value)) settings.classicInk = value;
  if (key === 'pinned' && typeof value === 'boolean') settings.pinned = value;
  if (key === 'autoSnap' && typeof value === 'boolean') settings.autoSnap = value;
  if (key === 'liveBackdrop' && typeof value === 'boolean') settings.liveBackdrop = value;
  if (key === 'opacity' && Number.isFinite(value)) settings.opacity = Math.round(Math.max(0, Math.min(45, value)));
  if (key === 'blur' && Number.isFinite(value)) settings.blur = Math.round(Math.max(0, Math.min(16, value)));
  if (key === 'classicOpacity' && Number.isFinite(value)) settings.classicOpacity = Math.round(Math.max(0, Math.min(85, value)));
  if (key === 'classicBlur' && Number.isFinite(value)) settings.classicBlur = Math.round(Math.max(0, Math.min(32, value)));
}

function needsBackdrop() {
  return settings.theme === 'mica' || settings.theme === 'mist'
    || (settings.theme === 'glass' && settings.blur > 0) || (settings.theme === 'classic' && settings.classicBlur > 0);
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    update('theme', saved.theme);
    update('ink', saved.ink);
    update('classicInk', saved.classicInk);
    update('pinned', saved.pinned);
    update('autoSnap', saved.autoSnap);
    update('liveBackdrop', saved.liveBackdrop);
    update('classicOpacity', saved.classicOpacity);
    update('classicBlur', saved.classicBlur);
    if (CORNERS.includes(saved.corner)) settings.corner = saved.corner;
    if (Number.isInteger(saved.displayId)) settings.displayId = saved.displayId;
    if (Number.isInteger(saved.offsetX) && Number.isInteger(saved.offsetY)) {
      settings.offsetX = saved.offsetX;
      settings.offsetY = saved.offsetY;
    }
    if (Number.isInteger(saved.width) && Number.isInteger(saved.height)) {
      settings.width = saved.width;
      settings.height = saved.height;
    }
    if (saved.appearanceVersion === APPEARANCE_VERSION) {
      update('opacity', saved.opacity);
      update('blur', saved.blur ?? (saved.acrylic ? 8 : 0));
    }
    if (Number.isInteger(saved.x) && Number.isInteger(saved.y)) {
      settings.x = saved.x;
      settings.y = saved.y;
    }
  } catch {}
}

function persist() {
  const tmp = configPath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ ...settings, appearanceVersion: APPEARANCE_VERSION }), 'utf8');
    fs.renameSync(tmp, configPath);
    return true;
  } catch {
    return false;
  }
}

function initialBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const { width = DEFAULT_SIZE.width, height = DEFAULT_SIZE.height, corner } = settings;
  const { bounds, display } = restorePosition(settings, {
    x: workArea.x + Math.max(0, workArea.width - width - 26),
    y: workArea.y + 26, width, height
  }, screen);
  return corner ? placeCorner(bounds, display.workArea, corner) : fitBounds(bounds, display.workArea);
}

function flushBounds() {
  if (resizeGesture || manualMove) recordBounds();
  if (moveTimer) {
    clearTimeout(moveTimer);
    moveTimer = persist() ? null : moveTimer;
  }
}

function recordBounds() {
  const bounds = widget.getBounds();
  Object.assign(settings, bounds, rememberPosition(bounds, screen.getDisplayMatching(bounds)));
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => { if (persist()) moveTimer = null; }, 250);
}

function announceCorner() {
  widget.webContents.send('clock:corner', settings.corner);
}

function dock(corner, display = screen.getDisplayMatching(widget.getBounds())) {
  settings.corner = corner;
  settings.displayId = display.id;
  widget.setBounds(placeCorner(widget.getBounds(), display.workArea, corner));
  recordBounds();
  flushBounds();
  announceCorner();
}

function finishMove() {
  if (!manualMove) return;
  manualMove = false;
  const bounds = widget.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const corner = settings.autoSnap ? nearestCorner(bounds, display.workArea) : null;
  if (corner) {
    dock(corner, display);
  } else {
    settings.corner = null;
    recordBounds();
    announceCorner();
  }
  flushBounds();
}

function resizeWidget(phase, x, y) {
  if (phase === 'end') {
    if (!resizeGesture) return;
    resizeGesture = null;
    recordBounds();
    flushBounds();
    return;
  }
  if (![x, y].every(Number.isFinite)) return;
  if (phase === 'start') {
    const start = widget.getBounds();
    const { workArea } = screen.getDisplayMatching(start);
    resizeGesture = { start, workArea, x, y, corner: settings.corner };
  } else if (phase === 'move' && resizeGesture) {
    const drag = resizeGesture;
    widget.setBounds(resizeFrom(drag.start, drag.workArea, drag.corner, x - drag.x, y - drag.y));
    recordBounds();
  } else if (phase === 'step') {
    const start = widget.getBounds();
    const { workArea } = screen.getDisplayMatching(start);
    widget.setBounds(resizeFrom(start, workArea, settings.corner, x, y));
    recordBounds();
  }
}

function emit(next) {
  state = { ...state, ...next };
  if (widget && !widget.isDestroyed()) widget.webContents.send('clock:state', state);
}

class LoginRequired extends Error {
  constructor(confirmed = true) {
    super();
    this.confirmed = confirmed;
  }
}

function requestText(url, auth = true) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, session: chaoxing, useSessionCookies: true, redirect: 'manual' });
    request.setHeader('Accept', 'text/html,application/json;q=0.9,*/*;q=0.8');
    request.setHeader('Accept-Language', 'zh-CN,zh;q=0.9');
    const timeout = setTimeout(() => {
      finish(new Error('学习通响应超时'));
      request.abort();
    }, auth ? 15000 : 5000);
    let redirects = 0;
    let currentUrl = url;
    function finish(error, body) {
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(body);
    }
    request.on('redirect', (_code, _method, redirectUrl) => {
      const next = schoolUrl(redirectUrl, currentUrl);
      if (!next || ++redirects > 5) {
        finish(new Error('学习通返回了无法访问的跳转'));
        request.abort();
        return;
      }
      if (new URL(next).hostname === 'passport2.chaoxing.com') {
        finish(new LoginRequired());
        request.abort();
        return;
      }
      currentUrl = next;
      request.followRedirect();
    });
    request.on('response', res => {
      if ([401, 403].includes(res.statusCode) && auth) {
        finish(new LoginRequired(res.statusCode === 401));
        request.abort();
        return;
      }
      if (res.statusCode !== 200) {
        finish(new Error('学习通返回了 HTTP ' + res.statusCode));
        request.abort();
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 6 * 1024 * 1024) {
          finish(new Error('学习通响应过大'));
          request.abort();
        } else chunks.push(chunk);
      });
      res.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
      res.on('error', error => finish(error));
    });
    request.on('error', error => finish(error));
    request.end();
  });
}

async function fetchHomework() {
  const response = await requestText(WORK_URL);
  const observedAt = Date.now();
  if (!/作业列表/.test(response) && /passport2\.chaoxing\.com|fanyalogin|请先登录|登录超时/i.test(response)) {
    throw new LoginRequired();
  }
  const items = parseWork(response, observedAt);
  if (items.length) {
    try {
      const names = parseCourses(await requestText(COURSE_URL, false));
      for (const item of items) item.course = names.get(item.courseId) || item.course;
    } catch {}
  }
  return { items, syncedAt: observedAt, status: 'ready', message: '' };
}

function refresh() {
  if (pendingRefresh) return pendingRefresh;
  if (DEMO || signingOut) return Promise.resolve(state);
  emit({ status: 'loading', message: '' });
  pendingRefresh = fetchHomework().then(async result => {
    await sessionRestore?.remember().catch(() => console.warn('未能保存学习通临时会话'));
    await chaoxing.cookies.flushStore().catch(() => console.warn('学习通会话暂未写入本地存储'));
    emit(result);
  }).catch(async error => {
    if (error instanceof LoginRequired) {
      if (error.confirmed) await sessionRestore?.forget().catch(() => console.warn('未能清除失效的学习通会话副本'));
      emit({ status: 'login', message: '请登录学习通以同步作业' });
    } else {
      const message = /^学习通|^未能识别/.test(error.message) ? error.message : '暂时连不上学习通，请稍后再试';
      emit({ status: 'error', message });
    }
  }).then(() => state).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

const portalOptions = {
  width: 1000, height: 760, minWidth: 520, minHeight: 530, autoHideMenuBar: true,
  title: '学习通', backgroundColor: '#ffffff'
};

function setupPortalContents(contents) {
  if (!chaoxing || contents.session !== chaoxing || contents.getType() !== 'window') return;
  const canOpen = url => url === 'about:blank' || Boolean(schoolUrl(url));
  contents.on('will-navigate', event => {
    if (!canOpen(event.url)) event.preventDefault();
  });
  contents.on('will-redirect', event => {
    if (event.isMainFrame && !canOpen(event.url)) event.preventDefault();
  });
  contents.on('dom-ready', () => {
    const address = schoolUrl(contents.getURL());
    if (!address || !/\/work\/phone\/task-work\/?$/.test(new URL(address).pathname)) return;
    // The mobile entry can redirect with vx=0. Switch the loaded page to its own web navigation.
    contents.executeJavaScript(
      '(() => {' +
      'if (location.href !== ' + JSON.stringify(address) + ') return;' +
      'const mode = document.getElementById("vx");' +
      'if (mode) mode.value = "1";' +
      'if (typeof window.processOpenUrl === "function") window.vx = "1";' +
      '})()'
    ).catch(() => {}); // The user can navigate away before the script runs.
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (signingOut || !canOpen(url)) return { action: 'deny' };
    // Let Chromium keep the opener, form method and body when creating a school page.
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...portalOptions,
        webPreferences: { session: chaoxing, nodeIntegration: false, contextIsolation: true, sandbox: true }
      }
    };
  });
  contents.on('did-create-window', child => {
    portalWindows.add(child);
    child.on('closed', () => portalWindows.delete(child));
  });
  contents.on('did-navigate', (_event, address) => {
    if (!schoolUrl(address) || new URL(address).hostname === 'passport2.chaoxing.com') return;
    if (state.status !== 'ready' && !signingOut) void refresh();
  });
}

function openPortal(value) {
  const url = schoolUrl(value);
  if (DEMO || signingOut || !url) return false;
  if (!portal || portal.isDestroyed()) {
    const root = new BrowserWindow({
      ...portalOptions,
      webPreferences: { session: chaoxing, nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    portal = root;
    portalWindows.add(root);
    root.on('closed', () => {
      portalWindows.delete(root);
      portal = null;
      if (state.status !== 'ready' && !signingOut) void refresh();
    });
  }
  portal.loadURL(url).catch(error => {
    if (!String(error.message).includes('ERR_ABORTED')) {
      emit({ status: 'error', message: '学习通页面暂时无法打开，请重试' });
    }
  });
  if (portal.isMinimized()) portal.restore();
  portal.show();
  portal.focus();
  return true;
}

function startupEnabled() {
  if (!startupPath) return null;
  const { launchItems } = app.getLoginItemSettings({ path: startupPath });
  return launchItems.some(item => item.name === STARTUP_NAME && item.scope === 'user' && item.enabled);
}

function setStartup(enabled) {
  if (!startupPath || typeof enabled !== 'boolean') throw new Error('Invalid startup setting');
  if (enabled && !fs.existsSync(startupPath)) throw new Error('Startup executable is missing');
  app.setLoginItemSettings({ name: STARTUP_NAME, path: startupPath, openAtLogin: enabled });
  return startupEnabled();
}

function showWidget() {
  if (!widget || widget.isDestroyed()) return;
  widget.show();
  widget.focus();
}

function openCountdownManager(id = null) {
  if (!widget || widget.isDestroyed()) return;
  showWidget();
  const contents = widget.webContents;
  if (contents.isLoadingMainFrame()) contents.once('did-finish-load', () => contents.send('clock:countdown-edit', id));
  else contents.send('clock:countdown-edit', id);
}

function createTray() {
  tray = new Tray(path.join(__dirname, '../src/assets/clock.ico'));
  tray.setToolTip('课隙');
  const toggle = () => widget.isVisible() ? widget.hide() : showWidget();
  tray.on('click', toggle);
  const updateMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: widget.isVisible() ? '隐藏组件' : '显示组件', click: toggle },
    { label: '倒计时小组件', click: () => openCountdownManager() },
    { type: 'separator' },
    { label: '退出课隙', click: () => app.quit() }
  ]));
  widget.on('show', updateMenu);
  widget.on('hide', updateMenu);
  updateMenu();
}

function registerIpc() {
  const handle = (channel, callback) => ipcMain.handle('clock:' + channel, (event, ...args) => {
    if (!widget || event.sender !== widget.webContents || event.senderFrame?.url !== widgetUrl) {
      throw new Error('Invalid widget sender');
    }
    return callback(...args);
  });
  handle('setup', () => ({
    settings, state, demo: DEMO, blurSupported, timetable: timetable?.saved, schools: schoolChoices,
    schedules: schedules.items, countdowns: countdowns.items, todos: todos.state
  }));
  handle('schedule-save', schedules.save);
  handle('schedule-remove', schedules.remove);
  handle('countdown-save', countdowns.save);
  handle('countdown-remove', countdowns.remove);
  handle('countdown-visible', countdowns.setVisible);
  handle('todo-update', todos.update);
  handle('todo-api-status', () => todoApi.status());
  handle('todo-api-configure', enabled => todoApi.configure(enabled));
  handle('todo-api-copy', () => {
    const config = todoApi.config();
    if (!config) return { error: '请先开启 AI 接口' };
    clipboard.writeText(JSON.stringify(config, null, 2));
    return {};
  });
  handle('timetable-open', id => timetable?.open(id));
  handle('timetable-calendar', data => timetable?.importCalendar(data));
  handle('timetable-cancel', () => timetable?.cancel());
  handle('timetable-save', monday => timetable?.save(monday));
  handle('refresh', () => { backdrop?.refresh(); return refresh(); });
  handle('dock', corner => { if (CORNERS.includes(corner)) dock(corner); });
  handle('resize', resizeWidget);
  handle('size-preset', preset => {
    const sizes = new Map([['small', { width: 330, height: 360 }], ['default', DEFAULT_SIZE], ['large', { width: 500, height: 620 }]]);
    const size = sizes.get(preset);
    if (!size) return;
    const bounds = widget.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const target = { ...bounds, ...size };
    widget.setBounds(settings.corner ? placeCorner(target, workArea, settings.corner) : fitBounds(target, workArea));
    recordBounds();
    flushBounds();
  });
  handle('change', async (key, value) => {
    update(key, value);
    if (key === 'pinned') widget.setAlwaysOnTop(settings.pinned);
    if (key === 'theme' || key === 'blur' || key === 'classicBlur' || key === 'liveBackdrop') {
      backdrop?.enable(needsBackdrop(), settings.liveBackdrop);
    }
    return { saved: persist() };
  });
  handle('login', () => openPortal(LOGIN_URL));
  handle('logout', async () => {
    if (DEMO || signingOut) return;
    signingOut = true;
    try {
      for (const window of [...portalWindows]) {
        if (!window.isDestroyed()) window.destroy();
      }
      await pendingRefresh;
      await chaoxing.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers'] });
      await sessionRestore?.forget();
      await chaoxing.cookies.flushStore();
      emit({ status: 'login', items: [], syncedAt: null, message: '请登录学习通以同步作业' });
    } finally {
      signingOut = false;
    }
  });
  handle('open', url => openPortal(typeof url === 'string' ? url : WORK_URL));
  handle('startup', startupEnabled);
  handle('set-startup', setStartup);
  handle('hide', () => { if (tray) widget.hide(); });
  handle('close', () => app.quit());
}

function createWidget() {
  const icon = path.join(__dirname, '../dist/client/clock-icon.png');
  widget = new BrowserWindow({
    ...initialBounds(), title: '课隙', frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, thickFrame: false, resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: settings.pinned, skipTaskbar: true, show: false, icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, spellcheck: false
    }
  });
  widget.webContents.on('will-navigate', event => event.preventDefault());
  widget.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  widget.on('will-move', () => { manualMove = true; });
  widget.on('move', () => {
    if (!manualMove) return;
    settings.corner = null;
    recordBounds();
  });
  widget.on('moved', finishMove);
  widget.on('query-session-end', flushBounds);
  widget.on('session-end', flushBounds);
  widget.on('close', flushBounds);
  widget.on('closed', () => { if (!quitting && !QA) app.quit(); });
  if (process.platform === 'win32') widget.hookWindowMessage(0x0232, () => setImmediate(finishMove)); // WM_EXITSIZEMOVE
  if (blurSupported) {
    backdrop = createBackdrop(widget);
    backdrop.enable(needsBackdrop(), settings.liveBackdrop);
  }
  widget.once('ready-to-show', () => widget.show());
  widget.loadFile(html);
}

const ownsInstance = QA || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
  app.on('second-instance', showWidget);
  app.whenReady().then(async () => {
    configPath = path.join(app.getPath('userData'), 'settings.json');
    loadSettings();
    countdowns = createCountdowns({
      userData: profilePath, widgetUrl, getMainBounds: () => widget.getBounds(), openManager: openCountdownManager,
      notify: items => { if (widget && !widget.isDestroyed()) widget.webContents.send('clock:countdowns', items); }
    });
    schedules = createSchedules(app.getPath('userData'));
    todos = createTodos(app.getPath('userData'), value => {
      if (widget && !widget.isDestroyed() && !widget.webContents.isDestroyed()) widget.webContents.send('clock:todos', value);
    });
    todoApi = createTodoApi(profilePath, {
      addTodo: todos.addFromApi,
      addCountdown: countdowns.addFromApi,
      readState: () => ({
        todos: todos.state, countdowns: countdowns.items, schedules: schedules.items,
        homework: state, timetable: timetable?.saved
      })
    }, QA ? 0 : undefined);
    chaoxing = session.fromPartition(PARTITION);
    if (!DEMO && process.platform === 'win32') {
      sessionRestore = createSessionRestore(chaoxing.cookies, profilePath);
      await sessionRestore.restore().catch(() => console.warn('未能恢复本机学习通会话'));
    }
    if (!DEMO) timetable = createTimetable(app.getPath('userData'), value => {
      if (widget && !widget.isDestroyed()) {
        widget.webContents.send('clock:timetable-result', value);
        if (value.draft) widget.focus();
      }
    });
    app.on('web-contents-created', (_event, contents) => {
      setupPortalContents(contents);
      timetable?.protect(contents);
    });
    chaoxing.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    chaoxing.setPermissionCheckHandler(() => false);
    chaoxing.on('will-download', event => event.preventDefault());
    if (DEMO || (QA && process.env.HOMEWORK_CLOCK_QA_TODO_API)) {
      const now = QA ? Date.parse('2026-11-09T17:58:00+08:00') : Date.now();
      state = { status: 'ready', items: demoItems(now), syncedAt: now, message: '' };
    }
    registerIpc();
    createWidget();
    countdowns.restore();
    if (!DEMO) await todoApi.restore();
    // Windows can add monitors or change the work area as the desktop starts.
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, () => {
        clearTimeout(displayTimer);
        displayTimer = setTimeout(() => {
          if (!widget.isDestroyed() && !manualMove && !resizeGesture) widget.setBounds(initialBounds());
          countdowns.restorePositions();
        }, 300);
      });
    }
    if (process.platform === 'win32' && !DEMO) createTray();
    if (QA) {
      if (!DEMO && !process.env.HOMEWORK_CLOCK_QA_TIMETABLE && !process.env.HOMEWORK_CLOCK_QA_SESSION
        && !process.env.HOMEWORK_CLOCK_QA_TODO_API) void refresh();
      const { verify } = require('./verify.cjs');
      try { await verify(widget, QA); app.exit(0); }
      catch (error) { console.error(error); app.exit(1); }
    } else if (!DEMO) {
      void refresh();
      timer = setInterval(refresh, INTERVAL);
    }
  });
  app.on('before-quit', () => {
    quitting = true;
    void todoApi?.close();
    clearInterval(timer);
    clearTimeout(displayTimer);
    if (widget && !widget.isDestroyed()) flushBounds();
    countdowns?.shutdown();
  });
  app.on('will-quit', () => tray?.destroy());
  app.on('window-all-closed', () => app.quit());
}
