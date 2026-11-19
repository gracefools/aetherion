// Appearance schema v2: every customisable option is an index into a fixed option list.
// The server validates with parseAppearance(); the client renders from the same tables.
import { JOB_DEFS } from './jobs';
import type { Job } from './protocol';

/** field -> number of options. Order here is the order of the creator UI. */
export const AP_LIMITS = {
  body: 2, build: 3, height: 3, skin: 8,
  face: 5, eyes: 4, eyeColor: 8,
  hair: 8, hairColor: 10,
  clothing: 4, color1: 12, color2: 12,
  armor: 4, armorColor: 12,
  helmet: 6, helmetColor: 12,
  weapon: 2,
  cape: 3, capeColor: 12,
  accessory: 5, accessoryColor: 12,
  aura: 5,
} as const;
export type ApField = keyof typeof AP_LIMITS;
export const AP_FIELDS = Object.keys(AP_LIMITS) as ApField[];
/**
 * `gt` and `gw` are not chosen by the player: the server sets them from the equipped armour and
 * weapon (gearTier in items.ts, 0 to 5) so better gear looks grander. Absent means 0.
 */
export type Appearance = { v: 2; gt?: number; gw?: number } & Record<ApField, number>;

export const AP_LABELS: Partial<Record<ApField, string[]>> = {
  body: ['Masculine', 'Feminine'],
  build: ['Slim', 'Average', 'Broad'],
  height: ['Short', 'Average', 'Tall'],
  face: ['Plain', 'Freckles', 'Scar', 'Beard', 'Blush'],
  eyes: ['Round', 'Narrow', 'Wide', 'Calm'],
  hair: ['Short', 'Long', 'Fringe', 'Topknot', 'Bald', 'Ponytail', 'Spiky', 'Bob'],
  clothing: ['Tunic', 'Robe', 'Vest', 'Long coat'],
  armor: ['None', 'Leather', 'Chain', 'Plate'],
  helmet: ['None', 'Cap', 'Hood', 'Helm', 'Circlet', 'Pointed hat'],
  cape: ['None', 'Short', 'Long'],
  accessory: ['None', 'Scarf', 'Glasses', 'Earring', 'Amulet'],
  aura: ['None', 'Sparkle', 'Ember', 'Frost', 'Shadow'],
};

const JOB_LOOK: Record<Job, Partial<Record<ApField, number>>> = {
  knight: { build: 2, clothing: 0, color1: 1, color2: 6, armor: 3, armorColor: 6, helmet: 3, helmetColor: 6, cape: 1, capeColor: 0 },
  mage: { build: 0, clothing: 1, color1: 3, color2: 4, helmet: 5, helmetColor: 3, hair: 1, hairColor: 4 },
  ranger: { clothing: 2, color1: 2, color2: 8, armor: 1, armorColor: 8, helmet: 2, helmetColor: 2, cape: 1, capeColor: 2 },
  assassin: { build: 0, clothing: 2, color1: 6, color2: 9, armor: 1, armorColor: 9, helmet: 2, helmetColor: 9, accessory: 1, accessoryColor: 0 },
  cleric: { clothing: 1, color1: 7, color2: 4, helmet: 4, helmetColor: 4, accessory: 4, accessoryColor: 4, hair: 7, hairColor: 3 },
  berserker: { build: 2, height: 2, clothing: 2, color1: 0, color2: 8, armor: 1, armorColor: 8, face: 3, hair: 6, hairColor: 5 },
};

export function defaultAppearance(job: Job): Appearance {
  const ap = { v: 2 } as Appearance;
  for (const f of AP_FIELDS) ap[f] = 0;
  Object.assign(ap, { build: 1, height: 1, skin: 1, hairColor: 1, eyeColor: 1 }, JOB_LOOK[job]);
  return ap;
}

/** Strict validation of untrusted input. Returns a clean object or an error string. */
export function parseAppearance(input: unknown, job: Job): Appearance | string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Appearance must be an object';
  const src = input as Record<string, unknown>;
  for (const k of Object.keys(src)) if (k !== 'v' && !(k in AP_LIMITS)) return `Unknown appearance field "${k.slice(0, 20)}"`;
  const ap = { v: 2 } as Appearance;
  for (const f of AP_FIELDS) {
    const v = src[f];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= AP_LIMITS[f]) return `Invalid appearance value for "${f}"`;
    ap[f] = v as number;
  }
  if (!JOB_DEFS[job].weapons[ap.weapon]) return 'Weapon not available for this job';
  return ap;
}

export function randomAppearance(job: Job, rnd: () => number = Math.random): Appearance {
  const ap = { v: 2 } as Appearance;
  for (const f of AP_FIELDS) ap[f] = Math.floor(rnd() * AP_LIMITS[f]);
  if (rnd() < 0.6) ap.aura = 0;
  return ap;
}

/** Stable cache key for sprite sheets. */
export const appearanceKey = (ap: Appearance, job: Job) => job + ':' + AP_FIELDS.map((f) => ap[f]).join('.') + ':' + (ap.gt ?? 0) + (ap.gw ?? 0);

// ---- animation sheet layout (shared so tests and the asset pipeline agree with the renderer) ----
export const ANIMS = {
  idle: { frames: 2, ms: 480, loop: true },
  walk: { frames: 4, ms: 130, loop: true },
  run: { frames: 4, ms: 95, loop: true },
  attack: { frames: 4, ms: 85, loop: false },
  cast: { frames: 4, ms: 120, loop: false },
  hit: { frames: 2, ms: 110, loop: false },
  death: { frames: 4, ms: 160, loop: false },
} as const;
export type Anim = keyof typeof ANIMS;
export const ANIM_NAMES = Object.keys(ANIMS) as Anim[];
export const ANIM_COL: Record<Anim, number> = (() => {
  const out = {} as Record<Anim, number>;
  let c = 0;
  for (const a of ANIM_NAMES) {
    out[a] = c;
    c += ANIMS[a].frames;
  }
  return out;
})();
export const SHEET_COLS = ANIM_NAMES.reduce((n, a) => n + ANIMS[a].frames, 0);
export const FRAME_W = 48;
export const FRAME_H = 48;
export const animDuration = (a: Anim) => ANIMS[a].frames * ANIMS[a].ms;
/** Sheet column for an animation at `t` ms since it started. One-shots hold their last frame. */
export function animFrame(a: Anim, t: number): number {
  const d = ANIMS[a];
  const f = Math.floor(t / d.ms);
  return ANIM_COL[a] + (d.loop ? f % d.frames : Math.min(d.frames - 1, f));
}
