// Game settings on the client (M16): applied at once, remembered in this browser, and saved to
// the account shortly after a change (the server validates them). Mirrors the M10 audio settings.
import { cleanGameSettings, defaultGameSettings, type GameSettings } from '../../shared/src/settings';

const LS_KEY = 'aetherion.game';
type Listener = () => void;

class SettingsStore {
  private s: GameSettings;
  private token = '';
  private dirty = false;
  private timer = 0;
  private subs = new Set<Listener>();
  constructor() {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null');
    } catch { /* storage unavailable */ }
    this.s = raw ? cleanGameSettings(raw) : { ...defaultGameSettings(), lang: guessLang() };
    this.apply();
  }
  subscribe = (f: Listener) => {
    this.subs.add(f);
    return () => void this.subs.delete(f);
  };
  get = (): GameSettings => this.s;
  /** Changes settings. Nested sections are replaced whole, so pass the full section. */
  set(patch: Partial<GameSettings>) {
    this.s = cleanGameSettings({ ...this.s, ...patch });
    this.apply();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.s));
    } catch { /* ignore */ }
    for (const f of this.subs) f();
    if (!this.token) return;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 600);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (!this.dirty || !this.token) return Promise.resolve();
    this.dirty = false;
    return fetch('/api/settings', {
      method: 'PUT', keepalive: true,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
      body: JSON.stringify({ game: this.s }),
    }).then((r) => void (r.ok || r.status === 401 || (this.dirty = true)), () => void (this.dirty = true));
  }
  /** Signing in: the account's saved settings win; an account that never saved any takes this browser's. */
  async setAccount(token: string) {
    if (token === this.token) return;
    if (!token) await this.flush();
    this.token = token;
    if (!token) return;
    try {
      const r = await fetch('/api/settings', { headers: { authorization: 'Bearer ' + token } });
      if (!r.ok || this.token !== token) return;
      const body = await r.json();
      if (body.gameSaved) {
        this.s = cleanGameSettings(body.game);
        this.apply();
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(this.s));
        } catch { /* ignore */ }
        for (const f of this.subs) f();
      } else {
        this.dirty = true;
        await this.flush();
      }
    } catch { /* offline: local settings stay in force */ }
  }
  /** Things the page itself reflects: the interface scale and the document language. */
  private watching = false;
  private apply() {
    if (typeof document === 'undefined') return;
    // Responsive interface: the HUD is laid out for 1280x720 (or 720x1100 upright) and shrinks to fit
    // smaller screens; windows shrink less, so their text stays readable, and fill a small screen.
    const touch = touchActive(this.s), W = window.innerWidth, H = window.innerHeight, upright = H > W;
    const r05 = (v: number) => Math.round(v * 20) / 20;
    // smaller than the design: shrink to fit (not below 0.62); larger: grow at half the rate, up to 1.4
    const fit = upright ? Math.min(W / 720, H / 1100) : Math.min(W / 1280, H / 720);
    const hud = fit >= 1 ? Math.min(1.4, r05(1 + (fit - 1) / 2)) : Math.max(0.62, r05(fit));
    const short = Math.min(W, H), win = Math.max(hud, short < 420 || (!upright && H < 480) ? 0.85 : short < 700 ? 0.9 : 1);
    document.documentElement.classList.toggle('touch', touch);
    document.documentElement.classList.toggle('portrait', upright);
    document.documentElement.style.setProperty('--ui', String(Math.round(this.s.uiScale * hud * 100) / 100));
    document.documentElement.style.setProperty('--uiw', String(Math.round(this.s.uiScale * win * 100) / 100));
    document.documentElement.classList.toggle('phone', short < 540);
    if (!this.watching) {
      this.watching = true;
      window.addEventListener('resize', () => this.apply());
      try { matchMedia('(pointer: coarse)').addEventListener('change', () => { this.apply(); for (const f of this.subs) f(); }); } catch { /* old browsers */ }
    }
    document.documentElement.lang = this.s.lang;
    // U6: colour correction (an SVG filter on the game and its interface), contrast and motion
    const a = this.s.access, root = document.documentElement;
    installColorFilters();
    root.dataset.cb = a.colorblind;
    root.classList.toggle('hc', a.contrast);
    root.classList.toggle('rm', a.reduceMotion);
  }
}
/**
 * U6: colour-blind correction filters (daltonisation). The confusable colours are simulated (Machado
 * et al. 2009, full severity), and the difference that is lost is shifted into channels the eye still
 * reads; the result is one 3x3 matrix per kind, applied by an SVG filter.
 */
const SIM: Record<string, number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
const SHIFT: Record<string, number[]> = { protan: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1], deutan: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1], tritan: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0] };
export function correctionMatrix(kind: string): number[] {
  const S = SIM[kind], M = SHIFT[kind], I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const E = I.map((v, i) => v - S[i]); // what is lost
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let v = I[r * 3 + c];
    for (let k = 0; k < 3; k++) v += M[r * 3 + k] * E[k * 3 + c];
    out.push(Math.round(v * 10000) / 10000);
  }
  return out;
}
function installColorFilters() {
  if (document.getElementById('cb-filters')) return;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.id = 'cb-filters';
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position:absolute;width:0;height:0');
  for (const kind of ['protan', 'deutan', 'tritan']) {
    const m = correctionMatrix(kind), f = document.createElementNS(ns, 'filter'), cm = document.createElementNS(ns, 'feColorMatrix');
    f.id = 'cb-' + kind;
    f.setAttribute('color-interpolation-filters', 'linearRGB');
    cm.setAttribute('type', 'matrix');
    cm.setAttribute('values', `${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0`);
    f.appendChild(cm);
    svg.appendChild(f);
  }
  document.body.appendChild(svg);
}
/** U3: whether the on-screen touch controls and the phone layout are in use. */
export function touchActive(s: GameSettings): boolean {
  if (s.touch !== 'auto') return s.touch === 'on';
  try { return matchMedia('(pointer: coarse)').matches; } catch { return false; }
}
function guessLang(): GameSettings['lang'] {
  return typeof navigator !== 'undefined' && /^id\b/i.test(navigator.language ?? '') ? 'id' : 'en';
}
export const settings = new SettingsStore();
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void settings.flush());

/** Fullscreen is the browser's state, not a saved setting. */
export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

/**
 * Whether a key press may trigger a game shortcut. Never while typing (a text field, a text area,
 * a list box, editable text, an input method composing a word), never with Ctrl, Alt or the
 * system key held (copy, paste and browser shortcuts), and never for the key that presses a
 * focused button. Escape is always allowed so every panel can be closed.
 */
export function shortcutAllowed(e: KeyboardEvent): boolean {
  if (e.code === 'Escape') return true;
  if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return false;
  const el = (document.activeElement ?? e.target) as HTMLElement | null;
  if (!el || el === document.body) return true;
  if (el.dataset?.capture || el.isContentEditable) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (tag === 'INPUT') return ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color'].includes((el as HTMLInputElement).type) && e.code !== 'Space';
  if ((tag === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'tab') && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) return false;
  return true;
}
