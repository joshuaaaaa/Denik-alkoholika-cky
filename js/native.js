// Napojení na Android (Capacitor). V prohlížeči (PWA) se nic z toho nepoužije.
// vendor/capacitor.js (runtime Capacitoru) se načítá v index.html před aplikací
const C = window.Capacitor;
export const isNative = !!C?.isNativePlatform?.();
const registered = {};
const plugin = name => {
  if (!isNative) return null;
  return registered[name] ||= window.capacitorExports?.registerPlugin(name) || C?.Plugins?.[name];
};

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/** Otevře systémové menu Sdílet (Disk, WhatsApp, e-mail…) se souborem. */
export async function nativeShare(blob, filename, title) {
  const Filesystem = plugin('Filesystem'), Share = plugin('Share');
  const { uri } = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: 'CACHE' });
  try { await Share.share({ title, dialogTitle: title, files: [uri] }); return 'shared'; }
  catch { return 'aborted'; }
}

/** Uloží soubor do složky Dokumenty/MujDenik; když to systém nedovolí, nabídne sdílení. */
export async function nativeSave(blob, filename) {
  const Filesystem = plugin('Filesystem');
  try {
    await Filesystem.writeFile({ path: `MujDenik/${filename}`, data: await blobToBase64(blob), directory: 'DOCUMENTS', recursive: true });
    return `Dokumenty/MujDenik/${filename}`;
  } catch {
    await nativeShare(blob, filename, filename);
    return null;
  }
}

// ---------- Rozpoznávání řeči (Android) ----------
export async function nativeSpeechAvailable() {
  const SR = plugin('SpeechRecognition');
  if (!SR) return false;
  try { return (await SR.available()).available; } catch { return false; }
}

export class NativeDictation {
  constructor({ onFinal, onInterim, onState, lang = 'cs-CZ' }) {
    Object.assign(this, { onFinal, onInterim, onState, lang });
    this.SR = plugin('SpeechRecognition');
    this.active = false; this.last = ''; this.handles = [];
  }
  async start() {
    const SR = this.SR;
    let perm = await SR.checkPermissions();
    if (perm.speechRecognition !== 'granted') perm = await SR.requestPermissions();
    if (perm.speechRecognition !== 'granted') throw new Error('not-allowed');
    this.active = true;
    this.handles.push(await SR.addListener('partialResults', d => {
      this.last = d.matches?.[0] || '';
      this.onInterim?.(this.last);
    }));
    // Android po chvíli ticha poslouchání ukončí – dokud uživatel nezastaví, spustíme ho znovu
    this.handles.push(await SR.addListener('listeningState', s => {
      if (s.status !== 'stopped') return;
      this.flush();
      if (this.active) setTimeout(() => this.listen(), 250);
    }));
    this.listen();
  }
  listen() {
    if (!this.active) return;
    this.SR.start({ language: this.lang, maxResults: 1, partialResults: true, popup: false })
      .catch(() => { if (this.active) setTimeout(() => this.listen(), 800); });
  }
  flush() {
    if (this.last.trim()) this.onFinal(this.last);
    this.last = '';
    this.onInterim?.('');
  }
  async stop() {
    this.active = false;
    try { await this.SR.stop(); } catch { /* už neposlouchá */ }
    this.flush();
    for (const h of this.handles) h?.remove?.();
    this.handles = [];
  }
}

// ---------- Denní připomínka (Android) ----------
const REMINDER_ID = 1;
export async function scheduleReminder(time) {
  const LN = plugin('LocalNotifications');
  let p = await LN.checkPermissions();
  if (p.display !== 'granted') p = await LN.requestPermissions();
  if (p.display !== 'granted') return false;
  await LN.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
  const [hour, minute] = time.split(':').map(Number);
  await LN.schedule({ notifications: [{
    id: REMINDER_ID, title: 'Čas na deník ✍️', body: 'Jak se dnes máte? Pár řádků o dnešním dni.',
    schedule: { on: { hour, minute }, repeats: true }
  }] });
  return true;
}
export async function cancelReminder() {
  await plugin('LocalNotifications')?.cancel({ notifications: [{ id: REMINDER_ID }] }).catch(() => {});
}

/** Hardwarové tlačítko Zpět: zavře okno / vrátí se, na začátku aplikaci minimalizuje. */
export function setupBackButton() {
  const App = plugin('App');
  if (!App) return;
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back(); else App.minimizeApp();
  });
}
