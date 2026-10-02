// Spuštění aplikace, navigace a zámek PINem.
import * as db from './db.js';
import { $, $$, hooks, revokeViewUrls, modalsOpen } from './core.js';
import * as V from './views.js';
import { isNative, setupBackButton } from './native.js';

const routes = {
  today: V.viewToday, calendar: V.viewCalendar, book: V.viewBook, milestones: V.viewMilestones,
  more: V.viewMore, stats: V.viewStats, sos: V.viewSOS, settings: V.viewSettings, backup: V.viewBackup,
  search: V.viewSearch, entry: V.viewEntry, about: V.viewAbout
};
const TAB_OF = { stats: 'more', settings: 'more', backup: 'more', about: 'more', search: 'more', sos: 'more', entry: 'calendar' };

let rendering = Promise.resolve();
async function route() {
  const [name = 'today', arg] = location.hash.slice(1).split('/');
  const fn = routes[name] || routes.today;
  const scroll = hooks.sameRoute === location.hash ? window.scrollY : 0;
  hooks.sameRoute = location.hash;
  V.cleanupBook(); V.cleanupSOS();
  revokeViewUrls();
  const tab = TAB_OF[name] || (routes[name] ? name : 'today');
  $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  try { await fn(arg); }
  catch (err) { console.error(err); $('#view').innerHTML = `<p class="empty">Něco se pokazilo: ${err.message}</p>`; }
  window.scrollTo(0, scroll);
}
hooks.refresh = () => { rendering = rendering.then(route); return rendering; };
window.addEventListener('hashchange', () => { if (!modalsOpen()) hooks.refresh(); });

$('#btn-search').onclick = () => { location.hash = '#search'; };
$('#btn-sos').onclick = () => { location.hash = '#sos'; };

// ---------- Zámek ----------
async function showLock() {
  const lock = $('#lock');
  let pin = '';
  lock.innerHTML = `<div style="font-size:54px">📔</div><h2>Můj deník</h2><div class="pin-dots">${'<i></i>'.repeat(4)}</div>
    <div class="pin-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '✓'].map(k => `<button data-k="${k}">${k}</button>`).join('')}</div>`;
  lock.classList.remove('hidden');
  const dots = () => { $('.pin-dots', lock).innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'f' : ''}"></i>`).join(''); };
  const S = await db.settings();
  const check = async () => {
    if (await V.hashPin(pin) === S.pinHash) { lock.classList.add('hidden'); lock.innerHTML = ''; return; }
    if (pin.length >= 8 || pin.length >= 4) {
      const d = $('.pin-dots', lock); d.classList.add('shake'); setTimeout(() => d.classList.remove('shake'), 400);
      if (pin.length >= 8) { pin = ''; dots(); }
    }
  };
  $$('[data-k]', lock).forEach(b => b.onclick = async () => {
    const k = b.dataset.k;
    if (k === '⌫') pin = pin.slice(0, -1);
    else if (k === '✓') { await check(); return; }
    else if (pin.length < 8) pin += k;
    dots();
    if (pin.length >= 4 && await V.hashPin(pin) === S.pinHash) check();
  });
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const S = await db.settings();
  if (S.pinHash && hiddenAt && Date.now() - hiddenAt > 60_000) showLock();
});

// ---------- Instalace a offline ----------
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.deferredInstall = e; });
if (isNative) setupBackButton();
else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async function start() {
  const S = await db.settings();
  V.applyLook(S);
  if (S.pinHash) await showLock();
  if (!location.hash) history.replaceState(null, '', '#today');
  hooks.refresh();
  navigator.storage?.persist?.().catch(() => {});
})();
