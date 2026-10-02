// Obrazovky aplikace.
import * as db from './db.js';
import {
  $, $$, esc, toast, openModal, ask, pickFiles, isoDate, nowTime, parseISO, addDays, fmtDate, fmtDay, daysBetween,
  MOODS, moodEmoji, MS_CATS, objUrl, shareOrSave, saveBlob, icsEvent, hooks
} from './core.js';
import { openEditor, openMilestone, openPlan, openCorrection, PLAN_KINDS } from './editor.js';
import { promptOfDay, wordCount, diffHtml } from './text.js';
import { fmtSize, blobToDataURL, dataURLToBlob, QUALITY } from './media.js';
import * as Book from './book.js';

const view = () => $('#view');
const setTitle = t => { $('#view-title').textContent = t; document.title = t + ' · Můj deník'; };
const TYPE_LABEL = { day: 'Zápis dne', hour: 'Hodinový' };
const SOBER_MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365, 500, 730, 1000, 1095, 1825, 3650];

// ---------- Společné kousky ----------
function entryCard(e) {
  const snip = (e.text || '').slice(0, 160);
  const photos = (e.media || []);
  return `<a class="entry-card ${e.special ? 'special' : ''}" href="#entry/${e.id}">
    <div class="meta"><span>${e.date === isoDate() ? '' : fmtDate(e.date, { day: 'numeric', month: 'short' }) + ' · '}${e.time}</span>
      <span>${TYPE_LABEL[e.type] || ''}</span>${e.special ? '<span>⭐ nevšední</span>' : ''}<span>${moodEmoji(e.mood)}</span>
      ${photos.length ? `<span>📎 ${photos.length}</span>` : ''}</div>
    ${e.title ? `<div class="title">${esc(e.title)}</div>` : ''}
    <div class="snip">${esc(snip)}</div>
    ${photos.length ? `<div class="thumbs" data-media="${photos.join(',')}"></div>` : ''}
  </a>`;
}
async function hydrateThumbs(root) {
  for (const box of $$('[data-media]', root)) {
    const ids = box.dataset.media.split(',').slice(0, 5);
    let html = '';
    for (const id of ids) {
      const md = await db.get('media', id);
      if (!md) continue;
      if (md.kind === 'photo') html += `<img src="${objUrl(md.blob)}" alt="">`;
      else if (md.kind === 'video' && md.thumb) html += `<img src="${objUrl(md.thumb)}" alt="" style="outline:3px solid var(--warn)">`;
      else html += `<span style="font-size:30px">${md.kind === 'video' ? '🎥' : '🎤'}</span>`;
    }
    box.innerHTML = html;
  }
}
function soberStats(S) {
  if (!S.sobriety || !S.soberStart) return null;
  const start = new Date(S.soberStart);
  const ms = Date.now() - start.getTime();
  const days = Math.max(0, Math.floor(ms / 86400000));
  const next = SOBER_MILESTONES.find(n => n > days) || days + 365;
  const prev = [...SOBER_MILESTONES].reverse().find(n => n <= days) || 0;
  return { days, hours: Math.floor(ms / 3600000) % 24, money: days * (+S.dailyCost || 0), next, prev, pct: Math.round((days - prev) / (next - prev) * 100) };
}
const dayWord = n => n === 1 ? 'den' : n >= 2 && n <= 4 ? 'dny' : 'dní';

// ---------- DNES ----------
export async function viewToday() {
  const S = await db.settings();
  setTitle(S.bookTitle || 'Můj deník');
  const t = isoDate();
  const [entries, day, all] = await Promise.all([db.byRange('entries', 'date', t, t), db.get('days', t), db.all('entries')]);
  entries.sort((a, b) => b.time.localeCompare(a.time));
  const h = new Date().getHours();
  const greet = h < 5 ? 'Dobrou noc' : h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý den' : 'Dobrý večer';
  const memories = all.filter(e => e.date < t && e.date.slice(5) === t.slice(5));
  const dates = new Set(all.map(e => e.date));
  let streak = 0; for (let d = dates.has(t) ? t : addDays(t, -1); dates.has(d); d = addDays(d, -1)) streak++;
  const ss = soberStats(S);
  const v = view();
  v.innerHTML = `
    <p class="greet">${greet}${S.name ? ', ' + esc(S.name) : ''}</p>
    <p class="date-big">${fmtDay(t)}${streak > 1 ? ` · 🔥 píšete ${streak} ${dayWord(streak)} v řadě` : ''}</p>
    ${ss ? `<div class="card">
      <div class="row between"><h3 style="margin:0">🌱 Bez alkoholu</h3><button class="btn ghost small" data-act="sos">Je to těžké?</button></div>
      <div class="counter"><span class="num">${ss.days}</span><span>${dayWord(ss.days)} a ${ss.hours} h</span></div>
      <div class="muted small">Ušetřeno přibližně <b>${ss.money.toLocaleString('cs-CZ')} ${esc(S.currency)}</b> · další milník: ${ss.next} ${dayWord(ss.next)}</div>
      <div class="progress" style="margin-top:8px"><i style="width:${ss.pct}%"></i></div>
    </div>` : ''}
    <div class="card">
      <h3>Jak se dnes máte?</h3>
      <div class="moods">${MOODS.map(x => `<button class="mood-btn ${day?.mood === x.v ? 'sel' : ''}" data-mood="${x.v}" aria-label="${x.t}">${x.e}</button>`).join('')}</div>
    </div>
    <div class="actions">
      <button class="action" data-act="day"><b>✍️</b>Zápis dne</button>
      <button class="action" data-act="hour"><b>🕐</b>Hodinový</button>
      <button class="action" data-act="dictate"><b>🎙️</b>Diktovat</button>
      <button class="action" data-act="vlog"><b>🎥</b>Vlog</button>
      <button class="action" data-act="photo"><b>📷</b>Fotka</button>
      <button class="action" data-act="gratitude"><b>🙏</b>Vděčnost</button>
      <button class="action" data-act="milestone"><b>⭐</b>Milník</button>
      <button class="action" data-act="plan"><b>🎯</b>Plán</button>
    </div>
    <div class="card paper" style="padding-top:10px">
      <div class="muted small">Inspirace na dnes</div>
      <p class="prompt">${esc(promptOfDay())}</p>
      <button class="btn small" data-act="prompt">Psát na toto téma</button>
    </div>
    <div id="install-slot"></div>
    <h3 style="font:600 26px var(--hand);color:var(--accent);margin:18px 0 8px">Dnešní zápisky</h3>
    <div id="today-list">${entries.length ? entries.map(entryCard).join('') : '<p class="empty">Zatím prázdná stránka… ✎</p>'}</div>
    ${memories.length ? `<h3 style="font:600 26px var(--hand);color:var(--accent);margin:18px 0 8px">📜 Tento den v minulosti</h3>${memories.map(entryCard).join('')}` : ''}
  `;
  hydrateThumbs(v);
  if (window.deferredInstall) {
    $('#install-slot', v).innerHTML = '<button class="btn secondary block" style="margin-bottom:14px">📲 Nainstalovat aplikaci do telefonu</button>';
    $('#install-slot button', v).onclick = async () => { window.deferredInstall.prompt(); window.deferredInstall = null; $('#install-slot', v).innerHTML = ''; };
  }
  $$('[data-mood]', v).forEach(b => b.onclick = async () => {
    const d = (await db.get('days', t)) || { date: t };
    d.mood = +b.dataset.mood;
    await db.put('days', d);
    $$('[data-mood]', v).forEach(x => x.classList.toggle('sel', x === b));
    toast(d.mood <= 2 ? 'Díky za upřímnost. Chcete se vypsat? ✍️' : 'Nálada zapsána');
  });
  $$('[data-act]', v).forEach(b => b.onclick = async () => {
    const a = b.dataset.act;
    if (a === 'day') openEditor({ type: 'day' });
    if (a === 'hour') openEditor({ type: 'hour', time: nowTime() });
    if (a === 'dictate') openEditor({ type: 'day', autoDictate: true });
    if (a === 'vlog') openEditor({ type: 'day', title: 'Vlog', autoVlog: true });
    if (a === 'gratitude') openEditor({ type: 'day', title: 'Vděčnost', gratitude: true });
    if (a === 'prompt') openEditor({ type: 'day', title: promptOfDay() });
    if (a === 'milestone') openMilestone();
    if (a === 'plan') { location.hash = '#milestones/plans'; setTimeout(() => openPlan(), 100); }
    if (a === 'sos') location.hash = '#sos';
    if (a === 'photo') {
      const files = await pickFiles({ accept: 'image/*', multiple: true });
      if (files.length) openEditor({ type: 'day', photos: files });
    }
  });
}

// ---------- DETAIL ZÁPISU ----------
export async function viewEntry(id) {
  const e = await db.get('entries', id);
  setTitle('Zápis');
  const v = view();
  if (!e) { v.innerHTML = '<p class="empty">Zápis nenalezen.</p>'; return; }
  const media = (await Promise.all((e.media || []).map(i => db.get('media', i)))).filter(Boolean);
  const mediaHtml = media.map(md => md.kind === 'photo' ? `<img src="${objUrl(md.blob)}" alt="">`
    : md.kind === 'video' ? `<video controls playsinline preload="metadata" src="${objUrl(md.blob)}" ${md.thumb ? `poster="${objUrl(md.thumb)}"` : ''}></video>`
    : `<audio controls src="${objUrl(md.blob)}"></audio>`).join('');
  const grat = (e.gratitude || []).filter(Boolean);
  v.innerHTML = `
    <div class="row between" style="margin-bottom:10px"><a href="#calendar/${e.date}" class="btn ghost small">← ${fmtDate(e.date, { day: 'numeric', month: 'long' })}</a>
      <span class="muted small">${wordCount(e.text)} slov</span></div>
    <article class="paper entry-view">
      <p class="head">${esc(e.title || fmtDay(e.date))}</p>
      <p class="meta">${fmtDay(e.date)} · ${e.time} · ${TYPE_LABEL[e.type] || ''}${e.special ? ' · ⭐ nevšední den' : ''} ${moodEmoji(e.mood)}</p>
      ${(e.emotions || []).length ? `<p class="meta">Pocity: ${esc(e.emotions.join(', '))}</p>` : ''}
      <div class="body hand">${esc(e.text)}</div>
      ${grat.length ? `<p class="meta" style="margin-top:var(--lh)">Jsem vděčný/á za:</p><div class="hand">${grat.map(g => '♥ ' + esc(g)).join('<br>')}</div>` : ''}
      ${e.sober === true ? `<p class="meta">🌱 Den bez alkoholu${e.craving ? ` · bažení ${e.craving}/10` : ''}</p>` : e.sober === false ? `<p class="meta">Pití: ${e.drinks} sklenic${e.craving ? ` · bažení ${e.craving}/10` : ''}</p>` : ''}
      ${mediaHtml}
      ${(e.tags || []).length ? `<p class="meta">${e.tags.map(t => '#' + esc(t)).join(' ')}</p>` : ''}
    </article>
    <div class="row" style="margin-top:14px">
      <button class="btn" data-a="edit">✏️ Upravit</button>
      <button class="btn secondary" data-a="fix">✨ Opravit text</button>
      <button class="btn secondary" data-a="share">📤 Sdílet</button>
      <button class="btn secondary" data-a="ms">⭐ Udělat milníkem</button>
      ${(e.history || []).length ? '<button class="btn secondary" data-a="hist">🕘 Verze</button>' : ''}
      <button class="btn danger" data-a="del">🗑️</button>
    </div>`;
  const act = {
    edit: () => openEditor({ entry: e }),
    fix: async () => {
      const S = await db.settings();
      const r = await openCorrection(e.text || '', S);
      if (r !== null && r !== e.text) {
        e.history = [{ text: e.text, at: e.updatedAt || e.createdAt }, ...(e.history || [])].slice(0, 20);
        e.text = r; e.updatedAt = Date.now();
        await db.put('entries', e); toast('Text opraven ✓'); hooks.refresh();
      }
    },
    share: async () => {
      const text = `${e.title ? e.title + '\n' : ''}${fmtDay(e.date)} ${e.time}\n\n${e.text}`;
      const files = media.filter(m => m.kind === 'photo').map((m, i) => new File([m.blob], `foto-${i + 1}.${m.blob.type.split('/')[1] || 'jpg'}`, { type: m.blob.type }));
      try {
        if (files.length && navigator.canShare?.({ files })) await navigator.share({ title: e.title || 'Zápis z deníku', text, files });
        else if (navigator.share) await navigator.share({ title: e.title || 'Zápis z deníku', text });
        else { await navigator.clipboard.writeText(text); toast('Text zkopírován do schránky'); }
      } catch { /* zrušeno */ }
    },
    ms: () => openMilestone(null, { date: e.date, title: e.title || '', text: e.text.slice(0, 600) }),
    hist: () => {
      const m = openModal({
        title: 'Předchozí verze',
        html: e.history.map((h, i) => `<div class="card"><div class="row between"><b class="small">${new Date(h.at).toLocaleString('cs-CZ')}</b><button class="btn small secondary" data-r="${i}">Obnovit</button></div><div class="diff small">${diffHtml(h.text, e.text, esc)}</div></div>`).join('')
      });
      $$('[data-r]', m.el).forEach(b => b.onclick = async () => {
        const h = e.history[+b.dataset.r];
        e.history = [{ text: e.text, at: e.updatedAt }, ...e.history.filter(x => x !== h)].slice(0, 20);
        e.text = h.text; e.updatedAt = Date.now();
        await db.put('entries', e); await m.close(); toast('Verze obnovena'); hooks.refresh();
      });
    },
    del: async () => {
      if (!await ask('Opravdu smazat tento zápis včetně fotek a videí?', { ok: 'Smazat', danger: true })) return;
      for (const mid of e.media || []) await db.del('media', mid);
      await db.del('entries', e.id);
      toast('Smazáno'); location.hash = '#calendar/' + e.date;
    }
  };
  $$('[data-a]', v).forEach(b => b.onclick = act[b.dataset.a]);
}

// ---------- KALENDÁŘ ----------
export async function viewCalendar(arg) {
  setTitle('Kalendář');
  const sel = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : isoDate();
  const d0 = parseISO(sel);
  const first = new Date(d0.getFullYear(), d0.getMonth(), 1);
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 41);
  const [entries, days, milestones] = await Promise.all([
    db.byRange('entries', 'date', isoDate(gridStart), isoDate(gridEnd)), db.all('days'), db.all('milestones')]);
  const byDate = {};
  entries.forEach(e => (byDate[e.date] ||= []).push(e));
  const dayMap = Object.fromEntries(days.map(d => [d.date, d]));
  const msDates = new Set(milestones.map(m => m.date));
  const today = isoDate();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart); d.setDate(gridStart.getDate() + i);
    const iso = isoDate(d), list = byDate[iso] || [];
    const mood = dayMap[iso]?.mood;
    cells += `<button class="cal-day ${d.getMonth() !== first.getMonth() ? 'other' : ''} ${iso === today ? 'today' : ''} ${iso === sel ? 'sel' : mood ? 'mood-' + mood : ''}" data-d="${iso}">
      ${list.some(e => e.special) ? '<span class="m">⭐</span>' : msDates.has(iso) ? '<span class="m">🏁</span>' : ''}
      ${d.getDate()}<span class="dots">${list.slice(0, 4).map(() => '<i class="dot"></i>').join('')}</span></button>`;
  }
  const dayEntries = (byDate[sel] || []).sort((a, b) => a.time.localeCompare(b.time));
  const nowH = new Date().getHours();
  const showNight = dayEntries.some(e => +e.time.slice(0, 2) < 6) || sessionStorage.getItem('night') === '1';
  let hours = '';
  for (let h = showNight ? 0 : 6; h < 24; h++) {
    const hh = String(h).padStart(2, '0');
    const at = dayEntries.filter(e => e.time.slice(0, 2) === hh);
    hours += `<div class="hour ${sel === today && h === nowH ? 'now' : ''}"><div class="h">${hh}:00</div><div class="slot">
      ${at.map(entryCard).join('')}<button class="add-h" data-h="${hh}">＋ zapsat</button></div></div>`;
  }
  const v = view();
  const mood = dayMap[sel]?.mood;
  const prevM = isoDate(new Date(first.getFullYear(), first.getMonth() - 1, 1));
  const nextM = isoDate(new Date(first.getFullYear(), first.getMonth() + 1, 1));
  v.innerHTML = `
    <div class="cal-head"><button class="icon-btn" data-go="${prevM}" aria-label="Předchozí měsíc">◀</button>
      <h2>${first.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}</h2>
      <button class="icon-btn" data-go="${nextM}" aria-label="Další měsíc">▶</button></div>
    <div class="cal-grid">${['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(x => `<div class="dow">${x}</div>`).join('')}${cells}</div>
    <div class="row" style="justify-content:center;margin:8px 0"><button class="btn ghost small" data-go="${today}">Dnes</button></div>
    <div class="card" style="margin-top:6px">
      <div class="row between"><h3 style="margin:0">${fmtDay(sel)}</h3><span style="font-size:26px">${moodEmoji(mood)}</span></div>
      <div class="row" style="margin-top:8px">
        <button class="btn small" data-new="day">＋ Zápis dne</button>
        <button class="btn small secondary" data-new="hour">＋ Hodinový</button>
        <button class="btn small secondary" data-new="ms">⭐ Milník</button>
      </div>
      <div class="timeline">${hours}</div>
      ${showNight ? '' : '<button class="btn ghost small block" data-night>Zobrazit i noc (0–6 h)</button>'}
    </div>`;
  hydrateThumbs(v);
  const go = d => { history.replaceState(null, '', '#calendar/' + d); hooks.refresh(); };
  $$('[data-d]', v).forEach(b => b.onclick = () => go(b.dataset.d));
  $$('[data-go]', v).forEach(b => b.onclick = () => go(b.dataset.go));
  $$('[data-h]', v).forEach(b => b.onclick = () => openEditor({ type: 'hour', date: sel, time: b.dataset.h + ':00' }));
  $('[data-night]', v)?.addEventListener('click', () => { sessionStorage.setItem('night', '1'); hooks.refresh(); });
  $('[data-new="day"]', v).onclick = () => openEditor({ type: 'day', date: sel, time: sel === today ? nowTime() : '20:00' });
  $('[data-new="hour"]', v).onclick = () => openEditor({ type: 'hour', date: sel, time: sel === today ? nowTime() : '12:00' });
  $('[data-new="ms"]', v).onclick = () => openMilestone(null, { date: sel });
  // swipe mezi měsíci
  let sx = 0;
  const grid = $('.cal-grid', v);
  grid.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  grid.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60) go(dx < 0 ? nextM : prevM); });
}

// ---------- KNIHA ----------
let reader = null, bookUrls = [];
export function cleanupBook() {
  reader?.destroy(); reader = null;
  bookUrls.forEach(u => URL.revokeObjectURL(u)); bookUrls = [];
}
export async function viewBook() {
  const S = await db.settings();
  setTitle('Kniha');
  const v = view();
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem('book-prefs') || '{}'); } catch { /* ignore */ }
  const p = { range: 'all', from: '', to: '', hourly: true, ms: true, special: false, ...prefs };
  v.innerHTML = `
    <div class="book-wrap">
      <details class="card book-opts">
        <summary><b>⚙️ Co zahrnout do knihy</b></summary>
        <label class="f">Období</label>
        <select class="in" data-o="range">
          <option value="all">Celý deník</option><option value="month">Tento měsíc</option><option value="30">Posledních 30 dní</option>
          <option value="year">Tento rok</option><option value="custom">Vlastní období…</option></select>
        <div class="row ${p.range === 'custom' ? '' : 'hidden'}" data-custom style="margin-top:8px">
          <input type="date" class="in grow" data-o="from" value="${p.from}"><input type="date" class="in grow" data-o="to" value="${p.to}"></div>
        <label class="switch"><span>Hodinové zápisky</span><input type="checkbox" data-o="hourly" ${p.hourly ? 'checked' : ''}></label>
        <label class="switch"><span>Jen nevšední dny ⭐</span><input type="checkbox" data-o="special" ${p.special ? 'checked' : ''}></label>
        <label class="switch"><span>Kapitola „Milníky mého života“</span><input type="checkbox" data-o="ms" ${p.ms ? 'checked' : ''}></label>
        <button class="btn block" data-build>Sestavit knihu</button>
      </details>
      <div class="book-stage" id="stage"><p class="empty" style="width:280px">Skládám stránky…</p></div>
      <div class="book-ctl">
        <button class="icon-btn" data-prev aria-label="Předchozí stránka">◀</button>
        <input type="range" min="0" max="0" value="0" data-slider aria-label="Stránka">
        <button class="icon-btn" data-next aria-label="Další stránka">▶</button>
      </div>
      <div class="muted small" data-pn></div>
      <div class="row" style="justify-content:center">
        <button class="btn" data-pdf="save">📄 Uložit PDF</button>
        <button class="btn secondary" data-pdf="share">📤 Sdílet PDF</button>
        <button class="btn secondary" data-print>🖨️ Tisk</button>
      </div>
      <p class="muted small center">Listujte přejetím prstem nebo klepnutím na okraj stránky.</p>
    </div>`;
  $('[data-o="range"]', v).value = p.range;
  $('[data-o="range"]', v).onchange = e => $('[data-custom]', v).classList.toggle('hidden', e.target.value !== 'custom');
  const stage = $('#stage', v), slider = $('[data-slider]', v), pn = $('[data-pn]', v);
  let book = null;

  function range() {
    const t = isoDate(), d = new Date();
    switch (p.range) {
      case 'month': return [t.slice(0, 8) + '01', t, d.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })];
      case '30': return [addDays(t, -29), t, 'posledních 30 dní'];
      case 'year': return [t.slice(0, 4) + '-01-01', t, 'rok ' + t.slice(0, 4)];
      case 'custom': return [p.from, p.to, `${p.from ? fmtDate(p.from) : '…'} – ${p.to ? fmtDate(p.to) : '…'}`];
      default: return ['', '', ''];
    }
  }
  async function build() {
    cleanupBook();
    stage.innerHTML = '<p class="empty" style="width:280px">Skládám stránky…</p>';
    const [from, to, label] = range();
    const { blocks, urls, count } = await Book.buildBlocks({ from, to, includeHourly: p.hourly, includeMilestones: p.ms, onlySpecial: p.special });
    bookUrls = urls;
    const pages = await Book.paginate(blocks, document.body);
    let sub = label;
    if (!sub) {
      const all = (await db.all('entries')).map(e => e.date).sort();
      sub = all.length ? `${fmtDate(all[0])} – ${fmtDate(all[all.length - 1])}` : '';
    }
    book = { pages, cover: Book.coverHtml(S.bookTitle || 'Můj deník', sub, S.name), title: S.bookTitle || 'Můj deník' };
    if (!count && !pages.length) {
      stage.innerHTML = '<p class="empty" style="width:280px">V tomto období zatím nejsou žádné zápisky.<br>Kniha se plní s každým dnem. ✎</p>';
    }
    reader = new Book.Reader(stage, book, (i, total) => {
      slider.max = total - 1; slider.value = i;
      pn.textContent = i === 0 ? `Obálka · ${total - 1} stran` : `Strana ${i} z ${total - 1}`;
    });
  }
  slider.oninput = () => reader?.go(+slider.value);
  $('[data-prev]', v).onclick = () => reader?.prev();
  $('[data-next]', v).onclick = () => reader?.next();
  $('[data-build]', v).onclick = () => {
    p.range = $('[data-o="range"]', v).value; p.from = $('[data-o="from"]', v).value; p.to = $('[data-o="to"]', v).value;
    p.hourly = $('[data-o="hourly"]', v).checked; p.ms = $('[data-o="ms"]', v).checked; p.special = $('[data-o="special"]', v).checked;
    try { localStorage.setItem('book-prefs', JSON.stringify(p)); } catch { /* ignore */ }
    $('.book-opts', v).open = false;
    build();
  };
  $$('[data-pdf]', v).forEach(b => b.onclick = async () => {
    if (!book) return;
    const ov = document.createElement('div');
    ov.className = 'overlay-progress'; ov.textContent = 'Připravuji PDF…';
    document.body.appendChild(ov);
    try {
      const blob = await Book.makePdf(book, (i, n) => { ov.textContent = `Vytvářím PDF… ${i} / ${n}`; });
      const name = `${(book.title || 'denik').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${isoDate()}.pdf`;
      ov.remove();
      if (b.dataset.pdf === 'share') {
        const r = await shareOrSave(blob, name, book.title);
        if (r === 'saved') toast('Sdílení není dostupné – PDF bylo staženo');
      } else { saveBlob(blob, name); toast(`PDF uloženo (${fmtSize(blob.size)})`); }
    } catch (err) {
      ov.remove();
      if (await ask('PDF se nepodařilo vytvořit (jste offline?). Použít tisk → „Uložit jako PDF“?', { ok: 'Tisk' })) Book.printBook(book);
    }
  });
  $('[data-print]', v).onclick = () => book && Book.printBook(book);
  build();
}

// ---------- MILNÍKY A PLÁNY ----------
export async function viewMilestones(arg) {
  setTitle('Milníky a plány');
  const tab = arg === 'plans' ? 'plans' : 'ms';
  const v = view();
  v.innerHTML = `<div class="tabs"><button data-tab="ms" class="${tab === 'ms' ? 'sel' : ''}">⭐ Milníky života</button><button data-tab="plans" class="${tab === 'plans' ? 'sel' : ''}">🎯 Plány a sny</button></div><div data-c></div>`;
  $$('[data-tab]', v).forEach(b => b.onclick = () => { history.replaceState(null, '', '#milestones' + (b.dataset.tab === 'plans' ? '/plans' : '')); hooks.refresh(); });
  const c = $('[data-c]', v);
  if (tab === 'ms') {
    const list = (await db.all('milestones')).sort((a, b) => b.date.localeCompare(a.date));
    let html = '<button class="btn block" data-add style="margin-bottom:10px">＋ Přidat milník</button>';
    if (!list.length) html += '<p class="empty">Sem patří chvíle, na které nechcete zapomenout – první krok dítěte, nová práce, 100 dní střízlivosti…</p>';
    let year = '';
    for (const x of list) {
      const y = x.date.slice(0, 4);
      if (y !== year) { if (year) html += '</div>'; html += `<div class="ms-year">${y}</div><div class="ms-list">`; year = y; }
      const [ico, cat] = MS_CATS[x.category] || MS_CATS.other;
      html += `<div class="ms card" data-id="${x.id}"><span class="ico">${ico}</span>
        <div class="muted small">${fmtDate(x.date)} · ${cat} · ${relTime(x.date)}</div>
        <div style="font:600 24px/1.15 var(--hand)">${esc(x.title)}</div>
        ${x.text ? `<div class="small" style="white-space:pre-wrap">${esc(x.text)}</div>` : ''}
        ${x.mediaId ? `<div data-ph="${x.mediaId}"></div>` : ''}</div>`;
    }
    if (year) html += '</div>';
    c.innerHTML = html;
    for (const ph of $$('[data-ph]', c)) { const md = await db.get('media', ph.dataset.ph); if (md) ph.innerHTML = `<img src="${objUrl(md.blob)}" alt="">`; }
    $('[data-add]', c).onclick = () => openMilestone();
    $$('.ms', c).forEach(el => el.onclick = () => openMilestone(list.find(x => x.id === el.dataset.id)));
  } else {
    const list = (await db.all('plans')).sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
    c.innerHTML = `<button class="btn block" data-add style="margin-bottom:10px">＋ Nový cíl, plán nebo sen</button>
      ${list.length ? '' : '<p class="empty">Co chcete v životě zažít? Zapište si cíle, plány i sny a rozložte je na malé kroky.</p>'}
      ${list.map(p => {
        const done = p.steps.filter(s => s.done).length, pct = p.steps.length ? Math.round(done / p.steps.length * 100) : (p.done ? 100 : 0);
        return `<div class="card plan ${p.done ? 'done' : ''}" data-id="${p.id}">
          <div class="row between"><span class="small muted">${PLAN_KINDS[p.kind] || ''}${p.due ? ' · do ' + fmtDate(p.due) : ''}</span>
            <button class="btn ghost small" data-edit>Upravit</button></div>
          <div style="font:600 24px/1.15 var(--hand)">${p.done ? '✅ ' : ''}${esc(p.title)}</div>
          ${p.why ? `<div class="small muted" style="font-style:italic">„${esc(p.why)}“</div>` : ''}
          <div class="steps">${p.steps.map((s, i) => `<label><input type="checkbox" data-step="${i}" ${s.done ? 'checked' : ''}> ${esc(s.t)}</label>`).join('')}</div>
          <div class="progress" style="margin:8px 0"><i style="width:${pct}%"></i></div>
          <div class="row">${p.done ? '' : '<button class="btn small" data-done>✓ Splněno</button>'}
            ${p.due ? '<button class="btn small secondary" data-ics>📅 Do kalendáře</button>' : ''}</div>
        </div>`;
      }).join('')}`;
    $('[data-add]', c).onclick = () => openPlan();
    $$('.plan', c).forEach(el => {
      const p = list.find(x => x.id === el.dataset.id);
      $('[data-edit]', el).onclick = () => openPlan(p);
      $$('[data-step]', el).forEach(cb => cb.onchange = async () => {
        p.steps[+cb.dataset.step].done = cb.checked;
        await db.put('plans', p);
        if (p.steps.length && p.steps.every(s => s.done) && !p.done) complete(p); else hooks.refresh();
      });
      $('[data-done]', el)?.addEventListener('click', () => complete(p));
      $('[data-ics]', el)?.addEventListener('click', () => shareOrSave(icsEvent({ title: p.title, description: p.why, date: p.due, allDay: true }), 'plan.ics'));
    });
  }
  async function complete(p) {
    p.done = true; p.doneAt = isoDate();
    await db.put('plans', p);
    if (await ask(`Gratuluji! 🎉 „${p.title}“ je splněno. Zapsat jako milník života?`, { ok: 'Ano, zapsat', cancel: 'Teď ne' })) {
      openMilestone(null, { title: p.title, text: p.why, category: 'success' });
    } else hooks.refresh();
  }
}
function relTime(d) {
  const n = daysBetween(d, isoDate());
  if (n < 0) return `za ${-n} ${dayWord(-n)}`;
  if (n === 0) return 'dnes';
  if (n < 31) return n === 1 ? 'včera' : `před ${n} dny`;
  if (n < 365) { const m = Math.round(n / 30.4); return m === 1 ? 'před měsícem' : `před ${m} měsíci`; }
  const y = Math.floor(n / 365.25);
  return y === 1 ? 'před rokem' : `před ${y} lety`;
}

// ---------- VÍCE ----------
export function viewMore() {
  setTitle('Více');
  view().innerHTML = `<div class="card menu">
    <a href="#stats"><span>📊</span><div>Statistiky a odznaky<small>Nálady, série psaní, střízlivost</small></div></a>
    <a href="#search"><span>🔍</span><div>Hledat v deníku<small>Text, štítky, pocity</small></div></a>
    <a href="#sos"><span>🆘</span><div>Pomoc v těžké chvíli<small>Dýchání, vlna bažení, kontakty</small></div></a>
    <a href="#milestones/plans"><span>🎯</span><div>Plány a sny</div></a>
    <a href="#settings"><span>⚙️</span><div>Nastavení<small>Profil, vzhled, PIN, střízlivost, připomínka</small></div></a>
    <a href="#backup"><span>💾</span><div>Záloha a export<small>Uložit / obnovit celý deník, export textu</small></div></a>
    <a href="#about"><span>ℹ️</span><div>O aplikaci a nápověda<small>Instalace, hlasové příkazy, soukromí</small></div></a>
  </div>`;
}

// ---------- STATISTIKY ----------
export async function viewStats() {
  setTitle('Statistiky');
  const S = await db.settings();
  const [entries, days, media, ms, plans] = await Promise.all([db.all('entries'), db.all('days'), db.all('media'), db.all('milestones'), db.all('plans')]);
  const words = entries.reduce((s, e) => s + wordCount(e.text), 0);
  const dates = [...new Set(entries.map(e => e.date))].sort();
  let best = 0, run = 0, prev = null;
  for (const d of dates) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  const t = isoDate(), set = new Set(dates);
  let cur = 0; for (let d = set.has(t) ? t : addDays(t, -1); set.has(d); d = addDays(d, -1)) cur++;
  // nálada za 30 dní
  const dayMap = Object.fromEntries(days.map(d => [d.date, d.mood]));
  const pts = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(t, -i);
    const em = entries.filter(e => e.date === d && e.mood).map(e => e.mood);
    const m = dayMap[d] || (em.length ? em.reduce((a, b) => a + b) / em.length : null);
    pts.push(m);
  }
  const W = 300, H = 120, step = W / 29;
  const coords = pts.map((m, i) => m ? [i * step, H - (m - 1) / 4 * (H - 20) - 10] : null);
  const path = coords.filter(Boolean).map((c, i) => (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1)).join(' ');
  const emo = {};
  entries.forEach(e => (e.emotions || []).forEach(x => { emo[x] = (emo[x] || 0) + 1; }));
  const topEmo = Object.entries(emo).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const ss = soberStats(S);
  const soberDays = entries.filter(e => e.sober === true).map(e => e.date);
  const cravings = entries.filter(e => e.craving).map(e => e.craving);
  const longest = Math.max(S.longestStreak || 0, ss?.days || 0);
  const badges = [
    ['✍️', 'První zápis', entries.length >= 1], ['📚', '10 zápisů', entries.length >= 10], ['🏛️', '100 zápisů', entries.length >= 100],
    ['🔥', '7 dní v řadě', best >= 7], ['🌟', '30 dní v řadě', best >= 30], ['📷', '10 fotek', media.filter(m => m.kind === 'photo').length >= 10],
    ['🎥', 'První vlog', media.some(m => m.kind === 'video')], ['⭐', 'První milník', ms.length >= 1], ['🎯', 'Splněný cíl', plans.some(p => p.done)],
    ['🖋️', '10 000 slov', words >= 10000]
  ];
  const soberBadges = S.sobriety ? [1, 7, 30, 90, 180, 365, 730].map(n => [n >= 365 ? '🏆' : n >= 90 ? '🌳' : n >= 30 ? '🌿' : '🌱', `${n} ${dayWord(n)}`, longest >= n]) : [];
  const v = view();
  v.innerHTML = `
    <div class="card"><h3>Můj deník v číslech</h3><div class="stat-grid">
      <div class="stat"><b>${entries.length}</b>zápisů</div><div class="stat"><b>${words.toLocaleString('cs-CZ')}</b>slov</div>
      <div class="stat"><b>${dates.length}</b>popsaných dní</div><div class="stat"><b>${cur}</b>dní v řadě (rekord ${best})</div>
      <div class="stat"><b>${media.filter(m => m.kind === 'photo').length}</b>fotek</div><div class="stat"><b>${media.filter(m => m.kind === 'video').length}</b>vlogů</div>
      <div class="stat"><b>${entries.filter(e => e.special).length}</b>nevšedních dní</div><div class="stat"><b>${ms.length}</b>milníků</div>
    </div></div>
    <div class="card"><h3>Nálada – posledních 30 dní</h3>
      ${path ? `<svg class="chart" viewBox="-6 0 ${W + 12} ${H}" preserveAspectRatio="none" role="img" aria-label="Graf nálady">
        ${[1, 2, 3, 4, 5].map(m => `<line x1="0" x2="${W}" y1="${H - (m - 1) / 4 * (H - 20) - 10}" y2="${H - (m - 1) / 4 * (H - 20) - 10}" stroke="var(--line)" stroke-width="1"/>`).join('')}
        <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        ${coords.filter(Boolean).map(c => `<circle cx="${c[0]}" cy="${c[1]}" r="3" fill="var(--accent-2)"/>`).join('')}
      </svg><div class="row between small muted"><span>před 30 dny</span><span>😞 → 😄</span><span>dnes</span></div>` : '<p class="muted">Zaznamenávejte náladu a uvidíte tu svůj průběh.</p>'}
    </div>
    ${topEmo.length ? `<div class="card"><h3>Nejčastější pocity</h3>${topEmo.map(([k, n]) => `<div class="row" style="margin:4px 0"><span style="width:90px">${k}</span><div class="progress grow"><i style="width:${n / topEmo[0][1] * 100}%;background:var(--accent-2)"></i></div><span class="small">${n}×</span></div>`).join('')}</div>` : ''}
    ${S.sobriety ? `<div class="card"><h3>🌱 Střízlivost</h3><div class="stat-grid">
      <div class="stat"><b>${ss?.days ?? '–'}</b>aktuální série</div><div class="stat"><b>${longest}</b>nejdelší série</div>
      <div class="stat"><b>${soberDays.length}</b>zapsaných dní bez alkoholu</div>
      <div class="stat"><b>${cravings.length ? (cravings.reduce((a, b) => a + b) / cravings.length).toFixed(1) : '–'}</b>prům. bažení</div>
      <div class="stat"><b>${(ss?.money || 0).toLocaleString('cs-CZ')}</b>${esc(S.currency)} ušetřeno</div></div></div>` : ''}
    <div class="card"><h3>Odznaky</h3><div class="badges">${[...badges, ...soberBadges].map(([i, t, ok]) => `<div class="badge ${ok ? '' : 'locked'}"><span>${i}</span>${t}</div>`).join('')}</div></div>
    <div class="card small muted" data-storage>Zjišťuji využití úložiště…</div>`;
  const total = media.reduce((s, m) => s + (m.size || 0) + (m.thumb?.size || 0), 0);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  $('[data-storage]', v).innerHTML = `Média v deníku: <b>${fmtSize(total)}</b>${est?.quota ? ` · dostupné místo pro aplikaci: ${fmtSize(est.quota)}` : ''}`;
}

// ---------- SOS ----------
let sosTimers = [];
export function cleanupSOS() { sosTimers.forEach(clearInterval); sosTimers = []; }
export async function viewSOS() {
  setTitle('Pomoc');
  const S = await db.settings();
  const contacts = (S.contacts || '').split('\n').map(l => l.split(/[:;–-](?=[^:;–-]*$)/)).filter(p => p.length === 2 && p[1].trim());
  const v = view();
  v.innerHTML = `
    <div class="card"><h2>Teď je to těžké. To je v pořádku.</h2>
      <p>Bažení i silné emoce přicházejí ve vlnách – obvykle odezní do 15–30 minut. Nemusíte nic řešit hned. Zkuste jednu z věcí níže.</p></div>
    <div class="card center"><h3>🫁 Dýchání do čtverce</h3>
      <div class="breath" data-breath>Start</div>
      <p class="muted small">4 s nádech · 4 s zadržet · 4 s výdech · 4 s pauza</p>
      <button class="btn" data-breathe>Začít dýchat</button></div>
    <div class="card"><h3>🌊 Surfování na vlně bažení</h3>
      <p class="small">Nastavte si 15 minut. Sledujte, jak chuť sílí, vrcholí a slábne – nemusíte podle ní jednat.</p>
      <div class="rec-time" data-urge>15:00</div>
      <div class="row" style="justify-content:center"><button class="btn" data-urgebtn>Spustit 15 minut</button></div></div>
    <div class="card"><h3>✋ Zastav se: HALT</h3>
      <p class="small muted">Nejsem…</p>
      <div class="chips">
        <button class="chip" data-halt="Najezte se – i malá svačina pomůže.">🍞 hladový/á?</button>
        <button class="chip" data-halt="Vypište vztek do deníku nebo se projděte.">😠 naštvaný/á?</button>
        <button class="chip" data-halt="Zavolejte nebo napište někomu blízkému.">🫂 osamělý/á?</button>
        <button class="chip" data-halt="Lehněte si, dejte si sprchu, jděte spát dřív.">😴 unavený/á?</button>
      </div><p data-haltmsg class="hand" style="margin:8px 0 0"></p></div>
    ${S.reasons ? `<div class="card paper"><h3>Proč to dělám</h3><div class="hand" style="white-space:pre-wrap">${esc(S.reasons)}</div></div>` : ''}
    ${S.letter ? `<div class="card paper"><h3>Dopis sám/sama sobě</h3><div class="hand" style="white-space:pre-wrap">${esc(S.letter)}</div></div>` : ''}
    <div class="card"><h3>📞 Zavolat</h3>
      ${contacts.map(([n, t]) => `<div class="sos-call"><span>${esc(n.trim())}</span><a class="btn small" href="tel:${esc(t.replace(/[^\d+]/g, ''))}">📞 ${esc(t.trim())}</a></div>`).join('')}
      <div class="sos-call"><span>Linka první psychické pomoci<br><small class="muted">nonstop, zdarma, anonymně</small></span><a class="btn small" href="tel:116123">📞 116 123</a></div>
      <div class="sos-call"><span>Národní linka pro odvykání<br><small class="muted">alkohol, hazard, drogy · Po–Pá 10–18</small></span><a class="btn small" href="tel:800350000">📞 800 350 000</a></div>
      <div class="sos-call"><span>Záchranná služba</span><a class="btn small danger" href="tel:155">📞 155</a></div>
      <div class="sos-call"><span>Tísňová linka</span><a class="btn small danger" href="tel:112">📞 112</a></div>
      ${contacts.length ? '' : '<p class="small muted">Vlastní kontakty (sponzor, kamarád, terapeut) přidáte v <a href="#settings">Nastavení</a>.</p>'}
    </div>
    <button class="btn block" data-write>✍️ Vypsat se – co se teď děje?</button>`;
  $('[data-write]', v).onclick = () => openEditor({ type: 'hour', title: 'Těžká chvíle', tags: ['sos'] });
  $$('[data-halt]', v).forEach(b => b.onclick = () => { $('[data-haltmsg]', v).textContent = b.dataset.halt; });
  const circle = $('[data-breath]', v);
  $('[data-breathe]', v).onclick = e => {
    cleanupSOS();
    e.target.textContent = 'Znovu od začátku';
    const phases = [['Nádech', 1], ['Zadržet', 1], ['Výdech', .6], ['Pauza', .6]];
    let i = 0, n = 0;
    const tick = () => { const [t, s] = phases[i % 4]; circle.textContent = t; circle.style.transform = `scale(${s})`; i++; if (++n > 40) cleanupSOS(); };
    tick(); sosTimers.push(setInterval(tick, 4000));
  };
  $('[data-urgebtn]', v).onclick = () => {
    cleanupSOS();
    let s = 15 * 60;
    const el = $('[data-urge]', v);
    sosTimers.push(setInterval(() => {
      s--; el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (s <= 0) { cleanupSOS(); el.textContent = 'Zvládli jste to 💚'; navigator.vibrate?.(300); }
    }, 1000));
  };
}

// ---------- NASTAVENÍ ----------
export async function hashPin(pin) {
  const data = new TextEncoder().encode('muj-denik:' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function applyLook(S) {
  const r = document.documentElement;
  if (S.theme === 'auto') delete r.dataset.theme; else r.dataset.theme = S.theme;
  if (S.font === 'serif') r.dataset.font = 'serif'; else delete r.dataset.font;
}
export async function viewSettings() {
  setTitle('Nastavení');
  const S = await db.settings();
  const v = view();
  const seg = (k, opts) => `<div class="seg" data-segk="${k}">${opts.map(([val, t]) => `<button data-v="${val}" class="${S[k] === val ? 'sel' : ''}">${t}</button>`).join('')}</div>`;
  v.innerHTML = `
    <div class="card"><h3>👤 Profil</h3>
      <label class="f">Jméno nebo přezdívka</label><input class="in" data-k="name" value="${esc(S.name)}">
      <label class="f">Název deníku (obálka knihy)</label><input class="in" data-k="bookTitle" value="${esc(S.bookTitle)}"></div>
    <div class="card"><h3>🎨 Vzhled</h3>
      <label class="f">Motiv</label>${seg('theme', [['auto', 'Automaticky'], ['light', '☀️ Den'], ['dark', '🌙 Noc']])}
      <label class="f">Písmo zápisků</label>${seg('font', [['hand', '✍️ Ručně psané'], ['serif', '📖 Knižní']])}</div>
    <div class="card"><h3>📷 Fotky</h3>
      <label class="f">Velikost ukládaných fotek</label>
      <select class="in" data-k="photoQuality">${Object.entries(QUALITY).map(([k, q]) => `<option value="${k}" ${S.photoQuality === k ? 'selected' : ''}>${q.label}</option>`).join('')}</select>
      <p class="small muted">Fotky se před uložením zmenší a převedou do formátu WebP – typicky 20× menší než originál.</p></div>
    <div class="card"><h3>🎙️ Diktování a korektura</h3>
      <label class="switch"><span>Ukládat i zvukovou nahrávku diktátu</span><input type="checkbox" data-k="saveDictationAudio" ${S.saveDictationAudio ? 'checked' : ''}></label>
      <label class="f">Vlastní slovník oprav (špatně=správně, každý na řádek)</label>
      <textarea class="in" data-k="corrections" rows="5">${esc(S.corrections)}</textarea></div>
    <div class="card"><h3>🌱 Sledování střízlivosti</h3>
      <label class="switch"><span>Zapnout počítadlo dní bez alkoholu</span><input type="checkbox" data-k="sobriety" ${S.sobriety ? 'checked' : ''}></label>
      <div class="${S.sobriety ? '' : 'hidden'}" data-sob>
        <label class="f">Bez alkoholu od</label><input type="datetime-local" class="in" data-k="soberStart" value="${esc(S.soberStart)}">
        <label class="f">Kolik jsem denně utrácel/a za alkohol</label>
        <div class="row"><input type="number" class="in grow" data-k="dailyCost" value="${S.dailyCost}"><input class="in" style="width:80px" data-k="currency" value="${esc(S.currency)}"></div>
        <button class="btn secondary block" style="margin-top:10px" data-reset>↺ Nový začátek (po zakolísání)</button>
        <p class="small muted">Zakolísání neznamená selhání. Nejdelší série zůstane uložená.</p>
      </div>
      <label class="f">Moje důvody (zobrazí se v SOS)</label><textarea class="in" data-k="reasons" rows="3" placeholder="Chci být u toho, až dcera poroste…">${esc(S.reasons)}</textarea></div>
    <div class="card"><h3>🆘 Krizové kontakty</h3>
      <label class="f">Jméno: telefon (každý na řádek)</label><textarea class="in" data-k="contacts" rows="3" placeholder="Petr (sponzor): 777 123 456">${esc(S.contacts)}</textarea>
      <label class="f">Dopis sám/sama sobě do těžkých chvil</label><textarea class="in" data-k="letter" rows="4">${esc(S.letter)}</textarea></div>
    <div class="card"><h3>⏰ Denní připomínka</h3>
      <p class="small muted">Přidá do kalendáře v telefonu opakovanou událost s upozorněním – funguje spolehlivě i bez internetu.</p>
      <div class="row"><input type="time" class="in" style="width:120px" data-k="reminderTime" value="${S.reminderTime}"><button class="btn" data-ics>📅 Přidat do kalendáře</button></div></div>
    <div class="card"><h3>🔒 Soukromí</h3>
      <p class="small muted">${S.pinHash ? 'Deník je chráněn PINem.' : 'Deník není zamčený.'} Data se nikam neodesílají – zůstávají jen v tomto zařízení.</p>
      <div class="row"><button class="btn" data-pin>${S.pinHash ? 'Změnit PIN' : 'Nastavit PIN'}</button>${S.pinHash ? '<button class="btn secondary" data-unpin>Zrušit PIN</button>' : ''}</div>
      <button class="btn secondary block" style="margin-top:10px" data-persist>Chránit data před automatickým smazáním</button></div>`;
  $$('[data-k]', v).forEach(inp => inp.addEventListener('change', async () => {
    const k = inp.dataset.k;
    let val = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value;
    await db.setSetting(k, val);
    if (k === 'sobriety') {
      $('[data-sob]', v).classList.toggle('hidden', !val);
      if (val && !S.soberStart) { const now = new Date(); now.setSeconds(0, 0); const s = isoDate(now) + 'T' + nowTime(now); await db.setSetting('soberStart', s); $('[data-k="soberStart"]', v).value = s; }
    }
    toast('Uloženo');
  }));
  $$('[data-segk]', v).forEach(sg => $$('button', sg).forEach(b => b.onclick = async () => {
    await db.setSetting(sg.dataset.segk, b.dataset.v);
    $$('button', sg).forEach(x => x.classList.toggle('sel', x === b));
    applyLook(await db.settings());
  }));
  $('[data-reset]', v).onclick = async () => {
    const st = soberStats(S);
    if (!await ask('Začít počítat znovu od teď? Každý den bez alkoholu se počítá – i ty předchozí.', { ok: 'Začít znovu' })) return;
    if (st) await db.setSetting('longestStreak', Math.max(S.longestStreak || 0, st.days));
    const now = new Date();
    await db.setSetting('soberStart', isoDate(now) + 'T' + nowTime(now));
    toast('Nový začátek. Jste tu a to se počítá. 💚', 3500); hooks.refresh();
  };
  $('[data-ics]', v).onclick = () => shareOrSave(icsEvent({
    title: 'Čas na deník ✍️', description: 'Pár řádků o dnešním dni – jak se cítím, co se stalo.',
    date: isoDate(), time: $('[data-k="reminderTime"]', v).value || '21:00', rrule: 'FREQ=DAILY'
  }), 'pripominka-denik.ics');
  $('[data-pin]', v).onclick = async () => {
    const p1 = await askPin('Zadejte nový PIN (4–8 číslic)');
    if (!p1) return;
    const p2 = await askPin('Zadejte PIN znovu');
    if (p1 !== p2) return toast('PINy se neshodují');
    await db.setSetting('pinHash', await hashPin(p1));
    toast('PIN nastaven 🔒'); hooks.refresh();
  };
  $('[data-unpin]', v)?.addEventListener('click', async () => { await db.setSetting('pinHash', ''); toast('PIN zrušen'); hooks.refresh(); });
  $('[data-persist]', v).onclick = async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Data jsou chráněna ✓' : 'Prohlížeč ochranu nepovolil – pravidelně zálohujte.', 3500);
  };
}
function askPin(label) {
  return new Promise(resolve => {
    let val = null;
    const m = openModal({ sheet: true, title: label, html: `<input class="in" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" data-p autocomplete="off"><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-ok>OK</button></div>`, onClose: () => resolve(val) });
    const inp = $('[data-p]', m.el);
    setTimeout(() => inp.focus(), 100);
    $('[data-ok]', m.el).onclick = () => {
      if (!/^\d{4,8}$/.test(inp.value)) return toast('PIN musí mít 4–8 číslic');
      val = inp.value; m.close();
    };
  });
}

// ---------- ZÁLOHA ----------
export function viewBackup() {
  setTitle('Záloha');
  const v = view();
  v.innerHTML = `
    <div class="card"><h3>💾 Záloha celého deníku</h3>
      <p class="small">Uloží všechny zápisky, fotky, vlogy, milníky i nastavení do jednoho souboru. Uložte si ho na Disk Google, iCloud nebo pošlete e-mailem sami sobě.</p>
      <div class="row"><button class="btn" data-exp="share">📤 Zálohovat a sdílet</button><button class="btn secondary" data-exp="save">⬇️ Stáhnout</button></div></div>
    <div class="card"><h3>♻️ Obnovit ze zálohy</h3>
      <p class="small">Existující zápisky zůstanou, ze zálohy se doplní a přepíší položky se stejným ID.</p>
      <button class="btn" data-imp>📂 Vybrat soubor zálohy</button></div>
    <div class="card"><h3>📝 Export textu</h3>
      <p class="small">Všechny zápisky jako jednoduchý text (Markdown) – lze otevřít v jakémkoli editoru.</p>
      <button class="btn secondary" data-md>Exportovat text</button></div>
    <div class="card"><h3 style="color:var(--warn)">⚠️ Smazat vše</h3>
      <button class="btn danger" data-wipe>Smazat celý deník z tohoto zařízení</button></div>`;
  $$('[data-exp]', v).forEach(b => b.onclick = async () => {
    toast('Připravuji zálohu…');
    const out = { app: 'muj-denik', version: 1, exportedAt: new Date().toISOString() };
    for (const s of ['entries', 'milestones', 'plans', 'days']) out[s] = await db.all(s);
    const media = await db.all('media');
    out.media = [];
    for (const m of media) {
      const x = { ...m, blob: await blobToDataURL(m.blob) };
      if (m.thumb) x.thumb = await blobToDataURL(m.thumb);
      out.media.push(x);
    }
    const S = { ...(await db.settings()) };
    out.settings = S;
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const name = `denik-zaloha-${isoDate()}.json`;
    if (b.dataset.exp === 'share') await shareOrSave(blob, name, 'Záloha deníku'); else saveBlob(blob, name);
    toast(`Záloha hotová (${fmtSize(blob.size)})`);
  });
  $('[data-imp]', v).onclick = async () => {
    const [f] = await pickFiles({ accept: 'application/json,.json' });
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'muj-denik') throw new Error('bad');
      for (const s of ['entries', 'milestones', 'plans', 'days']) for (const x of data[s] || []) await db.put(s, x);
      for (const m of data.media || []) {
        m.blob = await dataURLToBlob(m.blob);
        if (m.thumb) m.thumb = await dataURLToBlob(m.thumb);
        await db.put('media', m);
      }
      if (data.settings && await ask('Obnovit i nastavení (jméno, PIN, vzhled)?', { ok: 'Ano', cancel: 'Ne' })) {
        for (const [k, val] of Object.entries(data.settings)) await db.setSetting(k, val);
      }
      toast(`Obnoveno: ${(data.entries || []).length} zápisů ✓`, 3500);
    } catch { toast('Soubor není platná záloha deníku', 3500); }
  };
  $('[data-md]', v).onclick = async () => {
    const entries = (await db.all('entries')).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const ms = (await db.all('milestones')).sort((a, b) => a.date.localeCompare(b.date));
    let md = `# ${(await db.settings()).bookTitle}\n`, day = '';
    for (const e of entries) {
      if (e.date !== day) { day = e.date; md += `\n## ${fmtDay(e.date)}\n`; }
      md += `\n### ${e.time}${e.title ? ' – ' + e.title : ''}${e.special ? ' ⭐' : ''} ${moodEmoji(e.mood)}\n\n${e.text || ''}\n`;
      const g = (e.gratitude || []).filter(Boolean);
      if (g.length) md += `\nVděčnost: ${g.join('; ')}\n`;
      if ((e.tags || []).length) md += `\n${e.tags.map(t => '#' + t).join(' ')}\n`;
    }
    if (ms.length) md += `\n# Milníky\n` + ms.map(x => `\n- **${fmtDate(x.date)}** – ${x.title}${x.text ? ': ' + x.text : ''}`).join('');
    await shareOrSave(new Blob([md], { type: 'text/markdown' }), `denik-${isoDate()}.md`);
  };
  $('[data-wipe]', v).onclick = async () => {
    if (!await ask('Opravdu smazat VŠECHNY zápisky, fotky a videa? Tuto akci nelze vrátit.', { ok: 'Pokračovat', danger: true })) return;
    if (!await ask('Naposledy: máte zálohu? Smazat vše?', { ok: 'Smazat vše', danger: true })) return;
    for (const s of db.STORES) await db.clear(s);
    db.resetSettingsCache();
    toast('Deník byl smazán'); location.hash = '#today';
  };
}

// ---------- HLEDÁNÍ ----------
export async function viewSearch() {
  setTitle('Hledat');
  const [entries, ms, plans] = await Promise.all([db.all('entries'), db.all('milestones'), db.all('plans')]);
  const tags = {};
  entries.forEach(e => (e.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
  const v = view();
  v.innerHTML = `<input class="in" type="search" placeholder="Hledat slovo, štítek, pocit…" data-q autofocus>
    <div class="chips" style="margin:10px 0">${Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => `<button class="chip" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
    <div data-res></div>`;
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const res = $('[data-res]', v), q = $('[data-q]', v);
  const run = () => {
    const term = norm(q.value.trim().replace(/^#/, ''));
    if (term.length < 2) { res.innerHTML = '<p class="muted small center">Zadejte alespoň 2 znaky. Hledání ignoruje diakritiku.</p>'; return; }
    const hit = e => norm([e.title, e.text, ...(e.tags || []), ...(e.emotions || []), ...(e.gratitude || [])].join(' ')).includes(term);
    const found = entries.filter(hit).sort((a, b) => b.date.localeCompare(a.date));
    const fms = ms.filter(x => norm(x.title + ' ' + x.text).includes(term));
    const fpl = plans.filter(x => norm(x.title + ' ' + x.why + ' ' + x.steps.map(s => s.t).join(' ')).includes(term));
    res.innerHTML = `<p class="small muted">Nalezeno: ${found.length + fms.length + fpl.length}</p>` + found.slice(0, 100).map(entryCard).join('') +
      fms.map(x => `<a class="entry-card special" href="#milestones"><div class="meta">⭐ Milník · ${fmtDate(x.date)}</div><div class="title">${esc(x.title)}</div></a>`).join('') +
      fpl.map(x => `<a class="entry-card" href="#milestones/plans"><div class="meta">${PLAN_KINDS[x.kind]}</div><div class="title">${esc(x.title)}</div></a>`).join('');
    hydrateThumbs(res);
  };
  q.addEventListener('input', run);
  $$('[data-tag]', v).forEach(b => b.onclick = () => { q.value = b.dataset.tag; run(); });
  run();
  setTimeout(() => q.focus(), 100);
}

// ---------- O APLIKACI ----------
export function viewAbout() {
  setTitle('O aplikaci');
  view().innerHTML = `
    <div class="card paper"><h2>Můj deník</h2>
      <p class="hand">Deník pro každého, kdo něco prožil. Pro všední i nevšední dny, pro pocity, plány a milníky života – a pro cestu ke střízlivosti, pokud ji právě jdete.</p>
      <p class="small muted">Inspirováno knihami Michaely Duffkové „Zápisník alkoholičky“ a „Deník nealkoholičky“ – upřímné psaní pomáhá pochopit sám sebe.</p></div>
    <div class="card"><h3>📲 Instalace do telefonu</h3>
      <p class="small"><b>Android (Chrome):</b> menu ⋮ → „Přidat na plochu“ / „Nainstalovat aplikaci“.<br>
      <b>iPhone (Safari):</b> tlačítko Sdílet → „Přidat na plochu“.<br>Pak funguje i bez internetu jako běžná aplikace.</p></div>
    <div class="card"><h3>🎙️ Hlasové příkazy při diktování</h3>
      <p class="small">„tečka“, „čárka“, „otazník“, „vykřičník“, „dvojtečka“, „pomlčka“, „tři tečky“, „nový řádek“, „nový odstavec“, „smajlík“.<br>
      Po zastavení diktování se otevře <b>korektura</b>: doplní velká písmena, interpunkci, opraví mezery a slova z vašeho slovníku oprav. Původní přepis zůstává uložený a každou úpravu lze vrátit (historie verzí).</p></div>
    <div class="card"><h3>🔒 Soukromí</h3>
      <p class="small">Vše se ukládá pouze ve vašem zařízení (IndexedDB). Nic se neodesílá na server. Diktování využívá rozpoznávání řeči prohlížeče (v Chrome může zvuk zpracovat Google). Pravidelně si dělejte zálohu – při smazání dat prohlížeče nebo ztrátě telefonu by se deník ztratil.</p></div>`;
}
