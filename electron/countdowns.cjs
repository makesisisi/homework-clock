'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { createBackdrop } = require('./backdrop.cjs');
const { fitPosition, rememberPosition, restorePosition } = require('./window-layout.cjs');
const SIZES = require('./countdown-sizes.json');

const THEMES = new Set(['desktop', 'liquid', 'frost', 'paper', 'midnight']);
const INKS = new Set(['light', 'dark']);
const LAYOUTS = new Set(Object.keys(SIZES));

function valid(item) {
  return typeof item?.title === 'string' && item.title.trim() && item.title.length <= 100
    && Number.isSafeInteger(item.at) && item.at >= 0 && item.at < Date.UTC(10000, 0, 1)
    && typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color);
}

function createCountdowns({ userData, widgetUrl, getMainBounds, openManager, notify }) {
  const file = path.join(userData, 'countdowns.json');
  const windows = new Map();
  let items = [];
  let readable = true;
  let quitting = false;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(saved) || !saved.every(item => valid(item) && typeof item.id === 'string'
      && typeof item.visible === 'boolean' && Number.isInteger(item.position?.x) && Number.isInteger(item.position?.y))
      || new Set(saved.map(item => item.id)).size !== saved.length) throw new Error('Invalid countdowns');
    items = saved.map(item => ({
      ...item, theme: THEMES.has(item.theme) ? item.theme : 'midnight', ink: INKS.has(item.ink) ? item.ink : 'light',
      layout: LAYOUTS.has(item.layout) ? item.layout : 'standard'
    }));
  } catch (error) {
    readable = error.code === 'ENOENT';
  }

  function write(next) {
    if (!readable) return { error: '无法读取本地倒计时' };
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify(next), 'utf8');
      fs.renameSync(file + '.tmp', file);
      items = next;
      return { items };
    } catch {
      return { error: '无法保存倒计时，请重试' };
    }
  }

  const find = id => items.find(item => item.id === id);
  const replace = entry => write(items.map(item => item.id === entry.id ? entry : item));

  function boundsFor({ position, layout }) {
    const { bounds, display } = restorePosition(position, { ...position, ...SIZES[layout] }, screen);
    return fitPosition(bounds, display.workArea);
  }

  function startingPosition(layout) {
    const size = SIZES[layout];
    const anchor = getMainBounds();
    const display = screen.getDisplayMatching(anchor);
    const area = display.workArea;
    const left = anchor.x - size.width - 16;
    const x = left >= area.x ? left : anchor.x + anchor.width + 16;
    const y = anchor.y + (windows.size % 6) * 32;
    return rememberPosition(fitPosition({ ...size, x, y }, area), display);
  }

  function show(item) {
    if (windows.has(item.id)) return;
    const page = new URL(widgetUrl);
    page.searchParams.set('countdown', item.id);
    const win = new BrowserWindow({
      ...boundsFor(item), title: item.title, frame: false, transparent: true,
      backgroundColor: '#00000000', hasShadow: false, thickFrame: false, resizable: false,
      maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, show: false,
      webPreferences: {
        preload: path.join(__dirname, 'countdown-preload.cjs'), nodeIntegration: false,
        contextIsolation: true, sandbox: true, spellcheck: false
      }
    });
    const backdrop = createBackdrop(win);
    backdrop.enable(item.theme === 'frost', false);
    const record = { win, url: page.href, moving: false, timer: null, remember: null, backdrop };
    windows.set(item.id, record);

    const remember = () => {
      clearTimeout(record.timer);
      record.timer = null;
      if (!record.moving || win.isDestroyed()) return;
      const saved = find(item.id);
      if (!saved) return;
      const bounds = win.getBounds();
      if (!replace({ ...saved, position: rememberPosition(bounds, screen.getDisplayMatching(bounds)) }).error) {
        record.moving = false;
      }
    };
    record.remember = remember;
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('page-title-updated', event => event.preventDefault());
    win.on('will-move', () => {
      record.moving = true;
      clearTimeout(record.timer);
      record.timer = setTimeout(remember, 250);
    });
    if (process.platform === 'win32') win.hookWindowMessage(0x0232, () => setImmediate(remember));
    win.on('query-session-end', remember);
    win.on('session-end', remember);
    win.on('close', event => {
      remember();
      if (!quitting) {
        event.preventDefault();
        setVisible(item.id, false);
      }
    });
    win.on('closed', () => {
      clearTimeout(record.timer);
      windows.delete(item.id);
    });
    win.once('ready-to-show', () => win.showInactive());
    win.loadURL(page.href).catch(() => { if (!win.isDestroyed()) win.destroy(); });
  }

  function changeVisibility(id, visible) {
    const record = windows.get(id);
    if (visible) show(find(id));
    else record?.win.destroy();
  }

  function setVisible(id, visible) {
    const item = find(id);
    if (!item || typeof visible !== 'boolean') return { error: '找不到这个倒计时' };
    windows.get(id)?.remember();
    const result = replace({ ...find(id), visible });
    if (result.items) {
      changeVisibility(id, visible);
      notify(result.items);
    }
    return result;
  }

  for (const [action, callback] of [
    ['setup', id => find(id)],
    ['edit', id => openManager(id)],
    ['hide', id => setVisible(id, false)]
  ]) {
    ipcMain.handle('countdown:' + action, event => {
      for (const [id, { win, url }] of windows) {
        if (win.webContents === event.sender && url === event.senderFrame?.url) return callback(id);
      }
      throw new Error('Invalid countdown sender');
    });
  }

  function save(input, requestKey) {
    if (!valid(input)) return { error: '请填写有效的名称、日期、时间和颜色', status: 400 };
    if ((input.theme != null && !THEMES.has(input.theme)) || (input.ink != null && !INKS.has(input.ink))) {
      return { error: '倒计时外观无效', status: 400 };
    }
    if (input.layout != null && !LAYOUTS.has(input.layout)) return { error: '倒计时显示形式无效', status: 400 };
    windows.get(input.id)?.remember();
    const current = input.id == null ? null : find(input.id);
    if (input.id != null && !current) return { error: '找不到这个倒计时' };
    const details = {
      title: input.title.trim(), at: input.at, color: input.color.toLowerCase(),
      theme: input.theme ?? current?.theme ?? 'desktop', ink: input.ink ?? current?.ink ?? 'light',
      layout: input.layout ?? current?.layout ?? 'standard'
    };
    const requestId = requestKey ? 'api-' + createHash('sha256').update(requestKey).digest('hex') : null;
    if (requestId) {
      const existing = find(requestId);
      if (existing) {
        if (Object.keys(details).some(key => details[key] !== existing[key])) {
          return { error: '此请求标识已用于另一条倒计时', status: 409 };
        }
        return { entry: existing, repeated: true };
      }
    }
    const entry = {
      ...(current ?? { id: requestId ?? randomUUID(), position: startingPosition(details.layout), visible: true }),
      ...details
    };
    const result = current ? replace(entry) : write([...items, entry]);
    if (result.error) return result;
    if (!current) show(entry);
    const record = windows.get(entry.id);
    if (record) {
      if (current && current.layout !== entry.layout) record.win.setBounds(boundsFor(entry));
      record.win.setTitle(entry.title);
      record.win.webContents.send('countdown:update', entry);
      record.backdrop.enable(entry.theme === 'frost', false);
    }
    notify(result.items);
    return { ...result, entry };
  }

  return {
    get items() { return items; },
    restore() { for (const item of items) if (item.visible) show(item); },
    restorePositions() {
      for (const [id, { win, moving }] of windows) {
        if (!moving) win.setBounds(boundsFor(find(id)));
      }
    },
    shutdown() {
      quitting = true;
      for (const record of windows.values()) record.remember();
    },
    save: input => save(input),
    addFromApi: (input, key) => save({
      title: input.title, at: input.at, color: input.color === undefined ? '#7db4ff' : input.color,
      theme: input.theme, ink: input.ink, layout: input.layout
    }, key),
    remove(id) {
      if (!find(id)) return { error: '找不到这个倒计时' };
      const result = write(items.filter(item => item.id !== id));
      if (result.items) {
        changeVisibility(id, false);
        notify(result.items);
      }
      return result;
    },
    setVisible
  };
}

module.exports = { createCountdowns };
