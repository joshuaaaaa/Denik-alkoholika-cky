// Fotky (komprese), nahrávání vlogů a hlasu, převod řeči na text.

export const QUALITY = {
  small: { max: 1024, q: 0.6, label: 'Malá (~100 kB)' },
  medium: { max: 1440, q: 0.72, label: 'Střední (~200 kB)' },
  high: { max: 2048, q: 0.82, label: 'Vysoká (~500 kB)' }
};

export const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' kB' : (b / 1048576).toFixed(1) + ' MB';

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

const toBlob = (canvas, type, q) => new Promise(r => canvas.toBlob(r, type, q));

/** Zmenší a překóduje fotku (WebP, záložně JPEG). Vrací {blob, w, h, original}. */
export async function compressImage(file, quality = 'medium') {
  const { max, q } = QUALITY[quality] || QUALITY.medium;
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { src = await loadImage(file); }
  const sw = src.width, sh = src.height;
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  let blob = await toBlob(canvas, 'image/webp', q);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', q);
  // pokud by „komprese“ soubor zvětšila, ponecháme menší variantu
  if (file.size < blob.size && /image\/(jpeg|webp)/.test(file.type) && scale === 1) blob = file;
  return { blob, w, h, original: file.size };
}

/** Náhled z videa (snímek v 0,5 s) jako malý JPEG. */
export function videoThumb(blob) {
  return new Promise(resolve => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(blob);
    const done = res => { URL.revokeObjectURL(url); resolve(res); };
    const timer = setTimeout(() => done(null), 6000);
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch { /* ignore */ } };
    v.onseeked = async () => {
      clearTimeout(timer);
      try {
        const scale = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        const t = await toBlob(c, 'image/jpeg', 0.7);
        done(t ? { blob: t, w: c.width, h: c.height, duration: v.duration } : null);
      } catch { done(null); }
    };
    v.onerror = () => { clearTimeout(timer); done(null); };
    v.src = url;
  });
}

function pickMime(kind) {
  const list = kind === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  if (!window.MediaRecorder) return '';
  return list.find(m => MediaRecorder.isTypeSupported(m)) || '';
}

/** Nahrávač vlogu/zvuku s nízkým datovým tokem (šetří místo). */
export class Recorder {
  constructor(kind) { this.kind = kind; this.chunks = []; this.facing = 'user'; }
  async start(previewEl) {
    const constraints = this.kind === 'video'
      ? { audio: { echoCancellation: true, noiseSuppression: true },
          video: { facingMode: this.facing, width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } }
      : { audio: { echoCancellation: true, noiseSuppression: true } };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (previewEl) { previewEl.srcObject = this.stream; previewEl.muted = true; await previewEl.play().catch(() => {}); }
  }
  record() {
    const mimeType = pickMime(this.kind);
    const opts = mimeType ? { mimeType } : {};
    if (this.kind === 'video') { opts.videoBitsPerSecond = 700_000; opts.audioBitsPerSecond = 48_000; }
    else opts.audioBitsPerSecond = 32_000;
    this.chunks = [];
    this.mr = new MediaRecorder(this.stream, opts);
    this.mr.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.mr.start(1000);
    this.startedAt = Date.now();
  }
  stop() {
    return new Promise(resolve => {
      if (!this.mr || this.mr.state === 'inactive') return resolve(null);
      this.mr.onstop = () => resolve(new Blob(this.chunks, { type: this.mr.mimeType || (this.kind === 'video' ? 'video/webm' : 'audio/webm') }));
      this.mr.stop();
    });
  }
  async flip(previewEl) {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    this.release();
    await this.start(previewEl);
  }
  release() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
}

/** Diktování – Web Speech API v češtině. */
export class Dictation {
  static get supported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  constructor({ onFinal, onInterim, onState, lang = 'cs-CZ' }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.active = false;
    this.rec = new SR();
    this.rec.lang = lang;
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.maxAlternatives = 1;
    this.rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      onInterim?.(interim);
    };
    this.rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.active = false; onState?.(false, e.error); }
    };
    // mobilní prohlížeče diktování samy ukončují – dokud uživatel nezastaví, restartujeme
    this.rec.onend = () => {
      if (this.active) { try { this.rec.start(); } catch { this.active = false; onState?.(false); } }
      else onState?.(false);
    };
  }
  start() { this.active = true; this.rec.start(); }
  stop() { this.active = false; try { this.rec.stop(); } catch { /* ignore */ } }
}

export const blobToDataURL = blob => new Promise((resolve, reject) => {
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob);
});
export const dataURLToBlob = async url => (await fetch(url)).blob();
