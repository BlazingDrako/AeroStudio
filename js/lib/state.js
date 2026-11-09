// Remembering, sharing and saving a module's settings.
//
// A module opens a session; each tab registers its settings object with keep(key, obj) before building its
// controls. keep() fills the object in place with what was saved last time (or what a shared link carries),
// then the session saves every registered object to localStorage whenever the user changes something.
// Only the values that differ from the defaults are stored, so a link or a project file stays small and an
// old save still loads after the defaults change. Values are restored only where their type matches the
// default, so a stale or hand-edited save can't break a tab.
//
// The session also makes the toolbar: Copy link (state packed into the URL, deflate-compressed),
// Save / Open a project file (.json) and Reset.
import { h, icon, downloadText } from './ui.js';
import { printReport } from './export.js';

const PREFIX = 'pteronautics:state:';
const TRANSIENT = new Set(['hover', 'playing', 'play', 'drag', 'running', 'visible']);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => JSON.parse(JSON.stringify(v));

function readStore(mod) { try { return JSON.parse(localStorage.getItem(PREFIX + mod)) || {}; } catch { return {}; } }
function writeStore(mod, data) { try { localStorage.setItem(PREFIX + mod, JSON.stringify(data)); } catch { /* storage blocked: not remembered */ } }
export function clearModuleState(mod) { try { localStorage.removeItem(PREFIX + mod); } catch { } }

// copy saved values into target where the shapes agree with the defaults
function merge(target, def, saved) {
  if (!isObj(saved)) return;
  for (const k of Object.keys(def)) {
    if (!(k in saved)) continue;
    const d = def[k], s = saved[k];
    if (d === null) { if (s !== null && typeof s !== 'function') target[k] = clone(s); continue; }
    if (Array.isArray(d)) { if (Array.isArray(s)) target[k] = clone(s); continue; }
    if (isObj(d)) {
      if (!isObj(s)) continue;
      if (!Object.keys(d).length) { target[k] = clone(s); continue; } // free-form dictionary
      if (!isObj(target[k])) target[k] = clone(d);
      merge(target[k], d, s);
      continue;
    }
    if (typeof s === typeof d && (typeof s !== 'number' || isFinite(s))) target[k] = s;
  }
}

// JSON-safe copy of the keys worth saving, keeping only those that differ from the defaults
function diff(obj, def, skip) {
  const out = {};
  for (const k of Object.keys(def)) {
    if (skip.has(k) || TRANSIENT.has(k) || k.startsWith('_')) continue;
    const v = obj[k];
    if (typeof v === 'function' || v === undefined) continue;
    let js; try { js = JSON.stringify(v, (kk, x) => (kk.startsWith('_') ? undefined : x)); } catch { continue; }
    if (js === undefined || js.length > 200000) continue;
    if (js !== JSON.stringify(def[k])) out[k] = JSON.parse(js);
  }
  return out;
}

// ---- compact links: JSON → deflate → base64url ('z' prefix); plain base64url when compression is missing ----
const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = str => { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export async function encodeState(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream === 'function') return 'z' + b64(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'j' + b64(bytes);
}
export async function decodeState(str) {
  const kind = str[0], bytes = unb64(str.slice(1));
  const raw = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

let toastEl = null, toastTimer = 0;
export function toast(msg) {
  if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status' }); document.body.append(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
}

const reroute = () => dispatchEvent(new HashChangeEvent('hashchange'));

/**
 * session(moduleId, { title, tab: () => current tab id })
 *   (an incoming link, ?s=…, is unpacked into storage and the module is reopened with it)
 *   .keep(key, obj, { skip: [...] })   restore obj in place and remember it from now on
 *   .extra(key, { get, set })          custom state (e.g. a drawn model) included in links and files
 *   .toolbar()    the Copy link / Save / Open / Report / Reset buttons
 *   .watch(el)    save after user input inside el
 *   .flush()      save now; .dispose() save and stop
 */
export function session(mod, { title = mod, tab = () => null } = {}) {
  const kept = new Map(), extras = new Map();
  let stored = readStore(mod), timer = 0, frozen = false, off = [];
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const incoming = q.get('s');

  const applyData = data => {
    if (!data || typeof data !== 'object') return;
    // a send-to link (merge) adds its values to what the user already has; a shared link replaces them
    const deep = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = isObj(v) && isObj(o[k]) ? deep(o[k], v) : v; return o; };
    if (isObj(data.states)) for (const [k, v] of Object.entries(data.states)) stored[k] = data.merge && isObj(stored[k]) && isObj(v) ? deep(stored[k], v) : v;
    if (isObj(data.extra)) for (const [k, v] of Object.entries(data.extra)) { stored['~' + k] = v; }
    writeStore(mod, stored);
  };
  // a shared link: unpack it into storage, drop it from the address bar and reopen the module with those settings
  const stripLink = () => { q.delete('s'); const rest = q.toString(); history.replaceState(null, '', `#/${mod}${rest ? '?' + rest : ''}`); };
  const ready = incoming
    ? decodeState(incoming).then(data => { frozen = true; applyData(data); stripLink(); toast(data?.note || 'Opened shared settings'); reroute(); })
      .catch(e => { console.warn('Could not read the shared link', e); stripLink(); toast('That link could not be read; showing your last settings'); })
    : Promise.resolve();

  const snapshot = () => {
    const states = {};
    for (const [k, { obj, def, skip }] of kept) states[k] = diff(obj, def, skip);
    const extra = {};
    for (const [k, x] of extras) { try { const v = x.get(); if (v !== undefined) extra[k] = v; } catch (e) { console.warn(e); } }
    return { states, extra };
  };
  const flush = () => {
    clearTimeout(timer);
    if (frozen) return;
    const { states, extra } = snapshot();
    stored = { ...readStore(mod), ...states };
    for (const [k, v] of Object.entries(extra)) stored['~' + k] = v;
    writeStore(mod, stored);
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, 350); };

  const S = {
    ready,
    // defaults: pass them when obj may already hold edits (a store that outlives the module's page)
    // keys that start out null usually hold computed results, so they are left out unless listed in nulls
    keep(key, obj, { skip = [], nulls = [], defaults = obj } = {}) {
      const def = clone(Object.fromEntries(Object.entries(defaults).filter(([, v]) => typeof v !== 'function')));
      const sk = new Set(skip);
      for (const [k, v] of Object.entries(def)) if (v === null && !nulls.includes(k)) sk.add(k);
      for (const k of sk) delete def[k];
      kept.set(key, { obj, def, skip: sk });
      // start from the defaults so a store that outlives the page doesn't carry stale edits, then apply the save
      if (obj !== defaults) for (const k of Object.keys(def)) obj[k] = clone(def[k]);
      merge(obj, def, stored[key]);
      return obj;
    },
    extra(key, x) {
      extras.set(key, x);
      const v = stored['~' + key];
      if (v !== undefined) { try { x.set(v); } catch (e) { console.warn('Could not restore saved ' + key, e); } }
    },
    flush, schedule,
    watch(el) {
      const on = () => schedule();
      for (const ev of ['input', 'change', 'click', 'pointerup', 'keyup']) { el.addEventListener(ev, on, true); off.push(() => el.removeEventListener(ev, on, true)); }
      const hide = () => flush();
      addEventListener('pagehide', hide); off.push(() => removeEventListener('pagehide', hide));
    },
    dispose() { flush(); for (const f of off) f(); off = []; },
    async link() {
      flush();
      const { states, extra } = snapshot();
      const t = tab();
      const base = location.href.split('#')[0];
      return `${base}#/${mod}?${t ? 'tab=' + encodeURIComponent(t) + '&' : ''}s=${await encodeState({ v: 1, states, extra })}`;
    },
    toolbar() {
      const b = (ic, label, tip, fn) => { const el = h('button', { class: 'as-tool', type: 'button', title: `${label}: ${tip}`, 'aria-label': label }, icon(ic, 16)); el.addEventListener('click', fn); return el; };
      const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
      file.addEventListener('change', async () => {
        const f = file.files[0]; file.value = '';
        if (!f) return;
        try {
          const data = JSON.parse(await f.text());
          if (!data || !['Pteronautics', 'AeroStudio'].includes(data.app) || !data.module) throw new Error('not an Pteronautics project file');
          frozen = true;
          stored = {}; for (const [k, v] of Object.entries(data.states || {})) stored[k] = v;
          for (const [k, v] of Object.entries(data.extra || {})) stored['~' + k] = v;
          writeStore(data.module, stored);
          const target = `#/${data.module}${data.tab ? '?tab=' + data.tab : ''}`;
          toast('Opened ' + f.name);
          if (location.hash === target) reroute(); else location.hash = target;
        } catch (e) { toast('Could not open that file: ' + e.message); }
      });
      return h('div', { class: 'as-toolbar', role: 'toolbar', 'aria-label': 'Save and share' },
        b('link', 'Copy link', 'Copy a link that opens this module with your current settings', async () => {
          const url = await S.link();
          try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); }
        }),
        b('download', 'Save', 'Save these settings as a project file you can open later', () => {
          flush();
          const { extra } = snapshot();
          const states = {}; for (const [k, v] of Object.entries(stored)) if (!k.startsWith('~')) states[k] = v;
          const data = { app: 'Pteronautics', version: 1, module: mod, title, tab: tab(), saved: new Date().toISOString(), states, extra };
          downloadText(`Pteronautics ${title} ${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
        }),
        b('upload', 'Open', 'Open a saved Pteronautics project file', () => file.click()),
        b('print', 'Report', 'Open a printable report of the inputs and results on screen', () => {
          const v = document.getElementById('view');
          printReport({ title, controls: v.querySelector('.af-controls'), results: [...v.querySelectorAll('.cf-body, .af-main, .af-side')].filter(e => e.childElementCount) });
        }),
        b('reset', 'Reset', 'Put every setting in this module back to its default', () => {
          if (!confirm(`Reset every setting in ${title} to its default?`)) return;
          frozen = true; clearModuleState(mod); stored = {};
          for (const [, x] of extras) x.reset && x.reset();
          reroute();
        }),
        file);
    },
  };
  return S;
}
