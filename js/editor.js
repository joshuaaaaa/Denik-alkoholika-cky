// Editor zápisu, nahrávání vlogu/hlasu, korektura, editory milníků a plánů.
import * as db from './db.js';
import { $, $$, esc, toast, openModal, ask, pickFiles, isoDate, nowTime, MOODS, EMOTIONS, MS_CATS, hooks, objUrl } from './core.js';
import { applyVoiceCommands, autoCorrect, parseDictionary, describeChanges, diffHtml } from './text.js';
import { compressImage, videoThumb, Recorder, Dictation, fmtSize } from './media.js';

const DRAFT_KEY = 'muj-denik-draft';
const safeLS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* plné nebo blokované úložiště */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
};

// ---------- Ukládání médií ----------
export async function savePhoto(file, quality) {
  const r = await compressImage(file, quality);
  const m = { id: db.uid(), kind: 'photo', blob: r.blob, w: r.w, h: r.h, size: r.blob.size, original: r.original, createdAt: Date.now() };
  await db.put('media', m);
  return m;
}
export async function saveVideo(blob, duration) {
  const th = await videoThumb(blob);
  const m = { id: db.uid(), kind: 'video', blob, size: blob.size, createdAt: Date.now(), duration: th?.duration && isFinite(th.duration) ? th.duration : duration };
  if (th) Object.assign(m, { thumb: th.blob, tw: th.w, th: th.h });
  await db.put('media', m);
  return m;
}
export async function saveAudio(blob, duration) {
  const m = { id: db.uid(), kind: 'audio', blob, size: blob.size, duration, createdAt: Date.now() };
  await db.put('media', m);
  return m;
}

// ---------- Nahrávání vlogu / hlasu ----------
export function openRecorder(kind) {
  return new Promise(resolve => {
    let result = null, timer;
    const rec = new Recorder(kind);
    const m = openModal({
      title: kind === 'video' ? 'Nahrát vlog' : 'Hlasová poznámka',
      html: `
        ${kind === 'video' ? '<video class="rec-video" playsinline autoplay muted></video>' : '<div class="center" style="font-size:80px">🎙️</div>'}
        <div class="rec-time">0:00</div>
        <p class="center muted small" data-msg>${kind === 'video' ? 'Video se ukládá v nízkém rozlišení (480p), aby šetřilo místo.' : 'Mluvte volně – nahrávka se uloží k zápisu.'}</p>
        <div class="row" style="justify-content:center;gap:12px">
          <button class="btn" data-rec>● Nahrávat</button>
          ${kind === 'video' ? '<button class="btn secondary" data-flip>🔄 Kamera</button>' : ''}
        </div>
        <video class="rec-video hidden" data-review controls playsinline style="margin-top:12px"></video>
        <audio class="hidden" data-areview controls style="width:100%;margin-top:12px"></audio>
        <div class="row hidden" data-after style="justify-content:center;margin-top:12px">
          <button class="btn secondary" data-again>↺ Znovu</button><button class="btn" data-use>✓ Použít</button>
        </div>
        <hr style="margin:20px 0;border:0;border-top:1px dashed var(--line)">
        <button class="btn ghost block" data-file>📁 Vybrat ${kind === 'video' ? 'video' : 'zvuk'} z telefonu</button>`,
      onClose: () => { clearInterval(timer); rec.release(); resolve(result); }
    });
    const preview = $('video.rec-video', m.el), timeEl = $('.rec-time', m.el);
    let blob = null, secs = 0;
    rec.start(kind === 'video' ? preview : null).catch(() => {
      $('[data-msg]', m.el).textContent = 'Kamera/mikrofon nejsou dostupné nebo nebylo povoleno. Můžete vybrat soubor z telefonu.';
      $('[data-rec]', m.el).disabled = true;
    });
    $('[data-rec]', m.el).onclick = async e => {
      const b = e.currentTarget;
      if (!rec.mr || rec.mr.state === 'inactive') {
        rec.record(); secs = 0; b.textContent = '■ Zastavit'; b.classList.add('recording');
        timer = setInterval(() => { secs++; timeEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; }, 1000);
      } else {
        clearInterval(timer);
        blob = await rec.stop();
        b.textContent = '● Nahrávat'; b.classList.remove('recording');
        const rv = kind === 'video' ? $('[data-review]', m.el) : $('[data-areview]', m.el);
        rv.src = objUrl(blob); rv.classList.remove('hidden');
        $('[data-after]', m.el).classList.remove('hidden');
        $('[data-msg]', m.el).textContent = `Velikost: ${fmtSize(blob.size)}`;
      }
    };
    $('[data-flip]', m.el)?.addEventListener('click', () => rec.flip(preview).catch(() => toast('Druhou kameru nelze použít')));
    $('[data-again]', m.el).onclick = () => { blob = null; $('[data-after]', m.el).classList.add('hidden'); timeEl.textContent = '0:00'; };
    $('[data-use]', m.el).onclick = () => { result = { blob, duration: secs }; m.close(); };
    $('[data-file]', m.el).onclick = async () => {
      const [f] = await pickFiles({ accept: kind === 'video' ? 'video/*' : 'audio/*' });
      if (!f) return;
      if (f.size > 150 * 1048576) return toast('Soubor je příliš velký (max 150 MB)');
      result = { blob: f, duration: 0 }; m.close();
    };
  });
}

// ---------- Korektura ----------
export function openCorrection(text, settings) {
  return new Promise(resolve => {
    const fixed = autoCorrect(text, parseDictionary(settings.corrections));
    let result = null;
    const notes = describeChanges(text, fixed);
    const m = openModal({
      title: 'Korektura textu',
      html: fixed === text
        ? '<p class="empty">Text vypadá v pořádku ✓</p><p class="muted small center">Další překlepy podtrhává kontrola pravopisu vaší klávesnice.</p>'
        : `<p class="muted small">Navržené opravy: ${esc(notes.join(', '))}. <ins style="background:#cdeccd;text-decoration:none">zelené</ins> = přidáno, <del style="background:#f4c7c0">červené</del> = odebráno.</p>
           <div class="card diff">${diffHtml(text, fixed, esc)}</div>
           <label class="f">Výsledný text (můžete ho ještě upravit)</label>
           <textarea class="in" data-t rows="8" spellcheck="true" lang="cs">${esc(fixed)}</textarea>
           <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn secondary" data-close>Ponechat původní</button><button class="btn" data-apply>✓ Použít opravy</button></div>`,
      onClose: () => resolve(result)
    });
    $('[data-apply]', m.el)?.addEventListener('click', () => { result = $('[data-t]', m.el).value; m.close(); });
  });
}

// ---------- Editor zápisu ----------
export async function openEditor(opts = {}) {
  const S = await db.settings();
  const existing = opts.entry || null;
  const e = existing ? structuredClone(existing) : {
    id: db.uid(), date: opts.date || isoDate(), time: opts.time || nowTime(), type: opts.type || 'day',
    title: opts.title || '', text: opts.text || '', raw: '', mood: 0, emotions: [], tags: opts.tags || [],
    media: [], gratitude: ['', '', ''], special: false, sober: null, craving: 0, drinks: 0, createdAt: Date.now()
  };
  e.gratitude = [...(e.gratitude || []), '', '', ''].slice(0, 3);
  const added = [];      // média přidaná v tomto okně (při zrušení smazat)
  const removed = [];    // média odebraná (smazat až po uložení)
  let saved = false, dictation = null, voiceRec = null;

  if (!existing && !opts.text && !opts.title) {
    const draft = safeLS.get(DRAFT_KEY);
    if (draft) {
      try {
        const d = JSON.parse(draft);
        if ((d.text || d.title) && await ask('Máte rozepsaný neuložený zápis. Pokračovat v něm?', { ok: 'Obnovit', cancel: 'Zahodit' })) {
          Object.assign(e, d, { media: [] });
        } else safeLS.del(DRAFT_KEY);
      } catch { safeLS.del(DRAFT_KEY); }
    }
  }

  const m = openModal({
    title: existing ? 'Upravit zápis' : (e.type === 'hour' ? 'Hodinový zápis' : 'Nový zápis'),
    primary: 'Uložit',
    html: `
      <div class="row">
        <input type="date" class="in" data-f="date" style="flex:1.3" value="${e.date}">
        <input type="time" class="in" data-f="time" style="flex:1" value="${e.time}">
      </div>
      <div class="row" style="margin-top:8px">
        <div class="seg grow" data-seg="type"><button data-v="day">📝 Zápis dne</button><button data-v="hour">🕐 Hodinový</button></div>
        <div class="seg grow" data-seg="special"><button data-v="0">Všední</button><button data-v="1">⭐ Nevšední</button></div>
      </div>
      <div class="toolbar">
        <button class="btn small" data-dict>🎙️ Diktovat</button>
        <button class="btn small secondary" data-corr>✨ Korektura</button>
        <button class="btn small secondary" data-cam>📷 Foto</button>
        <button class="btn small secondary" data-gal>🖼️ Galerie</button>
        <button class="btn small secondary" data-vlog>🎥 Vlog</button>
        <button class="btn small secondary" data-audio>🎤 Hlas</button>
      </div>
      <div class="paper">
        <input class="editor-title" data-f="title" placeholder="Nadpis (nepovinný)…" value="${esc(e.title)}">
        <textarea class="editor-text" data-f="text" placeholder="Milý deníčku…" spellcheck="true" lang="cs">${esc(e.text)}</textarea>
        <div class="interim hand"></div>
      </div>
      <div class="att" data-att></div>
      <div class="card" style="margin-top:12px">
        <h3>Jak se cítím</h3>
        <div class="moods">${MOODS.map(x => `<button class="mood-btn" data-mood="${x.v}" title="${x.t}">${x.e}</button>`).join('')}</div>
        <div class="chips" style="margin-top:10px">${EMOTIONS.map(x => `<button class="chip" data-emo="${x}">${x}</button>`).join('')}</div>
      </div>
      <details class="card" ${e.gratitude.some(Boolean) || opts.gratitude ? 'open' : ''}>
        <summary><b>🙏 Za co jsem dnes vděčný/á</b></summary>
        ${e.gratitude.map((g, i) => `<input class="in" style="margin-top:8px" data-grat="${i}" placeholder="${i + 1}." value="${esc(g)}">`).join('')}
      </details>
      ${S.sobriety ? `
      <div class="card">
        <h3>🌱 Střízlivost</h3>
        <div class="seg" data-seg="sober"><button data-v="1">Dnes bez alkoholu</button><button data-v="0">Pil/a jsem</button><button data-v="">Nevyplňovat</button></div>
        <label class="f">Bažení / chuť: <b data-cv>${e.craving}</b>/10</label>
        <input type="range" min="0" max="10" data-f="craving" value="${e.craving}">
        <div data-drinks class="${e.sober === false ? '' : 'hidden'}"><label class="f">Kolik sklenic</label><input type="number" min="0" class="in" data-f="drinks" value="${e.drinks || 0}"></div>
      </div>` : ''}
      <label class="f">Štítky (oddělte čárkou)</label>
      <input class="in" data-f="tags" placeholder="např. rodina, práce, výlet" value="${esc((e.tags || []).join(', '))}">
      ${e.raw ? `<details class="card" style="margin-top:12px"><summary class="small muted">Původní přepis hlasu</summary><p class="small">${esc(e.raw)}</p></details>` : ''}
    `,
    onClose: async () => {
      dictation?.stop(); voiceRec?.release();
      if (!saved) for (const id of added) await db.del('media', id);
    }
  });
  const el = m.el;
  const ta = $('[data-f="text"]', el), titleIn = $('[data-f="title"]', el), interim = $('.interim', el);
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight, 280) + 'px'; };
  setTimeout(grow, 0);

  const setSeg = (name, v) => $$(`[data-seg="${name}"] button`, el).forEach(b => b.classList.toggle('sel', b.dataset.v === String(v)));
  setSeg('type', e.type); setSeg('special', e.special ? 1 : 0);
  if (S.sobriety) setSeg('sober', e.sober === null || e.sober === undefined ? '' : e.sober ? 1 : 0);
  $$('[data-seg] button', el).forEach(b => b.addEventListener('click', () => {
    const seg = b.parentElement.dataset.seg, v = b.dataset.v;
    if (seg === 'type') e.type = v;
    if (seg === 'special') e.special = v === '1';
    if (seg === 'sober') { e.sober = v === '' ? null : v === '1'; $('[data-drinks]', el)?.classList.toggle('hidden', e.sober !== false); }
    setSeg(seg, v);
  }));
  const paintMood = () => $$('[data-mood]', el).forEach(b => b.classList.toggle('sel', +b.dataset.mood === e.mood));
  const paintEmo = () => $$('[data-emo]', el).forEach(b => b.classList.toggle('sel', e.emotions.includes(b.dataset.emo)));
  paintMood(); paintEmo();
  $$('[data-mood]', el).forEach(b => b.onclick = () => { e.mood = e.mood === +b.dataset.mood ? 0 : +b.dataset.mood; paintMood(); });
  $$('[data-emo]', el).forEach(b => b.onclick = () => {
    const x = b.dataset.emo;
    e.emotions = e.emotions.includes(x) ? e.emotions.filter(y => y !== x) : [...e.emotions, x];
    paintEmo();
  });
  $('[data-f="craving"]', el)?.addEventListener('input', ev => { $('[data-cv]', el).textContent = ev.target.value; });

  // rozepsaný text se průběžně ukládá
  const saveDraft = () => { if (!existing) safeLS.set(DRAFT_KEY, JSON.stringify({ ...collect(), media: [] })); };
  ta.addEventListener('input', () => { grow(); saveDraft(); });
  titleIn.addEventListener('input', saveDraft);

  // ---- přílohy ----
  const mediaCache = {};
  async function paintAtt() {
    const box = $('[data-att]', el);
    const items = [];
    for (const id of e.media) {
      const md = mediaCache[id] || (mediaCache[id] = await db.get('media', id));
      if (!md) continue;
      let pic;
      if (md.kind === 'photo') pic = `<img src="${objUrl(md.blob)}" alt="">`;
      else if (md.kind === 'video') pic = md.thumb ? `<img src="${objUrl(md.thumb)}" alt=""><div class="vid" style="position:absolute;inset:0;background:transparent">▶</div>` : '<div class="vid">🎥</div>';
      else pic = '<div class="vid" style="background:var(--accent)">🎤</div>';
      const info = md.kind === 'photo' && md.original && md.original !== md.size
        ? `${fmtSize(md.original)} → ${fmtSize(md.size)}` : fmtSize(md.size);
      items.push(`<div class="a">${pic}<small>${info}</small><button class="x" data-rm="${id}" aria-label="Odebrat">✕</button></div>`);
    }
    box.innerHTML = items.join('');
    $$('[data-rm]', box).forEach(b => b.onclick = () => {
      const id = b.dataset.rm;
      e.media = e.media.filter(x => x !== id);
      if (added.includes(id)) db.del('media', id); else removed.push(id);
      paintAtt();
    });
  }
  paintAtt();

  async function addPhotos(files) {
    if (!files.length) return;
    toast('Zmenšuji fotky…');
    let before = 0, after = 0;
    for (const f of files) {
      try {
        const md = await savePhoto(f, S.photoQuality);
        mediaCache[md.id] = md; e.media.push(md.id); added.push(md.id);
        before += md.original; after += md.size;
      } catch { toast('Fotku se nepodařilo zpracovat'); }
    }
    paintAtt();
    if (after) toast(`Fotky uloženy: ${fmtSize(before)} → ${fmtSize(after)}`);
  }
  $('[data-cam]', el).onclick = async () => addPhotos(await pickFiles({ accept: 'image/*', capture: 'environment' }));
  $('[data-gal]', el).onclick = async () => addPhotos(await pickFiles({ accept: 'image/*', multiple: true }));
  async function addRecording(kind) {
    const r = await openRecorder(kind);
    if (!r?.blob) return;
    const md = kind === 'video' ? await saveVideo(r.blob, r.duration) : await saveAudio(r.blob, r.duration);
    mediaCache[md.id] = md; e.media.push(md.id); added.push(md.id);
    if (kind === 'video' && !e.title) { e.title = 'Vlog'; titleIn.value = 'Vlog'; }
    paintAtt();
  }
  $('[data-vlog]', el).onclick = () => addRecording('video');
  $('[data-audio]', el).onclick = () => addRecording('audio');

  // ---- diktování ----
  const dictBtn = $('[data-dict]', el);
  function insertText(t) {
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
    const sep = before && !/[\s\n]$/.test(before) && !/^[.,!?;:…]/.test(t) ? ' ' : '';
    ta.value = before + sep + t + after;
    const np = (before + sep + t).length;
    ta.setSelectionRange(np, np);
    grow(); saveDraft();
  }
  async function stopDictation() {
    dictation?.stop(); dictation = null;
    dictBtn.textContent = '🎙️ Diktovat'; dictBtn.classList.remove('recording');
    interim.textContent = '';
    if (voiceRec) {
      const blob = await voiceRec.stop(); voiceRec.release(); voiceRec = null;
      if (blob?.size) { const md = await saveAudio(blob, 0); mediaCache[md.id] = md; e.media.push(md.id); added.push(md.id); paintAtt(); }
    }
    if (ta.value.trim()) {
      const r = await openCorrection(ta.value, S);
      if (r !== null) { ta.value = r; grow(); saveDraft(); }
    }
  }
  async function startDictation() {
    if (!Dictation.supported) return toast('Tento prohlížeč neumí převod řeči na text. Zkuste Chrome, nebo mikrofon na klávesnici.', 4500);
    dictation = new Dictation({
      onFinal: t => { e.raw = (e.raw ? e.raw + ' ' : '') + t.trim(); insertText(applyVoiceCommands(t)); },
      onInterim: t => { interim.textContent = t; },
      onState: (on, err) => { if (!on && dictation) { if (err) toast('Mikrofon není povolen'); stopDictation(); } }
    });
    try { dictation.start(); } catch { return toast('Diktování nelze spustit'); }
    dictBtn.textContent = '⏹ Zastavit'; dictBtn.classList.add('recording');
    toast('Mluvte… Řekněte „tečka“, „čárka“, „nový řádek“.', 3500);
    if (S.saveDictationAudio) {
      try { voiceRec = new Recorder('audio'); await voiceRec.start(); voiceRec.record(); } catch { voiceRec = null; }
    }
  }
  dictBtn.onclick = () => dictation ? stopDictation() : startDictation();
  $('[data-corr]', el).onclick = async () => {
    if (!ta.value.trim()) return toast('Nejdřív něco napište nebo nadiktujte');
    const r = await openCorrection(ta.value, S);
    if (r !== null) { ta.value = r; grow(); saveDraft(); }
  };

  function collect() {
    return {
      ...e,
      date: $('[data-f="date"]', el).value || isoDate(),
      time: $('[data-f="time"]', el).value || nowTime(),
      title: titleIn.value.trim(),
      text: ta.value.replace(/\s+$/, ''),
      tags: $('[data-f="tags"]', el).value.split(',').map(s => s.trim()).filter(Boolean),
      gratitude: $$('[data-grat]', el).map(i => i.value.trim()),
      craving: +($('[data-f="craving"]', el)?.value || 0),
      drinks: +($('[data-f="drinks"]', el)?.value || 0)
    };
  }

  m.beforeClose = () => {
    const c = collect();
    if (!existing && (c.text || c.title || e.media.length)) {
      ask('Zahodit tento zápis?', { ok: 'Zahodit', danger: true }).then(ok => { if (ok) { safeLS.del(DRAFT_KEY); m.beforeClose = null; m.close(); } });
      return false;
    }
    return true;
  };

  $('[data-primary]', el).onclick = async () => {
    if (dictation) await stopDictation();
    const c = collect();
    if (!c.text && !c.title && !c.media.length && !c.mood) return toast('Zápis je prázdný');
    c.updatedAt = Date.now();
    if (existing && existing.text !== c.text && existing.text) {
      c.history = [{ text: existing.text, at: existing.updatedAt || existing.createdAt }, ...(existing.history || [])].slice(0, 20);
    }
    await db.put('entries', c);
    for (const id of removed) await db.del('media', id);
    // nálada zápisu se propíše do dne, pokud den ještě náladu nemá
    if (c.mood) {
      const day = (await db.get('days', c.date)) || { date: c.date };
      if (!day.mood) { day.mood = c.mood; await db.put('days', day); }
    }
    saved = true;
    safeLS.del(DRAFT_KEY);
    m.beforeClose = null;
    await m.close();
    toast('Uloženo do deníku ✓');
    opts.onSaved ? opts.onSaved(c) : hooks.refresh();
  };

  if (opts.autoDictate) setTimeout(startDictation, 300);
  if (opts.autoVlog) setTimeout(() => addRecording('video'), 300);
  if (opts.photos) addPhotos(opts.photos);
  if (!opts.autoDictate && !opts.autoVlog) setTimeout(() => ta.focus(), 250);
}

// ---------- Milník ----------
export async function openMilestone(existing = null, preset = {}) {
  const S = await db.settings();
  const x = existing ? { ...existing } : { id: db.uid(), date: isoDate(), title: '', text: '', category: 'other', mediaId: null, ...preset };
  let newMedia = null, saved = false;
  const m = openModal({
    title: existing ? 'Upravit milník' : 'Nový milník',
    primary: 'Uložit',
    html: `
      <p class="muted small">Důležitý okamžik života – svatba, narození dítěte, nová práce, rok bez alkoholu, první maraton…</p>
      <label class="f">Datum</label><input type="date" class="in" data-f="date" value="${x.date}">
      <label class="f">Co se stalo</label><input class="in" data-f="title" value="${esc(x.title)}" placeholder="např. Narodila se nám Anička">
      <label class="f">Oblast života</label>
      <div class="chips">${Object.entries(MS_CATS).map(([k, [i, t]]) => `<button class="chip" data-cat="${k}">${i} ${t}</button>`).join('')}</div>
      <label class="f">Jak jsem to prožíval/a</label><textarea class="in" data-f="text" rows="5" spellcheck="true" lang="cs">${esc(x.text)}</textarea>
      <label class="f">Fotka</label>
      <div data-ph></div>
      <button class="btn secondary" data-photo>📷 Vybrat fotku</button>
      ${existing ? '<hr style="margin:24px 0;border:0;border-top:1px dashed var(--line)"><button class="btn danger block" data-del>🗑️ Smazat milník</button>' : ''}`,
    onClose: () => { if (!saved && newMedia) db.del('media', newMedia); }
  });
  const el = m.el;
  const paintCat = () => $$('[data-cat]', el).forEach(b => b.classList.toggle('sel', b.dataset.cat === x.category));
  paintCat();
  $$('[data-cat]', el).forEach(b => b.onclick = () => { x.category = b.dataset.cat; paintCat(); });
  const paintPh = async () => {
    const md = x.mediaId && await db.get('media', x.mediaId);
    $('[data-ph]', el).innerHTML = md ? `<img src="${objUrl(md.blob)}" style="max-width:100%;max-height:200px;border-radius:10px;margin-bottom:8px">` : '';
  };
  paintPh();
  $('[data-photo]', el).onclick = async () => {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    const md = await savePhoto(f, S.photoQuality);
    if (newMedia) db.del('media', newMedia);
    newMedia = md.id; x.mediaId = md.id; paintPh();
  };
  $('[data-del]', el)?.addEventListener('click', async () => {
    if (!await ask('Opravdu smazat tento milník?', { ok: 'Smazat', danger: true })) return;
    await db.del('milestones', x.id);
    if (x.mediaId) await db.del('media', x.mediaId);
    saved = true; await m.close(); hooks.refresh();
  });
  $('[data-primary]', el).onclick = async () => {
    x.date = $('[data-f="date"]', el).value || isoDate();
    x.title = $('[data-f="title"]', el).value.trim();
    x.text = $('[data-f="text"]', el).value.trim();
    if (!x.title) return toast('Napište, co se stalo');
    if (existing?.mediaId && existing.mediaId !== x.mediaId) await db.del('media', existing.mediaId);
    await db.put('milestones', x);
    saved = true; await m.close();
    toast('Milník uložen ⭐'); hooks.refresh();
  };
}

// ---------- Plán / sen / cíl ----------
export const PLAN_KINDS = { goal: '🎯 Cíl', plan: '🗺️ Plán', dream: '🌈 Sen' };
export async function openPlan(existing = null) {
  const p = existing ? structuredClone(existing) : { id: db.uid(), kind: 'goal', title: '', why: '', due: '', steps: [], done: false, createdAt: Date.now() };
  const m = openModal({
    title: existing ? 'Upravit' : 'Nový cíl / plán',
    primary: 'Uložit',
    html: `
      <div class="seg" data-seg>${Object.entries(PLAN_KINDS).map(([k, t]) => `<button data-v="${k}">${t}</button>`).join('')}</div>
      <label class="f">Název</label><input class="in" data-f="title" value="${esc(p.title)}" placeholder="např. Uběhnout 10 km, Naučit se italsky…">
      <label class="f">Proč je to pro mě důležité</label><textarea class="in" data-f="why" rows="3">${esc(p.why)}</textarea>
      <label class="f">Termín (nepovinný)</label><input type="date" class="in" data-f="due" value="${p.due}">
      <label class="f">Kroky – každý na nový řádek</label><textarea class="in" data-f="steps" rows="5" placeholder="Koupit boty&#10;Běhat 3× týdně&#10;Přihlásit se na závod">${esc(p.steps.map(s => s.t).join('\n'))}</textarea>
      ${existing ? '<hr style="margin:24px 0;border:0;border-top:1px dashed var(--line)"><button class="btn danger block" data-del>🗑️ Smazat</button>' : ''}`
  });
  const el = m.el;
  const paint = () => $$('[data-seg] button', el).forEach(b => b.classList.toggle('sel', b.dataset.v === p.kind));
  paint();
  $$('[data-seg] button', el).forEach(b => b.onclick = () => { p.kind = b.dataset.v; paint(); });
  $('[data-del]', el)?.addEventListener('click', async () => {
    if (!await ask('Opravdu smazat?', { ok: 'Smazat', danger: true })) return;
    await db.del('plans', p.id); await m.close(); hooks.refresh();
  });
  $('[data-primary]', el).onclick = async () => {
    p.title = $('[data-f="title"]', el).value.trim();
    if (!p.title) return toast('Zadejte název');
    p.why = $('[data-f="why"]', el).value.trim();
    p.due = $('[data-f="due"]', el).value;
    const old = Object.fromEntries(p.steps.map(s => [s.t, s.done]));
    p.steps = $('[data-f="steps"]', el).value.split('\n').map(s => s.trim()).filter(Boolean).map(t => ({ t, done: !!old[t] }));
    await db.put('plans', p);
    await m.close(); toast('Uloženo'); hooks.refresh();
  };
}
