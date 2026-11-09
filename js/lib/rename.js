// The app used to be called AeroStudio. Move settings saved under the old
// "aerostudio" keys to the new "pteronautics" keys, once, so nothing is lost.
// Imported first in app.js so it runs before any module reads its settings.
try {
  const OLD = 'aerostudio', NEW = 'pteronautics';
  const oldKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(OLD)) oldKeys.push(k);
  }
  for (const k of oldKeys) {
    const nk = NEW + k.slice(OLD.length);
    if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
} catch { }
