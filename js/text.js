// Zpracování diktovaného textu: hlasové příkazy, automatická korektura, porovnání změn.

const W = '(?=$|[\\s.,!?;:])';
const COMMANDS = [
  [new RegExp('(^|\\s+)nový odstavec' + W, 'giu'), '\n\n'],
  [new RegExp('(^|\\s+)(nový|novej) řádek' + W, 'giu'), '\n'],
  [new RegExp('(^|\\s+)tečka' + W, 'giu'), '.'],
  [new RegExp('(^|\\s+)čárka' + W, 'giu'), ','],
  [new RegExp('(^|\\s+)otazník' + W, 'giu'), '?'],
  [new RegExp('(^|\\s+)vykřičník' + W, 'giu'), '!'],
  [new RegExp('(^|\\s+)dvojtečka' + W, 'giu'), ':'],
  [new RegExp('(^|\\s+)středník' + W, 'giu'), ';'],
  [new RegExp('(^|\\s+)pomlčka' + W, 'giu'), ' –'],
  [new RegExp('(^|\\s+)tři tečky' + W, 'giu'), '…'],
  [new RegExp('(^|\\s+)smajlík' + W, 'giu'), ' 🙂']
];

/** Převede hlasové příkazy („tečka“, „nový řádek“…) na interpunkci. */
export function applyVoiceCommands(text) {
  let t = ' ' + text.trim();
  for (const [re, rep] of COMMANDS) t = t.replace(re, rep);
  return t.replace(/^ /, '');
}

/** Načte vlastní slovník oprav ve formátu „špatně=správně“ po řádcích. */
export function parseDictionary(src = '') {
  return src.split('\n').map(l => l.split('=')).filter(p => p.length === 2 && p[0].trim() && p[1].trim())
    .map(([a, b]) => [a.trim(), b.trim()]);
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Automatická korektura: mezery, interpunkce, velká písmena, vlastní slovník. */
export function autoCorrect(text, dictionary = []) {
  if (!text) return text;
  let t = text;
  for (const [wrong, right] of dictionary) {
    const re = new RegExp('(^|[^\\p{L}])' + escapeRe(wrong) + '(?![\\p{L}])', 'giu');
    t = t.replace(re, (m, pre, off, str) => {
      const orig = m.slice(pre.length);
      const fixed = orig[0] === orig[0].toUpperCase() && orig[0] !== orig[0].toLowerCase()
        ? right[0].toUpperCase() + right.slice(1) : right;
      return pre + fixed;
    });
  }
  t = t
    .replace(/[ \t]+/g, ' ')                       // vícenásobné mezery
    .replace(/ +\n/g, '\n').replace(/\n +/g, '\n') // mezery na krajích řádků
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([.,!?;:…])/g, '$1')               // mezera před interpunkcí
    .replace(/([,;:])(?=[\p{L}])/gu, '$1 ')         // mezera za čárkou
    .replace(/([.!?…])(?=\p{L}{2})/gu, '$1 ')       // mezera za koncem věty
    .replace(/\.{3,}/g, '…').replace(/…(?=\p{L})/gu, '… ')
    .replace(/([,!?;:])\1+/g, '$1')
    .replace(/(^|[^\p{L}])(\p{L}+) \2(?![\p{L}])/gu, '$1$2'); // zdvojené slovo „že že“
  // velké písmeno na začátku věty a řádku
  t = t.replace(/(^|[.!?…]\s+|\n\s*)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
  t = t.trim();
  // tečka na konci, pokud chybí
  if (/[\p{L}\d)]$/u.test(t)) t += '.';
  return t;
}

/** Seznam druhů nalezených oprav – pro přehled v korektuře. */
export function describeChanges(before, after) {
  const notes = [];
  if (/ {2,}/.test(before)) notes.push('vícenásobné mezery');
  if (/ [.,!?;:]/.test(before)) notes.push('mezera před interpunkcí');
  if (/(^|[.!?]\s+)\p{Ll}/u.test(before)) notes.push('velká písmena na začátku vět');
  if (/[\p{L}\d]$/u.test(before.trim())) notes.push('tečka na konci');
  if (before !== after && !notes.length) notes.push('slovník oprav / drobnosti');
  return notes;
}

/** Porovnání po slovech (LCS) → HTML s <ins>/<del>. */
export function diffHtml(a, b, esc) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) return esc(b); // příliš dlouhé – bez zvýraznění
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, out = '';
  while (i < n && j < m) {
    if (A[i] === B[j]) { out += esc(A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out += /\S/.test(A[i]) ? `<del>${esc(A[i])}</del>` : esc(A[i]); i++; }
    else { out += /\S/.test(B[j]) ? `<ins>${esc(B[j])}</ins>` : esc(B[j]); j++; }
  }
  while (i < n) { if (/\S/.test(A[i])) out += `<del>${esc(A[i])}</del>`; i++; }
  while (j < m) { out += /\S/.test(B[j]) ? `<ins>${esc(B[j])}</ins>` : esc(B[j]); j++; }
  return out;
}

export const wordCount = t => (t || '').trim().split(/\s+/).filter(Boolean).length;

// Inspirace k psaní – střídá se podle dne.
export const PROMPTS = [
  'Co mi dnes udělalo radost, i kdyby to byla maličkost?',
  'Jak se právě teď cítím v těle? Kde cítím napětí?',
  'Za jaké tři věci jsem dnes vděčný/á?',
  'Co bych řekl/a sám/sama sobě před rokem?',
  'Který okamžik dnešního dne bych chtěl/a zastavit?',
  'Co mě dnes nejvíc potrápilo a jak jsem to zvládl/a?',
  'Na co se těším v příštích dnech?',
  'Kdo mi dnes pomohl – a komu jsem pomohl/a já?',
  'Co jsem se dnes naučil/a o sobě?',
  'Jaký malý krok mě dnes posunul k mému cíli?',
  'Kdy jsem se naposledy upřímně zasmál/a?',
  'Co potřebuji, abych se zítra cítil/a lépe?',
  'Jaký pocit se dnes vracel nejčastěji? Odkud přišel?',
  'Co bych chtěl/a pustit z hlavy, než půjdu spát?',
  'Které místo mi dává klid a proč?',
  'Napiš dopis svému budoucímu já za 5 let.',
  'Co mě dnes lákalo a co jsem udělal/a místo toho?',
  'Jaký byl dnešní den ve třech slovech?',
  'Na co jsem v poslední době hrdý/á?',
  'Které rozhodnutí mi změnilo život?',
  'Popiš jednu vzpomínku z dětství, která tě hřeje.',
  'Co mi bere energii a co mi ji dodává?',
  'Jak vypadá můj ideální obyčejný den?',
  'Komu bych měl/a odpustit – včetně sebe?',
  'Jaký sen jsem odložil/a a proč?',
  'Co bych dnes udělal/a jinak?',
  'Která písnička vystihuje můj dnešní den?',
  'Čeho se bojím a co nejhoršího by se mohlo reálně stát?',
  'Které tři hodnoty jsou pro mě nejdůležitější?',
  'Co jsem dnes udělal/a jen pro sebe?',
  'Jaké místo bych chtěl/a ještě v životě vidět?',
  'Kdy jsem se naposledy cítil/a opravdu svobodný/á?'
];
export const promptOfDay = (d = new Date()) =>
  PROMPTS[Math.floor(d.getTime() / 86400000) % PROMPTS.length];
