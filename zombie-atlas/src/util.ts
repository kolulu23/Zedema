/** Small shared helpers: formatting, colour scales, DOM, events. */

export const fmtInt = (n: number): string => n.toLocaleString('en-US');

export function fmtCompact(n: number): string {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

export function fmtBytes(n: number): string {
  const a = Math.abs(n);
  if (a >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  if (a >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}

export const pct = (x: number): string => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

/** Elapsed-time style suffix for generated timestamps. */
export function timeAgo(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const min = Math.round(d / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Escape text for safe innerHTML interpolation. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v as object);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el as T;
};

/** Colour helpers ---------------------------------------------------------- */

export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function lighten(hex: string, t: number): string {
  return mix(hex, '#ffffff', t);
}

export function darken(hex: string, t: number): string {
  return mix(hex, '#000000', t);
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Alias used by the UI for palette assignment. */
export const hashFor = (s: string): number => hashCode(s);

/** Simple string hash → stable pseudo-random colour index. */
export function hashCode(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Perceptually reasonable sequential ramps as hex stop lists. */
export const RAMPS: Record<string, string[]> = {
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  turbo: ['#30123b', '#4662d8', '#24c4b3', '#a4fc3c', '#f9ba38', '#e84a1c', '#7a0403'],
  ice: ['#0b1a3a', '#12467b', '#1f7fb5', '#43b5cc', '#8fdcdf', '#e8fbfa'],
  ember: ['#1a0b0b', '#5c1a10', '#a63a1a', '#d97a2b', '#f0c060', '#fff3cf'],
  mono: ['#1c1f26', '#3a4250', '#5b6675', '#8592a3', '#b8c2cf', '#f0f4f8'],
};

export function sampleRamp(name: string, t: number): string {
  const ramp = RAMPS[name] ?? RAMPS.viridis;
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  if (i >= ramp.length - 1) return ramp[ramp.length - 1];
  return mix(ramp[i], ramp[i + 1], f);
}

/** Debounce for resize / input handlers. */
export function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: number | undefined;
  return ((...args: never[]) => {
    if (t) clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  }) as T;
}

/** Truncate text to fit a pixel width using the canvas context metrics. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 1 ? text.slice(0, lo) + '…' : '';
}

export function download(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
