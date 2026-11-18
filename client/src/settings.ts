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
  private apply() {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--ui', String(this.s.uiScale));
    document.documentElement.lang = this.s.lang;
  }
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
