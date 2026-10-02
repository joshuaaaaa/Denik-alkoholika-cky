// Kontrola pravopisu a doplnění háčků a čárek – funguje offline nad slovníkem četností.
// Slovník: dict/cs-words.txt (slova seřazená od nejčastějšího), viz dict/README.md.

const ALPHA = 'aábcčdďeéěfghiíjklmnňoópqrřsštťuúůvwxyýzž';
const PLAIN = 'abcdefghijklmnopqrstuvwxyz';
const WORD_RE = /\p{L}+/gu;

let rank = null;      // slovo → pořadí (menší = častější)
let byStrip = null;   // slovo bez diakritiky → nejčastější tvar s diakritikou
let userWords = new Set();
let loading = null;

export const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Naplní slovník z textu (jedno slovo na řádek, seřazeno podle četnosti). */
export function initSpeller(text) {
  rank = new Map();
  byStrip = new Map();
  text.split('\n').forEach((w, i) => {
    if (!w || rank.has(w)) return;
    rank.set(w, i + 1);
    const s = strip(w);
    if (!byStrip.has(s)) byStrip.set(s, w);
  });
}

/** Načte slovník (jen jednou, líně – až když je potřeba). */
export function loadSpeller() {
  if (rank) return Promise.resolve(true);
  loading ||= fetch('dict/cs-words.txt').then(r => r.text()).then(t => { initSpeller(t); return true; })
    .catch(() => { loading = null; return false; });
  return loading;
}
export const spellerReady = () => !!rank;

/** Vlastní slova uživatele (jména, místa…) – nebudou označena jako chyba. */
export function setUserWords(list) {
  userWords = new Set((list || '').split(/[\n,;]+/).map(w => w.trim().toLowerCase()).filter(Boolean));
}

const rankOf = w => userWords.has(w) ? 1 : (rank.get(w) ?? Infinity);
const known = w => userWords.has(w) || rank.has(w);

function edits1(w, alphabet) {
  const out = new Set();
  for (let i = 0; i <= w.length; i++) {
    const a = w.slice(0, i), b = w.slice(i);
    if (b) out.add(a + b.slice(1));                                   // vynechání
    if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));          // přehození
    for (const c of alphabet) {
      if (b) out.add(a + c + b.slice(1));                             // záměna
      out.add(a + c + b);                                             // vložení
    }
  }
  return out;
}

/** Návrhy oprav pro jedno slovo (malými písmeny), seřazené podle pravděpodobnosti. */
export function suggest(w, max = 6) {
  if (!rank) return [];
  const score = new Map(); // kandidát → skóre (menší = lepší)
  const add = (c, penalty) => {
    if (c === w || !known(c)) return;
    const s = Math.log(rankOf(c)) + penalty;
    if (!score.has(c) || score.get(c) > s) score.set(c, s);
  };
  const sw = strip(w);
  // 1) stejné slovo, jen jiné háčky/čárky
  const d = byStrip.get(sw);
  if (d) add(d, -6);
  for (const u of userWords) if (strip(u) === sw) add(u, -6);
  // 2) jeden překlep
  for (const c of edits1(w, ALPHA)) add(c, 0);
  // 3) překlep + chybějící diakritika (porovnání bez háčků a čárek)
  for (const c of edits1(sw, PLAIN)) { const v = byStrip.get(c); if (v) add(v, 1.5); }
  // 4) dva překlepy jen u delších slov a jen když nic jiného nenajdeme
  if (!score.size && w.length > 5) {
    for (const e of edits1(sw, PLAIN)) for (const c of edits1(e, PLAIN)) { const v = byStrip.get(c); if (v) add(v, 4); }
  }
  return [...score.entries()].sort((a, b) => a[1] - b[1]).slice(0, max).map(x => x[0]);
}

/** Přenese velikost písmen z původního slova na opravu. */
export function matchCase(orig, fix) {
  if (orig.length > 1 && orig === orig.toUpperCase()) return fix.toUpperCase();
  if (orig[0] !== orig[0].toLowerCase()) return fix[0].toUpperCase() + fix.slice(1);
  return fix;
}

/**
 * Najde problémy v textu.
 * type: 'diakritika' (chybí/špatné háčky a čárky), 'preklep' (neznámé slovo), 'rozpoznani' (možná chyba diktování)
 * hints: { slovo: [alternativy z rozpoznávání řeči] }
 */
export function check(text, hints = {}) {
  if (!rank) return [];
  const issues = [];
  for (const m of text.matchAll(WORD_RE)) {
    const word = m[0], lw = word.toLowerCase(), start = m.index;
    const before = text.slice(0, start);
    const sentenceStart = !before.trim() || /[.!?…\n]\s*$/.test(before);
    const base = { word, start, end: start + word.length };
    const hint = (hints[lw] || []).filter(h => h.toLowerCase() !== lw);
    if (known(lw)) {
      // slovo existuje, ale bez diakritiky je mnohem méně časté než s ní (nevim → nevím)
      const v = byStrip.get(strip(lw));
      if (v && v !== lw && lw === strip(lw) && rankOf(v) * 15 < rankOf(lw)) {
        issues.push({ ...base, type: 'diakritika', suggestions: [v, ...hint], auto: true });
      } else if (hint.length) {
        issues.push({ ...base, type: 'rozpoznani', suggestions: hint, auto: false });
      }
      continue;
    }
    if (lw.length < 2) continue;
    // neznámé slovo s velkým písmenem uprostřed věty je nejspíš jméno – opravíme jen háčky a čárky (Brne → Brně)
    if (!sentenceStart && word[0] !== lw[0]) {
      const v = byStrip.get(strip(lw));
      if (v && v !== lw) issues.push({ ...base, type: 'diakritika', suggestions: [v], auto: true });
      continue;
    }
    const sug = [...new Set([...suggest(lw), ...hint.map(h => h.toLowerCase())])];
    if (!sug.length) { issues.push({ ...base, type: 'preklep', suggestions: [], auto: false }); continue; }
    const diaOnly = strip(sug[0]) === strip(lw);
    issues.push({ ...base, type: diaOnly ? 'diakritika' : 'preklep', suggestions: sug, auto: diaOnly });
  }
  return issues;
}

/** Použije opravy (zachová velikost písmen). fixes: [{start,end,word,replacement}] */
export function applyFixes(text, fixes) {
  let out = text;
  for (const f of [...fixes].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, f.start) + matchCase(f.word, f.replacement) + out.slice(f.end);
  }
  return out;
}

/** Automaticky doplní háčky a čárky tam, kde je to jednoznačné. */
export function autoDiacritics(text, hints) {
  const fixes = check(text, hints).filter(i => i.auto && i.suggestions[0]).map(i => ({ ...i, replacement: i.suggestions[0] }));
  return { text: applyFixes(text, fixes), count: fixes.length };
}

/** Porovná přepisy z rozpoznávání řeči a vrátí alternativy pro jednotlivá slova. */
export function hintsFromAlternatives(alts, into = {}) {
  if (!alts || alts.length < 2) return into;
  const main = alts[0].trim().split(/\s+/);
  for (const alt of alts.slice(1)) {
    const words = alt.trim().split(/\s+/);
    if (words.length !== main.length) continue;
    words.forEach((w, i) => {
      const a = main[i].toLowerCase().replace(/[^\p{L}]/gu, ''), b = w.toLowerCase().replace(/[^\p{L}]/gu, '');
      if (a && b && a !== b) (into[a] ||= []).includes(b) || into[a].push(b);
    });
  }
  return into;
}

// ---------- Online korektura (Korektor, ÚFAL MFF UK) – jen pokud ji uživatel zapne ----------
const KOREKTOR = 'https://lindat.mff.cuni.cz/services/korektor/api/correct';
export async function korektorOnline(text, model = 'czech-spellchecker') {
  const body = new URLSearchParams({ model, data: text });
  const r = await fetch(KOREKTOR, { method: 'POST', body });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (typeof j.result !== 'string') throw new Error('Neočekávaná odpověď');
  return j.result;
}
