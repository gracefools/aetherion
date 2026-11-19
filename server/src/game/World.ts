// Server-authoritative world simulation: zone rooms (with channels), fixed tick, input
// budgeting, combat resolution, monster AI, interest-managed delta snapshots, reconnect grace
// and batched persistence.
import { Friends } from './Friends';
import { applyGuild, type GuildBuildings } from '../../../shared/src/economy';
import { inSanctuary, inTown, MONSTER_TOWN_CLEAR, nearTown } from '../../../shared/src/pvp';
import { BOUNTY_STREAK, DEPTH_MONSTER, SANCTUARY_LEAVE_SHIELD_MS, SANCTUARY_SHIELD_EVERY_MS, type DepthBossState } from '../../../shared/src/depths';
import { applySigilSets, ARMAMENT_LEVEL, armamentDrops, armMultipliers, cleanGear, effectiveRanks, emptyGear, rollSigil, SIGIL_DROP, sigilTierForBoss, weaponAura, worldBossArmament, type Gear } from '../../../shared/src/gear';
import { performance } from 'node:perf_hooks';
import {
  COMBAT_TIMEOUT_MS, Dmg, expLevelFactor, expToNext, missChance, mitigate, RAGE_PER_HIT, RAGE_PER_HIT_TAKEN,
  RESPAWN_AUTO_MS, RESPAWN_MIN_MS, STATUS, STATUS_INDEX, weaponRule, type WeaponRule,
} from '../../../shared/src/combat';
import { cleanBuild, type Build } from '../../../shared/src/abilities';
import { applyGear, cleanInventory, ITEMS, RARITIES, rollBossItem, SECOND_WIND_CD_MS, type Equipment, type Item, type ItemSpec } from '../../../shared/src/items';
import { award, distributeLoot, grantStarterKit, invOp, sendInv, consume, count } from './Inventory';
import { Dungeons } from './Dungeon';
import { Journals } from './Journal';
import { Mail } from './Mail';
import { WorldEvents } from './WorldEvents';
import { Rifts } from './Rift';
import { Raids } from './Raid';
import { Conquest } from './Conquest';
import { Lives } from './Life';
import { AURA_SKINS, emptyLife, type Life } from '../../../shared/src/life';
import { applyMastery, applyPath, cleanAscension, emptyAscension, MASTERY_STATS, masteryCap, masteryEarned, masterySpent, PATH_INDEX, ASCENSION_LEVEL, LOADOUTS, ULT_PER_HIT, ULT_PER_HURT, ULT_PER_KILL, type Ascension } from '../../../shared/src/ascension';
import { chargeUlt } from './Abilities';
import { AWAKEN_LEVEL, awakenCost } from '../../../shared/src/awakening';
import { applyJournal, emptyJournal, type Journal } from '../../../shared/src/journal';
import { cleanDiscoveries, discoverWaystones, objOp } from './Places';
import { computeStats, JOB_DEFS, MAX_LEVEL, type Stats } from '../../../shared/src/jobs';
import { DEPTH_BOSSES, MONSTERS, SPAWNS, spawnRegions, WORLD_BOSSES } from '../../../shared/src/monsters';
import { navOf, spawnFault } from '../../../shared/src/nav';
import { cleanAutoConfig, emptyAutoStats, type AutoConfig, type AutoStats } from '../../../shared/src/autohunt';
import { Trades } from './Trade';
import { Quests } from './Quests';
import { Guilds } from './Guilds';
import { Economy } from './Economy';
import { Pvp } from './Pvp';
import { companionOp, dismount, petExp } from './Companions';
import { emptyQuests, type QuestState } from '../../../shared/src/quests';
import { applyCompanions, cleanCompanions, companionLook, MOUNT_FORBIDDEN_KINDS, type Companions, isFlying } from '../../../shared/src/companions';
import { DEFAULT_AUCTION_RATES, emptyBank, type AuctionRates, type Bank } from '../../../shared/src/economy';
import { cleanItem } from '../../../shared/src/items';
import type { Snapshot } from '../db/repo';
import { BOSS_SCROLL } from '../../../shared/src/runes';
import {
  AOI_HALF_H, AOI_HALF_W, MAX_CHAT_LEN, PARTY_EXP_BONUS, PLAYER_HALF, TICK_MS, TILE, Act, Dir, Move,
  type Appearance, type DamageEvent, type EntityEvent, type EntityMeta, type EntityMove, type Job, type PlayerMeta,
  type SelfState, type ServerMsg, type SnapMsg, type VitalUpdate,
  type Cue,
} from '../../../shared/src/protocol';
import { blocked, DEPTH_ZONES, EXIT, getZoneMap, portalAt, stepMove, stepSize, tileCenter, ZONES, type ZoneMap } from '../../../shared/src/world';
import type { CharacterRow, Repo } from '../db/repo';
import { attune, cancelCast, learn, noteDamage, respec, tickCast, updateFields, useAbility, type Casting, type Field } from './Abilities';
import { applyStatus, clearStatuses, emit, NO_MODS, pushDmg, removeStatus, tickStatuses, type Ent } from './entity';
import { Monster, type CombatCtx, type MonsterScale } from './Monster';
import { Parties, type Party } from './Party';
import { SpatialGrid } from './SpatialGrid';
import { Traits } from './Traits';
import { AUTO_EXP, AUTO_REST_MS, AUTO_WEARY_EXP, AUTO_WEARY_MS, RHYTHM_EXP, RHYTHM_MAX, RHYTHM_WINDOW_MS, talentsOf } from '../../../shared/src/talents';

export interface Conn {
  send(data: string): void;
  close(): void;
}

const INPUT_QUEUE_MAX = 8;
const INPUT_BURST = 3; // inputs a player may consume in one tick after a network hiccup
const IDLE_SNAP_TICKS = 20; // heartbeat snapshot interval for idle players
const TARGET_RANGE = 700; // a target further away than this is dropped
const ticks = (ms: number) => Math.ceil(ms / TICK_MS);
/** Largest half-extent of the world a client can show (1280x720 at the minimum zoom), plus a margin. */
const VIEW_HALF_W = Number(process.env.VIEW_HALF_W ?? 680), VIEW_HALF_H = Number(process.env.VIEW_HALF_H ?? 400);
/** `known` packs two versions into one number: movement version * PACK + vitals version. */
const PACK = 4194304;
/** Serialised snapshot fragments cached on an entity: valid while the version / tick they were made for is current. */
interface Frag {
  fMv?: string; fMvV?: number;
  fHp?: string; fHpV?: number;
  fEv?: string; fEvT?: number;
  fDm?: string; fDmT?: number;
}

export class Player implements Ent {
  readonly isPlayer = true;
  x = 0;
  y = 0;
  cell = 0;
  dir: number = Dir.Down;
  moving: number = Move.Idle;
  ver = 1; // bumped whenever replicated movement state changes
  sver = 1; // bumped whenever replicated vitals change
  inQ: number[] = []; // packed (seq, ix, iy, run) tuples
  stats!: Stats;
  rule!: WeaponRule;
  walkStep = 0;
  runStep = 0;
  hp = 0;
  maxHp = 0;
  res = 0;
  dead = false;
  deadTick = 0;
  st = [] as Ent['st'];
  mask = 0;
  mods = NO_MODS;
  lastCombat = -1000;
  /** Receiving developer overlay data (only possible when the server allows it). */
  debug = false;
  // auto hunting: the saved configuration, whether a session is running, and its figures
  autoCfg: AutoConfig;
  autoCfgDirty = false;
  autoOn = false;
  autoStats: AutoStats = emptyAutoStats();
  autoStart = 0;
  lastTradeInvite = 0;
  // M13-M15
  quests: QuestState = emptyQuests();
  rep: Record<string, number> = {};
  bank: Bank = emptyBank();
  comp: Companions;
  /** Quests, reputation or companions changed since the last save. */
  progDirty = false;
  /** Life outside combat: professions, home, season pass, wardrobe. */
  life: Life = emptyLife();
  /** Ascension: the path, mastery points and saved loadouts (level 70 on). */
  asc: Ascension = emptyAscension();
  /** The ultimate gauge (0-100) and when the last ultimate was cast. */
  ult = 0;
  ultAt = 0;
  /** Combo chain progress: the next step and when the last one landed. */
  combo = { i: 0, at: 0 };
  /** Experience past the level cap, turned into mastery points. */
  capExp = 0;
  /** The adventurer's journal (achievements, codex, missions, login streak). */
  journal: Journal = emptyJournal();
  journalDirty = false;
  /** A database-backed economy operation is in flight. */
  econBusy = false;
  /** The guild tag shown on the name plate. */
  gtag = '';
  /** The buildings of the character's guild (stats), and their key to notice a change. */
  guildB: GuildBuildings | null = null;
  guildKey = '';
  /** Player being auto-attacked (PvP), separate from the monster target. */
  pvpTarget: Player | null = null;
  pvpShieldUntil = 0;
  /** Struck another player: until then the sanctuary of the Depths gives no shelter and portals stay shut. */
  pvpTagUntil = 0;
  /** The Depths: standing in the sanctuary last tick, and when leaving it last gave protection. */
  inSanct = false;
  sanctShieldAt = 0;
  /** Players defeated in a row in the Depths (a bounty at BOUNTY_STREAK). */
  streak = 0;
  /** Agreed to the warning shown before entering the Depths (once per session). */
  depthOk = false;
  portalMsgAt = 0;
  evs: number[][] = [];
  evTick = -1;
  dmgs: number[][] = [];
  dmgTick = -1;
  target: Monster | null = null;
  attacking = false;
  nextAttack = 0; // tick
  swingTick = -1000; // last free swing
  build: Build;
  buildDirty = false;
  cds = new Map<string, number>(); // ability id -> tick it is ready again
  /** Talents (G2): Momentum's target and stacks, Bulwark's next ready tick. */
  momTarget = 0;
  momStacks = 0;
  bulwarkAt = 0;
  /** Battle Rhythm (G5): kills made by hand in quick succession, and when the last one was. */
  rhythm = 0;
  rhythmAt = 0;
  /** Auto hunting: when the current stretch began and when it was last switched off (ms). */
  autoSince = 0;
  autoOffAt = 0;
  /** Whether this character has chosen a talent. */
  hasTalent(id: string) {
    return talentsOf(this.build.skills).some((t) => t.id === id);
  }
  gcd = 0;
  casting: Casting | null = null;
  party: Party | null = null;
  inv: Item[] = [];
  eq: Equipment = {};
  /** Armament levels and equipped sigils. */
  gear: Gear = emptyGear();
  gold = 0;
  kit = false;
  invDirty = false;
  potionReady = 0;
  /** Unique passives granted by equipped items. */
  passives: string[] = [];
  secondWindReady = 0;
  /** Where the player entered a dungeon from; they return here when they leave. */
  ret: { zone: string; x: number; y: number } | null = null;
  /** Waystones attuned and hidden caches opened (persisted). */
  disc: Set<string>;
  discDirty = false;
  /** Effective look: the creator's choices with equipped weapon, armour and helmet applied. */
  ap: Appearance;
  invite: { from: number; until: number } | null = null;
  lastInvite = 0;
  selfDirty = true;
  xpGained = 0;
  budget = 1;
  lastSeq = 0;
  idleTicks = 0;
  sinceSnap = 0;
  needAck = false;
  conn: Conn | null = null;
  disconnectedAt = 0;
  dirty = false;
  room!: ZoneRoom;
  known = new Map<number, number>(); // entity id -> what this client was last sent: ver * PACK + sver
  chatTokens = 5;
  constructor(
    readonly id: number,
    readonly accountId: number,
    readonly name: string,
    readonly job: Job,
    public level: number,
    public exp: number,
    readonly baseAp: Appearance,
    build: unknown = null,
    store: { gold?: number; inventory?: unknown; equipment?: unknown; discoveries?: unknown; auto_hunt?: unknown; bank?: unknown; companions?: unknown; gear?: unknown } = {},
  ) {
    this.comp = cleanCompanions(store.companions);
    this.disc = cleanDiscoveries(store.discoveries);
    this.autoCfg = cleanAutoConfig(store.auto_hunt);
    this.ap = baseAp;
    this.build = cleanBuild(job, level, build);
    const c = cleanInventory(job, level, store.inventory, store.equipment);
    {
      const seen = new Set<string>([...c.inv.map((x) => x.uid), ...Object.values(c.eq).map((x) => x!.uid)]);
      this.gear = cleanGear(store.gear, (r) => cleanItem(r, seen));
    }
    this.inv = c.inv;
    this.eq = c.eq;
    this.kit = c.kit;
    this.gold = Number.isFinite(store.gold) ? Math.max(0, Math.floor(store.gold!)) : 0;
    // the bank shares the duplicate check with the bag: one item id, one place
    const seen = new Set<string>([...this.inv.map((i) => i.uid), ...Object.values(this.eq).map((i) => i!.uid), ...this.gear.sig.filter(Boolean).map((i) => i!.uid)]);
    const rb = (store.bank && typeof store.bank === 'object' ? store.bank : {}) as any;
    this.bank = { items: (Array.isArray(rb.items) ? rb.items : []).map((x: unknown) => cleanItem(x, seen)).filter((x: Item | null): x is Item => !!x).slice(0, 200), gold: Number.isInteger(rb.gold) && rb.gold > 0 ? rb.gold : 0 };
    this.recalc();
    this.hp = this.maxHp;
    this.res = JOB_DEFS[job].resource === 'rage' ? 0 : this.stats.maxRes;
  }
  /** Stats are derived on the server from job + level + weapon; the client never supplies them. */
  recalc() {
    // The equipped weapon decides the specialisation; armour and helmet show on the character.
    const wslot = this.eq.weapon ? ITEMS[this.eq.weapon.base].wslot! : this.baseAp.weapon;
    const ap = { ...this.baseAp, weapon: wslot };
    for (const it of [this.life.tmog.armor ? { base: this.life.tmog.armor } : this.eq.armor, this.life.tmog.helmet ? { base: this.life.tmog.helmet } : this.eq.helmet]) {
      const look = it && ITEMS[it.base].look;
      if (!look) continue;
      if (look.armor !== undefined) (ap.armor = look.armor), (ap.armorColor = look.color ?? ap.armorColor);
      if (look.helmet !== undefined) (ap.helmet = look.helmet), (ap.helmetColor = look.color ?? ap.helmetColor);
    }
    this.ap = ap;
    // sigils raise learned skills; armament boosts the main stats of each slot's item; sigil sets come last
    this.stats = computeStats(this.job, this.level, wslot, effectiveRanks(this.job, this.level, this.gear, this.build.skills));
    this.passives = applyGear(this.stats, this.eq, armMultipliers(this.gear, this.level)).passives;
    applySigilSets(this.stats, this.gear, this.level);
    if (this.comp) applyCompanions(this.stats, this.comp);
    applyJournal(this.stats, this.journal);
    applyPath(this.stats, this.asc.path, this.level);
    applyMastery(this.stats, this.asc.mastery);
    applyGuild(this.stats, this.guildB);
    this.rule = weaponRule(this.job, JOB_DEFS[this.job].weapons[wslot].kind, wslot);
    this.maxHp = this.stats.maxHp;
    this.onStatusChange();
  }
  onStatusChange() {
    const mul = this.stats.moveMul * this.mods.move;
    this.walkStep = stepSize(mul, false);
    this.runStep = stepSize(mul, true);
    this.selfDirty = true;
  }
  meta(): PlayerMeta {
    return { id: this.id, name: this.name, job: this.job, level: this.level, ap: this.ap, x: this.x, y: this.y, d: this.dir, hp: this.hp, mhp: this.maxHp, st: this.mask, ...companionLook(this.comp), ...(this.gtag ? { gt: this.gtag } : {}), ...(this.weaponGlow() ? { wa: this.weaponGlow() } : {}), ...(this.journal.ti ? { ti: this.journal.ti } : {}), ...(this.life.aura && AURA_SKINS[this.life.aura] ? { wk: this.life.aura } : {}) };
  }
  /** Weapon glow from the weapon armament (+6, +12, +18), shown only while a weapon is equipped. */
  weaponGlow(): number {
    return this.eq.weapon && this.level >= ARMAMENT_LEVEL ? weaponAura(this.gear.arm.weapon ?? 0) : 0;
  }
}

export class ZoneRoom {
  readonly map: ZoneMap;
  readonly players = new Map<number, Player>();
  readonly monsters = new Map<number, Monster>();
  readonly grid = new SpatialGrid<Ent>(256);
  fields: Field[] = [];
  /** Resource nodes that were gathered: object id -> tick they are ready again. */
  readonly nodeReady = new Map<string, number>();
  /** What happened when each spawn region was populated: how many were placed, and why candidate points were rejected. */
  readonly spawnLog: { region: string; wanted: number; placed: number; rejected: Record<string, number> }[] = [];
  constructor(readonly zoneId: string, readonly channel: number) {
    this.map = getZoneMap(zoneId);
  }
  add(p: Player) {
    p.room = this;
    p.known.clear();
    p.inQ.length = 0;
    p.moving = Move.Idle;
    p.target = null;
    p.pvpTarget = null;
    p.attacking = false;
    p.casting = null;
    p.selfDirty = true;
    p.ver++;
    this.players.set(p.id, p);
    this.grid.insert(p);
  }
  remove(p: Player) {
    this.players.delete(p.id);
    this.grid.remove(p);
    for (const m of this.monsters.values()) m.threat.delete(p.id);
  }
}

export interface Metrics {
  tick: number;
  players: number;
  connected: number;
  rooms: number;
  monsters: number;
  parties: number;
  tickMs: { avg: number; p95: number; p99: number; max: number; samples: number };
  lateTicks: number;
  msgsOut: number;
  bytesOut: number;
  msgsIn: number;
  uptimeSec: number;
}

export interface WorldOpts {
  /** Raiders needed to start a raid (lowered in tests). */
  raidMin?: number;
  /** World events and the night's monsters start by themselves (off in tests, which start them on purpose). */
  events?: boolean;
  roomCapacity: number;
  reconnectGraceMs: number;
  autosaveMs: number;
  /** Deterministic randomness for tests. */
  rng?: () => number;
  dropRate?: number;
  goldRate?: number;
  /** Tests can disable monster spawning. */
  monsters?: boolean;
  /** Developer overlay allowed (DEBUG_OVERLAY=1). Without it the server ignores requests for debug data. */
  debugOverlay?: boolean;
  /** Multiplier on world boss respawn time (WORLD_BOSS_RESPAWN_SCALE). */
  bossRespawnScale?: number;
  /** Auction listing fee and sales tax (AUCTION_FEE_PCT, AUCTION_TAX_PCT). */
  auction?: AuctionRates;
}

export class World implements CombatCtx {
  tick = 0;
  private rooms = new Map<string, ZoneRoom[]>();
  readonly online = new Map<number, Player>(); // by character id
  private timer: NodeJS.Timeout | null = null;
  private nextAt = 0;
  private samples = new Float32Array(1200); // last 60s of tick durations
  private sampleN = 0;
  private lateTicks = 0;
  msgsOut = 0;
  bytesOut = 0;
  msgsIn = 0;
  private started = Date.now();
  private scratch: Ent[] = [];
  private seen = new Set<number>();
  private transfers: Player[] = [];
  private dots: number[] = [];
  private fMv: string[] = [];
  private fEv: string[] = [];
  private fDm: string[] = [];
  private fHp: string[] = [];
  private lastHousekeep = 0;
  private lastAutosave = Date.now();
  private nextMonsterId = -1;
  rnd: () => number;
  dropRate: number;
  goldRate: number;
  readonly parties = new Parties(this);
  readonly dungeons = new Dungeons(this);
  readonly journals = new Journals(this);
  readonly events = new WorldEvents(this);
  /** Trades are stored the moment they complete: both inventories and the audit row in one transaction. */
  readonly trades = new Trades(this, (rec, a, b) => {
    a.invDirty = b.invDirty = false;
    this.repo.saveTrade(this.snapshot(a), this.snapshot(b), rec).catch((e) => {
      console.error('trade save failed', e);
      a.invDirty = b.invDirty = true; // the regular inventory save will store the result
    });
  });
  readonly quests = new Quests(this);
  readonly traits = new Traits(this);
  /** A monster's blow landed: the region trait reacts (CombatCtx). */
  traitHit(m: Monster, p: Player, dealt: number) {
    this.traits.onHit(m, p, dealt);
  }
  readonly guilds: Guilds;
  readonly economy: Economy;
  readonly pvp: Pvp;
  readonly mail: Mail;
  readonly friends: Friends;
  readonly rifts: Rifts;
  readonly raids: Raids;
  readonly conquest: Conquest;
  readonly life: Lives;
  private lastSweep = 0;
  private inStep = false;
  /** Set by strike(): whether the last strike was a critical hit. */
  lastCrit = false;
  /** Tick that events raised right now will be replicated in (calls can arrive between ticks). */
  get evt() {
    return this.inStep ? this.tick : this.tick + 1;
  }

  constructor(private repo: Repo, readonly opts: WorldOpts) {
    this.rnd = opts.rng ?? Math.random;
    this.dropRate = opts.dropRate ?? 1;
    this.goldRate = opts.goldRate ?? 1;
    this.guilds = new Guilds(this, repo);
    this.economy = new Economy(this, repo, opts.auction ?? DEFAULT_AUCTION_RATES);
    this.pvp = new Pvp(this, repo);
    this.mail = new Mail(this, repo);
    this.friends = new Friends(this, repo);
    this.rifts = new Rifts(this, repo);
    this.raids = new Raids(this);
    this.conquest = new Conquest(this, repo);
    this.life = new Lives(this);
  }
  /** Loads the database-backed parts of the world (factions, guilds). Called once before the server opens. */
  async load() {
    this.quests.setFactions(await this.repo.loadFactions());
    await this.guilds.load();
    await this.conquest.load();
  }
  /** A character's gold, bag, equipment and bank: what is stored together. */
  snapshot(p: Player): Snapshot {
    return { id: p.id, gold: p.gold, inventory: p.inv, equipment: { ...p.eq, kit: p.kit }, bank: p.bank, gear: p.gear };
  }
  /** The character's look changed (pet, mount, guild tag): everyone nearby is sent its details again. */
  relook(p: Player) {
    p.gtag = this.guilds.tagOf(p.id) ?? '';
    this.guildStats(p);
    for (const o of p.room.players.values()) if (o !== p) o.known.delete(p.id);
  }
  /** Guild buildings change a member's stats: recomputed when they differ, keeping the share of health. */
  guildStats(p: Player) {
    const gb = this.guilds.buildingsOf(p.id), key = gb ? JSON.stringify(gb) : '';
    if (key === p.guildKey) return;
    p.guildKey = key;
    p.guildB = gb ? { ...gb } : null;
    const frac = p.maxHp ? p.hp / p.maxHp : 1;
    p.recalc();
    p.hp = p.dead ? 0 : Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * frac)));
    p.sver++;
    p.selfDirty = true;
  }
  /** Pet or mount changed: stats (speed, bonus) and look. */
  companionsChanged(p: Player) {
    const frac = p.maxHp ? p.hp / p.maxHp : 1;
    p.recalc();
    p.hp = p.dead ? 0 : Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * frac)));
    p.sver++;
    p.progDirty = true;
    this.relook(p);
    this.send(p, { t: 'stats', level: p.level, stats: p.stats, exp: p.exp, next: expToNext(p.level) });
    this.send(p, { t: 'comp', comp: p.comp });
  }
  pushMiss(v: Player, a: Player) {
    pushDmg(v, this.evt, 0, Dmg.Miss, a.id);
  }

  // ---------- lifecycle ----------
  start() {
    this.nextAt = performance.now() + TICK_MS;
    const loop = () => {
      let now = performance.now();
      let n = 0;
      while (now >= this.nextAt && n < 3) {
        this.step();
        this.nextAt += TICK_MS;
        n++;
        now = performance.now();
      }
      if (now - this.nextAt > TICK_MS * 3) {
        this.lateTicks += Math.floor((now - this.nextAt) / TICK_MS);
        this.nextAt = now + TICK_MS; // never spiral: drop the backlog
      }
      this.timer = setTimeout(loop, Math.max(0, this.nextAt - performance.now()));
    };
    this.timer = setTimeout(loop, TICK_MS);
  }
  async stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const all = [...this.online.values()];
    await this.repo.saveState(all.map(saveRow));
    await Promise.all(all.filter((p) => p.buildDirty).map((p) => this.repo.saveBuild(p.id, p.build.skills, p.build.runes)));
    await Promise.all(all.filter((p) => p.discDirty).map((p) => this.repo.saveDiscoveries(p.id, [...p.disc])));
    await Promise.all(all.filter((p) => p.invDirty).map((p) => this.repo.saveItems(this.snapshot(p))));
    await Promise.all(all.filter((p) => p.progDirty).map((p) => this.repo.saveProgress(p.id, p.quests, p.rep, p.comp, p.journal, p.asc, p.life)));
    await this.guilds.save();
    for (const p of all) p.conn?.close();
  }

  // ---------- matchmaking ----------
  /** Party members are kept in the same channel when there is room. */
  private pickRoom(zoneId: string, p?: Player): ZoneRoom {
    const withParty = p && this.parties.roomFor(p, zoneId, this.opts.roomCapacity);
    if (withParty) return withParty;
    let list = this.rooms.get(zoneId);
    if (!list) this.rooms.set(zoneId, (list = []));
    for (const r of list) if (r.players.size < this.opts.roomCapacity) return r;
    let ch = 1;
    while (list.some((r) => r.channel === ch)) ch++;
    const room = new ZoneRoom(zoneId, ch);
    if (this.opts.monsters !== false) {
      this.populate(room);
      for (const b of [...WORLD_BOSSES, ...DEPTH_BOSSES]) if (b.zone === zoneId) this.spawn(room, b.type, tileCenter(b.tx), tileCenter(b.ty));
    }
    list.push(room);
    if (this.opts.monsters !== false) this.events.onRoomOpened(room);
    return room;
  }
  /** Places each spawn group on random walkable tiles, away from player arrival points. */
  private populate(room: ZoneRoom) {
    const map = room.map, safe: [number, number][] = [[map.def.spawn.tx, map.def.spawn.ty]];
    if (map.def.town) safe.push([map.def.town.tx, map.def.town.ty]);
    for (const g of map.def.gates ?? []) safe.push([g.tx, g.ty]);
    for (const z of Object.values(ZONES)) for (const p of z.portals) if (p.to === room.zoneId) safe.push([p.toTx, p.toTy]);
    const nav = navOf(room.zoneId), taken: [number, number][] = [];
    SPAWNS[room.zoneId]?.forEach((g, gi) => {
      const def = MONSTERS[g.type], region = spawnRegions(room.zoneId)[gi];
      const rejected: Record<string, number> = {};
      let placed = 0;
      for (let tries = 0; placed < g.count && tries < g.count * 300; tries++) {
        // the search widens if the camp's own ground is crowded or blocked, so nothing is ever left out
        const a = this.rnd() * 6.283, r = Math.sqrt(this.rnd()) * g.r * (1 + tries / (g.count * 100));
        const tx = Math.round(g.tx + Math.cos(a) * r), ty = Math.round(g.ty + Math.sin(a) * r);
        const x = tileCenter(tx), y = tileCenter(ty);
        // A spawn point must be valid before a monster is activated on it: inside the map, clear of
        // walls and objects, connected to the rest of the zone, with room to move; not on top of
        // an arrival point; and not on top of another monster (camps spread out, they do not stack).
        const fault = spawnFault(nav, x, y, def.flying)
          || (safe.some(([sx, sy]) => Math.hypot(sx - tx, sy - ty) < 12) ? 'arrival-point' : '')
          || (!def.boss && nearTown(room.zoneId, x, y, MONSTER_TOWN_CLEAR) ? 'near-village' : '')
          || (taken.some(([ox, oy]) => Math.abs(ox - tx) < 2 && Math.abs(oy - ty) < 2) ? 'occupied' : '');
        if (fault) {
          rejected[fault] = (rejected[fault] ?? 0) + 1;
          continue;
        }
        // the Depths: every monster but the boss is tougher and worth a little more
        const deep = !def.boss && !!map.def.depth;
        const m = this.spawn(room, def.id, x, y, deep ? { ...DEPTH_MONSTER, fierce: true } : undefined);
        m.region = region.id;
        m.patrolR = region.patrolRadius;
        taken.push([tx, ty]);
        placed++;
      }
      room.spawnLog.push({ region: region.id, wanted: g.count, placed, rejected });
      if (placed < g.count) console.warn(`spawn region ${region.id}: placed ${placed} of ${g.count}; rejected ${JSON.stringify(rejected)}`);
    });
  }
  spawn(room: ZoneRoom, type: string, x: number, y: number, scale?: MonsterScale): Monster {
    const m = new Monster(this.nextMonsterId--, MONSTERS[type], room, x, y, scale);
    if (m.def.boss?.world) m.respawnMul = this.opts.bossRespawnScale ?? 1;
    room.monsters.set(m.id, m);
    room.grid.insert(m);
    return m;
  }
  // ---------- rooms outside the zone/channel list (dungeon instances) ----------
  addRoom(room: ZoneRoom) {
    this.rooms.set(`#${room.channel}`, [room]);
  }
  dropRoom(room: ZoneRoom) {
    this.rooms.delete(`#${room.channel}`);
  }
  roomIn(zoneId: string, p?: Player) {
    return this.pickRoom(zoneId, p);
  }
  /** Moves a player to a position in another room and tells the client to start over there. */
  relocate(p: Player, room: ZoneRoom, x: number, y: number) {
    if (room !== p.room) {
      this.stopAuto(p, 'You left the hunting area');
      this.trades.drop(p, 'a player left');
      this.pvp.drop(p);
      if (MOUNT_FORBIDDEN_KINDS.includes(room.map.def.kind ?? '')) dismount(this, p);
    }
    p.room.remove(p);
    p.x = x;
    p.y = y;
    room.add(p);
    p.dirty = true;
    this.welcome(p);
  }
  syncInv(p: Player) {
    sendInv(this, p);
  }
  // ---------- services for monster AI ----------
  // ---------- auto hunting (the session; the hunter itself is the client playing through normal commands) ----------
  /** Starts or stops an auto hunting session and stores the configuration sent with it. */
  auto(p: Player, m: unknown) {
    if (!m || typeof m !== 'object') return;
    const msg = m as { on?: unknown; cfg?: unknown };
    if (msg.cfg !== undefined) {
      p.autoCfg = cleanAutoConfig(msg.cfg);
      p.autoCfgDirty = true;
    }
    if (msg.on === true && !p.autoOn) {
      if (p.dead) return this.sendAuto(p, 'You cannot hunt while dead');
      // a long enough break clears the weariness; a short one carries the session on
      const now = this.tick * TICK_MS;
      if (!p.autoSince || now - p.autoOffAt >= AUTO_REST_MS) p.autoSince = now;
      p.autoOn = true;
      p.autoStats = emptyAutoStats();
      p.autoStart = this.tick;
    } else if (msg.on !== true) {
      if (p.autoOn) p.autoOffAt = this.tick * TICK_MS;
      p.autoOn = false;
    }
    this.sendAuto(p);
  }
  // ---------- G5: active play beats idling ----------
  /** Experience multiplier for a kill: Battle Rhythm for hand-made kills, less while auto hunting. */
  grindFactor(p: Player): number {
    const now = this.tick * TICK_MS;
    if (p.autoOn) return now - p.autoSince >= AUTO_WEARY_MS ? AUTO_WEARY_EXP : AUTO_EXP;
    return 1 + RHYTHM_EXP * p.rhythm;
  }
  /** After a kill this player is rewarded for: the streak, and kill talents. */
  afterKill(p: Player) {
    const now = this.tick * TICK_MS;
    if (!p.autoOn) {
      // the streak grows with kills made by hand within the window; experience for this kill used the old value
      p.rhythm = now - p.rhythmAt <= RHYTHM_WINDOW_MS ? Math.min(RHYTHM_MAX, p.rhythm + 1) : 1;
      p.rhythmAt = now;
      this.send(p, { t: 'rhythm', n: p.rhythm, ms: RHYTHM_WINDOW_MS });
    }
    if (p.hasTalent('bloodthirst') && !p.dead) this.heal(p, Math.max(1, Math.round(p.maxHp * 0.06)));
    if (p.hasTalent('arcane_flow') && !p.dead) {
      p.res = Math.min(p.stats.maxRes, Math.round(p.res + p.stats.maxRes * 0.08));
      p.selfDirty = true;
      this.cutCooldowns(p, 1000);
    }
  }
  /** Ends a session from the server's side (death, leaving the zone, a full bag) and says why. */
  stopAuto(p: Player, why: string) {
    if (!p.autoOn) return;
    p.autoOn = false;
    p.autoOffAt = this.tick * TICK_MS;
    this.sendAuto(p, why);
  }
  sendAuto(p: Player, why?: string) {
    if (p.autoOn) p.autoStats.secs = Math.round(((this.tick - p.autoStart) * TICK_MS) / 1000);
    this.send(p, { t: 'auto', on: p.autoOn, cfg: p.autoCfg, stats: p.autoStats, why, xp: p.autoOn ? this.grindFactor(p) : 1 });
  }
  /** Quests and faction shops. */
  /** Journal commands: wear a title, claim a mission or the login reward. */
  journal(p: Player, m: unknown) {
    const why = this.journals.op(p, m);
    if (why) this.send(p, { t: 'no', a: 'journal', why });
    this.journals.send(p);
    return why;
  }
  /** Life: professions, the home, the season pass, the wardrobe. */
  lifeOp(p: Player, m: unknown) {
    const why = this.life.op(p, m);
    if (why) this.send(p, { t: 'no', a: 'life', why });
    return why;
  }
  /** Raids: the lobby at the Raid Herald, starting, leaving. */
  raidOp(p: Player, m: unknown) {
    const why = this.raids.op(p, m);
    if (why) this.send(p, { t: 'no', a: 'raid', why });
    return why;
  }
  /** The Endless Rift: enter, leave, the leaderboard. */
  async riftOp(p: Player, m: unknown) {
    const why = await this.rifts.op(p, m);
    if (why) this.send(p, { t: 'no', a: 'rift', why });
    return why;
  }
  sendAsc(p: Player) {
    this.send(p, { t: 'asc', asc: p.asc, ult: Math.floor(p.ult) });
  }
  /**
   * Ascension commands: choose a path (level 70; changing it later costs gold), spend or reset
   * mastery points, save and load skill loadouts (in a village, out of combat).
   */
  ascOp(p: Player, m: any): string {
    const why = this.ascDo(p, m);
    if (why) this.send(p, { t: 'no', a: 'asc', why });
    this.sendAsc(p);
    return why;
  }
  private ascDo(p: Player, m: any): string {
    if (!m || typeof m !== 'object') return 'Unknown command';
    const a = p.asc, town = inTown(p.room.zoneId, p.x, p.y), fighting = (this.tick - p.lastCombat) * TICK_MS < COMBAT_TIMEOUT_MS;
    switch (m.op) {
      case 'path': {
        const d = typeof m.id === 'string' ? PATH_INDEX[m.id] : undefined;
        if (!d || d.job !== p.job) return 'Not a path of your class';
        if (p.level < ASCENSION_LEVEL) return `Paths open at level ${ASCENSION_LEVEL}`;
        if (a.path === d.id) return 'You already walk that path';
        if (a.path) {
          const cost = 20000 * Math.max(1, Math.floor(p.level / 10));
          if (!town) return 'Change your path in a village';
          if (p.gold < cost) return `Changing your path costs ${cost} gold`;
          p.gold -= cost;
          p.invDirty = true;
          this.syncInv(p);
        }
        a.path = d.id;
        p.ult = 0;
        p.progDirty = true;
        p.recalc();
        p.dirty = true;
        this.announce(p.room, `${p.name} has ascended as a ${d.title}!`, 'rep');
        return '';
      }
      case 'mastery': {
        const k = m.stat;
        if (!MASTERY_STATS.includes(k)) return 'Unknown stat';
        if (masterySpent(a) >= masteryEarned(p.level, a.extra)) return 'No mastery points left';
        if ((a.mastery[k as keyof typeof a.mastery] ?? 0) >= masteryCap(p.level)) return 'That stat is at its mastery limit for now';
        a.mastery[k as keyof typeof a.mastery] = (a.mastery[k as keyof typeof a.mastery] ?? 0) + 1;
        p.progDirty = true;
        p.recalc();
        return '';
      }
      case 'mreset': {
        if (!town) return 'Reset mastery in a village';
        const cost = 5000 * Math.max(1, masterySpent(a));
        if (p.gold < cost) return `A reset costs ${cost} gold`;
        p.gold -= cost;
        p.invDirty = true;
        this.syncInv(p);
        a.mastery = {};
        p.progDirty = true;
        p.recalc();
        return '';
      }
      case 'save': {
        const i = m.slot;
        if (!Number.isInteger(i) || i < 0 || i >= LOADOUTS) return 'Unknown loadout';
        const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 20) : `Loadout ${i + 1}`;
        a.loadouts[i] = { name, skills: { ...p.build.skills }, slots: [...p.build.runes.slots] };
        p.progDirty = true;
        return '';
      }
      case 'awaken': {
        const id = typeof m.id === 'string' ? m.id : '', node = JOB_DEFS[p.job].skills.find((s) => s.id === id && s.type === 'active');
        if (!node) return 'Not an active skill of your class';
        if (p.level < AWAKEN_LEVEL) return `Awakening opens at level ${AWAKEN_LEVEL}`;
        if (a.awake.includes(id)) return 'That skill is already awakened';
        if ((p.build.skills[id] ?? 0) < node.maxRank) return 'Train the skill to its full rank first';
        const c = awakenCost(p.level);
        if (!town) return 'Awaken skills in a village';
        if (p.gold < c.gold) return `Awakening costs ${c.gold} gold`;
        if (count(p, 'awakening_essence') < c.essence) return `Requires ${c.essence} Awakening Essence`;
        p.gold -= c.gold;
        consume(p, 'awakening_essence', c.essence);
        p.invDirty = true;
        this.syncInv(p);
        a.awake.push(id);
        p.progDirty = true;
        this.announce(p.room, `${p.name} has awakened ${node.name}!`, 'rep');
        return '';
      }
      case 'load': {
        const i = m.slot, l = Number.isInteger(i) ? a.loadouts[i] : null;
        if (!l) return 'That loadout is empty';
        if (!town) return 'Change loadouts in a village';
        if (fighting) return 'Not while fighting';
        const b = cleanBuild(p.job, p.level, { skills: l.skills, runes: { slots: l.slots, lv: p.build.runes.lv, xp: p.build.runes.xp } });
        p.build = b;
        p.buildDirty = true;
        p.recalc();
        this.send(p, { t: 'build', build: p.build });
        this.send(p, { t: 'sys', text: `Loadout "${l.name}" ready.` });
        return '';
      }
      default:
        return 'Unknown command';
    }
  }
  /** Friends list commands (database-backed, asynchronous). */
  async friendOp(p: Player, m: unknown) {
    let why: string;
    try {
      why = await this.friends.op(p, m);
    } catch (e) {
      console.error('friends operation failed', e);
      why = 'The request could not be completed; nothing was changed';
    }
    if (why) this.send(p, { t: 'no', a: 'friends', why });
    return why;
  }
  /** Mail commands (database-backed, asynchronous). */
  async mailOp(p: Player, m: unknown) {
    const why = await this.mail.op(p, m);
    if (why) this.send(p, { t: 'no', a: 'mail', why });
    return why;
  }
  quest(p: Player, m: unknown) {
    const why = this.quests.op(p, m);
    if (why) this.send(p, { t: 'no', a: 'quest', why });
    return why;
  }
  async guild(p: Player, m: unknown) {
    const why = await this.guilds.op(p, m).catch((e) => (console.error('guild command failed', e), 'The guild request could not be completed'));
    if (why) this.send(p, { t: 'no', a: 'guild', why });
    return why;
  }
  async eco(p: Player, m: unknown) {
    const why = await this.economy.op(p, m).catch((e) => (console.error('economy command failed', e), 'The request could not be completed'));
    if (why) this.send(p, { t: 'no', a: 'eco', why });
    return why;
  }
  pvpOp(p: Player, m: unknown) {
    const why = this.pvp.op(p, m);
    if (why) this.send(p, { t: 'no', a: 'pvp', why });
    return why;
  }
  companion(p: Player, m: unknown) {
    const why = companionOp(this, p, m);
    if (why) this.send(p, { t: 'no', a: 'comp', why });
    return why;
  }
  /** Player-to-player trading. */
  trade(p: Player, m: unknown) {
    const why = this.trades.op(p, m, Date.now());
    if (why) this.send(p, { t: 'no', a: 'trade', why });
    return why;
  }
  /** Turns the developer overlay feed on or off for a player. Refused unless the server was started with it enabled. */
  setDebug(p: Player, on: unknown) {
    p.debug = !!this.opts.debugOverlay && on === true;
  }
  announce(room: ZoneRoom, text: string, cue?: Cue) {
    for (const p of room.players.values()) this.send(p, { t: 'ann', text, cue });
  }
  announceAll(text: string, cue?: Cue) {
    for (const p of this.online.values()) this.send(p, { t: 'ann', text, cue });
  }
  summon(by: Monster, type: string, count: number) {
    let have = 0;
    for (const m of by.room.monsters.values()) if (m.summoner === by.id && !m.dead) have++;
    for (let i = 0; i < count && have + i < 6; i++) {
      // a ring around the summoner, on walkable ground
      let x = by.x, y = by.y;
      for (let tries = 0; tries < 8; tries++) {
        const a = this.rnd() * 6.283, r = 60 + this.rnd() * 60, nx = by.x + Math.cos(a) * r, ny = by.y + Math.sin(a) * r;
        if (!blocked(by.room.map, nx, ny)) {
          x = nx;
          y = ny;
          break;
        }
      }
      const m = this.spawn(by.room, type, x, y, { hp: 0.6, atk: by.atkScale, level: by.level - MONSTERS[type].level, exp: 0 });
      m.noRespawn = true;
      m.summoner = by.id;
      for (const [id, th] of by.threat) m.addThreat(id, Math.max(1, th * 0.1));
    }
  }
  /** Takes a monster out of the world (event monsters, the night's monsters at dawn). */
  removeMonster(m: Monster) {
    m.room.monsters.delete(m.id);
    if (m.inGrid) m.room.grid.remove(m);
  }
  /** Every open-world room (all channels). */
  openRooms(): ZoneRoom[] {
    return [...this.rooms.values()].flat();
  }
  dismiss(by: Monster) {
    for (const m of by.room.monsters.values())
      if (m.summoner === by.id) {
        by.room.monsters.delete(m.id);
        if (m.inGrid) by.room.grid.remove(m);
      }
  }

  // ---------- join / leave ----------
  /** Attach a socket to a character: resumes a live entity if one exists, else spawns from the DB row. */
  join(row: CharacterRow, conn: Conn): Player {
    let p = this.online.get(row.id);
    if (p) {
      if (p.conn && p.conn !== conn) {
        this.send(p, { t: 'kick', reason: 'Logged in from another location.' });
        p.conn.close();
      }
      p.known.clear();
        p.inQ.length = 0;
    } else {
      p = new Player(row.id, row.account_id, row.name, row.job, Math.min(MAX_LEVEL, Math.max(1, row.level)), Math.max(0, row.exp), row.appearance, { skills: row.skills, runes: row.runes }, row);
      this.quests.load(p, row.quests, row.reputation);
      this.journals.load(p, (row as any).journal);
      p.asc = cleanAscension((row as any).ascension, p.job, p.level);
      this.life.load(p, (row as any).life);
      p.recalc();
      p.gtag = this.guilds.tagOf(p.id) ?? '';
      this.guildStats(p);
      void this.pvp.loadRating(p);
      if (!p.kit) {
        grantStarterKit(p);
        p.recalc();
        p.hp = p.maxHp;
      }
      const zone = ZONES[row.zone_id] && ZONES[row.zone_id].kind !== 'dungeon' ? row.zone_id : 'eldoria';
      p.x = row.pos_x;
      p.y = row.pos_y;
      const map = getZoneMap(zone);
      // Stored position must be walkable in the current map (maps can change between releases).
      // nobody wakes up in the middle of the Depths: they return to its sanctuary
      if (zone !== row.zone_id || map.def.depth || !Number.isFinite(p.x) || !Number.isFinite(p.y) || blocked(map, p.x, p.y)) {
        p.x = tileCenter(map.def.spawn.tx);
        p.y = tileCenter(map.def.spawn.ty);
      }
      this.pickRoom(zone).add(p);
      this.online.set(p.id, p);
    }
    p.conn = conn;
    p.disconnectedAt = 0;
    p.lastSeq = 0;
    this.welcome(p);
    this.guilds.seen(p);
    void this.guilds.sync(this.guilds.guildOf(p), p);
    return p;
  }
  private welcome(p: Player) {
    // `welcome` makes the client drop everything it knew, so the server must forget what it sent.
    p.known.clear();
    this.send(p, {
      t: 'welcome', id: p.id, zone: p.room.zoneId, channel: p.room.channel, tick: this.tick, x: p.x, y: p.y,
      self: p.meta(), stats: p.stats, hp: p.hp, res: p.res, exp: p.exp, next: expToNext(p.level), dev: this.opts.debugOverlay || undefined, auto: p.autoCfg, factions: this.quests.factions, comp: p.comp, bank: p.bank, gear: p.gear, arena: this.pvp.isArena(p.room) || undefined, build: p.build, inv: p.inv, eq: p.eq, gold: p.gold, disc: [...p.disc],
    });
    const cd: [string, number][] = [];
    for (const [id, at] of p.room.nodeReady) if (at > this.tick) cd.push([id, (at - this.tick) * TICK_MS]);
    if (cd.length) this.send(p, { t: 'nodes', cd });
    p.needAck = true;
    p.selfDirty = true;
    if (p.party) this.parties.sync(p.party, true);
    this.send(p, { t: 'dng', run: this.dungeons.stateFor(p) });
    this.quests.send(p);
    this.journals.send(p);
    this.sendAsc(p);
    void this.mail.notify(p);
    void this.friends.load(p);
    this.send(p, { t: 'depths', bosses: this.depthBossState() });
    this.events.sendTo(p);
    this.send(p, { t: 'rift', run: this.rifts.stateFor(p) });
    this.send(p, { t: 'raid', run: this.raids.stateFor(p) });
    this.conquest.sendTo(p);
    this.life.send(p);
  }
  /** Socket dropped: keep the entity for the grace window so a reconnect resumes in place. */
  disconnect(p: Player, conn: Conn) {
    if (p.conn !== conn) return;
    p.conn = null;
    p.autoOn = false; // nothing hunts for a player who is not connected
    this.trades.drop(p, 'a player disconnected');
    this.pvp.drop(p);
    p.disconnectedAt = Date.now();
    p.inQ.length = 0;
    p.attacking = false;
    p.casting = null;
  }
  private despawn(p: Player) {
    this.friends.left(p);
    this.parties.remove(p, 'offline');
    p.room.remove(p);
    this.online.delete(p.id);
    this.repo.saveState([saveRow(p)]).catch((e) => console.error('save failed', e));
    this.saveBuild(p);
  }
  private saveBuild(p: Player) {
    if (p.discDirty) {
      p.discDirty = false;
      this.repo.saveDiscoveries(p.id, [...p.disc]).catch((e) => console.error('discoveries save failed', e));
    }
    if (p.invDirty) {
      p.invDirty = false;
      this.repo.saveItems(this.snapshot(p)).catch((e) => console.error('inventory save failed', e));
    }
    if (p.progDirty) {
      p.progDirty = false;
      this.repo.saveProgress(p.id, p.quests, p.rep, p.comp, p.journal, p.asc, p.life).catch((e) => console.error('progress save failed', e));
    }
    if (p.autoCfgDirty) {
      p.autoCfgDirty = false;
      this.repo.saveAuto(p.id, p.autoCfg).catch((e) => console.error('auto hunting save failed', e));
    }
    if (!p.buildDirty) return;
    p.buildDirty = false;
    this.repo.saveBuild(p.id, p.build.skills, p.build.runes).catch((e) => console.error('build save failed', e));
  }
  nextExp(p: Player) {
    return expToNext(p.level);
  }

  // ---------- inbound ----------
  input(p: Player, seq: unknown, ix: unknown, iy: unknown, run: unknown) {
    if ((run !== 0 && run !== 1) || !Number.isInteger(seq) || (ix !== -1 && ix !== 0 && ix !== 1) || (iy !== -1 && iy !== 0 && iy !== 1)) return;
    const s = seq as number;
    if (s <= p.lastSeq || s > p.lastSeq + 10_000) return;
    if (p.inQ.length >= INPUT_QUEUE_MAX * 4) return; // flood: drop, client reconciles from ack
    const q = p.inQ;
    if (q.length && s <= q[q.length - 4]) return;
    q.push(s, ix as number, iy as number, run as number);
  }
  /** Select a monster as the attack target; 0 clears it. Only living monsters in range in the same room. */
  setTarget(p: Player, id: unknown) {
    if (p.dead) return;
    if (Number.isInteger(id) && (id as number) > 0) {
      // a player: only a valid enemy under the PvP rules
      const v = p.room.players.get(id as number), why = v ? this.pvp.block(p, v) : 'Not a valid target';
      if (why) return void this.send(p, { t: 'no', a: 'tgt', why });
      if (p.pvpTarget !== v) p.attacking = false;
      p.pvpTarget = v!;
      p.target = null;
      p.selfDirty = true;
      return;
    }
    p.pvpTarget = null;
    const m = Number.isInteger(id) && (id as number) < 0 ? p.room.monsters.get(id as number) : undefined;
    const ok = m && !m.dead && Math.hypot(m.x - p.x, m.y - p.y) <= TARGET_RANGE;
    const next = ok ? m : null;
    if (next !== p.target) p.attacking = false;
    p.target = next;
    p.selfDirty = true;
  }
  /**
   * Attack: starts auto-attacking the current target (acquiring the nearest monster in reach if
   * there is none). With nothing to hit it is a free swing, rate-limited by the attack interval.
   */
  action(p: Player, kind: unknown) {
    if (p.dead || p.mods.stun) return;
    if (kind !== Act.Attack) return;
    if (p.pvpTarget) {
      p.attacking = true;
      p.selfDirty = true;
      return;
    }
    if (!p.target) {
      let best: Monster | null = null, bd = p.stats.range + 70;
      for (const m of p.room.monsters.values()) {
        if (m.dead) continue;
        const d = Math.hypot(m.x - p.x, m.y - p.y) - m.def.radius;
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      p.target = best;
    }
    if (p.target) {
      p.attacking = true;
      p.selfDirty = true;
    } else if ((this.tick + 1 - p.swingTick) * TICK_MS >= p.stats.atkIntervalMs) {
      p.swingTick = this.tick + 1;
      emit(p, this.evt, [p.id, Act.Attack]);
    }
  }
  // --- abilities and build: thin wrappers that report a refusal to the client ---
  use(p: Player, id: unknown, tid: unknown) {
    const why = useAbility(this, p, id, tid);
    if (why) this.send(p, { t: 'no', a: typeof id === 'string' ? id.slice(0, 24) : '', why });
    return why;
  }
  learn(p: Player, id: unknown) {
    const why = learn(this, p, id);
    if (why) this.send(p, { t: 'no', a: 'learn', why });
    return why;
  }
  respec(p: Player) {
    const why = respec(this, p);
    if (why) this.send(p, { t: 'no', a: 'respec', why });
    return why;
  }
  attune(p: Player, slot: unknown, el: unknown) {
    const why = attune(this, p, slot, el);
    if (why) this.send(p, { t: 'no', a: 'rune', why });
    return why;
  }
  inventory(p: Player, m: unknown) {
    const why = invOp(this, p, m);
    if (why) this.send(p, { t: 'no', a: 'inv', why });
    return why;
  }
  /** Gathering, caches, waystone travel and crafting. */
  object(p: Player, m: unknown) {
    const why = objOp(this, p, m);
    if (why) this.send(p, { t: 'no', a: 'obj', why });
    return why;
  }
  dungeon(p: Player, op: unknown, id: unknown, diff: unknown) {
    const why = op === 'enter' ? this.dungeons.enter(p, id, diff) : op === 'leave' ? this.dungeons.leave(p) : op === 'ready' ? this.dungeons.ready(p, diff) : 'Unknown dungeon command';
    if (why) this.send(p, { t: 'no', a: 'dng', why });
    return why;
  }
  requestRespawn(p: Player) {
    if (p.dead && (this.tick - p.deadTick) * TICK_MS >= RESPAWN_MIN_MS) this.respawn(p);
  }
  /** Chat: zone (everyone in the room), party (members anywhere) or whisper (one named player). */
  chat(p: Player, text: unknown, ch: unknown = 'zone', to: unknown = undefined) {
    if (typeof text !== 'string') return;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT_LEN);
    if (!clean) return;
    if (p.chatTokens < 1) return this.send(p, { t: 'sys', text: 'You are sending messages too quickly.' });
    if (ch === 'guild') {
      p.chatTokens--;
      return this.guilds.chat(p, clean);
    }
    if (ch === 'party') {
      if (!p.party) return this.send(p, { t: 'sys', text: 'You are not in a party.' });
      p.chatTokens--;
      const data = JSON.stringify({ t: 'chat', from: p.name, text: clean, ch: 'party' } satisfies ServerMsg);
      for (const o of this.parties.members(p.party)) this.sendRaw(o, data);
    } else if (ch === 'whisper') {
      const name = typeof to === 'string' ? to.trim().toLowerCase() : '';
      let target: Player | undefined;
      if (name && name.length <= 20) for (const o of this.online.values()) if (o.name.toLowerCase() === name) target = o;
      if (!target || target === p) return this.send(p, { t: 'sys', text: target ? 'You cannot whisper to yourself.' : 'That player is not online.' });
      p.chatTokens--;
      const data = JSON.stringify({ t: 'chat', from: p.name, text: clean, ch: 'whisper', to: target.name } satisfies ServerMsg);
      this.sendRaw(target, data);
      this.sendRaw(p, data);
    } else {
      p.chatTokens--;
      const data = JSON.stringify({ t: 'chat', from: p.name, text: clean, ch: 'zone' } satisfies ServerMsg);
      for (const o of p.room.players.values()) this.sendRaw(o, data);
    }
  }
  /** Party commands from the client. Refusals are reported back as a `no` message. */
  party(p: Player, op: unknown, id: unknown, name: unknown) {
    let why = '';
    switch (op) {
      case 'invite': why = this.parties.invite(p, id ?? name); break;
      case 'accept': why = this.parties.respond(p, true); break;
      case 'decline': why = this.parties.respond(p, false); break;
      case 'leave': p.party ? this.parties.remove(p, 'left') : (why = 'You are not in a party'); break;
      case 'kick': why = this.parties.kick(p, id); break;
      case 'promote': why = this.parties.promote(p, id); break;
      case 'loot': why = this.parties.setLoot(p, id); break;
      default: why = 'Unknown party command';
    }
    if (why) this.send(p, { t: 'no', a: 'party', why });
    return why;
  }

  // ---------- outbound ----------
  send(p: Player, m: ServerMsg) {
    this.sendRaw(p, JSON.stringify(m));
  }
  sendRaw(p: Player, data: string) {
    if (!p.conn) return;
    this.msgsOut++;
    this.bytesOut += data.length;
    p.conn.send(data);
  }

  // ---------- combat services (CombatCtx) ----------
  hurt(target: Ent, amount: number, flags: number, src: Ent | null) {
    if (target.dead) return;
    if (amount > 0 && src instanceof Player && src !== target && !(flags & Dmg.Heal)) chargeUlt(this, src, ULT_PER_HIT);
    if (amount > 0 && target instanceof Player && src && src !== target && !(flags & Dmg.Heal)) chargeUlt(this, target, ULT_PER_HURT);
    // Null Field (region trait): a phased-out monster takes nothing
    if (target instanceof Monster && amount > 0 && !(flags & Dmg.Heal) && target.mods.invuln) {
      amount = 0;
      flags |= Dmg.Absorb;
    }
    if (target instanceof Player && amount > 0 && !(flags & Dmg.Heal) && target.hp - amount < target.maxHp / 2 && target.hp >= target.maxHp / 2 && this.tick >= target.bulwarkAt && target.hasTalent('bulwark')) {
      // Bulwark (talent): falling below half health raises a barrier
      target.bulwarkAt = this.tick + Math.round(20_000 / TICK_MS);
      applyStatus(target, STATUS_INDEX.barrier, this.tick, Math.round(target.maxHp * 0.15), target.id);
    }
    if (target instanceof Player && amount > 0) {
      const m = target.mods;
      if (m.invuln) {
        amount = 0;
        flags |= Dmg.Absorb;
      } else {
        const b = target.st.find((x) => x.i === STATUS_INDEX.barrier);
        if (b) {
          const soak = Math.min(b.power, amount);
          b.power -= soak;
          amount -= soak;
          flags |= Dmg.Absorb;
          if (b.power <= 0) removeStatus(target, STATUS_INDEX.barrier);
        }
        if (amount > 0 && m.absorbMana && target.res > 0) {
          const soak = Math.min(target.res, Math.floor(amount * m.absorbMana));
          target.res -= soak;
          amount -= soak;
          if (soak) flags |= Dmg.Absorb;
        }
        if (m.cantDie && amount >= target.hp) amount = target.hp - 1;
      }
      if (src instanceof Monster) src.credit(target.id, amount); // soaking a monster's hits is contribution
      if (src instanceof Player && src !== target) {
        this.pvp.onHit(src, target);
        amount = this.pvp.limit(src, target, amount);
      }
      if (amount > 0) dismount(this, target);
    }
    target.hp = Math.max(0, target.hp - amount);
    target.sver++;
    target.lastCombat = this.tick;
    pushDmg(target, this.evt, amount, flags, src ? src.id : 0);
    if (src) src.lastCombat = this.tick;
    if (target instanceof Monster) {
      if (src instanceof Player) {
        target.onDamaged(src.id, amount, this);
        if (target.room.fields.length) noteDamage(target.room, src.id, target.id, amount);
      }
      if (target.hp === 0) this.killMonster(target);
    } else if (target instanceof Player) {
      target.selfDirty = true;
      if (JOB_DEFS[target.job].resource === 'rage') target.res = Math.min(target.stats.maxRes, target.res + RAGE_PER_HIT_TAKEN);
      // Second Wind (unique passive): a large heal when health gets dangerously low, on a long cooldown.
      if (target.hp > 0 && target.hp < target.maxHp * 0.25 && this.tick >= target.secondWindReady && target.passives.includes('secondwind')) {
        target.secondWindReady = this.tick + ticks(SECOND_WIND_CD_MS);
        this.heal(target, Math.ceil(target.maxHp * 0.3));
        this.send(target, { t: 'sys', text: 'Second Wind restores your health.' });
      }
      if (target.hp === 0) {
        if (src instanceof Player && src !== target) this.pvp.onKill(src, target);
        this.killPlayer(target);
      }
    }
  }
  heal(e: Ent, amount: number, by?: Player) {
    if (e.dead || amount <= 0 || e.hp >= e.maxHp) return;
    const n = Math.min(amount, e.maxHp - e.hp);
    // Healing someone who is fighting a monster counts toward the healer's contribution to it.
    if (by && e instanceof Player) for (const m of e.room.monsters.values()) if (m.engagedAt && m.threat.has(e.id)) m.credit(by.id, n);
    e.hp += n;
    e.sver++;
    pushDmg(e, this.evt, n, Dmg.Heal, 0);
    if (e instanceof Player) e.selfDirty = true;
  }
  nearestPlayer(room: ZoneRoom, x: number, y: number, r: number): Player | null {
    const out = this.scratch;
    out.length = 0;
    room.grid.queryRect(x - r, y - r, x + r, y + r, out);
    let best: Player | null = null, bd = r;
    for (const e of out) {
      if (!(e instanceof Player) || e.dead || e.mods.stealth) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d <= bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  playersWithin(room: ZoneRoom, x: number, y: number, r: number, res: Player[]) {
    const out = this.scratch;
    out.length = 0;
    room.grid.queryRect(x - r, y - r, x + r, y + r, out);
    for (const e of out) if (e instanceof Player && !e.dead && Math.hypot(e.x - x, e.y - y) <= r) res.push(e);
  }
  entById(room: ZoneRoom, id: number): Ent | null {
    return (id < 0 ? room.monsters.get(id) : room.players.get(id)) ?? null;
  }

  private killMonster(m: Monster) {
    let total = 0;
    for (const d of m.dmgBy.values()) total += d;
    const paid = new Set<Party>();
    const looters: Player[] = [];
    // Summoned helpers are part of their master's fight: a little EXP, no loot.
    const exp = m.def.exp * m.expScale * (m.summoner ? 0.25 : 1);
    for (const [pid, dealt] of m.dmgBy) {
      const p = m.room.players.get(pid);
      if (!p) continue;
      // Everyone who contributed is rewarded: half flat, half by damage share.
      if (!p.party) {
        const share = total ? dealt / total : 0, f = expLevelFactor(p.level, m.level) * this.conquest.expBonus(p);
        if (f > 0 && exp > 0) this.grantExp(p, Math.max(1, Math.round(exp * (0.5 + 0.5 * share) * f * this.guilds.bonus(p, 'barracks'))));
        looters.push(p);
        continue;
      }
      // A party is rewarded as one: its combined share, a bonus per extra member present, split
      // equally among members near the kill - so healers and tanks earn the same as damage dealers.
      if (paid.has(p.party)) continue;
      paid.add(p.party);
      let share = 0;
      for (const id of p.party.members) share += total ? (m.dmgBy.get(id) ?? 0) / total : 0;
      const who = this.parties.sharers(p.party, m.room, m.x, m.y, (id) => m.dmgBy.has(id));
      const pool = exp * (0.5 + 0.5 * share) * (1 + PARTY_EXP_BONUS * (who.length - 1));
      for (const e of who) {
        const f = expLevelFactor(e.level, m.level) * this.conquest.expBonus(e) * this.grindFactor(e);
        if (f > 0 && exp > 0) this.grantExp(e, Math.max(1, Math.round((pool / who.length) * f * this.guilds.bonus(e, 'barracks'))));
        looters.push(e);
      }
    }
    if (m.def.boss) this.bossRewards(m, looters);
    else if (!m.summoner) distributeLoot(this, m, looters);
    // auto hunting sessions: the kill counts for everyone rewarded for it
    if (!m.def.boss) for (const p of looters) this.quests.onKill(p, m);
    for (const p of looters) this.afterKill(p);
    for (const p of looters) {
      this.journals.onKill(p, m);
      chargeUlt(this, p, ULT_PER_KILL);
      if (!m.summoner) this.conquest.onKill(p);
      if (!m.summoner) this.guilds.onKill(p, m.def.boss ? (m.def.boss.world ? 'world' : 'boss') : m.def.elite ? 'elite' : 'normal');
    }
    for (const p of looters)
      if (p.autoOn) {
        p.autoStats.kills++;
        this.sendAuto(p);
      }
    m.die(this.tick);
    this.dismiss(m);
    this.dungeons.onKill(m);
    this.traits.onDeath(m);
    this.events.onKill(m);
    this.rifts.onKill(m);
    this.raids.onKill(m);
    for (const p of m.room.players.values())
      if (p.target === m) {
        p.target = null;
        p.attacking = false;
        p.selfDirty = true;
      }
  }
  /**
   * Boss rewards are always personal and guaranteed: one boss item each (Epic, Legendary or
   * Mythic by the boss's odds), gold and upgrade stones. World bosses reward everyone whose
   * contribution (damage, plus half of healing given and damage soaked) reached 1% of the
   * boss's health, and the three highest contributors roll a second item.
   */
  private bossRewards(m: Monster, rewarded: Player[]) {
    const world = !!m.def.boss!.world, run = this.dungeons.runs.get(m.room);
    const ranked = [...m.contrib].sort((a, b) => b[1] - a[1]);
    const top = new Set(ranked.slice(0, 3).map((x) => x[0]));
    const who = world ? [...m.room.players.values()].filter((p) => (m.contrib.get(p.id) ?? 0) >= m.maxHp * 0.01) : run ? [...m.room.players.values()] : rewarded;
    for (const p of who) {
      const items: ItemSpec[] = [];
      const rolls = 1 + (world && top.has(p.id) ? 1 : 0);
      for (let i = 0; i < rolls; i++) items.push(rollBossItem(this.rnd, m.def.id, m.level, p.job, world ? 'world' : run?.diff ?? 'normal'));
      items.push({ base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: world ? 3 : 2 });
      items.push({ base: BOSS_SCROLL[world ? 'world' : run?.diff ?? 'normal'], rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
      // dungeon bosses on Nightmare and Armageddon: armament materials; on Armageddon a chance of a sigil
      if (run && !world) {
        items.push(...armamentDrops(this.rnd, run.diff, run.def.level));
        // the sigil's tier follows the boss's designed level: tier 3 only from bosses of level 110 or more
        const tier = sigilTierForBoss(MONSTERS[run.def.boss].level);
        if (run.diff === 'armageddon' && this.rnd() < 0.3) items.push({ base: 'awakening_essence', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
        if (run.diff === 'armageddon' && tier && this.rnd() < SIGIL_DROP) {
          const sg = rollSigil(this.rnd, tier);
          items.push(sg);
          this.announce(m.room, `${p.name} found a sigil: ${ITEMS[sg.base].name} (tier ${tier})!`, 'loot');
        }
      }
      // world bosses of level 30 or more: armament material too
      if (world) items.push(...worldBossArmament(this.rnd, m.def.level));
      // world bosses of level 120+ rarely give a flying mount's reins
      if (world && m.def.level >= 160 && this.rnd() < 0.015) items.push({ base: 'mount_star_drake', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
      else if (world && m.def.level >= 120 && this.rnd() < 0.03) items.push({ base: 'mount_sky_griffin', rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 });
      award(this, p, Math.round((world ? 120 : 60) * m.level * this.goldRate), items);
      this.quests.onKill(p, m);
      this.journals.onBoss(p, world);
      if (items.some((i) => ITEMS[i.base]?.kind === 'sigil')) this.journals.add(p, 'sigil');
      for (const it of items) if (it.rar >= 4) this.announce(m.room, `${p.name} received ${RARITIES[it.rar]} loot: ${ITEMS[it.base].name}!`, 'loot');
    }
    if (world) {
      const best = ranked[0] && this.online.get(ranked[0][0]);
      this.announceAll(`${m.def.name} has been defeated in ${m.room.map.def.name}${best ? `. Greatest contribution: ${best.name}` : ''}.`, 'bossdown');
    }
  }
  grantExp(p: Player, amount: number) {
    if (amount <= 0) return;
    if (p.level >= MAX_LEVEL) {
      // past the level cap, experience becomes mastery points
      p.capExp += amount;
      const need = Math.round(expToNext(MAX_LEVEL - 1) / 10);
      while (p.capExp >= need) {
        p.capExp -= need;
        p.asc.extra++;
        p.progDirty = true;
        this.send(p, { t: 'sys', text: 'A mastery point gained beyond the level cap.', cue: 'rep' });
      }
      if (p.asc.extra) this.sendAsc(p);
      return;
    }
    p.exp += amount;
    p.xpGained += amount;
    petExp(this, p, amount);
    if (p.autoOn) p.autoStats.exp += amount;
    p.dirty = true;
    p.selfDirty = true;
    let leveled = false;
    const before = p.level;
    while (p.level < MAX_LEVEL && p.exp >= expToNext(p.level)) {
      p.exp -= expToNext(p.level);
      p.level++;
      leveled = true;
    }
    if (p.level >= MAX_LEVEL) p.exp = 0;
    this.journals.best(p, 'level', p.level);
    if (!leveled) return;
    p.recalc();
    if (!p.dead) {
      p.hp = p.maxHp;
      if (JOB_DEFS[p.job].resource !== 'rage') p.res = p.stats.maxRes;
    }
    p.sver++;
    emit(p, this.evt, [p.id, Act.LevelUp, p.level]);
    this.send(p, { t: 'stats', level: p.level, stats: p.stats, exp: p.exp, next: expToNext(p.level) });
    // a class progression reached: everyone nearby hears it, and the player gets its bonus at once (in the stats above)
    for (const tier of JOB_DEFS[p.job].tiers.slice(1))
      if (before < tier.level && p.level >= tier.level) this.announce(p.room, `${p.name} has become a ${tier.title}!`, 'rep');
  }
  private killPlayer(p: Player) {
    p.streak = 0;
    p.pvpTagUntil = 0;
    this.stopAuto(p, 'You died');
    this.pvp.drop(p);
    for (const o of p.room.players.values()) if (o.pvpTarget === p) (o.pvpTarget = null), (o.attacking = false), (o.selfDirty = true);
    this.trades.drop(p, 'a player died');
    p.dead = true;
    p.deadTick = this.tick;
    p.attacking = false;
    p.target = null;
    p.casting = null;
    p.inQ.length = 0;
    p.moving = Move.Idle;
    p.ver++;
    clearStatuses(p);
    p.selfDirty = true;
    for (const m of p.room.monsters.values()) m.threat.delete(p.id);
  }
  /** Back to the zone's spawn point at full health, with a short protective ward. No EXP or item penalty. */
  private respawn(p: Player) {
    const sp = p.room.map.def.spawn, at = this.pvp.isArena(p.room) ? this.pvp.arenaSpawn() : { x: tileCenter(sp.tx), y: tileCenter(sp.ty) };
    p.dead = false;
    p.x = at.x;
    p.y = at.y;
    p.room.grid.update(p);
    p.hp = p.maxHp;
    p.res = JOB_DEFS[p.job].resource === 'rage' ? 0 : p.stats.maxRes;
    p.inQ.length = 0;
    p.ver++;
    p.sver++;
    p.dirty = true;
    applyStatus(p, STATUS_INDEX.ward, this.tick, 0, p.id);
    this.welcome(p);
  }

  /** Raise a fallen player where they lie (Resurrection). */
  revive(p: Player, frac: number) {
    if (!p.dead) return;
    p.dead = false;
    p.hp = Math.max(1, Math.ceil(p.maxHp * frac));
    p.ver++;
    p.sver++;
    p.selfDirty = true;
    applyStatus(p, STATUS_INDEX.ward, this.tick, 0, p.id);
  }

  /**
   * One strike against a monster: a weapon hit (`basic`) or an ability hit. Returns the damage
   * dealt (0 on a miss) and records whether it was a critical hit in `lastCrit`.
   */
  strike(p: Player, m: Monster, mul: number, magic = !!p.rule.magic, critAdd = 0, basic = true): number {
    if (m.dead) return 0;
    if (m.evading || this.rnd() * 100 < missChance(p.level, m.level)) {
      pushDmg(m, this.evt, 0, Dmg.Miss, p.id);
      m.addThreat(p.id, 1);
      return 0;
    }
    const rule = p.rule, s = p.stats;
    const power = (magic ? s.matk : s.atk) * p.mods.atk;
    const def = (magic ? m.def.mdef : m.def.def) * m.mods.def * (basic ? 1 - (rule.pierce ?? 0) : 1);
    // Unique passives from boss loot.
    if (m.def.elite && p.passives.includes('giantslayer')) mul *= 1.15;
    if (m.hp < m.maxHp * 0.3 && p.passives.includes('executioner')) mul *= 1.25;
    // Berserker passive (level 25): hits harder the lower its own health.
    if (p.job === 'berserker' && p.level >= 25) mul *= 1 + (1 - p.hp / p.maxHp) * 0.5;
    if (!magic && p.mask & (1 << STATUS_INDEX.retribution)) {
      mul *= STATUS[STATUS_INDEX.retribution].nextMul!;
      removeStatus(p, STATUS_INDEX.retribution);
    }
    // talents (G2): whom you hit changes how hard
    if (p.hasTalent('momentum') && !this.echoing) {
      if (p.momTarget !== m.id) { p.momTarget = m.id; p.momStacks = 0; }
      mul *= 1 + 0.04 * p.momStacks;
      p.momStacks = Math.min(5, p.momStacks + 1);
    }
    if (p.hasTalent('opportunist') && m.hp > m.maxHp * 0.9) mul *= 1.4;
    if (p.hasTalent('executioner_eye') && m.hp < m.maxHp * 0.35) mul *= 1.3;
    let dmg = mitigate(power * mul * (0.9 + this.rnd() * 0.2), def), flags = 0;
    if (this.rnd() * 100 < s.crit + critAdd) {
      dmg *= s.critDmg;
      flags |= Dmg.Crit;
      this.lastCrit = true;
    }
    const dealt = Math.max(1, Math.round(dmg));
    this.hurt(m, dealt, flags, p);
    const ls = s.lifesteal + p.mods.lifesteal;
    if (ls > 0) this.heal(p, Math.max(1, Math.round((dealt * ls) / 100)));
    if (basic && JOB_DEFS[p.job].resource === 'rage') {
      p.res = Math.min(s.maxRes, Math.round(p.res + RAGE_PER_HIT * (rule.rageMul ?? 1)));
      p.selfDirty = true;
    }
    if (basic && rule.poison && !m.dead && this.rnd() * 100 < rule.poison) applyStatus(m, STATUS_INDEX.poison, this.tick, power, p.id);
    // talents (G2): what happens after a hit lands
    if (!this.echoing) {
      if (!basic && flags & Dmg.Crit && p.hasTalent('overload')) this.cutCooldowns(p, 500);
      if (!basic && p.hasTalent('echo') && !m.dead && this.rnd() < 0.2) {
        this.echoing = true;
        try { this.strike(p, m, mul * 0.5, magic, critAdd, false); } finally { this.echoing = false; }
      }
      if (basic && p.hasTalent('cleaving_blows')) {
        this.echoing = true;
        try {
          let n = 0;
          for (const o of m.room.monsters.values()) {
            if (o === m || o.dead || Math.hypot(o.x - m.x, o.y - m.y) > 70) continue;
            this.strike(p, o, mul * 0.4, magic, 0, false);
            if (++n >= 2) break;
          }
        } finally { this.echoing = false; }
      }
    }
    return dealt;
  }
  /** Echoes and cleaves resolve as extra hits that do not trigger talents again. */
  private echoing = false;
  /** Takes time off every skill cooldown (Arcane Flow, Overload); the client is told. */
  cutCooldowns(p: Player, ms: number) {
    const t = Math.round(ms / TICK_MS);
    for (const [id, at] of p.cds) p.cds.set(id, Math.max(this.tick, at - t));
    this.send(p, { t: 'cdcut', ms });
  }
  private playerAttack(p: Player, m: Monster) {
    dismount(this, p);
    const dx = m.x - p.x, dy = m.y - p.y;
    p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
    p.ver++;
    p.nextAttack = this.tick + Math.max(4, ticks(p.stats.atkIntervalMs * p.mods.interval));
    emit(p, this.tick, [p.id, Act.Attack, m.id]);
    const rule = p.rule;
    // Attacking reveals a stealthed player; the assassin's level-25 passive makes that opener a critical hit.
    let ambush = 0;
    if (p.mods.stealth) {
      if (p.job === 'assassin' && p.level >= 25) ambush = 100;
      removeStatus(p, STATUS_INDEX.stealth);
    }
    this.strike(p, m, 1, !!rule.magic, ambush);
    if (rule.double) this.strike(p, m, rule.double);
    if (rule.cleave) {
      let extra = 0;
      for (const o of p.room.monsters.values()) {
        if (extra >= 2) break;
        if (o === m || o.dead || Math.hypot(o.x - m.x, o.y - m.y) > 48) continue;
        this.strike(p, o, rule.cleave);
        extra++;
      }
    }
  }

  // ---------- simulation ----------
  private step() {
    const t0 = performance.now();
    this.tick++;
    this.inStep = true;
    for (const list of this.rooms.values()) for (const room of list) {
      this.simulate(room);
      if (room.fields.length) updateFields(this, room);
      if (room.players.size) { for (const m of room.monsters.values()) m.update(this); this.traits.tick(room); }
      // developer overlay: AI state of the monsters around each developer, four times a second
      if (this.opts.debugOverlay && this.tick % 5 === 0)
        for (const p of room.players.values())
          if (p.debug) this.send(p, { t: 'dbg', mobs: [...room.monsters.values()].filter((m) => Math.abs(m.x - p.x) < AOI_HALF_W && Math.abs(m.y - p.y) < AOI_HALF_H).map((m) => m.debugInfo()) });
    }
    for (const p of this.transfers) this.transfer(p);
    this.transfers.length = 0;
    this.depthTick();
    for (const list of this.rooms.values()) for (const room of list) this.replicate(room);
    this.inStep = false;
    const now = Date.now();
    if (now - this.lastHousekeep >= 1000) this.housekeep(now);
    this.samples[this.sampleN++ % this.samples.length] = performance.now() - t0;
  }

  private simulate(room: ZoneRoom) {
    const map = room.map, tick = this.tick;
    for (const p of room.players.values()) {
      if (p.st.length) {
        this.dots.length = 0;
        tickStatuses(p, tick, this.dots);
        for (let i = 0; i < this.dots.length; i += 2) this.hurt(p, this.dots[i], Dmg.Dot, this.entById(room, this.dots[i + 1]));
      }
      p.budget = Math.min(p.budget + 1, INPUT_BURST);
      const q = p.inQ;
      if (p.dead || p.mods.stun) {
        // Inputs are acknowledged but have no effect, so the client's prediction settles.
        if (q.length) {
          p.lastSeq = q[q.length - 4];
          q.length = 0;
          p.needAck = true;
        }
        if (p.moving) {
          p.moving = Move.Idle;
          p.ver++;
        }
        if (p.casting) cancelCast(this, p);
        if (p.dead && (tick - p.deadTick) * TICK_MS >= RESPAWN_AUTO_MS) this.respawn(p);
        continue;
      }
      let used = 0;
      let i = 0;
      while (p.budget >= 1 && i < q.length) {
        const ix = q[i + 1], iy = q[i + 2], run = q[i + 3];
        const ox = p.x, oy = p.y;
        stepMove(p, ix, iy, map, run ? p.runStep : p.walkStep, isFlying(p.comp));
        p.lastSeq = q[i];
        i += 4;
        p.budget--;
        used++;
        const dir = ix < 0 ? Dir.Left : ix > 0 ? Dir.Right : iy < 0 ? Dir.Up : iy > 0 ? Dir.Down : p.dir;
        const moving = ix !== 0 || iy !== 0 ? (run ? Move.Run : Move.Walk) : Move.Idle;
        if (p.x !== ox || p.y !== oy || dir !== p.dir || moving !== p.moving) {
          p.dir = dir;
          p.moving = moving;
          p.ver++;
          p.dirty = true;
          room.grid.update(p);
          if (p.casting && moving) cancelCast(this, p); // moving interrupts a cast
        }
      }
      if (i) q.splice(0, i);
      if (p.casting) tickCast(this, p);
      if (used) {
        p.idleTicks = 0;
        p.needAck = true;
        if (portalAt(map, p.x, p.y)) this.transfers.push(p);
      } else if (p.moving && ++p.idleTicks >= 2) {
        // Two empty ticks tolerate jitter before others see the walk animation stop.
        p.moving = Move.Idle;
        p.ver++;
      }

      // --- the Depths: stepping out of the sanctuary gives a moment of protection ---
      if (map.def.sanctuary) {
        const inS = inSanctuary(room.zoneId, p.x, p.y);
        if (p.inSanct && !inS && !p.dead) {
          const now = Date.now();
          if (p.pvpTagUntil <= now && now - p.sanctShieldAt >= SANCTUARY_SHIELD_EVERY_MS) {
            p.sanctShieldAt = now;
            p.pvpShieldUntil = Math.max(p.pvpShieldUntil, now + SANCTUARY_LEAVE_SHIELD_MS);
          }
        }
        p.inSanct = inS;
      }

      // --- auto-attack on a player (PvP) ---
      const v = p.pvpTarget;
      if (v) {
        if (v.dead || v.room !== room || Math.hypot(v.x - p.x, v.y - p.y) > TARGET_RANGE || this.pvp.block(p, v)) {
          p.pvpTarget = null;
          p.attacking = false;
          p.selfDirty = true;
        } else if (p.attacking && !p.casting && tick >= p.nextAttack && Math.hypot(v.x - p.x, v.y - p.y) <= p.stats.range + PLAYER_HALF + 10) {
          const dx = v.x - p.x, dy = v.y - p.y;
          p.dir = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? Dir.Left : Dir.Right) : dy < 0 ? Dir.Up : Dir.Down;
          p.ver++;
          p.nextAttack = tick + Math.max(4, ticks(p.stats.atkIntervalMs * p.mods.interval));
          emit(p, tick, [p.id, Act.Attack, v.id]);
          dismount(this, p);
          this.pvp.strike(p, v, 1, !!p.rule.magic);
          if (p.rule.double && !v.dead) this.pvp.strike(p, v, p.rule.double, !!p.rule.magic);
        }
      }
      // --- auto-attack ---
      const m = p.target;
      if (m) {
        if (m.dead || !m.inGrid || Math.hypot(m.x - p.x, m.y - p.y) > TARGET_RANGE) {
          p.target = null;
          p.attacking = false;
          p.selfDirty = true;
        } else if (p.attacking && !p.casting && tick >= p.nextAttack && Math.hypot(m.x - p.x, m.y - p.y) <= p.stats.range + m.def.radius + 10) {
          this.playerAttack(p, m);
        }
      }

      // --- regeneration, once per second, staggered per player ---
      if ((tick + p.id) % 20 === 0) {
        const s = p.stats, rage = JOB_DEFS[p.job].resource === 'rage';
        const calm = (tick - p.lastCombat) * TICK_MS > COMBAT_TIMEOUT_MS;
        const hp0 = p.hp, res0 = p.res;
        if (calm) {
          p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.03));
          p.res = rage ? Math.max(0, p.res - 3) : Math.min(s.maxRes, p.res + Math.ceil(s.maxRes * 0.04));
        } else if (!rage) p.res = Math.min(s.maxRes, p.res + Math.ceil(s.maxRes * 0.01));
        if (p.hp !== hp0) p.sver++;
        if (p.hp !== hp0 || p.res !== res0) p.selfDirty = true;
      }
    }
  }

  private transfer(p: Player) {
    const portal = portalAt(p.room.map, p.x, p.y);
    if (portal?.to === EXIT && !p.dead) return void (this.pvp.isArena(p.room) ? this.pvp.leaveArena(p) : this.rifts.isRift(p.room) ? this.rifts.leave(p) : this.raids.isRaid(p.room) ? this.raids.leave(p) : this.life.isHome(p.room) ? this.life.leaveHome(p) : this.dungeons.leave(p));
    if (!portal || !ZONES[portal.to] || p.dead) return;
    const dest = ZONES[portal.to], now = Date.now();
    const refuse = (text: string) => {
      if (now - p.portalMsgAt < 3000) return;
      p.portalMsgAt = now;
      this.send(p, { t: 'sys', text });
    };
    if (p.pvpTagUntil > now) return refuse('You cannot leave while you are fighting another player');
    if (dest.depth) {
      const need = ZONES[dest.depth.host].level[0];
      if (p.level < need) return refuse(`The Depths open at level ${need}`);
      if (!p.depthOk) {
        // the first time: a warning to agree to (the client answers with `depth enter`)
        if (now - p.portalMsgAt >= 1500) {
          p.portalMsgAt = now;
          this.send(p, { t: 'depthask', zone: dest.id, level: need });
        }
        return;
      }
    }
    p.streak = 0;
    p.inSanct = !!dest.sanctuary;
    this.stopAuto(p, 'You left the hunting area');
    this.trades.drop(p, 'a player left');
    this.pvp.drop(p);
    if (MOUNT_FORBIDDEN_KINDS.includes(ZONES[portal.to].kind ?? '')) dismount(this, p);
    p.room.remove(p);
    p.x = tileCenter(portal.toTx);
    p.y = tileCenter(portal.toTy);
    this.pickRoom(portal.to, p).add(p);
    p.dirty = true;
    this.welcome(p);
  }

  /** The player agreed to the warning at the entrance of the Depths. */
  depthEnter(p: Player) {
    p.depthOk = true;
    p.portalMsgAt = 0;
    const portal = portalAt(p.room.map, p.x, p.y);
    if (portal && ZONES[portal.to]?.depth) this.transfer(p);
  }
  /** When each boss of the Depths returns (first channel); 0 while it lives. */
  depthBossState(): DepthBossState[] {
    return DEPTH_BOSSES.map((b) => {
      let at = 0;
      const room = this.rooms.get(b.zone)?.[0];
      if (room) for (const m of room.monsters.values()) if (m.def.id === b.type && m.dead) at = Date.now() + Math.max(0, m.respawnTick - this.tick) * TICK_MS;
      return { zone: b.zone, at };
    });
  }
  private bountyRooms = new Set<ZoneRoom>();
  /** The Depths: players carrying a bounty are shown to everyone there; boss timers go to everyone. */
  private depthTick() {
    // story quests: "go to" objectives are checked about once a second
    if (this.tick % 20 === 7) for (const p of this.online.values()) if (!p.dead && Object.keys(p.quests.active).some((id) => id.startsWith('story_'))) this.quests.onMove(p);
    if (this.tick % 40 === 0)
      for (const z of DEPTH_ZONES) for (const room of this.rooms.get(z) ?? []) {
        const marks = [...room.players.values()].filter((p) => p.streak >= BOUNTY_STREAK && !p.dead).map((p) => ({ id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), n: p.streak }));
        if (!marks.length && !this.bountyRooms.has(room)) continue;
        for (const p of room.players.values()) this.send(p, { t: 'bounty', marks });
        if (marks.length) this.bountyRooms.add(room);
        else this.bountyRooms.delete(room);
      }
    if (this.tick % 400 === 0) {
      const bosses = this.depthBossState();
      for (const p of this.online.values()) if (p.conn) this.send(p, { t: 'depths', bosses });
    }
  }

  private selfState(p: Player): SelfState {
    const me: SelfState = {
      hp: p.hp, res: p.res, exp: p.exp,
      st: p.st.map((s) => [s.i, Math.max(0, (s.until - this.tick) * TICK_MS)] as [number, number]),
      tgt: p.target ? p.target.id : 0,
      atk: p.attacking ? 1 : 0,
      dead: p.dead ? Math.max(0, RESPAWN_AUTO_MS - (this.tick - p.deadTick) * TICK_MS) : 0,
    };
    if (p.xpGained) {
      me.xp = p.xpGained;
      p.xpGained = 0;
    }
    return me;
  }

  private replicate(room: ZoneRoom) {
    const near = this.scratch;
    const seen = this.seen;
    const tick = this.tick;
    for (const p of room.players.values()) {
      if (!p.conn) continue;
      near.length = 0;
      room.grid.queryRect(p.x - AOI_HALF_W, p.y - AOI_HALF_H, p.x + AOI_HALF_W, p.y + AOI_HALF_H, near);
      // Snapshots are assembled as strings from per-entity fragments that are serialised once and
      // shared by every viewer; with a crowd on screen this is most of the tick's work.
      let add: EntityMeta[] | undefined, rm: number[] | undefined;
      const mv = this.fMv, ev = this.fEv, dm = this.fDm, hp = this.fHp;
      mv.length = ev.length = dm.length = hp.length = 0;
      const known = p.known, px = p.x, py = p.y;
      for (let i = 0; i < near.length; i++) {
        const e = near[i] as Ent & Frag;
        if (e === (p as Ent)) continue;
        // `known` holds what this viewer was last sent, movement and vitals versions packed in one number.
        const want = e.ver * PACK + e.sver, v = known.get(e.id);
        if (v === undefined) {
          (add ??= []).push(e.meta());
          known.set(e.id, want);
        } else if (v !== want) {
          // Outside what any client can show (the view is at most 1280x720): still replicated, so
          // entities are in place when they come into view, but movement is sent at a quarter rate.
          const off = Math.abs(e.x - px) > VIEW_HALF_W || Math.abs(e.y - py) > VIEW_HALF_H;
          const sv = v % PACK;
          let ver = (v - sv) / PACK;
          if (ver !== e.ver && (!off || ((tick + e.id) & 3) === 0)) {
            if (e.fMvV !== e.ver) {
              e.fMv = `[${e.id},${e.x},${e.y},${e.dir},${e.moving}]`;
              e.fMvV = e.ver;
            }
            mv.push(e.fMv!);
            ver = e.ver;
          }
          if (sv !== e.sver) {
            if (e.fHpV !== e.sver) {
              e.fHp = `[${e.id},${e.hp},${e.maxHp},${e.mask}]`;
              e.fHpV = e.sver;
            }
            hp.push(e.fHp!);
          }
          known.set(e.id, ver * PACK + e.sver);
        }
        if (e.evTick === tick && e.evs.length) {
          if (e.fEvT !== tick) {
            e.fEv = JSON.stringify(e.evs).slice(1, -1);
            e.fEvT = tick;
          }
          ev.push(e.fEv!);
        }
        // floating damage numbers are only sent for entities that can be on screen
        if (e.dmgTick === tick && e.dmgs.length && Math.abs(e.x - px) <= VIEW_HALF_W && Math.abs(e.y - py) <= VIEW_HALF_H) {
          if (e.fDmT !== tick) {
            e.fDm = JSON.stringify(e.dmgs).slice(1, -1);
            e.fDmT = tick;
          }
          dm.push(e.fDm!);
        }
      }
      if (p.dmgTick === tick && p.dmgs.length) dm.push(JSON.stringify(p.dmgs).slice(1, -1));
      // The actor needs its own cast/effect events (cooldowns and cast bar are driven by them).
      if (p.evTick === tick)
        for (const x of p.evs) if (x[1] === Act.Cast || x[1] === Act.Fx || x[1] === Act.FxEnd || (x[1] === Act.Telegraph && x[6])) ev.push(JSON.stringify(x));
      if (known.size > near.length - 1) {
        seen.clear();
        for (let i = 0; i < near.length; i++) seen.add(near[i].id);
        for (const id of known.keys())
          if (!seen.has(id)) {
            (rm ??= []).push(id);
            known.delete(id);
          }
      }
      p.sinceSnap++;
      if (!add && !rm && !mv.length && !ev.length && !dm.length && !hp.length && !p.needAck && !p.selfDirty && p.sinceSnap < IDLE_SNAP_TICKS) continue;
      let snap = `{"t":"snap","k":${tick},"a":${p.lastSeq},"x":${p.x},"y":${p.y}`;
      if (add) snap += ',"add":' + JSON.stringify(add);
      if (rm) snap += ',"rm":' + JSON.stringify(rm);
      if (mv.length) snap += ',"mv":[' + mv.join() + ']';
      if (ev.length) snap += ',"ev":[' + ev.join() + ']';
      if (dm.length) snap += ',"dm":[' + dm.join() + ']';
      if (hp.length) snap += ',"hp":[' + hp.join() + ']';
      if (p.selfDirty) {
        snap += ',"me":' + JSON.stringify(this.selfState(p));
        p.selfDirty = false;
      }
      p.needAck = false;
      p.sinceSnap = 0;
      this.sendRaw(p, snap + '}');
    }
  }

  private housekeep(now: number) {
    this.lastHousekeep = now;
    for (const p of this.online.values()) {
      if (p.chatTokens < 5) p.chatTokens += 0.5; // 5 burst, 1 message / 2s sustained
      if (!p.conn && p.disconnectedAt && now - p.disconnectedAt >= this.opts.reconnectGraceMs) this.despawn(p);
    }
    for (const [zone, list] of this.rooms) {
      const keep = list.filter((r, i) => i === 0 || r.players.size > 0);
      if (keep.length !== list.length) this.rooms.set(zone, keep);
    }
    this.parties.tick(now);
    this.trades.tick(now);
    this.pvp.tick(now);
    if (now - this.lastSweep >= 30_000) {
      this.lastSweep = now;
      void this.economy.sweep();
    }
    this.dungeons.tick(now);
    this.journals.tick(now);
    this.events.tick(now);
    this.rifts.tick(now);
    this.raids.tick(now);
    this.conquest.tick(now);
    this.life.tick();
    discoverWaystones(this);
    if (now - this.lastAutosave >= this.opts.autosaveMs) {
      this.lastAutosave = now;
      const rows = [];
      for (const p of this.online.values())
        if (p.dirty) {
          p.dirty = false;
          rows.push(saveRow(p));
        }
      for (const p of this.online.values()) this.saveBuild(p);
      this.repo.saveState(rows).catch((e) => console.error('autosave failed', e));
      void this.guilds.save();
    }
  }

  metrics(): Metrics {
    const n = Math.min(this.sampleN, this.samples.length);
    const s = Array.from(this.samples.subarray(0, n)).sort((a, b) => a - b);
    const at = (q: number) => (n ? s[Math.min(n - 1, Math.floor(n * q))] : 0);
    let rooms = 0, connected = 0, monsters = 0;
    for (const l of this.rooms.values()) {
      rooms += l.length;
      for (const r of l) monsters += r.monsters.size;
    }
    for (const p of this.online.values()) if (p.conn) connected++;
    const r = (v: number) => Math.round(v * 1000) / 1000;
    return {
      tick: this.tick, players: this.online.size, connected, rooms, monsters, parties: this.parties.count,
      tickMs: { avg: r(n ? s.reduce((a, b) => a + b, 0) / n : 0), p95: r(at(0.95)), p99: r(at(0.99)), max: r(n ? s[n - 1] : 0), samples: n },
      lateTicks: this.lateTicks, msgsOut: this.msgsOut, bytesOut: this.bytesOut, msgsIn: this.msgsIn,
      uptimeSec: Math.round((Date.now() - this.started) / 1000),
    };
  }
}

/** What is stored for a character. Inside a dungeon instance the entrance outside is stored: instances do not outlive a logout. */
const saveRow = (p: Player) => {
  const inside = ZONES[p.room.zoneId].kind === 'dungeon', ret = inside ? p.ret : null;
  const zone = inside ? ret?.zone ?? 'eldoria' : p.room.zoneId, sp = ZONES[zone].spawn;
  return { id: p.id, zone, x: inside ? ret?.x ?? tileCenter(sp.tx) : p.x, y: inside ? ret?.y ?? tileCenter(sp.ty) : p.y, level: p.level, exp: p.exp };
};
// Re-exported for tests that want to assert against the status table.
export { STATUS, TILE };
