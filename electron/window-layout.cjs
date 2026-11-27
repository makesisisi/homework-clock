'use strict';

const DEFAULT_SIZE = { width: 384, height: 458 };
const MIN_SIZE = { width: 320, height: 320 };
const MAX_SIZE = { width: 680, height: 900 };
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const GAP = 14;
const SNAP_DISTANCE = 40;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

function fitBounds(bounds, area) {
  const width = clamp(bounds.width, MIN_SIZE.width, Math.min(MAX_SIZE.width, area.width));
  const height = clamp(bounds.height, MIN_SIZE.height, Math.min(MAX_SIZE.height, area.height));
  return fitPosition({ ...bounds, width, height }, area);
}

function fitPosition(bounds, area) {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    width, height,
    x: clamp(bounds.x, area.x, area.x + area.width - width),
    y: clamp(bounds.y, area.y, area.y + area.height - height)
  };
}

function rememberPosition(bounds, display) {
  return {
    x: bounds.x, y: bounds.y, displayId: display.id,
    offsetX: bounds.x - display.workArea.x, offsetY: bounds.y - display.workArea.y
  };
}

function restorePosition(saved, fallback, screen) {
  const hasPosition = Number.isInteger(saved.x) && Number.isInteger(saved.y);
  const bounds = hasPosition ? { ...fallback, x: saved.x, y: saved.y } : fallback;
  const display = screen.getAllDisplays().find(item => item.id === saved.displayId);
  if (display && Number.isInteger(saved.offsetX) && Number.isInteger(saved.offsetY)) {
    bounds.x = display.workArea.x + saved.offsetX;
    bounds.y = display.workArea.y + saved.offsetY;
  }
  return { bounds, display: display ?? screen.getDisplayMatching(bounds) };
}

function placeCorner(bounds, area, corner) {
  const result = fitBounds(bounds, area);
  const roomX = area.width - result.width;
  const roomY = area.height - result.height;
  const padX = Math.min(GAP, Math.floor(roomX / 2));
  const padY = Math.min(GAP, Math.floor(roomY / 2));
  return {
    ...result,
    x: area.x + (corner.endsWith('right') ? roomX - padX : padX),
    y: area.y + (corner.startsWith('bottom') ? roomY - padY : padY)
  };
}

function nearestCorner(bounds, area) {
  const candidates = CORNERS.map(corner => {
    const target = placeCorner(bounds, area, corner);
    const dx = Math.abs(bounds.x - target.x);
    const dy = Math.abs(bounds.y - target.y);
    return { corner, dx, dy };
  }).filter(({ dx, dy }) => dx <= SNAP_DISTANCE && dy <= SNAP_DISTANCE);
  candidates.sort((a, b) => a.dx + a.dy - b.dx - b.dy);
  return candidates[0]?.corner ?? null;
}

function resizeFrom(start, area, corner, dx, dy) {
  const left = corner?.endsWith('right');
  const top = corner?.startsWith('bottom');
  const width = start.width + (left ? -dx : dx);
  const height = start.height + (top ? -dy : dy);
  return corner ? placeCorner({ ...start, width, height }, area, corner)
    : fitBounds({ ...start, width, height }, area);
}

module.exports = { DEFAULT_SIZE, CORNERS, fitBounds, fitPosition, rememberPosition, restorePosition, placeCorner, nearestCorner, resizeFrom };
