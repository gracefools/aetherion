// Game client: fixed-step prediction, server reconciliation, remote interpolation, combat feedback
// and the canvas renderer. Deliberately independent of React; the HUD subscribes to `hud` snapshots.
import type { FriendView } from '../../../shared/src/friends';
import {
  Act, Move, TICK_MS, TILE,
  type ChatChannel, type EntityMeta, type LootMode, type PartyState, type PlayerMeta, type SelfState, type ServerMsg, type SnapMsg, type WelcomeMsg,
} from '../../../shared/src/protocol';
import { ABILITIES, ABILITY_LIST, freePoints, GCD_MS, jobActives, runeSpells, type AbilityDef, type Build } from '../../../shared/src/abilities';
import { ANIM_COL, animDuration, animFrame, FRAME_H, FRAME_W, type Anim, type Appearance } from '../../../shared/src/appearance';
import { Dmg, STATUS, STATUS_INDEX, statusNames } from '../../../shared/src/combat';
import { ITEMS, POTION_CD_MS, RARITIES, SHOP_RANGE, type Equipment, type Item } from '../../../shared/src/items';
import { JOB_DEFS, type Stats } from '../../../shared/src/jobs';
import { MONSTERS, phaseAt } from '../../../shared/src/monsters';
import type { DungeonState } from '../../../shared/src/dungeons';
import { INTERACT_RANGE, isNpc, NODE_RESPAWN_MS, objNear, zoneObjects, type WorldObj } from '../../../shared/src/places';
import { propSprite } from './props';
import { gateNear, getZoneMap, START_ZONE, stepMove, stepSize, tileAt, tileCenter, ZONES, type ZoneMap } from '../../../shared/src/world';
import { BOSS_MUSIC_RANGE } from '../../../shared/src/audio';
import { navOf } from '../../../shared/src/nav';
import { DEFAULT_AUTO, emptyAutoStats, withSkills, type AutoConfig, type AutoStats } from '../../../shared/src/autohunt';
import { INVENTORY_SIZE } from '../../../shared/src/items';
import type { Job, SortKey, TradeState } from '../../../shared/src/protocol';
import { AutoHunter } from './autohunt';
import { acceptBlock, DEFAULT_FACTIONS, emptyQuests, giverId, QUEST_LIST, QUESTS, type FactionDef, type QuestState } from '../../../shared/src/quests';
import { emptyCompanions, type Companions, isFlying, MOUNTS, petStage } from '../../../shared/src/companions';
import { emptyBank, type AuctionRates, type Bank, type GuildView, type Listing } from '../../../shared/src/economy';
import { inTown, pvpBlock, pvpRuleAt } from '../../../shared/src/pvp';
import type { BountyMark, DepthBossState } from '../../../shared/src/depths';
import { drawWeaponGlow, mountSprite, MOUNT_W, MOUNT_H, PET_W, petSprite } from './companions';
import { ARMAMENT_LEVEL, emptyGear, sigilRanks, WEAPON_AURA_COLORS, weaponAura, type Gear } from '../../../shared/src/gear';
import { actionFor, keyLabel, type Action, type TutorialStep } from '../../../shared/src/settings';
import { ACHIEVEMENT_INDEX, emptyJournal, type Journal } from '../../../shared/src/journal';
import type { WorldEventState } from '../../../shared/src/events';
import type { RiftScore } from '../../../shared/src/rift';
import type { RaidLobby, RaidState, SiegeState, TerritoryState } from '../../../shared/src/conquest';
import { AURA_SKINS, FURNITURE, GROW_MS, type Life } from '../../../shared/src/life';
import { emptyAscension, PATH_INDEX, type Ascension } from '../../../shared/src/ascension';
import { awaken, AWAKEN_LEVEL, fusionsFor } from '../../../shared/src/awakening';
import { Sky } from './sky';
import type { MailEntry } from '../../../shared/src/mail';
const titleName = (id: string) => ACHIEVEMENT_INDEX[id]?.title?.name ?? '';
import { settings, shortcutAllowed } from '../settings';
import { markTutorial } from '../tutorial';
import { t as tr, tv } from '../i18n';
import { enhance } from '../../../shared/src/subskills';
import { sound } from '../audio/gameSound';
import { buildChunk, CHUNK, CHUNK_PX, miniColors } from './art';
import { buildChunk as buildHDChunk, miniColors as hdMiniColors, type Chunk } from './hdart';
import { getHDSheet, HD, HD_COL, HD_FEET, HD_OX, hdDuration, hdFrame, peekHDSheet, type HdAnim } from './hdchars';
import { drawAura, getCharSheet, NAME_OY, SPRITE_OX, SPRITE_OY } from './chars';
import { drawFx, drawHit, fxDuration, screenFx, type Fx } from './fx';
import { blastImpact, drawBlastAir, drawBlastGround, drawCastCircle, drawFxAir, drawFxGround, drawMonsterWarning, type Blast } from './fx25d';
/** The colour of each class's spell circles. */
const CAST_COLOR: Record<string, string> = { knight: '#ffd36a', mage: '#7fc8ff', ranger: '#8fe07a', assassin: '#c08aff', cleric: '#fff0a8', berserker: '#ff7a4a' };
import { getMonsterSheet, hasMonsterSheet, HD_M_FRAME, M_FRAME, mAnimDuration, mAnimFrame, monsterHeight, monsterScale, type MAnim } from './monsters';
import { HD_MOUNT_H, HD_MOUNT_W, hdMountSprite, hdPetSprite } from './hdcomp';
import { Stage3D, stageSupported } from './stage3d';
import { darkness } from '../../../shared/src/events';
import { buildBuildings } from './buildings3d';

export interface ChatLine {
  id: number;
  from?: string;
  text: string;
  ch?: ChatChannel;
  to?: string;
}
export interface TargetInfo {
  id: number;
  name: string;
  level: number;
  hp: number;
  mhp: number;
  elite: boolean;
  statuses: string[];
  /** A player (PvP), not a monster. */
  player?: boolean;
  /** A monster of an open-PvP area. */
  fierce?: boolean;
}
export interface Hud {
  status: 'connecting' | 'playing' | 'reconnecting' | 'kicked';
  reason: string;
  zone: string;
  channel: number;
  ping: number;
  fps: number;
  nearby: number;
  chat: ChatLine[];
  self: PlayerMeta | null;
  stats: Stats | null;
  hp: number;
  res: number;
  exp: number;
  next: number;
  statuses: string[];
  target: TargetInfo | null;
  attacking: boolean;
  /** Seconds until automatic respawn; 0 when alive. */
  dead: number;
  canRespawn: boolean;
  toast: string;
  build: Build | null;
  points: number;
  /** Ability id -> [local start time, duration ms] of its running cooldown. */
  cds: Record<string, [number, number]>;
  cast: { name: string; at: number; ms: number } | null;
  ally: { id: number; name: string; hp: number; mhp: number } | null;
  notice: string;
  party: PartyState | null;
  invite: { from: string; id: number; until: number } | null;
  inv: Item[];
  eq: Equipment;
  gold: number;
  /** Local time the potion cooldown started (0 = ready). */
  potionAt: number;
  /** True while standing close enough to a shop to trade. */
  shop: boolean;
  loot: LootLine[];
  /** Zone-wide announcement shown as a banner (boss phases, dungeon stages). */
  banner: { text: string; id: number } | null;
  /** The boss in view, for the boss bar. */
  boss: { name: string; title: string; hp: number; mhp: number; phase: number; phases: number; phaseName: string; level: number } | null;
  dungeon: DungeonState | null;
  /** Id of the dungeon whose entrance the player is standing at. */
  gate: string | null;
  level: [number, number];
  /** The object in reach, for the interaction hint. */
  near: { id: string; kind: string; name: string; hint: string } | null;
  /** Id of the NPC the player is talking to. */
  talk: string | null;
  /** Waystones attuned and caches opened. */
  disc: string[];
  zoneId: string;
  /** Auto hunting: whether it is running, what it is doing, its configuration and the session's figures. */
  auto: { on: boolean; status: string; target: string; cfg: AutoConfig; stats: AutoStats };
  /** The trade in progress, if any, and a pending trade request. */
  trade: TradeState | null;
  tradeInvite: { from: string; id: number; until: number } | null;
  /** Quests (M13): state, progress per active quest, reputation, the factions in force. */
  quests: QuestState;
  journal: Journal;
  /** The world event running now. */
  wevent: WorldEventState | null;
  asc: Ascension;
  life: Life | null;
  home: { owner: string; mine: boolean; furn: { base: string; tx: number; ty: number }[]; garden: ({ seed: string; at: number } | null)[] } | null;
  territory: { held: TerritoryState[]; factions: Record<string, string> };
  siege: SiegeState | null;
  raidLobbies: RaidLobby[] | null;
  raid: RaidState | null;
  ult: number;
  combo: { i: number; at: number };
  rift: { floor: number; left: number; time: number; state: 'break' | 'fight' | 'over'; best: number } | null;
  riftTop: RiftScore[] | null;
  mail: MailEntry[] | null;
  mailUnread: number;
  friends: FriendView[];
  qprog: Record<string, number[]>;
  rep: Record<string, number>;
  factions: FactionDef[];
  /** M14: guild, its invitation, the bank, the auction house as last searched, histories. */
  guild: GuildView | null;
  grank: number;
  ginv: { guild: string; tag: string; from: string; until: number } | null;
  bank: Bank;
  ah: { list: Listing[]; total: number; page: number; claims: { gold: number; items: number }; rates: AuctionRates } | null;
  ahhist: { id: number; base: string; rar: number; qty: number; price: number; status: string; sold: boolean; other: string; at: number }[];
  banklog: { at: number; op: string; detail: any }[];
  /** M15: pets and mounts, the duel in progress and a pending challenge, rankings, arena, the PvP rule where one stands. */
  comp: Companions;
  duel: { with: string; id: number; starts: number; ends: number } | null;
  dinv: { from: string; id: number; until: number } | null;
  /** A dungeon ready check: who asked, which dungeon, who agreed and who has not yet. */
  dready: { id: string; diff: string; from: string; until: number; ok: string[]; wait: string[] } | null;
  pvprank: { rows: any[]; me: any } | null;
  arena: boolean;
  pvpZone: 'safe' | 'duel' | 'open' | 'town' | 'arena';
  /** The warning before entering the Depths, waiting for an answer. */
  depthAsk: { zone: string; level: number } | null;
  depthBosses: DepthBossState[];
  bounty: BountyMark[];
  /** Armament levels and equipped sigils. */
  gear: Gear;
}
export interface LootLine {
  id: number;
  text: string;
  rar: number;
  until: number;
}

interface Remote {
  meta: EntityMeta;
  mt: string; // monster type, '' for players
  sheet: HTMLCanvasElement;
  buf: number[]; // interpolation samples: packed [t, x, y]
  d: number;
  m: number;
  rx: number;
  ry: number;
  act: string | null;
  actAt: number;
  hp: number;
  mhp: number;
  st: number;
  hitAt: number;
  deadAt: number;
  castUntil: number;
  /** Local time of this player's next audible footstep. */
  stepAt: number;
}
interface Drawable {
  /** The weapon glow colour worn (wardrobe). */
  wk?: string;
  /** The pet's evolution stage (0-3): drawn larger and glowing. */
  petStage?: number;
  /** Riding a flying mount: drawn higher, with its shadow below. */
  flying?: boolean;
  /** A title worn by a player, drawn above the name. */
  title?: string;
  /** Quest marker (U5): '!' quests on offer, '?' a quest to hand in, 'mob' a monster a quest still needs. */
  mark?: string;
  y: number;
  x: number;
  sheet: HTMLCanvasElement;
  sx: number; // source rect
  sy: number;
  sw: number;
  ox: number; // anchor
  oy: number;
  aura: number;
  alpha: number;
  id: number;
  label: string;
  labelY: number;
  color: string;
  bar: number; // hp fraction, <0 = hidden
  barW: number;
  /** Companions drawn with the character (players only). */
  pet: HTMLCanvasElement | null;
  mount: HTMLCanvasElement | null;
  flip: boolean;
  /** Weapon glow from the weapon armament: 0 none, 1 white, 2 blue, 3 ember. */
  wa: number;
}
interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  big: boolean;
  t0: number;
  /** How it is drawn (size, colour, motion); see FLOAT_STYLE. */
  kind?: FloatKind;
  /** Vertical offset so numbers popping at the same moment stack instead of overlapping. */
  lift?: number;
}
/** Combat and reward text kinds: each with its own size, colour and life, so a player tells them apart at a glance. */
type FloatKind = 'dealt' | 'crit' | 'taken' | 'other' | 'heal' | 'exp' | 'gold' | 'miss' | 'info';
const FLOAT_STYLE: Record<FloatKind, { px: number; color: string; life: number; rise: number; pop: number; damage: boolean }> = {
  dealt: { px: 19, color: '#fff3c4', life: 1000, rise: 40, pop: 1.5, damage: true },
  crit: { px: 28, color: '#ffa61f', life: 1300, rise: 48, pop: 1.9, damage: true },
  taken: { px: 21, color: '#ff4a3a', life: 1100, rise: 42, pop: 1.5, damage: true },
  other: { px: 13, color: '#e8e4dc', life: 800, rise: 30, pop: 1, damage: true },
  heal: { px: 21, color: '#5dff7a', life: 1200, rise: 44, pop: 1.5, damage: false },
  exp: { px: 18, color: '#d29bff', life: 1400, rise: 50, pop: 1.4, damage: false },
  gold: { px: 17, color: '#ffd24a', life: 1300, rise: 46, pop: 1.4, damage: false },
  miss: { px: 15, color: '#c0c4d0', life: 800, rise: 28, pop: 1.2, damage: true },
  info: { px: 22, color: '#ffe08a', life: 1600, rise: 40, pop: 1.6, damage: false },
};

const INTERP_DELAY = 100;
/** Movement actions and their direction. The keys themselves come from the player's bindings (M16). */
const MOVES: Partial<Record<Action, [number, number]>> = { 'move.up': [0, -1], 'move.down': [0, 1], 'move.left': [-1, 0], 'move.right': [1, 0] };
/** The label of the first key bound to an action, for hotbars and hints. */
export const keyOf = (a: Action) => keyLabel(settings.get().keys[a][0] ?? '');
export const runeKey = (slot: number, i: number) => keyOf(`rune.${slot + 1}.${i + 1}` as Action);
const STEALTH_BIT = 1 << STATUS_INDEX.stealth;
const rangedCache = new Map<string, boolean>();
/** Whether a monster type throws projectiles (in any boss phase). */
function isRanged(mt: string) {
  let v = rangedCache.get(mt);
  if (v === undefined) {
    const d = MONSTERS[mt];
    v = !!d && (d.boss ? d.boss.phases.flatMap((p) => p.pattern) : d.pattern).some((a) => a.ranged);
    rangedCache.set(mt, v);
  }
  return v;
}
const PROJ: Record<string, string> = { mage: '#7fd6ff', cleric: '#ffe89a', ranger: '#e9e3d0', spider: '#9be06a' };

export class Game {
  hud: Hud = {
    status: 'connecting', reason: '', zone: '', channel: 1, ping: 0, fps: 0, nearby: 0, chat: [], self: null, stats: null,
    hp: 0, res: 0, exp: 0, next: 1, statuses: [], target: null, attacking: false, dead: 0, canRespawn: false, toast: '',
    build: null, points: 0, cds: {}, cast: null, ally: null, notice: '', party: null, invite: null,
    inv: [], eq: {}, gold: 0, potionAt: 0, shop: false, loot: [], banner: null, boss: null, dungeon: null, gate: null, level: [1, 1], near: null, talk: null, disc: [], zoneId: '',
    auto: { on: false, status: 'Stopped', target: '', cfg: DEFAULT_AUTO, stats: emptyAutoStats() }, trade: null, tradeInvite: null,
    quests: emptyQuests(), journal: emptyJournal(), friends: [], wevent: null, rift: null, riftTop: null, asc: emptyAscension(), life: null, home: null, territory: { held: [], factions: {} }, siege: null, raidLobbies: null, raid: null, ult: 0, combo: { i: 0, at: 0 }, mail: null, mailUnread: 0, qprog: {}, rep: {}, factions: DEFAULT_FACTIONS,
    guild: null, grank: 3, ginv: null, bank: emptyBank(), ah: null, ahhist: [], banklog: [],
    comp: emptyCompanions(), duel: null, dinv: null, dready: null, pvprank: null, arena: false, pvpZone: 'safe', depthAsk: null, depthBosses: [], bounty: [], gear: emptyGear(),
  };
  private objs: WorldObj[] = [];
  /** Gathered nodes: object id -> local time it is ready again. */
  private nodeCd = new Map<string, number>();
  private bannerId = 0;
  private bannerUntil = 0;
  private bossAt = 0;
  private lootId = 0;
  private subs = new Set<() => void>();
  private ws: WebSocket | null = null;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private dead = false;
  private retry = 0;
  private retryTimer = 0;

  private map: ZoneMap | null = null;
  private me: PlayerMeta | null = null;
  private sheet: HTMLCanvasElement | null = null;
  /** Whether the cached terrain chunks were built by the HD renderer. */
  private chunksHD = false;
  /** False while terrain chunks or sprite sheets are still being built for what is on screen. */
  private warm = false;
  private cur = { x: 0, y: 0 };
  private prev = { x: 0, y: 0 };
  private off = { x: 0, y: 0 };
  private dir = 0;
  private moving: number = Move.Idle;
  private walkHeld = false;
  private unsubSettings = () => {};
  private act: Anim | null = null;
  private actAt = 0;
  private actReady = [0, 0];
  private seq = 0;
  private pending: number[] = []; // packed [seq, ix, iy, step]
  private remotes = new Map<number, Remote>();
  private keys = new Set<string>();
  private acc = 0;
  private last = 0;
  private timeOffset: number | null = null;
  readonly sky = new Sky();
  private chunks = new Map<number, Chunk>();
  private drawList: Drawable[] = [];
  private pool: Drawable[] = [];
  private floaters: Floater[] = [];
  private telegraphs: { x: number; y: number; r: number; t0: number; ms: number; friendly: boolean; inner: number; tier: number; color: string; blast: boolean }[] = [];
  private blasts: Blast[] = [];
  private shots: { x: number; y: number; to: number; t0: number; color: string }[] = [];
  private frames = 0;
  private fpsAt = 0;
  private pingAt = 0;
  private chatId = 0;
  private zoom = 1;
  private camX = 0;
  private camY = 0;
  private mini: HTMLCanvasElement | null = null;
  private miniBase: HTMLCanvasElement | null = null;
  private miniAt = 0;
  // combat state mirrored from the server
  private hp = 0;
  private statusUntil: [number, number][] = []; // [status index, local time it ends]
  private moveMul = 1;
  private stunned = false;
  private isDead = false;
  private deadAuto = 0; // local time of the automatic respawn
  private diedAt = 0;
  private selfHitAt = 0;
  private targetId = 0;
  private toastUntil = 0;
  private friendId = 0;
  private fx: Fx[] = [];
  /** Sparks where blows land: packed [x, y, t0, crit, colour index]. */
  private hits: number[] = [];
  private cdReady = new Map<string, number>();
  private gcdUntil = 0;
  private castUntil = 0;
  private noticeUntil = 0;
  private stealthed = false;
  /** The auto hunter: it sees the world through this object and acts through the same commands the keyboard does. */
  private hunter = new AutoHunter({
    pos: () => this.cur,
    map: () => this.map!,
    playing: () => this.hud.status === 'playing' && !!this.map && !!this.me,
    dead: () => this.isDead,
    hp: () => this.hud.hp,
    maxHp: () => this.hud.stats?.maxHp ?? 1,
    res: () => this.hud.res,
    maxRes: () => this.hud.stats?.maxRes ?? 1,
    range: () => this.hud.stats?.range ?? 30,
    monsters: () => {
      const out = [];
      for (const r of this.remotes.values()) if (r.mt && r.hp > 0) out.push({ id: r.meta.id, type: r.mt, x: r.rx, y: r.ry, hp: r.hp, mhp: r.mhp });
      return out;
    },
    targetId: () => this.targetId,
    setTarget: (id) => this.setTarget(id),
    attacking: () => this.hud.attacking,
    attack: () => this.sendMsg({ t: 'act', k: Act.Attack }),
    abilityReady: (id) => this.abilityReady(id),
    abilityCost: (id) => this.abilityCost(id),
    useAbility: (id) => this.useAbility(id, true),
    potions: (base) => this.hud.inv.reduce((n, i) => n + (i.base === base ? i.qty : 0), 0),
    potionReady: () => !this.hud.potionAt || performance.now() - this.hud.potionAt >= POTION_CD_MS,
    quaff: (base) => this.quaff(base),
    usesMana: () => !!this.me && JOB_DEFS[this.me.job].resource !== 'rage',
    bagFull: () => this.hud.inv.length >= INVENTORY_SIZE,
    notify: (text) => this.pushChat({ text }),
  });
  private autoSave = 0;
  // developer overlay (only when the server allows it)
  private dev = false;
  private dbgOn = false;
  private dbgMobs: (number | string)[][] = [];
  // exposed for automated browser tests
  stats = { snaps: 0, corrections: 0, maxCorrection: 0, dmgSeen: 0 };

  constructor(private canvas: HTMLCanvasElement, private token: string, private characterId: number) {
    this.ctx = canvas.getContext('2d')!; // transparent: with style B the WebGL world shows through
    screenFx.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------- store ----------
  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  };
  getHud = () => this.hud;
  private setHud(patch: Partial<Hud>) {
    this.hud = { ...this.hud, ...patch };
    for (const s of this.subs) s();
  }
  private pushChat(line: Omit<ChatLine, 'id'>) {
    this.setHud({ chat: [...this.hud.chat.slice(-79), { ...line, id: ++this.chatId }] });
  }

  // ---------- lifecycle ----------
  start(minimap: HTMLCanvasElement | null) {
    this.mini = minimap;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('mousedown', this.onClick);
    this.unsubSettings = settings.subscribe(this.resize); // camera zoom
    this.resize();
    this.connect();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.startBackgroundClock();
  }
  /**
   * Browsers stop painting (requestAnimationFrame) when the tab is hidden or the window is minimised
   * or covered, and throttle ordinary timers. A timer inside a worker keeps ticking, so the
   * simulation (and auto hunting) carries on while the player is in another application.
   */
  private bgWorker: Worker | null = null;
  private rafAt = 0;
  private startBackgroundClock() {
    try {
      this.bgWorker = new Worker('/clock.js');
      this.bgWorker.onmessage = () => {
        const now = performance.now();
        if (!this.dead && now - this.rafAt > 250) this.simulate(now, false);
      };
    } catch {
      // no workers: the game still runs while visible
    }
  }
  destroy() {
    this.dead = true;
    this.stage?.destroy();
    cancelAnimationFrame(this.raf);
    this.bgWorker?.terminate();
    clearTimeout(this.retryTimer);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('mousedown', this.onClick);
    this.unsubSettings();
    this.ws?.close();
    this.subs.clear();
  }
  private onKey = (e: KeyboardEvent) => {
    if (e.type === 'keydown' && !shortcutAllowed(e)) return;
    const act = actionFor(settings.get().keys, e.code);
    if (act === 'walk') {
      if (!settings.get().movement.walkToggle) this.walkHeld = e.type === 'keydown';
      else if (e.type === 'keydown' && !e.repeat) this.walkHeld = !this.walkHeld;
      return;
    }
    if (e.type === 'keydown' && !e.repeat) {
      if (act === 'attack') {
        e.preventDefault();
        return this.doAction();
      }
      if (act === 'target') {
        e.preventDefault();
        return this.cycleTarget();
      }
      if (e.code === 'Escape') {
        this.friendId = 0;
        if (this.hud.ally) this.setHud({ ally: null });
        return this.setTarget(0);
      }
      if (act === 'interact') return this.interact();
      if (e.code === 'F9' && this.dev) {
        e.preventDefault();
        this.dbgOn = !this.dbgOn;
        this.dbgMobs = [];
        return this.sendMsg({ t: 'dbg', on: this.dbgOn });
      }
      if (act === 'fusion.1' || act === 'fusion.2' || act === 'fusion.3') {
        const f = fusionsFor(this.hud.build?.runes.slots ?? [])[Number(act.slice(-1)) - 1];
        if (f) {
          e.preventDefault();
          return this.useAbility(f.id);
        }
      }
      if (act === 'ultimate') {
        const u = PATH_INDEX[this.hud.asc.path]?.ult;
        if (u) {
          e.preventDefault();
          return this.useAbility(u);
        }
      }
      if (act === 'potion.hp') return this.quaff('hp_potion');
      if (act === 'potion.mp') return this.quaff('mana_potion');
      const a = act ? this.abilityForAction(act) : undefined;
      if (a) {
        e.preventDefault();
        return this.useAbility(a.id);
      }
    }
    if (!act || !MOVES[act]) {
      if (e.type === 'keyup') this.keys.delete(e.code);
      return;
    }
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
    this.walkHeld = false;
  };
  private onClick = (e: MouseEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const wx = this.camX + (e.clientX - r.left) / this.zoom, wy = this.camY + (e.clientY - r.top) / this.zoom;
    let best = 0, bd = 1e9;
    for (const m of this.remotes.values()) {
      if (!m.mt || m.hp <= 0) continue;
      const rad = MONSTERS[m.mt].radius * monsterScale(m.mt) + 12;
      const d = Math.hypot(m.rx - wx, m.ry - 6 - wy);
      if (d < rad && d < bd) {
        bd = d;
        best = m.meta.id;
      }
    }
    if (best) {
      if (best === this.targetId) this.doAction(); // clicking the target again attacks it
      else this.setTarget(best);
      return;
    }
    // No monster under the cursor: clicking a player selects them as the ally for heals and shields.
    for (const r of this.remotes.values()) {
      if (r.mt) continue;
      const d = Math.hypot(r.rx - wx, r.ry - 10 - wy);
      if (d < 18 && d < bd) {
        bd = d;
        best = r.meta.id;
      }
    }
    if (best) {
      const r = this.remotes.get(best)!;
      if (r.hp > 0 && this.canAttack(r)) { // a fair opponent: a target, like a monster
        if (best === this.targetId) this.doAction();
        else this.setTarget(best);
        return;
      }
      this.friendId = best;
      this.refreshAlly();
    }
  };
  private resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    // Integer zoom (min 2x) keeps pixels crisp and caps the visible world at 1280x720 (inside the server AOI).
    this.zoom = Math.max(2, Math.ceil(Math.max(w / 1280, h / 720))) + settings.get().camera.zoom;
    this.canvas.width = w;
    this.canvas.height = h;
  };

  // ---------- targeting & actions ----------
  /** When the player last chose a target here: until the server has seen it, its older choice is ignored. */
  private tgtAt = 0;
  setTarget(id: number) {
    this.targetId = id;
    this.tgtAt = performance.now();
    this.sendMsg({ t: 'tgt', id });
    this.refreshTarget();
  }
  private monstersByDistance(): Remote[] {
    const out: Remote[] = [];
    for (const m of this.remotes.values()) if (m.mt && m.hp > 0) out.push(m);
    const { x, y } = this.cur;
    return out.sort((a, b) => Math.hypot(a.rx - x, a.ry - y) - Math.hypot(b.rx - x, b.ry - y));
  }
  cycleTarget() {
    const list = this.monstersByDistance().filter((m) => Math.hypot(m.rx - this.cur.x, m.ry - this.cur.y) < 500);
    if (!list.length) return;
    const i = list.findIndex((m) => m.meta.id === this.targetId);
    this.setTarget(list[(i + 1) % list.length].meta.id);
  }
  /**
   * Attack: with a target (or a monster within reach) the server runs the auto-attack and our swing
   * animation is driven by its damage events. With nothing to hit it is a local free swing.
   */
  doAction() {
    const now = performance.now(), stats = this.hud.stats;
    if (!stats || this.hud.status !== 'playing' || this.isDead || this.stunned) return;
    const reach = stats.range + 70;
    const inReach = this.targetId || this.monstersByDistance().some((m) => Math.hypot(m.rx - this.cur.x, m.ry - this.cur.y) - MONSTERS[m.mt].radius < reach);
    this.sendMsg({ t: 'act', k: Act.Attack });
    this.tut('attack');
    if (inReach || now < this.actReady[0]) return;
    this.actReady[0] = now + stats.atkIntervalMs + TICK_MS;
    this.act = 'attack';
    this.actAt = now;
  }

  // ---------- abilities ----------
  /** Hotbar layout: skill.1-7 the job skills in tree order; rune.S.N spell N of rune slot S (keys are rebindable). */
  abilityForAction(act: Action): AbilityDef | undefined {
    const me = this.me, build = this.hud.build;
    if (!me || !build) return undefined;
    const d = /^skill\.([1-7])$/.exec(act);
    if (d) return jobActives(me.job)[Number(d[1]) - 1];
    const r = /^rune\.([1-3])\.([1-3])$/.exec(act);
    const el = r ? build.runes.slots[Number(r[1]) - 1] : null;
    return r && el ? runeSpells(el)[Number(r[2]) - 1] : undefined;
  }
  /** Where the player is (world units) and in which zone: for the world map. */
  pos(): { zone: string; x: number; y: number } {
    return { zone: this.map?.def.id ?? '', x: this.cur.x, y: this.cur.y };
  }
  /** Marks a tutorial step done (it is a no-op once done). */
  tut(step: TutorialStep) {
    markTutorial(step);
  }
  /** A short line above the hotbar (interface refusals such as a menu that is not open yet). */
  showNotice(text: string) {
    this.notice(text);
  }
  private notice(text: string) {
    this.noticeUntil = performance.now() + 1600;
    if (this.hud.notice !== text) this.setHud({ notice: text });
    sound.refused();
  }
  /** Local pre-checks give instant feedback; the server repeats every check and is the authority. */
  useAbility(id: string, auto = false) {
    const def = this.ability(id), stats = this.hud.stats, build = this.hud.build, me = this.me, now = performance.now();
    if (auto && !this.abilityReady(id)) return;
    if (!def || !stats || !build || !me || this.hud.status !== 'playing' || this.isDead) return;
    if (def.kind === 'skill' && !(build.skills[id] > 0)) return this.notice('Skill not learned (press K)');
    if (def.kind === 'rune' && (build.runes.lv[def.el!] ?? 0) + stats.runeLevel < def.unlock!) return this.notice(`Requires rune level ${def.unlock}`);
    if (this.stunned) return this.notice('Stunned');
    if (now < this.gcdUntil || now < (this.cdReady.get(id) ?? 0) || this.castUntil > now) return this.notice('Not ready');
    const cost = def.kind === 'rune' ? Math.round(def.cost * stats.runeCost) : def.cost;
    if (this.hud.res < cost) return this.notice(JOB_DEFS[me.job].resource === 'rage' ? 'Not enough rage' : 'Not enough mana');
    let tid = 0;
    if (def.target === 'enemy') {
      tid = this.targetId;
      if (!tid) {
        const near = this.monstersByDistance()[0];
        if (near && Math.hypot(near.rx - this.cur.x, near.ry - this.cur.y) - MONSTERS[near.mt].radius < def.range + 40) tid = near.meta.id;
      }
      if (!tid) return this.notice('No target');
      const r = this.remotes.get(tid);
      if (r && Math.hypot(r.rx - this.cur.x, r.ry - this.cur.y) > def.range + (r.mt ? MONSTERS[r.mt].radius : 10) + 24) return this.notice('Out of range');
      if (tid !== this.targetId) this.setTarget(tid);
    } else if (def.target === 'ally' || def.target === 'deadAlly') {
      tid = this.friendId;
      if (def.target === 'deadAlly' && !(this.remotes.get(tid)?.hp === 0)) return this.notice('Click a fallen ally first');
    }
    this.sendMsg({ t: 'use', a: id, tid });
    this.tut(def.kind === 'rune' ? 'rune' : 'skill');
  }
  /** Learned or unlocked, off cooldown, and nothing else in the way (the hunter asks before every use). */
  abilityReady(id: string): boolean {
    const def = ABILITIES[id], stats = this.hud.stats, build = this.hud.build, now = performance.now();
    if (!def || !stats || !build || this.stunned || this.isDead) return false;
    if (def.kind === 'skill' ? !(build.skills[id] > 0) : (build.runes.lv[def.el!] ?? 0) + stats.runeLevel < def.unlock!) return false;
    return now >= this.gcdUntil && now >= (this.cdReady.get(id) ?? 0) && this.castUntil <= now;
  }
  abilityCost(id: string): number {
    const def = this.ability(id), stats = this.hud.stats;
    return !def || !stats ? Infinity : def.kind === 'rune' ? Math.round(def.cost * stats.runeCost) : def.cost;
  }
  /** Floating text: numbers popping at the same spot within a moment stack upward instead of overlapping. */
  private float(x: number, y: number, text: string, kind: FloatKind, color: string, now: number) {
    let lift = 0;
    for (const o of this.floaters) if (now - o.t0 < 260 && Math.abs(o.x - x) < 26 && Math.abs(o.y - y) < 20) lift = Math.max(lift, (o.lift ?? 0) + FLOAT_STYLE[kind].px + 2);
    this.floaters.push({ x, y, text, color, big: kind === 'crit' || kind === 'info', t0: now, kind, lift });
    if (this.floaters.length > 120) this.floaters.splice(0, this.floaters.length - 120);
  }
  /** Ranks the equipped sigils add to this character's skills and sub-skills. */
  private sigilExtra(): Record<string, number> {
    const me = this.hud.self, b = this.hud.build;
    return me && b ? sigilRanks(me.job, me.level, this.hud.gear, b.skills) : {};
  }
  /** An ability as this character casts it (with its learned sub-skills). */
  ability(id: string): AbilityDef {
    const d = ABILITIES[id] && enhance(ABILITIES[id], this.hud.build, this.sigilExtra());
    return d && d.kind === 'skill' && this.hud.asc.awake.includes(id) && (this.hud.self?.level ?? 0) >= AWAKEN_LEVEL ? awaken(d) : d;
  }

  // ---------- auto hunting ----------
  private setAuto(patch: Partial<Hud['auto']>) {
    this.setHud({ auto: { ...this.hud.auto, ...patch } });
  }
  startAuto() {
    if (this.hud.status !== 'playing' || this.isDead || !this.map || this.hunter.on) return;
    const cfg = this.hud.auto.cfg;
    this.hunter.start(cfg, performance.now());
    this.hunter.onStop = () => {
      // the hunter stopped by itself (bag full, out of potions): the server session ends too
      this.sendMsg({ t: 'auto', on: false });
      this.setAuto({ on: false, status: this.hunter.status, target: '' });
    };
    this.sendMsg({ t: 'auto', on: true, cfg });
    this.tut('auto');
    this.setAuto({ on: true, status: this.hunter.status, stats: emptyAutoStats() });
  }
  /** Stops auto hunting immediately: the Stop button or the hotkey. Moving only steers for a moment. */
  stopAuto(why = 'Stopped') {
    const was = this.hunter.on;
    this.hunter.stop(why);
    this.hunter.cancelReturn();
    if (was) this.sendMsg({ t: 'auto', on: false });
    this.setAuto({ on: false, status: why, target: '' });
  }
  /** Changes the configuration: used at once, and saved to the character by the server. */
  setAutoCfg(cfg: AutoConfig) {
    this.hunter.cfg = cfg;
    this.setAuto({ cfg });
    clearTimeout(this.autoSave);
    this.autoSave = window.setTimeout(() => this.sendMsg({ t: 'auto', on: this.hunter.on, cfg: this.hud.auto.cfg }), 400);
  }
  /** Journal (titles, mission and login rewards) and mail; the server decides. */
  journalOp(op: 'title' | 'claim' | 'login', a: { id?: string; kind?: 'daily' | 'weekly'; i?: number } = {}) {
    this.sendMsg({ t: 'journal', op, ...a });
  }
  ascOp(op: 'path' | 'mastery' | 'mreset' | 'save' | 'load' | 'awaken', a: { id?: string; stat?: string; slot?: number; name?: string } = {}) {
    this.sendMsg({ t: 'asc', op, ...a });
  }
  lifeOp(op: string, a: Record<string, unknown> = {}) {
    this.sendMsg({ t: 'life', op, ...a } as any);
  }
  /** The tile the character stands on (furniture is placed there). */
  homeTile() {
    return { tx: Math.floor(this.cur.x / TILE), ty: Math.floor(this.cur.y / TILE) };
  }
  raidOp(op: 'open' | 'join' | 'leave' | 'start' | 'list', id?: number) {
    this.sendMsg({ t: 'raid', op, id });
  }
  riftOp(op: 'enter' | 'leave' | 'top') {
    this.sendMsg({ t: 'rift', op });
  }
  friendOp(op: 'list' | 'add' | 'accept' | 'decline' | 'remove', a: { id?: number; name?: string } = {}) {
    this.sendMsg({ t: 'friends', op, ...a });
  }
  mailOp(op: 'list' | 'send' | 'claim' | 'read' | 'delete', a: { id?: number; to?: string; subject?: string; body?: string; items?: string[]; gold?: number } = {}) {
    this.sendMsg({ t: 'mail', op, ...a });
  }
  /** Quests and faction shops; the server decides. */
  questOp(op: 'accept' | 'abandon' | 'turnin' | 'shop' | 'talk', a: { id?: string; faction?: string; base?: string; npc?: string } = {}) {
    this.sendMsg({ t: 'quest', op, ...a });
    if (op === 'accept') this.tut('quest');
  }
  /** Guilds (M14); the server checks every permission. */
  guildOp(op: string, a: Record<string, unknown> = {}) {
    if (op === 'accept' || op === 'decline') this.setHud({ ginv: null });
    this.sendMsg({ t: 'guild', op, ...a });
  }
  /** Bank and auction house (M14), at a banker. */
  ecoOp(op: string, a: Record<string, unknown> = {}) {
    this.sendMsg({ t: 'eco', op, ...a });
  }
  /** Duels, the arena and the rankings (M15). */
  private depthQuietUntil = 0;
  /** Answer to the warning at the entrance of the Depths. */
  depthAnswer(enter: boolean) {
    this.setHud({ depthAsk: null });
    if (enter) this.sendMsg({ t: 'depth', op: 'enter' });
    else this.depthQuietUntil = performance.now() + 4000; // time to walk off the portal
  }
  pvpOp(op: 'duel' | 'accept' | 'decline' | 'forfeit' | 'arena' | 'leave' | 'rank', a: { id?: number; by?: string } = {}) {
    if (op === 'accept' || op === 'decline') this.setHud({ dinv: null });
    this.sendMsg({ t: 'pvp', op, ...a });
  }
  /** Pets and mounts (M15). */
  compOp(op: 'summon' | 'dismiss' | 'rename' | 'release' | 'mount' | 'dismount', a: { uid?: string; id?: string; name?: string } = {}) {
    this.sendMsg({ t: 'comp', op, ...a });
  }
  /** Challenges the player with this name, if they are in sight. */
  duelByName(name: string) {
    const r = [...this.remotes.values()].find((x) => !x.mt && x.meta.name.toLowerCase() === name.toLowerCase());
    if (!r) return this.pushChat({ text: `${name} is not nearby.` });
    this.pvpOp('duel', { id: r.meta.id });
  }
  /** Whether the local rules allow attacking this player (the server decides; this only picks what a click means). */
  canAttack(r: { meta: EntityMeta; rx: number; ry: number }): boolean {
    const me = this.me;
    if (!me || !this.map) return false;
    const party = (id: number) => (this.hud.party?.members.some((m) => m.id === id) ? 1 : 0);
    const duel = this.hud.duel && this.hud.duel.starts <= Date.now() ? this.hud.duel.id : 0;
    return pvpBlock(
      { id: me.id, level: me.level, x: this.cur.x, y: this.cur.y, party: party(me.id), shieldUntil: 0, duel, guild: me.gt ?? '' },
      { id: r.meta.id, level: r.meta.level, x: r.rx, y: r.ry, party: party(r.meta.id), shieldUntil: 0, duel: duel === r.meta.id ? me.id : 0, guild: r.meta.gt ?? '' },
      this.map.def.id, this.hud.arena, Date.now(),
    ) === '';
  }
  /** Player-to-player trading; every step is decided by the server. */
  tradeOp(op: 'invite' | 'accept' | 'decline' | 'offer' | 'remove' | 'gold' | 'confirm' | 'unconfirm' | 'cancel', a: { id?: number; name?: string; uid?: string; qty?: number; gold?: number } = {}) {
    if (op === 'accept' || op === 'decline') this.setHud({ tradeInvite: null });
    this.sendMsg({ t: 'trade', op, ...a });
  }

  learn(id: string) {
    this.sendMsg({ t: 'learn', id });
  }
  respec() {
    this.sendMsg({ t: 'respec' });
  }
  attune(slot: number, el: string | null) {
    this.sendMsg({ t: 'rune', slot, el });
  }
  private refreshAlly() {
    const r = this.friendId ? this.remotes.get(this.friendId) : undefined, cur = this.hud.ally;
    if (!r || r.mt) {
      // not on screen: fall back to what the party frame knows
      const pm = this.friendId ? this.hud.party?.members.find((m) => m.id === this.friendId) : undefined;
      if (pm) {
        if (!cur || cur.id !== pm.id || cur.hp !== pm.hp || cur.mhp !== pm.mhp) this.setHud({ ally: { id: pm.id, name: pm.name, hp: pm.hp, mhp: pm.mhp } });
      } else if (cur) this.setHud({ ally: null });
      return;
    }
    if (!cur || cur.id !== r.meta.id || cur.hp !== r.hp || cur.mhp !== r.mhp) this.setHud({ ally: { id: r.meta.id, name: r.meta.name, hp: r.hp, mhp: r.mhp } });
  }
  private setBuild(build: Build) {
    if (this.me) this.setAuto({ cfg: withSkills(this.hud.auto.cfg, this.me.job, build) });
    this.setHud({ build, points: this.me ? freePoints(this.me.level, build) : 0 });
  }
  private onFx(e: number[], now: number) {
    const base = ABILITY_LIST[e[2]];
    if (!base) return;
    const mine = e[0] === this.me!.id, r = this.remotes.get(e[0]);
    // my own skills are drawn and timed as my sub-skills make them (larger areas, shorter cooldowns)
    const def = mine ? enhance(base, this.hud.build, this.sigilExtra()) : base;
    const src = mine ? this.cur : r ? { x: r.rx, y: r.ry } : { x: e[3], y: e[4] };
    const moved = !!def.move;
    this.fx.push({
      def, t0: now + (mine ? 0 : INTERP_DELAY), ms: fxDuration(def), sx: moved ? e[3] : src.x, sy: moved ? e[4] : src.y,
      tx: e[3], ty: e[4], src: e[0], tid: def.field || def.hit?.aoe ? 0 : e[5], key: e[6], chain: e.slice(7),
    });
    if (this.fx.length > 80) this.fx.splice(0, this.fx.length - 80);
    // the ability's sound: centred for the local player, positional for everyone else
    if (mine) sound.ability(def, this.me!.job, this.me!.ap.weapon);
    else sound.ability(def, r?.meta.job, r?.meta.ap?.weapon, src.x - this.cur.x, src.y - this.cur.y);
    const anim: Anim = def.fx.t === 'slash' || def.fx.t === 'dash' ? 'attack' : 'cast';
    if (mine) {
      this.act = anim;
      this.actAt = now;
      this.castUntil = 0;
      this.cdReady.set(def.id, now + def.cdMs);
      this.gcdUntil = Math.max(this.gcdUntil, now + GCD_MS);
      this.setHud({ cds: { ...this.hud.cds, [def.id]: [now, def.cdMs] }, cast: null });
    } else if (r) {
      r.act = anim;
      r.actAt = now + INTERP_DELAY;
      r.castUntil = 0;
    }
  }

  respawn() {
    this.sendMsg({ t: 'respawn' });
  }
  private refreshTarget() {
    const r = this.targetId ? this.remotes.get(this.targetId) : undefined;
    const cur = this.hud.target;
    if (!r) {
      if (cur) this.setHud({ target: null });
      return;
    }
    if (cur && cur.id === r.meta.id && cur.hp === r.hp && cur.mhp === r.mhp && cur.statuses.length === statusNames(r.st).length) return;
    this.setHud({ target: { id: r.meta.id, name: r.meta.name, level: r.meta.level, hp: r.hp, mhp: r.mhp, elite: r.mt ? MONSTERS[r.mt].elite : false, statuses: statusNames(r.st), player: !r.mt, fierce: !!r.meta.fz } });
  }

  // ---------- network ----------
  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws`));
    ws.onopen = () => {
      this.seq = 0;
      this.pending.length = 0;
      ws.send(JSON.stringify({ t: 'join', token: this.token, characterId: this.characterId }));
    };
    ws.onmessage = (ev) => this.onMsg(JSON.parse(ev.data as string) as ServerMsg);
    ws.onclose = () => {
      if (this.dead || this.ws !== ws) return;
      this.ws = null;
      if (this.hud.status === 'kicked') return;
      this.setHud({ status: 'reconnecting' });
      this.retryTimer = window.setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
  }
  private sendMsg(m: object) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m));
  }
  /** Sends chat, or runs a slash command: /p text, /w Name text, /invite Name, /leave. */
  sendChat(text: string, ch: ChatChannel = 'zone') {
    const m = /^\/(\w+)\s*(.*)$/.exec(text.trim());
    if (!m) return this.sendMsg({ t: 'chat', text, ch });
    const [, cmd, rest] = m;
    switch (cmd.toLowerCase()) {
      case 'p': case 'party': return this.sendMsg({ t: 'chat', text: rest, ch: 'party' });
      case 'g': case 'guild': return this.sendMsg({ t: 'chat', text: rest, ch: 'guild' });
      case 'duel': return rest ? this.duelByName(rest) : this.pushChat({ text: 'Usage: /duel Name' });
      case 'ginvite': return rest ? this.guildOp('invite', { name: rest }) : this.pushChat({ text: 'Usage: /ginvite Name' });
      case 'z': case 'zone': case 's': case 'say': return this.sendMsg({ t: 'chat', text: rest, ch: 'zone' });
      case 'w': case 'whisper': case 'tell': {
        const w = /^(\S+)\s+(.+)$/.exec(rest);
        return w ? this.sendMsg({ t: 'chat', text: w[2], ch: 'whisper', to: w[1] }) : this.pushChat({ text: 'Usage: /w Name message' });
      }
      case 'invite': return rest ? this.partyOp('invite', undefined, rest) : this.pushChat({ text: 'Usage: /invite Name' });
      case 'leave': return this.partyOp('leave');
      case 'trade': return rest ? this.tradeOp('invite', { name: rest }) : this.pushChat({ text: 'Usage: /trade Name' });
      default: return this.pushChat({ text: `Unknown command /${cmd}. Try /p, /g, /w Name, /invite Name, /trade Name, /duel Name, /ginvite Name, /leave.` });
    }
  }
  /** Inventory command; the server decides and answers with the new inventory. */
  invOp(op: 'equip' | 'unequip' | 'use' | 'sell' | 'sellall' | 'sort' | 'buy' | 'dailystone' | 'upgrade' | 'destroy' | 'scroll' | 'buyrune' | 'arm' | 'sigil' | 'unsigil', a: { uid?: string; uids?: string[]; by?: SortKey; slot?: string | number; base?: string; qty?: number; el?: string } = {}) {
    this.sendMsg({ t: 'inv', op, ...a });
    if (op === 'equip') this.tut('equip');
    if (op === 'scroll') this.tut('scroll');
    if (op === 'use' && a.uid && this.hud.inv.find((i) => i.uid === a.uid)?.base.endsWith('_potion')) this.tut('potion');
  }
  /** Drinks the first potion of a kind (Z / X). */
  quaff(base: string) {
    if (this.isDead || this.hud.status !== 'playing') return;
    const it = this.hud.inv.find((i) => i.base === base);
    if (!it) return this.notice(`No ${ITEMS[base].name} left`);
    if (this.hud.potionAt && performance.now() - this.hud.potionAt < POTION_CD_MS) return this.notice('Potions are on cooldown');
    this.invOp('use', { uid: it.uid });
    this.tut('potion');
  }
  private pushLoot(text: string, rar: number) {
    this.setHud({ loot: [...this.hud.loot.slice(-5), { id: ++this.lootId, text, rar, until: performance.now() + 5000 }] });
  }
  objOp(op: 'gather' | 'open' | 'tp' | 'craft', a: { id?: string; to?: string; recipe?: string } = {}) {
    this.sendMsg({ t: 'obj', op, ...a });
  }
  /** F: talk to the NPC, gather from the node or open the cache in reach. */
  interact() {
    const n = this.hud.near;
    if (!n || this.isDead || this.hud.status !== 'playing') return;
    if (n.kind === 'node') return this.objOp('gather', { id: n.id });
    if (n.kind === 'cache') return this.objOp('open', { id: n.id });
    this.setHud({ talk: this.hud.talk === n.id ? null : n.id });
  }
  closeTalk() {
    if (this.hud.talk) this.setHud({ talk: null });
  }
  private refreshNear() {
    const now = performance.now();
    let o = this.map ? objNear(this.map.def.id, this.cur.x, this.cur.y, INTERACT_RANGE) : undefined;
    if (o && o.kind === 'cache' && this.hud.disc.includes(o.id)) o = undefined;
    if (o && o.kind === 'node' && (this.nodeCd.get(o.id) ?? 0) > now) o = undefined;
    const cur = this.hud.near, patch: Partial<Hud> = {};
    if ((o?.id ?? null) !== (cur?.id ?? null)) patch.near = o ? { id: o.id, kind: o.kind, name: o.name, hint: isNpc(o) ? `Talk to ${o.name}` : o.kind === 'node' ? `Gather ${o.name}` : 'Open Hidden Cache' } : null;
    // walking away ends a conversation
    if (this.hud.talk) {
      const t = this.objs.find((x) => x.id === this.hud.talk);
      if (!t || Math.hypot(t.x - this.cur.x, t.y - this.cur.y) > INTERACT_RANGE * 2.2) patch.talk = null;
    }
    if (patch.near !== undefined || patch.talk !== undefined) this.setHud(patch);
  }
  setLootMode(mode: LootMode) {
    this.sendMsg({ t: 'party', op: 'loot', mode });
  }
  dungeonOp(op: 'enter' | 'leave', id?: string, diff?: string) {
    this.sendMsg({ t: 'dng', op, id, diff });
  }
  /** Answers a dungeon ready check. */
  dungeonReady(yes: boolean) {
    this.sendMsg({ t: 'dng', op: 'ready', yes });
    if (!yes) this.setHud({ dready: null });
  }
  /** The boss bar follows the nearest living boss in view; its phase is derived from its health. */
  private refreshBoss() {
    let best: Remote | null = null, bd = Infinity;
    for (const r of this.remotes.values()) {
      if (!r.mt || r.hp <= 0 || !MONSTERS[r.mt]?.boss) continue;
      const d = Math.hypot(r.rx - this.cur.x, r.ry - this.cur.y);
      if (d < bd) { bd = d; best = r; }
    }
    const cur = this.hud.boss;
    if (!best) return void (cur && this.setHud({ boss: null }));
    const def = MONSTERS[best.mt], ph = phaseAt(def, best.hp / best.mhp);
    if (cur && cur.name === def.name && cur.hp === best.hp && cur.mhp === best.mhp) return;
    this.setHud({ boss: { name: def.name, title: def.boss!.title, hp: best.hp, mhp: best.mhp, phase: ph, phases: def.boss!.phases.length, phaseName: def.boss!.phases[ph].name, level: best.meta.level } });
  }
  partyOp(op: 'invite' | 'accept' | 'decline' | 'leave' | 'kick' | 'promote', id?: number, name?: string) {
    if (op === 'accept' || op === 'decline') this.setHud({ invite: null });
    this.sendMsg({ t: 'party', op, id, name });
  }
  /** Chooses the ally for heals and shields (from a party frame or by clicking a player). */
  selectAlly(id: number) {
    this.friendId = id;
    this.refreshAlly();
  }

  private onMsg(m: ServerMsg) {
    switch (m.t) {
      case 'welcome': return this.onWelcome(m);
      case 'snap': return this.onSnap(m);
      case 'stats':
        if (this.me) {
          const up = m.level > this.me.level;
          this.me = { ...this.me, level: m.level, mhp: m.stats.maxHp };
          this.setHud({ self: this.me, stats: m.stats, exp: m.exp, next: m.next, points: this.hud.build ? freePoints(m.level, this.hud.build) : 0 });
          if (up) {
            sound.levelUp();
            this.toastUntil = performance.now() + 3500;
            this.setHud({ toast: `Level ${m.level}!` });
            this.floaters.push({ x: this.cur.x, y: this.cur.y - 34, text: tr('float.levelUp'), color: '#ffe08a', big: true, t0: performance.now(), kind: 'info' });
          }
        }
        return;
      case 'build': return this.setBuild(m.build);
      case 'inv': {
        if (this.me && JSON.stringify(this.me.ap) !== JSON.stringify(m.ap)) {
          this.me = { ...this.me, ap: m.ap };
          this.sheet = getCharSheet(m.ap, this.me.job);
          this.setHud({ self: this.me });
        }
        // potion drunk, gear changed, gold spent or earned at a shop: all confirmed by this message
        if (this.hud.self) sound.inventory(performance.now(), this.hud, m, this.hud.shop);
        return this.setHud({ inv: m.inv, eq: m.eq, gold: m.gold, potionAt: m.pcd > 0 ? performance.now() - (POTION_CD_MS - m.pcd) : 0, ...(m.gear ? { gear: m.gear } : {}) });
      }
      case 'loot':
        sound.loot(performance.now(), m.gold, m.items);
        if (m.gold) {
          this.pushLoot(`+${m.gold} gold`, -1);
          this.float(this.cur.x + 14, this.cur.y - 30, tr('float.gold', { n: m.gold }), 'gold', FLOAT_STYLE.gold.color, performance.now());
        }
        for (const i of m.items) {
          const b = ITEMS[i.base];
          this.pushLoot(`${b?.kind === 'equip' ? tv(RARITIES[i.rar]) + ' ' : ''}${b?.name ?? i.base}${i.qty > 1 ? ' ×' + i.qty : ''}`, b?.kind === 'equip' ? i.rar : 0);
          if (i.rar >= 3) this.pushChat({ text: `You found ${RARITIES[i.rar]} loot: ${b?.name ?? i.base}!` });
        }
        return;
      case 'no':
        // while auto hunting, the server turning down one of the hunter's own skill attempts (a cooldown,
        // a cast in progress) is routine; it is not shown as an error. Everything else still is.
        if (this.hunter.on && ABILITIES[m.a]) return;
        return this.notice(m.why);
      case 'chat': return this.pushChat({ from: m.from, text: m.text, ch: m.ch, to: m.to });
      case 'party':
        this.setHud({ party: m.party });
        if (m.party) this.tut('party');
        return this.refreshAlly();
      case 'auto': {
        // the server's view of the session: its figures, and its decision when it ends one
        if (!m.on && this.hunter.on) this.hunter.stop(m.why ? `Stopped: ${m.why}` : 'Stopped');
        const cfg = this.me && this.hud.build ? withSkills(m.cfg, this.me.job, this.hud.build) : m.cfg;
        this.setAuto({ on: this.hunter.on, stats: m.stats, status: this.hunter.status, ...(this.hunter.on ? {} : { cfg }) });
        if (m.why) this.pushChat({ text: `Auto hunting stopped: ${m.why}.` });
        return;
      }
      case 'trade':
        if (m.trade && !this.hud.trade) sound.notify();
        return this.setHud({ trade: m.trade, tradeInvite: null });
      case 'tinv':
        sound.notify();
        return this.setHud({ tradeInvite: { from: m.from, id: m.id, until: performance.now() + m.ms } });
      case 'rune': {
        // a rune was unlocked or strengthened: say so where the player is looking
        const name = `${m.el[0].toUpperCase()}${m.el.slice(1)} Rune`;
        sound.at(m.isNew ? 'game.level_up' : 'skill.buff', 0, 0, m.isNew ? 0.7 : 1);
        this.toastUntil = performance.now() + 3500;
        this.setHud({ toast: m.isNew ? `New rune: ${name}` : `${name} +${m.xp} experience` });
        this.floaters.push({ x: this.cur.x, y: this.cur.y - 34, text: m.isNew ? tr('float.runeNew') : tr('float.runeExp'), color: '#c9a8ff', big: true, t0: performance.now(), kind: 'info' });
        return;
      }
      case 'quests': return this.setHud({ quests: m.q, qprog: m.prog, rep: m.rep });
      case 'journal': return this.setHud({ journal: m.j });
      case 'rift': return this.setHud({ rift: m.run });
      case 'asc': return this.setHud({ asc: m.asc, ult: m.ult });
      case 'territory': return this.setHud({ territory: { held: m.held, factions: m.factions } });
      case 'siege': return this.setHud({ siege: m.siege });
      case 'raidlobby': return this.setHud({ raidLobbies: m.list });
      case 'raid': return this.setHud({ raid: m.run });
      case 'life': return this.setHud({ life: m.life });
      case 'home': return this.setHud({ home: m.owner ? { owner: m.owner, mine: m.mine, furn: m.furn, garden: m.garden } : null });
      case 'ult':
        if (m.v >= 100 && this.hud.ult < 100) sound.notify();
        return this.setHud({ ult: m.v });
      case 'combo':
        if (m.i >= 3) this.float(this.cur.x, this.cur.y - 46, `${m.name}!`, 'info', '#ffd24a', performance.now());
        return this.setHud({ combo: { i: m.i >= 3 ? 0 : m.i, at: Date.now() } });
      case 'rifttop': return this.setHud({ riftTop: m.rows });
      case 'wevent':
        if (m.ev && (!this.hud.wevent || this.hud.wevent.id !== m.ev.id)) sound.notify();
        return this.setHud({ wevent: m.ev });
      case 'mail': return this.setHud({ mailUnread: m.unread, ...(m.list ? { mail: m.list } : {}) });
      case 'friends': return this.setHud({ friends: m.list });
      case 'depths': return this.setHud({ depthBosses: m.bosses });
      case 'bounty': return this.setHud({ bounty: m.marks });
      case 'depthask':
        if (this.hud.depthAsk || performance.now() < this.depthQuietUntil) return;
        sound.notify();
        return this.setHud({ depthAsk: { zone: m.zone, level: m.level } });
      case 'guild': return this.setHud({ guild: m.guild, grank: m.rank, ginv: m.guild ? null : this.hud.ginv });
      case 'ginv':
        sound.notify();
        return this.setHud({ ginv: { guild: m.guild, tag: m.tag, from: m.from, until: performance.now() + m.ms } });
      case 'bank': return this.setHud({ bank: m.bank });
      case 'banklog': return this.setHud({ banklog: m.rows as any });
      case 'ah': return this.setHud({ ah: { list: m.list, total: m.total, page: m.page, claims: m.claims, rates: m.rates } });
      case 'ahhist': return this.setHud({ ahhist: m.rows });
      case 'comp': return this.setHud({ comp: m.comp });
      case 'dinv':
        sound.notify();
        return this.setHud({ dinv: { from: m.from, id: m.id, until: performance.now() + m.ms } });
      case 'duel':
        if (m.result) {
          this.pushChat({ text: m.result });
          if (this.targetId === m.id) this.setTarget(0);
          return this.setHud({ duel: null, dinv: null });
        }
        sound.notify();
        this.pushChat({ text: `Duel with ${m.with}: it begins in ${Math.max(0, Math.round((m.starts - Date.now()) / 1000))} seconds. Stay close.` });
        return this.setHud({ duel: { with: m.with, id: m.id, starts: m.starts, ends: m.ends }, dinv: null });
      case 'pvprank': return this.setHud({ pvprank: { rows: m.rows, me: m.me } });
      case 'pinv':
        sound.notify();
        this.setHud({ invite: { from: m.from, id: m.id, until: performance.now() + m.ms } });
        return;
      case 'sys':
        sound.notice(m.cue, performance.now(), false);
        return this.pushChat({ text: m.text });
      case 'ann':
        sound.notice(m.cue, performance.now(), true);
        this.bannerUntil = performance.now() + 5000;
        this.setHud({ banner: { text: m.text, id: ++this.bannerId } });
        return this.pushChat({ text: m.text });
      case 'dng':
        if (m.run) this.tut('dungeon');
        return this.setHud({ dungeon: m.run });
      case 'dready':
        if (m.id && !this.hud.dready) sound.notify();
        return this.setHud({ dready: m.id ? { id: m.id, diff: m.diff, from: m.from, until: performance.now() + m.ms, ok: m.ok, wait: m.wait } : null });
      case 'disc': return this.setHud({ disc: m.list });
      case 'nodes':
        for (const [id, ms] of m.cd) {
          this.nodeCd.set(id, performance.now() + ms);
          // someone gathered this node just now (a full cooldown, not the list sent on arrival): heard from where it stands
          const o = ms >= NODE_RESPAWN_MS - 50 ? this.objs.find((x) => x.id === id) : undefined;
          if (o) sound.at('env.gather', o.x - this.cur.x, o.y - this.cur.y);
        }
        return;
      case 'dbg':
        this.dbgMobs = m.mobs;
        return;
      case 'pong': return this.setHud({ ping: Math.round(performance.now() - m.c) });
      case 'kick':
        this.setHud({ status: 'kicked', reason: m.reason });
        return;
    }
  }
  private onWelcome(m: WelcomeMsg) {
    const zoneChanged = this.map?.def.id !== m.zone;
    sound.zone(m.zone, zoneChanged, !!this.map);
    this.map = getZoneMap(m.zone);
    this.me = m.self;
    this.sheet = getCharSheet(m.self.ap, m.self.job);
    this.cur.x = this.prev.x = m.x;
    this.cur.y = this.prev.y = m.y;
    this.off.x = this.off.y = 0;
    this.pending.length = 0;
    this.remotes.clear();
    this.telegraphs.length = this.shots.length = this.blasts.length = 0;
    this.timeOffset = null;
    this.retry = 0;
    this.dev = !!m.dev;
    if (this.dbgOn) this.sendMsg({ t: 'dbg', on: true }); // a new zone: ask again
    this.targetId = 0;
    this.friendId = 0;
    this.fx.length = 0;
    this.hits.length = 0;
    this.castUntil = 0;
    this.hp = m.hp;
    this.isDead = m.hp <= 0;
    this.act = null;
    if (zoneChanged) {
      this.chunks.clear();
      this.stage?.reset();
      this.miniBase = null;
      this.pushChat({ text: `You have entered ${ZONES[m.zone].name}.` });
    }
    this.setHud({ status: 'playing', zone: ZONES[m.zone].name, channel: m.channel, self: m.self, stats: m.stats, hp: m.hp, res: m.res, exp: m.exp, next: m.next, target: null, attacking: false, build: m.build, points: freePoints(m.self.level, m.build), cast: null, ally: null, inv: m.inv, eq: m.eq, gold: m.gold, boss: null, gate: null, level: ZONES[m.zone].level, near: null, talk: null, disc: m.disc, zoneId: m.zone, trade: null, tradeInvite: null, factions: m.factions?.length ? m.factions : DEFAULT_FACTIONS,
      comp: m.comp ?? emptyCompanions(), bank: m.bank ?? emptyBank(), gear: m.gear ?? emptyGear(), arena: !!m.arena, duel: null, dinv: null,
      auto: { on: false, status: this.hunter.on ? 'Stopped: you left the hunting area' : this.hud.auto.status, target: '', cfg: withSkills(m.auto, m.self.job, m.build), stats: this.hud.auto.stats } });
    if (this.hunter.busy) {
      this.hunter.stop('Stopped: you left the hunting area');
      this.hunter.cancelReturn();
    }
    this.objs = zoneObjects(m.zone);
    this.nodeCd.clear();
  }

  private posOf(id: number): { x: number; y: number } | null {
    if (this.me && id === this.me.id) return this.cur;
    const r = this.remotes.get(id);
    return r ? { x: r.rx, y: r.ry } : null;
  }
  private onSelf(me: SelfState, now: number) {
    this.statusUntil = me.st.map(([i, ms]) => [i, now + ms] as [number, number]);
    this.recalcStatus(now);
    if (me.dead && !this.isDead) {
      this.diedAt = now;
      sound.died();
    }
    this.isDead = me.dead > 0;
    this.deadAuto = now + me.dead;
    this.hp = me.hp;
    if (me.tgt !== this.targetId && performance.now() - this.tgtAt > 600 && (me.tgt || !this.remotes.get(this.targetId) || this.remotes.get(this.targetId)!.hp <= 0)) this.targetId = me.tgt;
    if (me.xp) this.float(this.cur.x, this.cur.y - 36, tr('float.exp', { n: me.xp }), 'exp', FLOAT_STYLE.exp.color, now);
    this.setHud({ hp: me.hp, res: me.res, exp: me.exp, attacking: me.atk === 1, statuses: me.st.map(([i]) => STATUS[i].name) });
    this.refreshTarget();
  }
  private recalcStatus(now: number) {
    let mul = 1, stun = false;
    this.statusUntil = this.statusUntil.filter(([, until]) => until > now);
    for (const [i] of this.statusUntil) {
      mul *= STATUS[i].moveMul ?? 1;
      if (STATUS[i].stun) stun = true;
    }
    this.moveMul = mul;
    this.stunned = stun;
    this.stealthed = this.statusUntil.some(([i]) => i === STATUS_INDEX.stealth);
  }

  private onSnap(m: SnapMsg) {
    if (!this.map || !this.me) return;
    this.stats.snaps++;
    const now = performance.now();
    const o = m.k * TICK_MS - now;
    this.timeOffset = this.timeOffset === null || Math.abs(o - this.timeOffset) > 500 ? o : this.timeOffset + (o - this.timeOffset) * 0.1;
    const t = m.k * TICK_MS;
    if (m.rm) for (const id of m.rm) this.remotes.delete(id);
    if (m.add)
      for (const e of m.add) {
        const mt = e.mt ?? '';
        this.remotes.set(e.id, {
          meta: e, mt, sheet: mt ? getMonsterSheet(mt) : getCharSheet(e.ap!, e.job!), buf: [t, e.x, e.y], d: e.d, m: 0, rx: e.x, ry: e.y,
          act: null, actAt: 0, hp: e.hp, mhp: e.mhp, st: e.st, hitAt: 0, deadAt: e.hp <= 0 ? now - 2000 : 0, castUntil: 0, stepAt: 0,
        });
        if (mt && e.hp > 0 && MONSTERS[mt]?.boss) sound.bossSeen(e.id, now);
      }
    if (m.mv)
      for (const [id, x, y, d, mov] of m.mv) {
        const r = this.remotes.get(id);
        if (!r) continue;
        const b = r.buf;
        // After a pause, anchor the old position one tick back so the entity does not glide across the gap.
        if (b.length && t - b[b.length - 3] > 150) b.push(t - TICK_MS, b[b.length - 2], b[b.length - 1]);
        b.push(t, x, y);
        if (b.length > 30) b.splice(0, 3);
        r.d = d;
        r.m = mov;
      }
    if (m.hp)
      for (const [id, hp, mhp, st] of m.hp) {
        const r = this.remotes.get(id);
        if (!r) continue;
        if (hp <= 0 && r.hp > 0) {
          r.deadAt = now + INTERP_DELAY;
          sound.death(r.mt, r.rx - this.cur.x, r.ry - this.cur.y, now);
        }
        if (hp > 0) r.deadAt = 0;
        r.hp = hp;
        r.mhp = mhp;
        r.st = st;
      }
    let myFx = false;
    if (m.ev)
      for (const e of m.ev) {
        const r = this.remotes.get(e[0]), mine = e[0] === this.me.id;
        if (e[1] === Act.Telegraph) {
          // the rank of the monster decides how grand its attack looks: ordinary, elite, dungeon boss, world boss
          const src = this.remotes.get(e[0]), d = src?.mt ? MONSTERS[src.mt] : undefined;
          const tier = d?.boss ? (d.boss.world ? 3 : 2) : d?.elite ? 1 : 0;
          this.telegraphs.push({ x: e[2], y: e[3], r: e[4], t0: now, ms: e[5], friendly: !!e[6], inner: e[7] ?? 0, tier, color: e[6] ? '#5aaaff' : (src?.mt && PROJ[src.mt]) || ['#ff5a3a', '#ff8a2a', '#ff3a6a', '#c84aff'][tier], blast: !e[6] && !!src?.mt });
        }
        else if (e[1] === Act.Fx) {
          this.onFx(e, now);
          if (mine) myFx = true;
        } else if (e[1] === Act.FxEnd) {
          const f = this.fx.find((x) => x.key === e[2] && x.src === e[0]);
          if (f) e[3] ? (f.firedAt = now) : (f.ms = 0);
          if (f && e[3]) sound.at('skill.trap_fire', f.tx - this.cur.x, f.ty - this.cur.y);
        } else if (e[1] === Act.Cast) {
          const def = ABILITY_LIST[e[2]], until = e[3] ? now + e[3] : 0;
          if (def && e[3]) mine ? sound.castStart(def) : r && sound.castStart(def, r.rx - this.cur.x, r.ry - this.cur.y);
          if (mine) {
            this.castUntil = until;
            this.act = null;
            this.setHud({ cast: e[3] && def ? { name: def.name, at: now, ms: e[3] } : null });
          } else if (r) r.castUntil = until ? until + INTERP_DELAY : 0;
        }
        if (!r) continue;
        if (e[1] === Act.Attack) {
          r.act = 'attack';
          r.actAt = now + INTERP_DELAY; // play in sync with the interpolated position
          const color = e[1] === Act.Attack && e[2] ? (r.mt ? (isRanged(r.mt) ? PROJ[r.mt] ?? '#d8b8ff' : '') : JOB_DEFS[r.meta.job!].range > 100 ? PROJ[r.meta.job!] : '') : '';
          if (color) this.shots.push({ x: r.rx, y: r.ry - 12, to: e[2], t0: now + INTERP_DELAY, color });
          else if (r.mt && e[2]) { // a monster's blow in melee: claw marks across its target
            const v = this.posOf(e[2]), d = MONSTERS[r.mt];
            if (v) this.blasts.push({ x: v.x, y: v.y, r: 0, t0: now + INTERP_DELAY + 90, tier: 0, color: d.boss ? '#ff3a6a' : d.elite ? '#ff8a2a' : '#ffd0c0', inner: 0, kind: 'claw' });
          }
          if (!r.mt) sound.swing(r.meta.job!, r.meta.ap?.weapon ?? 0, r.rx - this.cur.x, r.ry - this.cur.y);
        } else if (e[1] === Act.LevelUp) {
          sound.at('game.level_up', r.rx - this.cur.x, r.ry - this.cur.y, 0.5);
          r.meta.level = e[2];
          this.floaters.push({ x: r.rx, y: r.ry - 34, text: tr('float.levelUp'), color: '#ffe08a', big: true, t0: now, kind: 'info' });
        }
      }
    if (m.me) this.onSelf(m.me, now);
    if (m.dm) {
      const myId = this.me.id;
      let swung = false;
      for (const [tid, amount, flags, src] of m.dm) {
        this.stats.dmgSeen++;
        const pos = this.posOf(tid);
        if (!pos) continue;
        const mine = tid === myId, byMe = src === myId;
        const r = this.remotes.get(tid);
        sound.damage(now, {
          mine, byMe, basic: byMe && !myFx, targetMt: mine ? '' : r?.mt ?? '', srcMt: this.remotes.get(src)?.mt ?? '', flags, amount,
          dx: pos.x - this.cur.x, dy: pos.y - this.cur.y, job: this.me.job, weapon: this.me.ap.weapon,
        });
        if (amount > 0 && !(flags & (Dmg.Heal | Dmg.Dot | Dmg.Miss)) && this.hits.length < 5 * 40)
          this.hits.push(pos.x + (Math.random() * 10 - 5), pos.y - (r?.mt ? monsterHeight(r.mt) * 0.5 : 14), now + (mine ? 0 : INTERP_DELAY), flags & Dmg.Crit ? 1 : 0, mine ? 1 : 0);
        if (amount > 0 && !(flags & Dmg.Heal)) {
          if (mine) this.selfHitAt = now;
          else if (r) r.hitAt = now + INTERP_DELAY;
        }
        const crit = !!(flags & Dmg.Crit), heal = !!(flags & Dmg.Heal);
        const text = flags & Dmg.Miss ? tr('float.miss') : heal ? `+${amount}` : flags & Dmg.Absorb ? (amount ? `${amount} ${tr('float.shield')}` : tr('float.absorbed')) : flags & Dmg.Block ? `${amount} ${tr('float.block')}` : crit ? `${amount}!` : String(amount);
        // what matters to this player stands out: their own hits, crits, heals, and damage they take
        const kind: FloatKind = flags & Dmg.Miss ? 'miss' : heal ? (mine || byMe ? 'heal' : 'other') : mine ? 'taken' : byMe ? (crit ? 'crit' : 'dealt') : 'other';
        const color = kind === 'other' ? (heal ? '#9be8a6' : flags & Dmg.Dot ? '#b9e06a' : FLOAT_STYLE.other.color) : flags & Dmg.Dot && kind === 'dealt' ? '#c8f07a' : FLOAT_STYLE[kind].color;
        this.float(pos.x + (Math.random() * 12 - 6), pos.y - (r?.mt ? monsterHeight(r.mt) : 30), text, kind, color, now);
        if (byMe && !myFx && !(flags & (Dmg.Dot | Dmg.Heal)) && !swung) {
          swung = true;
          this.act = 'attack';
          this.actAt = now;
          sound.swing(this.me.job, this.me.ap.weapon);
          if (r) {
            const dx = r.rx - this.cur.x, dy = r.ry - this.cur.y;
            this.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 1 : 2) : dy < 0 ? 3 : 0;
            const color2 = PROJ[this.me.job];
            if (this.hud.stats && this.hud.stats.range > 100 && color2) this.shots.push({ x: this.cur.x, y: this.cur.y - 12, to: tid, t0: now - 60, color: color2 });
          }
        }
      }
      if (this.floaters.length > 60) this.floaters.splice(0, this.floaters.length - 60);
      this.refreshTarget();
    } else if (m.hp) this.refreshTarget();
    if (m.hp && this.friendId) this.refreshAlly();

    // --- reconciliation: rewind to authoritative state, replay unacknowledged inputs ---
    const p = this.pending;
    let i = 0;
    while (i < p.length && p[i] <= m.a) i += 4;
    if (i) p.splice(0, i);
    const ox = this.cur.x, oy = this.cur.y;
    this.cur.x = m.x;
    this.cur.y = m.y;
    for (let j = 0; j < p.length; j += 4) stepMove(this.cur, p[j + 1], p[j + 2], this.map, p[j + 3], isFlying(this.hud.comp));
    const ex = ox - this.cur.x, ey = oy - this.cur.y;
    if (ex || ey) {
      const mag = Math.hypot(ex, ey);
      this.stats.corrections++;
      if (mag > this.stats.maxCorrection) this.stats.maxCorrection = mag;
      this.prev.x -= ex;
      this.prev.y -= ey;
      if (mag < 48) {
        this.off.x += ex; // hide small corrections by easing the sprite over a few frames
        this.off.y += ey;
      } else this.off.x = this.off.y = 0;
    }
  }

  // ---------- simulation ----------
  private fixedStep() {
    this.prev.x = this.cur.x;
    this.prev.y = this.cur.y;
    const stats = this.hud.stats;
    if (!this.map || !stats || this.hud.status !== 'playing') return;
    if (this.statusUntil.length) this.recalcStatus(performance.now());
    if (this.isDead || this.stunned) {
      this.moving = Move.Idle;
      return;
    }
    let ix = 0, iy = 0;
    const binds = settings.get().keys;
    for (const k of this.keys) {
      const v = MOVES[actionFor(binds, k)!];
      if (!v) continue;
      ix += v[0];
      iy += v[1];
    }
    ix = Math.sign(ix);
    iy = Math.sign(iy);
    let run = this.walkHeld ? 0 : 1;
    if (this.hunter.busy) {
      // a hand on the movement keys always wins, but only while held: a hunt carries on from where you let go
      if (ix || iy) {
        if (this.hunter.on) this.hunter.steer(performance.now());
        else this.stopAuto('Stopped: you took the controls'); // a return walk is cancelled
      } else {
        const s = this.hunter.step(performance.now());
        if (s) {
          ix = s.ix;
          iy = s.iy;
          run = s.run ? 1 : 0;
        }
      }
    }
    this.moving = ix !== 0 || iy !== 0 ? (run ? Move.Run : Move.Walk) : Move.Idle;
    if (this.moving && !this.hunter.busy) this.tut('move');
    if (!this.moving) return;
    this.dir = ix < 0 ? 1 : ix > 0 ? 2 : iy < 0 ? 3 : 0;
    const s = ++this.seq;
    // The step is stored with the input so replays stay exact when a slow starts or ends mid-flight.
    const step = stepSize(stats.moveMul * this.moveMul, run === 1);
    this.sendMsg({ t: 'in', s, x: ix, y: iy, r: run });
    if (this.pending.length < 240) this.pending.push(s, ix, iy, step);
    stepMove(this.cur, ix, iy, this.map, step, isFlying(this.hud.comp));
    // footsteps follow the predicted position, and only while it actually changes (not against a wall)
    if (this.cur.x !== this.prev.x || this.cur.y !== this.prev.y)
      sound.myStep(performance.now(), tileAt(this.map, Math.floor(this.cur.x / TILE), Math.floor(this.cur.y / TILE)), this.map.def.theme, run === 1);
  }
  /** Music, ambience and other players' footsteps, from what the server has told this client. */
  private updateAudio(now: number) {
    const map = this.map;
    if (!map || !this.me || this.hud.status !== 'playing') return;
    let boss: '' | 'dungeon' | 'world' = '', bd = Infinity;
    for (const r of this.remotes.values()) {
      const b = r.mt && r.hp > 0 ? MONSTERS[r.mt]?.boss : undefined;
      if (!b) continue;
      // a boss takes over the music when it is close, or from further away once someone has engaged it
      const d = Math.hypot(r.rx - this.cur.x, r.ry - this.cur.y);
      if (d < bd && (d < BOSS_MUSIC_RANGE || r.hp < r.mhp)) {
        bd = d;
        boss = b.world ? 'world' : 'dungeon';
      }
    }
    const town = map.def.id !== START_ZONE ? map.def.town : undefined;
    sound.frame(now, {
      zone: map.def.id, dungeon: map.def.kind === 'dungeon', dead: this.isDead, attacking: this.hud.attacking, boss,
      villageDist: town ? Math.hypot(this.cur.x / TILE - town.tx, this.cur.y / TILE - town.ty) : Infinity,
    });
  }
  private remoteSteps(now: number) {
    const map = this.map!;
    for (const r of this.remotes.values()) {
      if (r.mt || r.m === Move.Idle || r.hp <= 0 || now < r.stepAt) continue;
      const dx = r.rx - this.cur.x, dy = r.ry - this.cur.y;
      // beyond a short distance other people's footsteps are not worth a voice
      r.stepAt = now + (Math.abs(dx) + Math.abs(dy) < 260 && !(r.st & STEALTH_BIT)
        ? sound.step(tileAt(map, Math.floor(r.rx / TILE), Math.floor(r.ry / TILE)), map.def.theme, r.m === Move.Run, dx, dy)
        : 400);
    }
  }

  private frame = (now: number) => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    this.rafAt = performance.now();
    this.simulate(now, true);
  };
  /** One frame: the fixed simulation steps, then (when painting) the picture. */
  private simulate(now: number, paint: boolean) {
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    if (!paint && this.timeOffset !== null) {
      // nothing is drawn, but auto hunting still needs to know where monsters are
      const rt = now + this.timeOffset - INTERP_DELAY;
      for (const r of this.remotes.values()) this.sample(r, rt);
    }
    while (this.acc >= TICK_MS) {
      this.fixedStep();
      this.acc -= TICK_MS;
    }
    if (paint) {
      this.render(now, this.acc / TICK_MS);
      this.frames++;
      if (this.map && this.remotes.size) this.remoteSteps(now);
    }
    if (now - this.bossAt > 200) {
      this.bossAt = now;
      this.refreshBoss();
      this.refreshNear();
      if (this.hunter.busy && (this.hud.status !== 'playing' || this.isDead)) this.hunter.step(now); // lets it notice death or a lost connection
      const au = this.hud.auto;
      if (au.on !== this.hunter.on || au.status !== this.hunter.status || au.target !== this.hunter.targetName) this.setAuto({ on: this.hunter.on, status: this.hunter.status, target: this.hunter.targetName });
      if (this.hud.tradeInvite && now > this.hud.tradeInvite.until) this.setHud({ tradeInvite: null });
      if (this.hud.ginv && now > this.hud.ginv.until) this.setHud({ ginv: null });
      if (this.hud.dinv && now > this.hud.dinv.until) this.setHud({ dinv: null });
      if (this.map) {
        const id = this.map.def.id;
        const z = this.hud.arena ? 'arena' : inTown(id, this.cur.x, this.cur.y) ? 'town' : pvpRuleAt(id, this.cur.x, this.cur.y);
        if (z !== this.hud.pvpZone) {
          // crossing the edge of an open-PvP area is announced, so nobody walks into one unaware
          if (z === 'open') {
            this.toastUntil = performance.now() + 3500;
            this.setHud({ toast: tr('pvp.enterArea') });
            this.pushChat({ text: tr('pvp.enterAreaLong') });
            sound.notify();
          } else if (this.hud.pvpZone === 'open' && z === 'safe' && this.map.def.depth) this.pushChat({ text: tr('pvp.sanctuary') });
          else if (this.hud.pvpZone === 'open' && (z === 'duel' || z === 'town')) this.pushChat({ text: tr('pvp.leaveArea') });
          if (!this.map.def.depth && this.hud.bounty.length) this.setHud({ bounty: [] });
          if (this.hud.depthAsk && this.map.def.depth) this.setHud({ depthAsk: null });
          this.setHud({ pvpZone: z });
        }
      }
      this.updateAudio(now);
    }
    if (now - this.fpsAt >= 1000) {
      const patch: Partial<Hud> = { fps: Math.round((this.frames * 1000) / (now - this.fpsAt)), nearby: this.remotes.size };
      if (this.isDead) {
        patch.dead = Math.max(1, Math.ceil((this.deadAuto - now) / 1000));
        patch.canRespawn = now - this.diedAt > 3200;
      } else if (this.hud.dead) {
        patch.dead = 0;
        patch.canRespawn = false;
      }
      if (this.hud.toast && now > this.toastUntil) patch.toast = '';
      if (this.hud.notice && now > this.noticeUntil) patch.notice = '';
      if (this.hud.invite && now > this.hud.invite.until) patch.invite = null;
      if (this.hud.loot.length && this.hud.loot.some((l) => now > l.until)) patch.loot = this.hud.loot.filter((l) => now <= l.until);
      if (this.hud.banner && now > this.bannerUntil) patch.banner = null;
      if (this.map) {
        const gate = gateNear(this.map, this.cur.x, this.cur.y)?.dungeon ?? null;
        if (gate !== this.hud.gate) patch.gate = gate;
      }
      if (this.map) {
        const shop = !!objNear(this.map.def.id, this.cur.x, this.cur.y, SHOP_RANGE, ['merchant']);
        if (shop !== this.hud.shop) patch.shop = shop;
      }
      this.setHud(patch);
      this.frames = 0;
      this.fpsAt = now;
    }
    if (now - this.pingAt >= 2000) {
      this.pingAt = now;
      this.sendMsg({ t: 'ping', c: now });
    }
  }

  // ---------- rendering ----------
  /** A cached terrain chunk; null when it is not built yet and `build` is false (HD chunks are built one per frame). */
  private chunk(cx: number, cy: number, map: ZoneMap, build = true): Chunk | null {
    const hd = settings.get().graphics.art === 'hd', staged = hd && !!this.stage;
    if (hd !== this.chunksHD || staged !== this.chunksStaged) { this.chunks.clear(); this.chunksHD = hd; this.chunksStaged = staged; }
    const key = cx + cy * 1024;
    let c = this.chunks.get(key);
    if (c) return c;
    if (!build && hd) return null;
    c = hd ? buildHDChunk(map, cx, cy, staged) : buildChunk(map, cx, cy);
    if (this.chunks.size >= 40) this.chunks.delete(this.chunks.keys().next().value!);
    this.chunks.set(key, c);
    return c;
  }

  private sample(r: Remote, t: number) {
    const b = r.buf;
    while (b.length > 6 && b[3] <= t) b.splice(0, 3);
    if (b.length >= 6 && t > b[0]) {
      const f = Math.min(1, (t - b[0]) / (b[3] - b[0]));
      r.rx = b[1] + (b[4] - b[1]) * f;
      r.ry = b[2] + (b[5] - b[2]) * f;
    } else {
      r.rx = b[1];
      r.ry = b[2];
    }
  }

  private render(now: number, alpha: number) {
    let g = this.ctx;
    const map = this.map, z = this.zoom;
    const W = this.canvas.width, H = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (!map || !this.me) {
      g.fillStyle = '#10131c';
      g.fillRect(0, 0, W, H);
      return;
    }
    this.off.x *= 0.8;
    this.off.y *= 0.8;
    const px = this.prev.x + (this.cur.x - this.prev.x) * alpha + this.off.x;
    const py = this.prev.y + (this.cur.y - this.prev.y) * alpha + this.off.y;
    const vw = W / z, vh = H / z;
    const mw = map.w * TILE, mh = map.h * TILE;
    // heavy effects shake the camera for a moment (never the stored camera used for mouse picking)
    screenFx.cx = px;
    screenFx.cy = py;
    const shake = screenFx.shake > 0.3 ? screenFx.shake : 0;
    screenFx.shake *= 0.86;
    this.camX = Math.round(vw >= mw ? (mw - vw) / 2 : Math.max(0, Math.min(mw - vw, px - vw / 2)));
    this.camY = Math.round(vh >= mh ? (mh - vh) / 2 : Math.max(0, Math.min(mh - vh, py - vh / 2)));
    const camX = this.camX + Math.round(Math.sin(now / 23) * shake), camY = this.camY + Math.round(Math.cos(now / 19) * shake);
    // style B: the world goes to the WebGL stage; this canvas keeps only the interface on top
    const st = this.stageNow();
    if (st) {
      st.begin(W, H);
      this.ctx.clearRect(0, 0, W, H);
      g = st.groundCtx;
      st.groundDirty = true;
    } else {
      g.fillStyle = '#10131c';
      g.fillRect(0, 0, W, H);
    }
    g.imageSmoothingEnabled = false;
    g.setTransform(z, 0, 0, z, -camX * z, -camY * z);

    const cx0 = Math.max(0, Math.floor(camX / CHUNK_PX)), cx1 = Math.min(Math.ceil(map.w / CHUNK) - 1, Math.floor((camX + vw) / CHUNK_PX));
    const cy0 = Math.max(0, Math.floor(camY / CHUNK_PX)), cy1 = Math.min(Math.ceil(map.h / CHUNK) - 1, Math.floor((camY + vh) / CHUNK_PX));
    // HD terrain is costly to paint: one new chunk per frame, nearest to the camera first; until then
    // its area shows the region's ground colour, so a zone change never stalls a frame
    let missing: [number, number] | null = null, best = Infinity;
    const visTrees: NonNullable<Chunk['trees']>[] = [];
    // style B: the zone's buildings rise as 3D blocks (built once per zone, HD art only)
    if (st && this.stageZone !== map.def.id + (this.chunksHD ? ':hd' : '')) {
      this.stageZone = map.def.id + (this.chunksHD ? ':hd' : '');
      const b = this.chunksHD ? buildBuildings(map) : { meshes: [], doors: [] };
      st.setStatic(b.meshes);
      this.doors = b.doors;
    }
    const mcx = (camX + vw / 2) / CHUNK_PX, mcy = (camY + vh / 2) / CHUNK_PX;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = this.chunk(cx, cy, map, false);
      if (c) { if (st) { st.chunk(cx, cy, CHUNK_PX, c.ground); if (c.trees) visTrees.push(c.trees); } else g.drawImage(c.ground, cx * CHUNK_PX, cy * CHUNK_PX); continue; }
      g.fillStyle = hdMiniColors(map.def.theme)[0];
      g.fillRect(cx * CHUNK_PX, cy * CHUNK_PX, CHUNK_PX, CHUNK_PX);
      const d = (cx + 0.5 - mcx) ** 2 + (cy + 0.5 - mcy) ** 2;
      if (d < best) { best = d; missing = [cx, cy]; }
    }
    if (missing) { const c = this.chunk(missing[0], missing[1], map)!; if (st) st.chunk(missing[0], missing[1], CHUNK_PX, c.ground); else g.drawImage(c.ground, missing[0] * CHUNK_PX, missing[1] * CHUNK_PX); }
    let warm = !missing;

    for (const p of map.def.portals) {
      const pulse = (Math.sin(now / 300) + 1) / 2;
      g.fillStyle = `rgba(150,110,255,${0.35 + pulse * 0.35})`;
      g.beginPath();
      g.arc(p.tx * TILE + 16, p.ty * TILE + 16, 6 + pulse * 3, 0, 7);
      g.fill();
    }

    if (this.hunter.on) {
      // the hunting area: the hunter never leaves this circle
      const ar = this.hunter.area();
      g.strokeStyle = 'rgba(201,162,74,0.55)';
      g.lineWidth = 1;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.arc(ar.x, ar.y, ar.r, 0, 7);
      g.stroke();
      g.setLineDash([]);
    }
    // Ground warnings for incoming area attacks: the fill grows until the attack lands.
    const fx25w = settings.get().graphics.quality !== 'low';
    for (let i = this.blasts.length - 1; i >= 0; i--) if (!drawBlastGround(g, this.blasts[i], now)) this.blasts.splice(i, 1);
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i], k = Math.max(0, (now - t.t0) / t.ms); // the frame clock can trail the event clock by a few ms
      if (k >= 1 && t.blast) { // the attack lands: its blast takes over from the warning
        const b: Blast = { x: t.x, y: t.y, r: t.r, t0: now, tier: t.tier, color: t.color, inner: t.inner, kind: 'area' };
        this.blasts.push(b);
        blastImpact(b);
        this.telegraphs.splice(i, 1);
        continue;
      }
      if (k >= 1.1) {
        this.telegraphs.splice(i, 1);
        continue;
      }
      if (fx25w) { drawMonsterWarning(g, t.x, t.y, t.r, k, t.tier, t.color, t.inner, now); continue; }
      const rgb = t.friendly ? '90,170,255' : '240,70,50';
      if (t.inner) {
        // ring attack: the band between the two circles is dangerous, the centre is safe
        const kk = Math.min(1, k), ring = (outer: number) => { g.beginPath(); g.ellipse(t.x, t.y, outer, outer * 0.8, 0, 0, 7); g.ellipse(t.x, t.y, t.inner, t.inner * 0.8, 0, 0, 7); g.fill('evenodd'); };
        g.fillStyle = `rgba(${rgb},0.14)`; ring(t.r);
        g.fillStyle = `rgba(${rgb},0.28)`; ring(t.inner + (t.r - t.inner) * kk);
        g.strokeStyle = `rgba(${rgb},0.85)`; g.lineWidth = 1;
        g.beginPath(); g.ellipse(t.x, t.y, t.r, t.r * 0.8, 0, 0, 7); g.stroke();
        g.strokeStyle = 'rgba(120,230,140,0.9)';
        g.beginPath(); g.ellipse(t.x, t.y, t.inner, t.inner * 0.8, 0, 0, 7); g.stroke();
        continue;
      }
      g.fillStyle = `rgba(${rgb},0.14)`;
      g.beginPath(); g.ellipse(t.x, t.y, t.r, t.r * 0.8, 0, 0, 7); g.fill();
      g.fillStyle = `rgba(${rgb},0.28)`;
      g.beginPath(); g.ellipse(t.x, t.y, t.r * Math.min(1, k), t.r * 0.8 * Math.min(1, k), 0, 0, 7); g.fill();
      g.strokeStyle = `rgba(${rgb},0.85)`;
      g.lineWidth = 1;
      g.beginPath(); g.ellipse(t.x, t.y, t.r, t.r * 0.8, 0, 0, 7); g.stroke();
    }

    // The sanctuary of the Depths: a green ring on the ground where nobody can be attacked.
    const sanct = map.def.sanctuary;
    if (sanct) {
      const cx = sanct.tx * TILE, cy = sanct.ty * TILE, rr = sanct.r * TILE;
      if (cx - rr < camX + vw && cx + rr > camX && cy - rr < camY + vh && cy + rr > camY) {
        g.save();
        g.fillStyle = 'rgba(90,220,140,0.07)';
        g.beginPath(); g.arc(cx, cy, rr, 0, 7); g.fill();
        g.strokeStyle = 'rgba(120,235,160,0.8)';
        g.lineWidth = 2;
        g.setLineDash([8, 6]);
        g.lineDashOffset = -(now / 60) % 14;
        g.stroke();
        g.restore();
      }
    }
    // Ground effects (zones, traps) go under the characters.
    const posOf = (id: number) => this.posOf(id);
    // 2.5D: rune circles, craters and streaks on the ground, and circles under anyone channelling
    const fx25 = settings.get().graphics.quality !== 'low';
    if (fx25) {
      for (const f of this.fx) drawFxGround(g, f, now, posOf);
      if (this.castUntil > now) drawCastCircle(g, this.cur.x, this.cur.y, CAST_COLOR[this.me.job] ?? '#ffffff', now, this.me.id);
      for (const r of this.remotes.values()) if (!r.mt && r.castUntil > now) drawCastCircle(g, r.rx, r.ry, CAST_COLOR[r.meta.job!] ?? '#ffffff', now, r.meta.id);
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i], ground = f.def.fx.t === 'zone' || f.def.fx.t === 'trap';
      if (ground && !drawFx(g, f, now, posOf)) this.fx.splice(i, 1);
    }

    // Build the y-sorted draw list from pooled objects (no per-frame allocation).
    const list = this.drawList, pool = this.pool;
    while (list.length) pool.push(list.pop()!);
    const rt = this.timeOffset === null ? 0 : now + this.timeOffset - INTERP_DELAY;
    const pcol = (act: string | null, actAt: number, move: number, hitAt: number, deadAt: number, castUntil: number) => {
      if (deadAt && now >= deadAt) return animFrame('death', now - deadAt);
      if (castUntil > now) return ANIM_COL.cast + 1 + (Math.floor(now / 160) & 1); // hold the raised-arms frames while channelling
      if (act && now >= actAt && now - actAt < animDuration(act as Anim)) return animFrame(act as Anim, now - actAt);
      if (hitAt && now >= hitAt && now - hitAt < 180) return animFrame('hit', now - hitAt);
      return animFrame(move === Move.Run ? 'run' : move === Move.Walk ? 'walk' : 'idle', now);
    };
    // HD art: 64px chibi sheets with more frames; the same states pick the column
    const hd = settings.get().graphics.art === 'hd', HD_OY = HD_FEET - 9, HD_NAME = 36;
    const hcol = (act: string | null, actAt: number, move: number, hitAt: number, deadAt: number, castUntil: number) => {
      if (deadAt && now >= deadAt) return hdFrame('death', now - deadAt);
      if (castUntil > now) return HD_COL.cast + 2 + (Math.floor(now / 160) & 1);
      if (act && now >= actAt && now - actAt < hdDuration(act as HdAnim)) return hdFrame(act as HdAnim, now - actAt);
      if (hitAt && now >= hitAt && now - hitAt < 220) return hdFrame('hit', now - hitAt);
      return hdFrame(move === Move.Run ? 'run' : move === Move.Walk ? 'walk' : 'idle', now);
    };
    // HD sheets cost a little to build: at most one new one per frame; until then the classic sprite is drawn
    let sheetBudget = 1;
    const hdChar = (ap: Appearance, job: Job) => {
      if (!hd) return null;
      const s = peekHDSheet(ap, job);
      if (s) return s;
      if (sheetBudget <= 0) return null;
      sheetBudget--;
      return getHDSheet(ap, job);
    };
    const hdMon = (mt: string) => {
      if (!hd) return false;
      if (hasMonsterSheet(mt, true)) return true;
      if (sheetBudget <= 0) return false;
      sheetBudget--;
      getMonsterSheet(mt, true);
      return true;
    };
    let targetPos: Remote | null = null;
    for (const r of this.remotes.values()) {
      this.sample(r, rt);
      if (r.rx < camX - 60 || r.rx > camX + vw + 60 || r.ry < camY - 80 || r.ry > camY + vh + 60) continue;
      const b = r.buf;
      const move = r.m || (b.length >= 6 && rt < b[b.length - 3] ? Move.Run : Move.Idle);
      const o = pool.pop() ?? ({} as Drawable);
      o.mark = '';
      o.x = r.rx; o.y = r.ry; o.sheet = r.sheet; o.id = r.meta.id;
      const frac = r.mhp ? r.hp / r.mhp : 0;
      if (r.mt) {
        const mhd = hdMon(r.mt), sc = monsterScale(r.mt), MK = mhd ? HD_M_FRAME / M_FRAME : 1, F = Math.round((mhd ? HD_M_FRAME : M_FRAME) * sc), def = MONSTERS[r.mt];
        if (mhd) o.sheet = getMonsterSheet(r.mt, true);
        let a: MAnim = move ? 'move' : 'idle', t = now;
        if (r.deadAt && now >= r.deadAt) { a = 'death'; t = now - r.deadAt; }
        else if (r.act === 'attack' && now >= r.actAt && now - r.actAt < mAnimDuration('attack')) { a = 'attack'; t = now - r.actAt; }
        else if (r.hitAt && now >= r.hitAt && now - r.hitAt < 170) { a = 'hit'; t = 0; }
        o.sx = mAnimFrame(a, t) * F; o.sy = r.d === 1 ? F : 0; o.sw = F; o.ox = F / 2; o.oy = Math.round(42 * MK * sc) - 9 + (def.flying ? 6 : 0);
        o.aura = 0;
        o.alpha = 1;
        o.pet = o.mount = null; o.flip = false; o.wa = 0;
        const targeted = r.meta.id === this.targetId;
        if (targeted) targetPos = r;
        const show = targeted || def.elite || r.hp < r.mhp || !!r.meta.fz;
        o.label = show && r.hp > 0 ? `${r.meta.ev ? '✦ ' : r.meta.nt ? '☾ ' : r.meta.fz ? '⚔ ' : ''}${r.meta.name}  Lv.${r.meta.level}` : '';
        o.title = '';
        o.mark = r.hp > 0 && this.questMarks().mobs.has(r.mt) ? 'mob' : '';
        o.labelY = monsterHeight(r.mt) * MK - 2 + (def.flying ? 6 : 0);
        o.color = r.meta.ev ? '#7fe8ff' : def.elite ? '#ffb347' : targeted ? '#ff9a8a' : r.meta.nt ? '#b9a2ff' : r.meta.fz ? '#ff7a5a' : '#f0d9d0';
        o.bar = show && r.hp > 0 ? frac : -1;
        o.barW = Math.round(26 * sc);
      } else {
        const ap = r.meta.ap!;
        const hs = hdChar(ap, r.meta.job!);
        if (hs) { o.sheet = hs; o.sx = hcol(r.act, r.actAt, move, r.hitAt, r.deadAt, r.castUntil) * HD; o.sy = r.d * HD; o.sw = HD; o.ox = HD_OX; o.oy = HD_OY; }
        else { o.sx = pcol(r.act, r.actAt, move, r.hitAt, r.deadAt, r.castUntil) * FRAME_W; o.sy = r.d * FRAME_H; o.sw = FRAME_W; o.ox = SPRITE_OX; o.oy = SPRITE_OY; }
        o.aura = r.hp > 0 ? ap.aura : 0;
        o.alpha = r.st & STEALTH_BIT ? 0.4 : 1;
        o.label = `${r.meta.gt ? `[${r.meta.gt}] ` : ''}${r.meta.name}  Lv.${r.meta.level}`;
        o.title = r.meta.ti ? titleName(r.meta.ti) : '';
        o.labelY = (hs ? HD_NAME : NAME_OY) + (ap.helmet === 5 || ap.helmet === 3 ? 8 : 0) + (r.meta.mnt ? 6 : 0);
        const targeted = r.meta.id === this.targetId;
        if (targeted) targetPos = r;
        o.color = targeted ? '#ff9a8a' : this.hud.party?.members.some((m) => m.id === r.meta.id) ? '#8fd0ff' : this.hud.guild && r.meta.gt === this.hud.guild.tag ? '#a8f0b0' : '#ffffff';
        o.pet = r.meta.pet && r.hp > 0 ? (hd ? hdPetSprite : petSprite)(r.meta.pet[0]) : null;
        o.petStage = r.meta.pet ? petStage(r.meta.pet[2]) : 0;
        o.flying = !!(r.meta.mnt && MOUNTS[r.meta.mnt]?.fly);
        o.mount = r.meta.mnt && r.hp > 0 ? (hd ? hdMountSprite : mountSprite)(r.meta.mnt) : null;
        o.flip = r.d === 1;
        o.wa = r.hp > 0 ? r.meta.wa ?? 0 : 0;
        o.wk = r.meta.wk ?? '';
        o.bar = r.hp < r.mhp ? frac : -1;
        o.barW = 24;
      }
      list.push(o);
    }
    {
      const me = this.me, o = pool.pop() ?? ({} as Drawable), mhp = this.hud.stats?.maxHp ?? 1;
      o.mark = '';
      o.x = px; o.y = py; o.sheet = this.sheet!; o.id = me.id;
      o.alpha = this.stealthed ? 0.5 : 1;
      if (hd) { o.sheet = getHDSheet(me.ap, me.job); o.sx = hcol(this.act, this.actAt, this.moving, this.selfHitAt, this.isDead ? this.diedAt : 0, this.castUntil) * HD; o.sy = this.dir * HD; o.sw = HD; o.ox = HD_OX; o.oy = HD_OY; }
      else { o.sx = pcol(this.act, this.actAt, this.moving, this.selfHitAt, this.isDead ? this.diedAt : 0, this.castUntil) * FRAME_W; o.sy = this.dir * FRAME_H; o.sw = FRAME_W; o.ox = SPRITE_OX; o.oy = SPRITE_OY; }
      o.aura = this.isDead ? 0 : me.ap.aura;
      const comp = this.hud.comp, pet = comp.pet ? comp.pets.find((x) => x.uid === comp.pet) : undefined;
      o.label = `${this.hud.guild ? `[${this.hud.guild.tag}] ` : ''}${me.name}  Lv.${me.level}`;
      o.title = this.hud.journal.ti ? titleName(this.hud.journal.ti) : '';
      o.labelY = (hd ? HD_NAME : NAME_OY) + (me.ap.helmet === 5 || me.ap.helmet === 3 ? 8 : 0) + (comp.riding ? 6 : 0);
      o.color = '#ffe08a';
      o.pet = pet && !this.isDead ? (hd ? hdPetSprite : petSprite)(pet.kind) : null;
      o.petStage = pet ? petStage(pet.level) : 0;
      o.flying = isFlying(comp);
      o.mount = comp.riding && !this.isDead ? (hd ? hdMountSprite : mountSprite)(comp.riding) : null;
      o.flip = this.dir === 1;
      o.wa = !this.isDead && this.hud.eq.weapon && me.level >= ARMAMENT_LEVEL ? weaponAura(this.hud.gear.arm.weapon ?? 0) : 0;
      o.wk = this.hud.life?.aura ?? '';
      o.bar = this.hp < mhp ? this.hp / mhp : -1;
      o.barW = 24;
      list.push(o);
    }
    // Townsfolk, resource nodes and caches: static, so they come straight from shared zone data.
    for (const ob of this.objs) {
      if (Math.abs(ob.x - px) > 760 || Math.abs(ob.y - py) > 480) continue;
      const o = pool.pop() ?? ({} as Drawable), npc = isNpc(ob);
      o.mark = npc ? this.questMarks().npc.get(ob.id) ?? '' : '';
      o.x = ob.x; o.y = ob.y; o.id = 0; o.aura = npc ? ob.ap!.aura : 0; o.bar = -1; o.barW = 0; o.alpha = 1;
      o.pet = o.mount = null; o.flip = false; o.wa = 0;
      if (npc) {
        const hs = hdChar(ob.ap!, ob.job!);
        if (hs) { o.sheet = hs; o.sx = (HD_COL.idle + (Math.floor(now / 240 + ob.x) % 4)) * HD; o.sy = 0; o.sw = HD; o.ox = HD_OX; o.oy = HD_OY; }
        else { o.sheet = getCharSheet(ob.ap!, ob.job!); o.sx = (Math.floor(now / 520 + ob.x) % 2) * FRAME_W; o.sy = 0; o.sw = FRAME_W; o.ox = SPRITE_OX; o.oy = SPRITE_OY; }
        o.label = ob.name; o.labelY = hs ? HD_NAME : NAME_OY; o.color = '#9fe0a0';
        o.title = tr(`npc.title.${ob.kind}` as any);
      } else {
        const opened = ob.kind === 'cache' && this.hud.disc.includes(ob.id), spent = ob.kind === 'node' && (this.nodeCd.get(ob.id) ?? 0) > now;
        o.sheet = propSprite(ob.kind === 'cache' ? (opened ? 'cache_open' : 'cache') : ob.res!);
        o.sx = 0; o.sy = 0; o.sw = 32; o.ox = 16; o.oy = 24; o.alpha = spent ? 0.3 : 1;
        o.label = ''; o.labelY = 30; o.color = '#ffffff'; o.title = '';
      }
      list.push(o);
    }
    list.sort((a, b) => a.y - b.y);

    if (targetPos) { // target ring under the monster
      const rad = targetPos.mt ? MONSTERS[targetPos.mt].radius * monsterScale(targetPos.mt) + 5 : 14, pulse = 1 + Math.sin(now / 180) * 0.06;
      g.strokeStyle = this.hud.attacking ? 'rgba(255,90,70,0.95)' : 'rgba(255,220,120,0.9)';
      g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(Math.round(targetPos.rx), Math.round(targetPos.ry) + 8, rad * pulse, rad * 0.45 * pulse, 0, 0, 7); g.stroke();
    }
    const gfx = settings.get().graphics, low = gfx.quality === 'low';
    screenFx.density = low ? 0.35 : gfx.quality === 'medium' ? 0.65 : 1;
    screenFx.glow = !low;
    screenFx.noShake = !gfx.shake;
    // style B: everything drawn from here on lies over the sprites (air effects, canopy, night)
    if (st) {
      g = st.airCtx;
      g.imageSmoothingEnabled = false;
      g.setTransform(z, 0, 0, z, -camX * z, -camY * z);
    }
    let order = 0;
    if (st) for (const tl of visTrees) for (const t of tl) {
      if (t.x > camX + vw + 40 || t.x + t.img.width < camX - 40 || t.y > camY + vh + 40 || t.footY < camY - 40) continue;
      st.sprite(t.img, 0, 0, t.img.width, t.img.height, t.x, t.y, t.img.width, t.img.height, t.footY, order++);
    }
    for (const o of list) {
      const sx = Math.round(o.x), sy = Math.round(o.y);
      if (st) { // billboards with real shadows instead of drawn ones
        const PW = o.pet ? o.pet.width / 2 : 0;
        if (o.pet) {
          const stg = o.petStage ?? 0, pw = Math.round(PW * (1 + 0.15 * stg)), hx = sx + (o.flip ? 18 : -18) - pw / 2;
          st.sprite(o.pet, (Math.floor(now / 300 + o.id) & 1) * PW, 0, PW, PW, hx, sy - pw + 8, pw, pw, sy, order++, o.alpha, o.flip && PW !== PET_W);
        }
        let lift = 0;
        if (o.mount) {
          const MS = 2, hover = o.flying ? 16 + Math.round(Math.sin(now / 300 + o.id) * 2) : 0, f = Math.floor(now / 160 + o.id) & 1;
          lift = 14 + hover;
          if (o.mount.width === HD_MOUNT_W * 2) st.sprite(o.mount, f * HD_MOUNT_W, 0, HD_MOUNT_W, HD_MOUNT_H, sx - HD_MOUNT_W / 2, sy - hover - HD_MOUNT_H + 12, HD_MOUNT_W, HD_MOUNT_H, sy, order++, o.alpha, o.flip);
          else st.sprite(o.mount, f * MOUNT_W, 0, MOUNT_W, MOUNT_H, sx - (MOUNT_W * MS) / 2, sy - hover - MOUNT_H * MS + 14, MOUNT_W * MS, MOUNT_H * MS, sy, order++, o.alpha, o.flip);
        }
        st.sprite(o.sheet, o.sx, o.sy, o.sw, o.sw, sx - o.ox, sy - o.oy - lift, o.sw, o.sw, sy, order++, o.alpha);
        if (o.wa) drawWeaponGlow(g, (o.wk && AURA_SKINS[o.wk]?.color) || WEAPON_AURA_COLORS[o.wa], sx + (o.flip ? -8 : 8), sy - 15 - lift, now, o.wa, o.id);
        if (o.aura && !low) drawAura(g, o.aura, sx, sy, now, o.id);
        continue;
      }
      if (!low) {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath();
        g.ellipse(sx, sy + 9, Math.max(8, o.sw / 5), Math.max(3, o.sw / 13), 0, 0, 7);
        g.fill();
      }
      if (o.alpha < 1) g.globalAlpha = o.alpha;
      if (o.pet) { // the pet keeps to its owner's side, a little behind, hopping
        // evolved pets (levels 20, 40, 60) are larger and glow white, blue and gold
        const PW = o.pet.width / 2, st = o.petStage ?? 0, k = 1 + 0.15 * st, pw = Math.round(PW * k), hx = sx + (o.flip ? 18 : -18) - pw / 2;
        if (st) {
          g.save();
          g.shadowColor = ['', '#ffffff', '#7fe8ff', '#ffd24a'][st];
          g.shadowBlur = 4 + st * 2;
        }
        if (o.flip && PW !== PET_W) { g.save(); g.translate(hx + pw, 0); g.scale(-1, 1); g.drawImage(o.pet, (Math.floor(now / 300 + o.id) & 1) * PW, 0, PW, PW, 0, sy - pw + 8, pw, pw); g.restore(); }
        else g.drawImage(o.pet, (Math.floor(now / 300 + o.id) & 1) * PW, 0, PW, PW, hx, sy - pw + 8, pw, pw);
        if (st) g.restore();
      }
      let lift = 0;
      if (o.mount) { // the mount is drawn under the rider, who sits a little higher
        // mounts are drawn at character scale (twice their pixel size): the rider sits on the saddle
        const MS = 2, hover = o.flying ? 16 + Math.round(Math.sin(now / 300 + o.id) * 2) : 0;
        lift = 14 + hover;
        if (o.flying) { // its shadow stays on the ground
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.beginPath();
          g.ellipse(sx, sy + 8, 26, 7, 0, 0, 7);
          g.fill();
        }
        g.save();
        g.translate(sx, sy - hover);
        if (o.flip) g.scale(-1, 1);
        if (o.mount.width === HD_MOUNT_W * 2) g.drawImage(o.mount, (Math.floor(now / 160 + o.id) & 1) * HD_MOUNT_W, 0, HD_MOUNT_W, HD_MOUNT_H, -HD_MOUNT_W / 2, -HD_MOUNT_H + 12, HD_MOUNT_W, HD_MOUNT_H);
        else g.drawImage(o.mount, (Math.floor(now / 160 + o.id) & 1) * MOUNT_W, 0, MOUNT_W, MOUNT_H, (-MOUNT_W * MS) / 2, -MOUNT_H * MS + 14, MOUNT_W * MS, MOUNT_H * MS);
        g.restore();
      }
      g.drawImage(o.sheet, o.sx, o.sy, o.sw, o.sw, sx - o.ox, sy - o.oy - lift, o.sw, o.sw);
      g.globalAlpha = 1;
      if (o.wa) drawWeaponGlow(g, (o.wk && AURA_SKINS[o.wk]?.color) || WEAPON_AURA_COLORS[o.wa], sx + (o.flip ? -8 : 8), sy - 15 - lift, now, o.wa, o.id);
      if (o.aura && !low) drawAura(g, o.aura, sx, sy, now, o.id);
    }
    // Projectiles fly from the attacker to wherever the target currently is.
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i], k = (now - s.t0) / 140;
      if (k < 0) continue;
      const to = this.posOf(s.to);
      if (k >= 1 || !to) {
        this.shots.splice(i, 1);
        continue;
      }
      const x = Math.round(s.x + (to.x - s.x) * k), y = Math.round(s.y + (to.y - 10 - s.y) * k);
      g.fillStyle = s.color;
      g.fillRect(x - 2, y - 1, 4, 3);
      g.fillStyle = '#ffffff';
      g.fillRect(x - 1, y, 2, 1);
    }
    if (fx25) for (const f of this.fx) drawFxAir(g, f, now, posOf);
    for (const b of this.blasts) drawBlastAir(g, b, now);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      if (f.def.fx.t !== 'zone' && f.def.fx.t !== 'trap' && !drawFx(g, f, now, posOf)) this.fx.splice(i, 1);
    }
    for (let i = this.hits.length - 5; i >= 0; i -= 5)
      if (!drawHit(g, this.hits[i], this.hits[i + 1], now - this.hits[i + 2], this.hits[i + 3] === 1, this.hits[i + 4] ? '#ff7a6a' : '#ffe9a8', this.hits[i + 2] % 1000)) this.hits.splice(i, 5);
    this.warm = warm && sheetBudget > 0; // nothing had to be built this frame
    // Canopy layer: drawn over characters so they pass behind tree tops.
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const o = this.chunk(cx, cy, map, false)?.over;
        if (o) g.drawImage(o, cx * CHUNK_PX, cy * CHUNK_PX);
      }
    // A home: furniture and the garden, drawn on the floor in screen space.
    if (this.hud.home && map.def.id === 'h_home') {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${Math.round(TILE * z * 0.8)}px serif`;
      for (const f of this.hud.home.furn) g.fillText(FURNITURE[f.base]?.glyph ?? '?', ((f.tx + 0.5) * TILE - camX) * z, ((f.ty + 0.5) * TILE - camY) * z);
      [[19, 13], [21, 13], [23, 13]].forEach(([tx, ty], i) => {
        const p = this.hud.home!.garden[i], ripe = p && Date.now() - p.at >= GROW_MS;
        g.fillText(p ? (ripe ? '🌾' : '🌱') : '🟫', ((tx + 0.5) * TILE - camX) * z, ((ty + 0.5) * TILE - camY) * z);
      });
      g.textBaseline = 'alphabetic';
    }
    // Night and weather, in screen space under the name plates.
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (settings.get().graphics.weather) {
      const lights = [{ x: (px - camX) * z, y: (py - 10 - camY) * z }];
      const town = map.def.town;
      if (town) lights.push({ x: (town.tx * TILE - camX) * z, y: (town.ty * TILE - camY) * z });
      this.sky.draw(g, W, H, now, this.skyNow(now), map.def.id, map.def.theme, map.def.kind === 'dungeon', lights, screenFx.density, st ? 0.3 : 1);
    }
    // Name plates, health bars and combat text in screen space so they stay sharp at any zoom.
    if (st) {
      g = this.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    g.font = '600 12px "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(10,12,20,0.85)';
    g.lineJoin = 'round';
    for (const o of list) {
      const tx = Math.round((o.x - camX) * z), ty = Math.round((o.y - camY - o.labelY) * z);
      if (o.bar >= 0) {
        const w = o.barW * z, x = tx - w / 2;
        g.fillStyle = 'rgba(10,12,20,0.85)';
        g.fillRect(x - 1, ty + 3, w + 2, 6);
        g.fillStyle = o.bar > 0.5 ? '#5fd35a' : o.bar > 0.25 ? '#e8c23a' : '#e2523f';
        g.fillRect(x, ty + 4, Math.max(1, Math.round(w * o.bar)), 4);
      }
      if (o.label && (gfx.nameplates || o.id === this.targetId || o.id === this.me?.id || o.id === 0)) {
        g.strokeText(o.label, tx, ty);
        g.fillStyle = o.color;
        g.fillText(o.label, tx, ty);
        if (o.title) {
          // the title worn, small and gold, above the name
          const f = g.font;
          g.font = `italic 600 ${Math.max(9, Math.round(Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 12) * 0.85))}px Georgia, serif`;
          g.strokeText(`« ${o.title} »`, tx, ty - 12);
          g.fillStyle = '#e8c56a';
          g.fillText(`« ${o.title} »`, tx, ty - 12);
          g.font = f;
        }
      }
      if (o.mark) this.drawQuestMark(g, o.mark, tx, ty - (o.title ? 26 : 12), now);
    }
    const showDmg = settings.get().graphics.damageNumbers;
    g.lineJoin = 'round';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i], st = FLOAT_STYLE[f.kind ?? (f.big ? 'info' : 'other')], age = now - f.t0, k = age / st.life;
      if (k >= 1) {
        this.floaters.splice(i, 1);
        continue;
      }
      if (age < 0 || (st.damage && !showDmg)) continue;
      // pop in (large, then settling), rise with an easing, fade at the end
      const popK = Math.min(1, age / 140), scale = st.pop + (1 - st.pop) * (1 - (1 - popK) * (1 - popK));
      const rise = (1 - (1 - k) * (1 - k)) * st.rise;
      g.font = `800 ${Math.round(st.px * scale)}px "Trebuchet MS", sans-serif`;
      g.globalAlpha = k > 0.65 ? (1 - k) / 0.35 : 1;
      const tx = (f.x - camX) * z, ty = (f.y - camY) * z - rise - (f.lift ?? 0);
      g.lineWidth = Math.max(3, Math.round(st.px / 4));
      g.strokeStyle = 'rgba(12,8,18,0.95)';
      g.strokeText(f.text, tx, ty);
      g.fillStyle = f.color;
      g.fillText(f.text, tx, ty);
    }
    g.globalAlpha = 1;
    g.lineWidth = 3;
    if (screenFx.flash > 0.02) {
      // lightning and great impacts light the whole screen for a few frames
      g.globalAlpha = Math.min(0.6, screenFx.flash);
      g.fillStyle = screenFx.flashColor;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      screenFx.flash *= 0.8;
    }
    if (this.dbgOn) this.drawDebug(g, map, camX, camY, z, W, H);
    if (this.isDead) {
      g.fillStyle = 'rgba(40,10,14,0.35)';
      g.fillRect(0, 0, W, H);
    }
    if (st) {
      st.airDirty = true;
      const indoor = map.def.kind === 'dungeon', day = 1 - darkness(this.skyNow(now)), night = indoor ? 0.6 : 1 - day;
      // night lights: the hero's lantern, the town square and the doors of houses, nearest first
      const lamps: { x: number; y: number; h: number; color: number; power: number; range: number }[] = [];
      if (night > 0.15) {
        lamps.push({ x: px, y: py - 4, h: 46, color: 0xffc27a, power: 7000 * night, range: 300 });
        const town = map.def.town;
        if (town) lamps.push({ x: town.tx * TILE + 16, y: town.ty * TILE + 16, h: 70, color: 0xffb060, power: 16000 * night, range: 420 });
        const near = this.doors.filter((d) => Math.abs(d.x - px) < vw && Math.abs(d.y - py) < vh).sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py));
        for (const d of near.slice(0, 4)) lamps.push({ x: d.x, y: d.y, h: 34, color: 0xff9a40, power: 4500 * night, range: 240 });
      }
      st.setLights(lamps);
      st.render(camX, camY, z, Math.max(0, Math.min(1, ((py - camY) * z) / H)), day, indoor, gfx.quality === 'high');
    }
    if (this.mini && now - this.miniAt > 200) {
      this.miniAt = now;
      this.drawMinimap(map, px, py);
    }
  }

  /** The world clock for light and weather (visual checks may shift it with window.__clockShift). */
  private skyNow(now: number) {
    return now + (this.timeOffset ?? 0) + (Number((window as any).__clockShift) || 0);
  }

  /** The WebGL stage when style B is on and this browser can run it; created on first use. */
  private stage: Stage3D | null = null;
  private chunksStaged = false;
  private stageZone = '';
  private doors: { x: number; y: number }[] = [];
  private stageOff = false;
  private stageNow(): Stage3D | null {
    if (settings.get().graphics.renderer !== 'hd2d' || this.stageOff) {
      if (this.stage) { this.stage.destroy(); this.stage = null; this.canvas.classList.remove('over3d'); }
      return null;
    }
    if (this.stage) return this.stage;
    if (!stageSupported()) { this.stageOff = true; return null; }
    try {
      this.stage = new Stage3D(this.canvas.parentElement!, this.canvas, CHUNK_PX);
      this.canvas.classList.add('over3d');
    } catch (e) {
      console.warn('3D stage unavailable, using the 2D renderer', e);
      this.stageOff = true;
    }
    return this.stage;
  }

  /** Quest givers with something for this character, and the monsters active quests still need; refreshed twice a second. */
  private qm = { at: -1e9, npc: new Map<string, string>(), mobs: new Set<string>(), spots: [] as { x: number; y: number }[] };
  private questMarks() {
    if (performance.now() - this.qm.at < 500) return this.qm;
    const h = this.hud, zone = this.map?.def.id, lv = h.self?.level ?? 0, npc = new Map<string, string>(), mobs = new Set<string>(), spots: { x: number; y: number }[] = [];
    if (settings.get().graphics.questMarkers !== false) {
      for (const id of Object.keys(h.quests.active)) {
        const q = QUESTS[id];
        if (!q) continue;
        const p = h.qprog[id] ?? q.objectives.map(() => 0);
        if (q.objectives.every((o, i) => (p[i] ?? 0) >= o.n)) npc.set(giverId(q), '?');
        else q.objectives.forEach((o, i) => {
          if ((p[i] ?? 0) >= o.n) return;
          if ((o.kind === 'kill' || o.kind === 'boss' || o.kind === 'loot') && o.mob && (o.kind !== 'kill' || !o.zone || o.zone === zone)) mobs.add(o.mob);
          if (o.kind === 'talk' && !npc.has(o.npc)) npc.set(o.npc, '…');
          if (o.kind === 'visit' && o.zone === zone) spots.push({ x: o.x, y: o.y });
        });
      }
      const now = Date.now();
      for (const q of QUEST_LIST) {
        if (h.quests.active[q.id] || npc.has(giverId(q)) || (q.repeat !== 'once' && q.type !== 'main') || acceptBlock(q, h.quests, lv, h.rep, now)) continue;
        if (this.objs.some((o) => o.id === giverId(q))) npc.set(giverId(q), '!');
      }
    }
    this.qm = { at: performance.now(), npc, mobs, spots };
    return this.qm;
  }
  private drawQuestMark(g: CanvasRenderingContext2D, mark: string, x: number, y: number, now: number) {
    const bob = Math.round(Math.sin(now / 260) * 2);
    g.save();
    if (mark === 'mob') {
      // a small gold diamond over a monster a quest needs
      const s = 4, cy = y - 4 + bob;
      g.fillStyle = '#ffd24a';
      g.strokeStyle = '#2a1c05';
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, cy - s); g.lineTo(x + s, cy); g.lineTo(x, cy + s); g.lineTo(x - s, cy); g.closePath();
      g.stroke(); g.fill();
    } else {
      const cy = y - 10 + bob;
      g.font = 'bold 20px Georgia, serif';
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = '#2a1c05';
      g.strokeText(mark, x, cy);
      g.fillStyle = mark === '?' ? '#ffe14a' : '#ffc23a';
      g.shadowColor = 'rgba(255,200,60,0.8)';
      g.shadowBlur = 8;
      g.fillText(mark, x, cy);
    }
    g.restore();
  }
  private drawMinimap(map: ZoneMap, px: number, py: number) {
    const c = this.mini!, g = c.getContext('2d')!;
    if (!this.miniBase) {
      const b = (this.miniBase = document.createElement('canvas'));
      b.width = map.w;
      b.height = map.h;
      const bg = b.getContext('2d')!;
      const col = (settings.get().graphics.art === 'hd' ? hdMiniColors : miniColors)(map.def.theme);
      for (let y = 0; y < map.h; y++)
        for (let x = 0; x < map.w; x++) {
          bg.fillStyle = col[map.tiles[x + y * map.w]];
          bg.fillRect(x, y, 1, 1);
        }
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniBase, 0, 0, c.width, c.height);
    const sx = c.width / (map.w * TILE), sy = c.height / (map.h * TILE);
    const qm = this.questMarks();
    for (const r of this.remotes.values()) {
      if (r.mt && r.hp <= 0) continue;
      if (r.mt && qm.mobs.has(r.mt)) {
        // monsters an active quest needs: larger gold dots with a dark rim
        g.fillStyle = '#2a1c05';
        g.fillRect(r.rx * sx - 2, r.ry * sy - 2, 5, 5);
        g.fillStyle = '#ffd24a';
        g.fillRect(r.rx * sx - 1, r.ry * sy - 1, 3, 3);
        continue;
      }
      g.fillStyle = r.mt ? (MONSTERS[r.mt].elite ? '#ffb347' : '#e2523f') : '#ffffff';
      g.fillRect(r.rx * sx - 1, r.ry * sy - 1, r.mt ? 2 : 3, r.mt ? 2 : 3);
    }
    for (const sp of qm.spots) { // a place a story step sends the player to
      g.strokeStyle = '#2a1c05'; g.lineWidth = 3;
      g.beginPath(); g.arc(sp.x * sx, sp.y * sy, 5, 0, 7); g.stroke();
      g.strokeStyle = '#ffe14a'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(sp.x * sx, sp.y * sy, 5, 0, 7); g.stroke();
    }
    if (qm.npc.size) {
      g.font = 'bold 12px Georgia, serif';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = '#2a1c05';
      for (const ob of this.objs) {
        const m = qm.npc.get(ob.id);
        if (!m) continue;
        g.strokeText(m, ob.x * sx, ob.y * sy + 4);
        g.fillStyle = '#ffe14a';
        g.fillText(m, ob.x * sx, ob.y * sy + 4);
      }
      g.textAlign = 'left';
    }
    // party members in this zone, including those beyond the visible area
    const party = this.hud.party;
    if (party && this.me) {
      g.fillStyle = '#5fb8ff';
      for (const m of party.members) if (m.id !== this.me.id && m.zone === map.def.id) g.fillRect(m.x * sx - 2, m.y * sy - 2, 4, 4);
    }
    if (map.def.depth) {
      // the Depths: a red frame (open PvP everywhere), the sanctuary in green, bounties as red marks
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(240,70,50,0.9)';
      g.strokeRect(1, 1, c.width - 2, c.height - 2);
      const s = map.def.sanctuary;
      if (s) {
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(120,235,160,0.95)';
        g.beginPath(); g.ellipse(s.tx * TILE * sx, s.ty * TILE * sy, s.r * TILE * sx, s.r * TILE * sy, 0, 0, 7); g.stroke();
      }
      g.fillStyle = '#ff3b2f';
      for (const b of this.hud.bounty) if (b.id !== this.me?.id) {
        g.beginPath(); g.arc(b.x * sx, b.y * sy, 3, 0, 7); g.fill();
      }
    }
    g.fillStyle = '#ffd24a';
    g.fillRect(px * sx - 2, py * sy - 2, 4, 4);
  }

  /**
   * Developer overlay (F9, only when the server was started with DEBUG_OVERLAY=1): collision
   * tiles, ground that cannot be reached, and for every monster its spawn point, patrol, aggro
   * and leash radius, AI state, current route and the reason its last move failed.
   */
  private drawDebug(g: CanvasRenderingContext2D, map: ZoneMap, camX: number, camY: number, z: number, W: number, H: number) {
    const nav = navOf(map.def.id), sx = (x: number) => (x - camX) * z, sy = (y: number) => (y - camY) * z;
    const tx0 = Math.max(0, Math.floor(camX / TILE)), ty0 = Math.max(0, Math.floor(camY / TILE));
    const tx1 = Math.min(map.w - 1, Math.floor((camX + W / z) / TILE)), ty1 = Math.min(map.h - 1, Math.floor((camY + H / z) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = tx + ty * map.w;
      if (!nav.walk[i]) g.fillStyle = 'rgba(255,60,60,0.22)'; // collision
      else if (!nav.reach[i]) g.fillStyle = 'rgba(255,170,0,0.35)'; // walkable but cut off: nothing may spawn here
      else continue;
      g.fillRect(sx(tx * TILE), sy(ty * TILE), TILE * z, TILE * z);
    }
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    for (let tx = tx0; tx <= tx1 + 1; tx++) { g.moveTo(sx(tx * TILE), 0); g.lineTo(sx(tx * TILE), H); }
    for (let ty = ty0; ty <= ty1 + 1; ty++) { g.moveTo(0, sy(ty * TILE)); g.lineTo(W, sy(ty * TILE)); }
    g.stroke();
    const ring = (x: number, y: number, r: number, color: string, dash: number[] = []) => {
      if (r <= 0) return;
      g.strokeStyle = color;
      g.setLineDash(dash);
      g.beginPath();
      g.arc(sx(x), sy(y), r * z, 0, 7);
      g.stroke();
    };
    g.font = '11px monospace';
    g.textAlign = 'center';
    for (const m of this.dbgMobs) {
      const [, state, x, y, spx, spy, patrol, aggro, leash, why] = m as [number, string, number, number, number, number, number, number, number, string];
      g.lineWidth = 1;
      ring(spx, spy, patrol, 'rgba(120,220,120,0.8)');
      ring(spx, spy, leash, 'rgba(120,160,255,0.5)', [6, 6]);
      ring(x, y, aggro, 'rgba(255,120,80,0.6)', [2, 4]);
      g.setLineDash([]);
      g.fillStyle = '#7fe08a';
      g.fillRect(sx(spx) - 3, sy(spy) - 3, 6, 6); // spawn point
      if (m.length > 10) {
        g.strokeStyle = '#ffe14a';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(sx(x), sy(y));
        for (let i = 10; i + 1 < m.length; i += 2) g.lineTo(sx(m[i] as number), sy(m[i + 1] as number));
        g.stroke();
      }
      g.fillStyle = why ? '#ff8f7a' : '#ffffff';
      g.fillText(why ? `${state}: ${why}` : state, sx(x), sy(y) + 14);
    }
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.fillText('DEBUG  red: collision  orange: unreachable  green: patrol  blue: leash  dotted red: aggro  yellow: route  (F9)', 10, H - 30);
  }
  /** Test/debug hook. */
  debug() {
    const now = performance.now();
    const anim = (act: string | null, at: number, move: number) =>
      act && now >= at && now - at < animDuration(act as Anim) ? act : move === Move.Run ? 'run' : move === Move.Walk ? 'walk' : 'idle';
    const all = [...this.remotes.values()];
    return {
      x: this.cur.x, y: this.cur.y, zone: this.map?.def.id, warm: this.warm, skyClock: this.skyNow(now) - (Number((window as any).__clockShift) || 0), remotes: all.filter((r) => !r.mt).length, pending: this.pending.length / 4, ...this.stats, hud: this.hud,
      anim: this.isDead ? 'death' : this.castUntil > now ? 'cast' : anim(this.act, this.actAt, this.moving), dead: this.isDead, fx: this.fx.map((f) => f.def.id), targetId: this.targetId, zoom: this.zoom, camX: this.camX, camY: this.camY,
      remoteList: all.filter((r) => !r.mt).map((r) => ({ id: r.meta.id, name: r.meta.name, ap: r.meta.ap, anim: r.castUntil > now ? 'cast' : anim(r.act, r.actAt, r.m), x: r.rx, y: r.ry, hp: r.hp, st: r.st })),
      dev: this.dev, dbgOn: this.dbgOn, dbgMobs: this.dbgMobs, auto: { on: this.hunter.on, status: this.hunter.status, target: this.hunter.targetName, area: this.hunter.on ? this.hunter.area() : null },
      monsters: all.filter((r) => r.mt).map((r) => ({ id: r.meta.id, type: r.mt, x: r.rx, y: r.ry, hp: r.hp, mhp: r.mhp, st: r.st })),
    };
  }
}
