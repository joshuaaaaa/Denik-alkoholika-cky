// Kniha: sestavení stránek z deníku, listování a export do PDF.
import { all } from './db.js';

export const PAGE_W = 420, PAGE_H = 595;
const LINE = 26;
const MOOD = ['', '😞', '😕', '😐', '🙂', '😄'];
const MILESTONE_ICONS = {
  education: '🎓', work: '💼', love: '❤️', family: '👶', home: '🏠', travel: '✈️',
  health: '💪', sober: '🌱', success: '🏆', loss: '🕯️', other: '⭐'
};

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Dlaždice s linkou (bitmapa – kvůli věrnému exportu do PDF). */
export function lineTile(color) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = LINE;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, LINE - 1, 8, 1);
  return `url(${c.toDataURL()})`;
}
export function applyTile(el, light = false) {
  const color = light ? '#c9d8ea' : getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#c9d8ea';
  el.style.setProperty('--tile', lineTile(color));
}

const dayLabel = d => cap(new Date(d + 'T12:00').toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
const monthLabel = d => new Date(d + 'T12:00').toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
const fmtDur = s => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

function blockHtml(b) {
  switch (b.t) {
    case 'chapter': return `<p class="bh" style="font-size:34px;line-height:78px;text-align:center;text-transform:capitalize">${esc(b.text)}</p>`;
    case 'day': return `<p class="bday">${esc(b.text)}</p>`;
    case 'h': return `<p class="bh">${esc(b.text)}</p>`;
    case 'meta': return `<p class="bmeta">${esc(b.text)}</p>`;
    case 'p': return `<p>${b.text ? esc(b.text) : '&nbsp;'}</p>`;
    case 'sep': return '<p class="bsep">~ ✦ ~</p>';
    case 'img': {
      const maxW = 342 - 12, maxH = 9 * LINE;
      let h = Math.min(maxH, maxW * b.h / b.w);
      let w = h * b.w / b.h;
      const box = Math.ceil((h + 24) / LINE) * LINE;
      const pad = (box - h - 12) / 2;
      return `<div class="bimg-wrap" style="height:${box}px;padding-top:${pad}px"><img class="bimg" src="${b.url}" style="width:${w}px;height:${h}px" alt=""></div>` +
        (b.caption ? `<p class="bmeta" style="text-align:center">${esc(b.caption)}</p>` : '');
    }
  }
  return '';
}

/** Načte data a připraví bloky textu. */
export async function buildBlocks({ from, to, includeHourly = true, includeMilestones = true, onlySpecial = false }) {
  const urls = [];
  const [entries, media, days, milestones] = await Promise.all([all('entries'), all('media'), all('days'), all('milestones')]);
  const mediaMap = Object.fromEntries(media.map(m => [m.id, m]));
  const dayMap = Object.fromEntries(days.map(d => [d.date, d]));
  const url = blob => { const u = URL.createObjectURL(blob); urls.push(u); return u; };

  const list = entries
    .filter(e => (!from || e.date >= from) && (!to || e.date <= to))
    .filter(e => includeHourly || e.type !== 'hour')
    .filter(e => !onlySpecial || e.special)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  const blocks = [];
  let month = '', day = '';
  for (const e of list) {
    const m = e.date.slice(0, 7);
    if (m !== month) {
      month = m;
      blocks.push({ t: 'break' }, { t: 'chapter', text: monthLabel(e.date), keep: true });
    }
    if (e.date !== day) {
      day = e.date;
      blocks.push({ t: 'day', text: dayLabel(e.date), keep: true });
      const dm = dayMap[e.date];
      if (dm?.mood) blocks.push({ t: 'meta', text: `Nálada dne: ${MOOD[dm.mood]}`, keep: true });
    }
    const metaParts = [e.time, e.type === 'hour' ? 'hodinový zápis' : null, e.special ? '⭐ nevšední' : null,
      e.mood ? MOOD[e.mood] : null, (e.emotions || []).join(', ') || null].filter(Boolean);
    if (e.title) blocks.push({ t: 'h', text: e.title, keep: true });
    blocks.push({ t: 'meta', text: metaParts.join(' · '), keep: true });
    for (const line of (e.text || '').split('\n')) blocks.push({ t: 'p', text: line });
    const grat = (e.gratitude || []).filter(Boolean);
    if (grat.length) {
      blocks.push({ t: 'meta', text: 'Jsem vděčný/á za:', keep: true });
      grat.forEach(g => blocks.push({ t: 'p', text: '♥ ' + g }));
    }
    if (e.sober !== undefined && e.sober !== null) blocks.push({ t: 'meta', text: e.sober ? '🌱 Den bez alkoholu' + (e.craving ? ` · bažení ${e.craving}/10` : '') : `Pití: ${e.drinks || '?'} sklenic` });
    for (const id of e.media || []) {
      const md = mediaMap[id];
      if (!md) continue;
      if (md.kind === 'photo') blocks.push({ t: 'img', url: url(md.blob), w: md.w, h: md.h });
      else if (md.kind === 'video' && md.thumb) blocks.push({ t: 'img', url: url(md.thumb), w: md.tw, h: md.th, caption: `▶ Vlog ${fmtDur(md.duration)}` });
      else if (md.kind === 'video') blocks.push({ t: 'meta', text: `▶ Vlog ${fmtDur(md.duration)}` });
      else if (md.kind === 'audio') blocks.push({ t: 'meta', text: `🎤 Hlasová nahrávka ${fmtDur(md.duration)}` });
    }
    blocks.push({ t: 'sep' });
  }

  if (includeMilestones) {
    const ms = milestones.filter(x => (!from || x.date >= from) && (!to || x.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
    if (ms.length) {
      blocks.push({ t: 'break' }, { t: 'chapter', text: 'Milníky mého života', keep: true });
      for (const x of ms) {
        blocks.push({ t: 'day', text: `${MILESTONE_ICONS[x.category] || '⭐'} ${new Date(x.date + 'T12:00').toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })}`, keep: true });
        blocks.push({ t: 'h', text: x.title, keep: true });
        for (const line of (x.text || '').split('\n')) if (line) blocks.push({ t: 'p', text: line });
        const md = mediaMap[x.mediaId];
        if (md?.kind === 'photo') blocks.push({ t: 'img', url: url(md.blob), w: md.w, h: md.h });
        blocks.push({ t: 'sep' });
      }
    }
  }
  return { blocks, urls, count: list.length };
}

function pageShell(inner, head = '', num = '') {
  return `<div class="bpage"><div class="spine"></div><div class="mline"></div>` +
    `<div class="phead"><span>${esc(head)}</span><span>${esc(num ? '' : '')}</span></div>` +
    `<div class="pc">${inner}</div><div class="pnum">${num}</div></div>`;
}

/** Rozdělí bloky na stránky měřením skutečné výšky textu. */
export async function paginate(blocks, host) {
  if (document.fonts?.ready) await document.fonts.ready;
  const box = document.createElement('div');
  box.className = 'measure';
  box.innerHTML = pageShell('');
  host.appendChild(box);
  const pc = box.querySelector('.pc');
  // počkáme na načtení obrázků není třeba – výšky obrázků jsou dané předem
  const pages = [];
  let cur = [], label = '';
  const fits = () => pc.scrollHeight <= pc.clientHeight + 1;
  const flush = () => {
    if (cur.length) pages.push({ html: cur.map(c => c.html).join(''), label: cur.label || label });
    cur = []; pc.innerHTML = '';
  };
  const queue = blocks.slice();
  while (queue.length) {
    const b = queue.shift();
    if (b.t === 'break') { flush(); continue; }
    if (b.t === 'chapter') label = b.text;
    if (b.t === 'day') label = label || b.text;
    if (b.t === 'sep' && cur.length === 0) continue;
    const html = blockHtml(b);
    pc.insertAdjacentHTML('beforeend', html);
    if (fits()) { cur.push({ b, html }); if (!cur.label) cur.label = label; continue; }
    pc.lastElementChild.remove();
    if (b.t === 'img' && b.caption) pc.lastElementChild?.remove?.(); // popisek obrázku
    if (b.t === 'p' && b.text) {
      // rozdělení odstavce po slovech
      const parts = b.text.split(/(\s+)/);
      let lo = 0, hi = parts.length;
      const probe = document.createElement('p');
      pc.appendChild(probe);
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        probe.textContent = parts.slice(0, mid).join('');
        if (fits()) lo = mid; else hi = mid - 1;
      }
      probe.remove();
      if (lo > 0) {
        const head = parts.slice(0, lo).join('');
        cur.push({ b: { t: 'p', text: head }, html: blockHtml({ t: 'p', text: head }) });
        queue.unshift({ t: 'p', text: parts.slice(lo).join('').trimStart() });
        flush();
        continue;
      }
    }
    if (cur.length === 0) { cur.push({ b, html }); flush(); continue; } // nevejde se ani na prázdnou stránku
    // nadpisy nenecháváme osamocené na konci stránky
    const carry = [];
    while (cur.length > 1 && cur[cur.length - 1].b.keep) carry.unshift(cur.pop().b);
    if (cur.length && cur.every(c => c.b.keep)) { /* celá stránka jsou nadpisy – necháme */ }
    flush();
    queue.unshift(...carry, b);
  }
  flush();
  box.remove();
  return pages;
}

export function coverHtml(title, subtitle, name) {
  return `<div class="bpage cover"><div class="ct">${esc(title)}</div><div class="cl"></div>` +
    `<div class="cs">${esc(name)}</div><div class="cs">${esc(subtitle)}</div></div>`;
}

export function pageHtml(book, i) {
  if (i === 0) return book.cover;
  const p = book.pages[i - 1];
  return pageShell(p.html, p.label, String(i));
}

/** Prohlížeč knihy s animací otáčení stránek. */
export class Reader {
  constructor(stage, book, onChange) {
    this.stage = stage; this.book = book; this.onChange = onChange;
    this.i = 0; this.busy = false;
    this.holder = document.createElement('div');
    this.holder.className = 'page-holder';
    stage.innerHTML = '';
    stage.appendChild(this.holder);
    applyTile(this.holder);
    this.fit();
    this.show(0);
    let sx = 0, sy = 0, moved = false;
    stage.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; moved = false; }, { passive: true });
    stage.addEventListener('touchmove', () => { moved = true; }, { passive: true });
    stage.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (moved && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? this.next() : this.prev();
    });
    stage.addEventListener('click', e => {
      if (e.target.closest('a,button,video,audio')) return;
      const r = stage.getBoundingClientRect();
      (e.clientX - r.left) > r.width / 2 ? this.next() : this.prev();
    });
    this.onKey = e => { if (e.key === 'ArrowRight') this.next(); if (e.key === 'ArrowLeft') this.prev(); };
    document.addEventListener('keydown', this.onKey);
    this.onResize = () => this.fit();
    window.addEventListener('resize', this.onResize);
  }
  get total() { return this.book.pages.length + 1; }
  fit() {
    const maxW = Math.min(window.innerWidth - 32, 560);
    const maxH = window.innerHeight - 250;
    const s = Math.max(0.4, Math.min(maxW / PAGE_W, maxH / PAGE_H));
    this.stage.style.width = PAGE_W * s + 'px';
    this.stage.style.height = PAGE_H * s + 'px';
    this.holder.style.transform = `scale(${s})`;
  }
  make(i) {
    const t = document.createElement('template');
    t.innerHTML = pageHtml(this.book, i).trim();
    return t.content.firstChild;
  }
  show(i) {
    this.holder.innerHTML = '';
    this.cur = this.make(i);
    this.holder.appendChild(this.cur);
    this.i = i;
    this.onChange?.(i, this.total);
  }
  go(i) {
    i = Math.max(0, Math.min(this.total - 1, i));
    if (i === this.i || this.busy) return;
    if (Math.abs(i - this.i) > 1) return this.show(i);
    this.busy = true;
    const old = this.cur, nu = this.make(i);
    const done = () => { old.remove(); this.cur = nu; nu.classList.remove('top', 'under'); this.busy = false; };
    if (i > this.i) {
      nu.classList.add('under'); old.classList.add('top');
      this.holder.insertBefore(nu, old);
      requestAnimationFrame(() => old.classList.add('flipped'));
    } else {
      nu.classList.add('top', 'flipped'); nu.style.transition = 'none';
      old.classList.add('under');
      this.holder.appendChild(nu);
      nu.getBoundingClientRect();
      nu.style.transition = '';
      requestAnimationFrame(() => nu.classList.remove('flipped'));
    }
    setTimeout(done, 580);
    this.i = i;
    this.onChange?.(i, this.total);
  }
  next() { this.go(this.i + 1); }
  prev() { this.go(this.i - 1); }
  destroy() {
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
  }
}

// ---- Export do PDF ----
// knihovny jsou přibalené ve složce vendor/ – PDF tedy funguje i offline
const CDN = { jspdf: 'vendor/jspdf.umd.min.js', h2c: 'vendor/html2canvas.min.js' };
const loadScript = src => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const s = document.createElement('script');
  s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Nelze načíst ' + src));
  document.head.appendChild(s);
});

/** Vytvoří PDF (formát A5) – každou stránku vykreslí jako obrázek, takže diakritika i ručně psané písmo zůstanou. */
export async function makePdf(book, onProgress) {
  await Promise.all([loadScript(CDN.jspdf), loadScript(CDN.h2c)]);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a5', compress: true });
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
  const host = document.createElement('div');
  host.className = 'light-vars';
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;`;
  applyTile(host, true);
  document.body.appendChild(host);
  const total = book.pages.length + 1;
  try {
    for (let i = 0; i < total; i++) {
      onProgress?.(i + 1, total);
      host.innerHTML = pageHtml(book, i);
      const pg = host.firstChild;
      pg.style.position = 'relative';
      await Promise.all([...pg.querySelectorAll('img')].map(img => img.complete ? 0 : new Promise(r => { img.onload = img.onerror = r; })));
      const canvas = await window.html2canvas(pg, {
        scale: 2, backgroundColor: '#fbf6e9', logging: false,
        // html2canvas kreslí v kopii dokumentu – počkáme, až se v ní načtou písma, jinak se slova překrývají
        onclone: async doc => { if (doc.fonts?.ready) { await doc.fonts.ready; await new Promise(r => setTimeout(r, 50)); } }
      });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.78), 'JPEG', 0, 0, W, H);
    }
  } finally { host.remove(); }
  return pdf.output('blob');
}

/** Záložní cesta: tisk (v telefonu „Uložit jako PDF“). */
export function printBook(book) {
  let area = document.getElementById('print-area');
  if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
  area.className = 'light-vars';
  applyTile(area, true);
  area.innerHTML = Array.from({ length: book.pages.length + 1 }, (_, i) => pageHtml(book, i)).join('');
  setTimeout(() => { window.print(); }, 300);
}
