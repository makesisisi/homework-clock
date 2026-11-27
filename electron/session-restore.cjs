'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { safeStorage } = require('electron');

function cookieKey({ name, domain, path: cookiePath }) {
  return JSON.stringify([name, domain, cookiePath]);
}

function sessionCookieDetails(cookie) {
  if (!cookie?.session || typeof cookie.name !== 'string' || typeof cookie.value !== 'string'
    || typeof cookie.path !== 'string' || !cookie.path.startsWith('/') || typeof cookie.domain !== 'string') return null;
  const host = cookie.domain.replace(/^\./, '');
  if (!/^(?:[a-z0-9-]+\.)*chaoxing\.com$/i.test(host)) return null;
  const { name, value, secure, httpOnly, sameSite } = cookie;
  return {
    url: 'https://' + host + '/', name, value, path: cookie.path, secure, httpOnly, sameSite,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain })
  };
}

function createSessionRestore(cookies, profile) {
  const file = path.join(profile, 'chaoxing-session.bin');
  const temp = file + '.tmp';
  let saved = new Map();
  let queue = Promise.resolve();
  let encryptionAvailable = false;

  function run(operation) {
    const task = queue.then(operation);
    queue = task.catch(() => {});
    return task;
  }

  async function persist(next) {
    if (!next.size) {
      await fs.rm(file, { force: true });
      await fs.rm(temp, { force: true });
    } else {
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify([...next.values()]));
      await fs.writeFile(temp, encrypted);
      await fs.rename(temp, file);
    }
    saved = next;
  }

  cookies.on('changed', (_event, cookie, cause, removed) => {
    // Chromium reports an overwrite as a removal followed by the replacement.
    if (cause === 'overwrite') return;
    void run(async () => {
      const key = cookieKey(cookie);
      if (!saved.has(key)) return;
      const next = new Map(saved);
      if (!removed && sessionCookieDetails(cookie)) next.set(key, cookie);
      else next.delete(key);
      await persist(next);
    }).catch(() => console.warn('未能更新本机学习通会话副本'));
  });

  return {
    async restore() {
      encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable();
      if (!encryptionAvailable) return;
      const encrypted = await fs.readFile(file).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!encrypted) return;
      const { result } = await safeStorage.decryptStringAsync(encrypted);
      const stored = JSON.parse(result);
      if (!Array.isArray(stored)) throw new Error('Invalid session cache');
      const existing = new Set((await cookies.get({})).map(cookieKey));
      const restored = new Map();
      for (const cookie of stored) {
        const details = sessionCookieDetails(cookie);
        if (!details || existing.has(cookieKey(cookie))) continue;
        // Restore as a session cookie. The server still decides whether the session is valid.
        try {
          await cookies.set(details);
          restored.set(cookieKey(cookie), cookie);
        } catch { console.warn('未能恢复一项学习通临时会话数据'); }
      }
      if (restored.size !== stored.length) await persist(restored);
      else saved = restored;
    },
    remember() {
      return run(async () => {
        if (!encryptionAvailable) return;
        const current = await cookies.get({ session: true });
        await persist(new Map(current.filter(sessionCookieDetails).map(cookie => [cookieKey(cookie), cookie])));
      });
    },
    forget() { return run(() => persist(new Map())); }
  };
}

module.exports = { createSessionRestore };
