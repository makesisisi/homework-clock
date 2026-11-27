'use strict';

const { desktopCapturer, screen } = require('electron');
const { release } = require('node:os');

const blurSupported = process.platform === 'win32' && Number(release().split('.')[2]) >= 19041;
const PADDING = 48;
const SETTLE_MS = 160;
const LIVE_FRAME_MS = 100;

function createBackdrop(window) {
  let enabled = false;
  let live = false;
  let excluded = false;
  let capturing = false;
  let timer;
  let generation = 0;
  let lastFrame;

  const visible = () => enabled && !window.isDestroyed() && window.isVisible() && !window.isMinimized();

  function excludeFromCapture(value) {
    if (excluded === value || window.isDestroyed()) return;
    window.setContentProtection(value);
    excluded = value;
  }

  function send(frame) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('clock:backdrop', frame);
    }
  }

  function schedule(request, delay) {
    timer = setTimeout(() => void capture(request), delay);
  }

  async function capture(request) {
    if (request !== generation || !visible()) return;
    if (capturing) {
      schedule(request, LIVE_FRAME_MS);
      return;
    }
    capturing = true;
    const started = performance.now();
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    try {
      const thumbnailSize = live ? 1080 : 1440;
      const sources = await desktopCapturer.getSources({
        types: ['screen'], thumbnailSize: { width: thumbnailSize, height: thumbnailSize }
      });
      if (request !== generation || !visible()) return;
      const thumbnail = sources.find(source => source.display_id === String(display.id))?.thumbnail;
      if (!thumbnail || thumbnail.isEmpty()) throw new Error('Screen capture unavailable');

      const size = thumbnail.getSize();
      const sx = size.width / display.bounds.width;
      const sy = size.height / display.bounds.height;
      const offsetX = bounds.x - display.bounds.x;
      const offsetY = bounds.y - display.bounds.y;
      const x = Math.max(0, Math.floor((offsetX - PADDING) * sx));
      const y = Math.max(0, Math.floor((offsetY - PADDING) * sy));
      const right = Math.min(size.width, Math.ceil((offsetX + bounds.width + PADDING) * sx));
      const bottom = Math.min(size.height, Math.ceil((offsetY + bounds.height + PADDING) * sy));
      if (right <= x || bottom <= y) throw new Error('Backdrop is outside the display');
      const pixels = thumbnail.crop({ x, y, width: right - x, height: bottom - y }).toJPEG(live ? 78 : 85);
      const geometry = {
        left: x / sx - offsetX, top: y / sy - offsetY,
        width: (right - x) / sx, height: (bottom - y) / sy
      };
      if (live && lastFrame && Object.keys(geometry).every(key => lastFrame[key] === geometry[key])
        && lastFrame.pixels.equals(pixels)) return;
      lastFrame = { ...geometry, pixels };
      send({ ...geometry, image: 'data:image/jpeg;base64,' + pixels.toString('base64') });
    } catch {
      if (request === generation) {
        lastFrame = null;
        send(null);
      }
    } finally {
      capturing = false;
      if (request === generation && visible()) {
        if (live) schedule(request, Math.max(0, LIVE_FRAME_MS - (performance.now() - started)));
        else excludeFromCapture(false);
      }
    }
  }

  function refresh() {
    clearTimeout(timer);
    const request = ++generation;
    lastFrame = null;
    if (!visible()) {
      excludeFromCapture(false);
      send(null);
      return;
    }
    excludeFromCapture(true);
    schedule(request, SETTLE_MS);
  }

  for (const event of ['show', 'hide', 'move', 'resize', 'restore', 'minimize']) window.on(event, refresh);
  window.webContents.on('did-finish-load', refresh);
  window.once('closed', () => { clearTimeout(timer); generation++; });

  return {
    refresh,
    enable(value, followWallpaper) {
      const active = blurSupported && value;
      const continuous = active && followWallpaper;
      if (enabled === active && live === continuous) return;
      enabled = active;
      live = continuous;
      refresh();
    }
  };
}

module.exports = { blurSupported, createBackdrop };
