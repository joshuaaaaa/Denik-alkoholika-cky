import { isNative, nativeSave, nativeShare } from './native.js';
// Sdílené pomocné funkce: DOM, data, modální okna, sdílení souborů.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = n => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const parseISO = s => new Date(s + 'T12:00');
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); };
export const fmtDate = (s, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => parseISO(s).toLocaleDateString('cs-CZ', opts);
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtDay = s => cap(fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);

export const MOODS = [
  { v: 1, e: '😞', t: 'Mizerně' }, { v: 2, e: '😕', t: 'Nic moc' }, { v: 3, e: '😐', t: 'Ujde to' },
  { v: 4, e: '🙂', t: 'Dobře' }, { v: 5, e: '😄', t: 'Skvěle' }
];
export const moodEmoji = v => MOODS.find(m => m.v === v)?.e || '';
export const EMOTIONS = ['radost', 'klid', 'vděčnost', 'naděje', 'hrdost', 'láska', 'úleva', 'energie',
  'nuda', 'únava', 'smutek', 'úzkost', 'strach', 'vztek', 'stud', 'vina', 'osamělost', 'bažení', 'zmatek', 'stres'];
export const MS_CATS = {
  sober: ['🌱', 'Střízlivost'], health: ['💪', 'Zdraví'], love: ['❤️', 'Vztahy'], family: ['👶', 'Rodina'],
  home: ['🏠', 'Domov'], work: ['💼', 'Práce'], education: ['🎓', 'Vzdělání'], travel: ['✈️', 'Cesty'],
  success: ['🏆', 'Úspěch'], loss: ['🕯️', 'Ztráta'], other: ['⭐', 'Jiné']
};

let toastTimer;
export function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---- Sledování object URL, aby neunikala paměť ----
let viewUrls = [];
export function objUrl(blob) { const u = URL.createObjectURL(blob); viewUrls.push(u); return u; }
export function revokeViewUrls() { viewUrls.forEach(u => URL.revokeObjectURL(u)); viewUrls = []; }

// ---- Modální okna (tlačítko Zpět v Androidu je zavírá) ----
const stack = [];
const waiters = [];
window.addEventListener('popstate', () => {
  const m = stack.pop();
  if (m) { m.el.remove(); m.onClose?.(); }
  waiters.shift()?.();
});

/**
 * Otevře celostránkové okno (nebo spodní panel, když sheet = true).
 * Vrací {el, body, close}.
 */
export function openModal({ title = '', html = '', primary = null, sheet = false, onClose = null, closeLabel = '✕' }) {
  const el = document.createElement('div');
  el.className = 'modal' + (sheet ? ' sheet' : '');
  if (sheet) {
    el.innerHTML = `<div class="sheet-body">${title ? `<div class="row between"><h3 style="margin:0;font:600 24px var(--hand);color:var(--accent)">${esc(title)}</h3><button class="icon-btn" data-close aria-label="Zavřít">✕</button></div>` : ''}<div class="mb">${html}</div></div>`;
    el.addEventListener('click', e => { if (e.target === el) close(); });
  } else {
    el.innerHTML = `<div class="modal-head"><button class="btn ghost" data-close>${closeLabel}</button><h2>${esc(title)}</h2>` +
      (primary ? `<button class="btn" data-primary>${esc(primary)}</button>` : '<span style="width:56px"></span>') +
      `</div><div class="modal-body mb">${html}</div>`;
  }
  $('#modals').appendChild(el);
  const m = { el, onClose };
  stack.push(m);
  history.pushState({ modal: stack.length }, '');
  function close() {
    return new Promise(resolve => {
      if (!stack.includes(m)) return resolve();
      waiters.push(resolve);
      history.back();
    });
  }
  el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    if (m.beforeClose && m.beforeClose() === false) return;
    close();
  }));
  m.close = close;
  m.body = $('.mb', el);
  return m;
}
export const modalsOpen = () => stack.length;

/** Jednoduchý potvrzovací panel místo window.confirm. */
export function ask(text, { ok = 'Ano', cancel = 'Zrušit', danger = false } = {}) {
  return new Promise(resolve => {
    let result = false;
    const m = openModal({
      sheet: true, title: '',
      html: `<p style="font-size:17px">${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn secondary" data-c>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : ''}" data-o>${esc(ok)}</button></div>`,
      onClose: () => resolve(result)
    });
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-o]', m.el).onclick = () => { result = true; m.close(); };
  });
}

/** Výběr souborů – musí se volat přímo z obsluhy kliknutí. */
export function pickFiles({ accept = 'image/*', multiple = false, capture = null } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => { resolve([...input.files]); input.remove(); };
    input.oncancel = () => { resolve([]); input.remove(); };
    input.click();
  });
}

/** Uloží soubor. Vrací popis místa uložení (v Androidu složku Dokumenty). */
export async function saveBlob(blob, filename) {
  if (isNative) return nativeSave(blob, filename);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  return 'Stažené soubory';
}

/** Sdílení souboru přes systémové menu (WhatsApp, e-mail, Disk…), jinak stažení. */
export async function shareOrSave(blob, filename, title = 'Můj deník') {
  if (isNative) return nativeShare(blob, filename, title);
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  await saveBlob(blob, filename);
  return 'saved';
}

/** Kalendářová událost (.ics) – funguje jako připomínka v kalendáři telefonu. */
export function icsEvent({ title, description = '', date, time = '09:00', rrule = '', allDay = false }) {
  const d = date.replace(/-/g, '');
  const t = time.replace(':', '') + '00';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const fold = s => s.replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Muj denik//CS', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@muj-denik`, `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${d}` : `DTSTART:${d}T${t}`,
    allDay ? '' : `DTEND:${d}T${t.slice(0, 2)}${String(Math.min(59, +t.slice(2, 4) + 15)).padStart(2, '0')}00`,
    rrule ? `RRULE:${rrule}` : '', `SUMMARY:${fold(title)}`, description ? `DESCRIPTION:${fold(description)}` : '',
    'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${fold(title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}

// Volání pro překreslení aktuálního pohledu (nastaví app.js)
export const hooks = { refresh: () => {} };
