// Life outside combat on the server: professions (gathering, fishing, forging gear with chosen
// sub-stats), the home (furniture, garden, a bed to rest in), the season pass, and the wardrobe.
import { applyStatus } from './entity';
import { STATUS_INDEX } from '../../../shared/src/combat';
import { INVENTORY_SIZE, ITEMS, RARITIES, rollItem, type GearStat } from '../../../shared/src/items';
/** How far up the forge's scale a rarity is (normal 0 ... mythic 4): more smithing experience for better results. */
const FORGE_RARITY_RANK: Record<number, number> = { 0: 0, 2: 1, 3: 2, 4: 3, 5: 4 };
import {
  AURA_SKINS, cleanLife, COOK_COST, cookCost, ENERGY_COST, energyNow, extraYield, FISH_COOLDOWN_MS, FOOD_MS, FOODS, foodId, foodOf, FORGE_LEVELS, forgeCost, forgedAffix, forgeSlots,
  FURNITURE, FURNITURE_MAX, GARDEN_PLOTS, GEAR_STATS, GROW_MS, haulRoll, HOME_SLOTS, HOME_ZONE, MAT_TIER, matOf, PROF_MAX, PROF_OF_RES, profExpToNext, REST_EVERY_MS, REST_MS, rollForge,
  SEASON_GAIN, SEASON_LEVELS, SEASON_XP, seasonLevel, seasonOf, seasonReward, SEEDS, spendEnergy, zoneTier, type FoodKind, type Life, type Profession,
} from '../../../shared/src/life';
import { objNear } from '../../../shared/src/places';
import { inTown } from '../../../shared/src/pvp';
import { TILE } from '../../../shared/src/protocol';
import { getZoneMap, T, tileAt, tileCenter, ZONES } from '../../../shared/src/world';
import { award, consume, count, give, newUid, sendInv } from './Inventory';
import { ZoneRoom, type Player, type World } from './World';

const STEWARD_RANGE = 160;
/** Where the garden's plots are in the home (tiles). */
export const PLOT_TILES = [[19, 13], [21, 13], [23, 13]];
export const BED_RANGE = 48;

export class Lives {
  /** Homes open now: owner id -> room. */
  readonly homes = new Map<number, ZoneRoom>();
  private fishAt = new Map<number, number>();
  constructor(private w: World) {}

  load(p: Player, raw: unknown) {
    p.life = cleanLife(raw);
    this.rollSeason(p, Date.now());
  }
  send(p: Player) {
    this.w.send(p, { t: 'life', life: p.life });
  }
  private touch(p: Player) {
    p.progDirty = true;
    this.send(p);
  }

  // ---------- professions ----------
  private train(p: Player, prof: Profession, xp: number) {
    const s = p.life.prof[prof];
    if (s.lv >= PROF_MAX) return;
    s.xp += xp;
    while (s.lv < PROF_MAX && s.xp >= profExpToNext(s.lv)) {
      s.xp -= profExpToNext(s.lv);
      s.lv++;
      this.w.send(p, { t: 'sys', text: `Your ${prof} skill is now level ${s.lv}.`, cue: 'rep' });
    }
    if (s.lv >= PROF_MAX) s.xp = 0;
    p.progDirty = true;
  }
  /** Energy left today. */
  energy(p: Player, now = Date.now()) {
    return energyNow(p.life, now);
  }
  /** Spends the energy a gathering of this material's tier costs; the reason it cannot, or ''. */
  payEnergy(p: Player, res: string, now = Date.now()): string {
    const cost = ENERGY_COST[MAT_TIER[res] || 1];
    if (!spendEnergy(p.life, cost, now)) return `Not enough energy: this takes ${cost}, you have ${energyNow(p.life, now)} (it fills again tomorrow)`;
    p.progDirty = true;
    return '';
  }
  /** How many a gathering yields: herbalism doubles, triples or quadruples with its level; mining adds one every 15 levels. */
  haul(p: Player, res: string): number {
    const prof = PROF_OF_RES[res];
    if (!prof) return 1;
    const lv = p.life.prof[prof].lv;
    return prof === 'herbalism' ? haulRoll(lv, this.w.rnd()) : 1 + (this.w.rnd() < 0.35 ? 1 : 0) + extraYield(lv);
  }
  /** A resource node was gathered: the profession trains (by the material's tier). */
  onGather(p: Player, res: string) {
    const prof = PROF_OF_RES[res];
    if (!prof) return;
    this.train(p, prof, 8 + 6 * (MAT_TIER[res] || 1));
    this.send(p);
  }
  private nearWater(p: Player): boolean {
    const m = p.room.map, tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (tileAt(m, tx + dx, ty + dy) === T.Water) return true;
    return false;
  }

  // ---------- food ----------
  /** Eats a dish: its bonus for half an hour, replacing the same dish eaten before. */
  eat(p: Player, base: string): string {
    const f = foodOf(base);
    if (!f) return 'Cannot be eaten';
    p.life.food[f.kind] = { t: f.tier, until: Date.now() + FOOD_MS };
    p.progDirty = true;
    this.w.companionsChanged(p); // stats, HP kept in proportion, sent
    this.send(p);
    return '';
  }
  /** Once a second: a dish whose half hour is over stops counting. */
  foodTick(p: Player, now: number) {
    let gone = false;
    for (const k of FOODS) { const f = p.life.food[k]; if (f && f.until <= now) { delete p.life.food[k]; gone = true; } }
    if (!gone) return;
    p.progDirty = true;
    this.w.companionsChanged(p);
    this.send(p);
  }

  // ---------- the season ----------
  private rollSeason(p: Player, now: number) {
    const id = seasonOf(now);
    if (p.life.season.id !== id) p.life.season = { id, xp: 0, claimed: [] };
  }
  /** Season experience for something the character did. */
  season(p: Player, what: keyof typeof SEASON_GAIN, n = 1) {
    this.rollSeason(p, Date.now());
    const before = seasonLevel(p.life.season.xp);
    p.life.season.xp = Math.min(SEASON_LEVELS * SEASON_XP, p.life.season.xp + SEASON_GAIN[what] * n);
    p.progDirty = true;
    if (seasonLevel(p.life.season.xp) > before) {
      this.w.send(p, { t: 'sys', text: `Season level ${seasonLevel(p.life.season.xp)} reached. Claim it in the Life panel.`, cue: 'rep' });
      this.send(p);
    }
  }

  // ---------- the home ----------
  /** The room of a home (opened on demand). */
  private homeRoom(owner: Player): ZoneRoom {
    let r = this.homes.get(owner.id);
    if (!r) {
      r = new ZoneRoom(HOME_ZONE, 60000 + owner.id);
      this.homes.set(owner.id, r);
      this.w.addRoom(r);
    }
    return r;
  }
  ownerOf(room: ZoneRoom): Player | undefined {
    for (const [id, r] of this.homes) if (r === room) return this.w.online.get(id);
    return undefined;
  }
  isHome(room: ZoneRoom) {
    return [...this.homes.values()].includes(room);
  }
  sendHome(room: ZoneRoom) {
    const o = this.ownerOf(room);
    if (!o) return;
    for (const p of room.players.values()) this.w.send(p, { t: 'home', owner: o.name, mine: p === o, furn: o.life.home.furn, garden: o.life.home.garden, now: Date.now() });
  }
  leaveHome(p: Player): string {
    if (!this.isHome(p.room)) return 'You are not in a home';
    const ret = p.ret && ZONES[p.ret.zone] && ZONES[p.ret.zone].kind !== 'dungeon' ? p.ret : null;
    const zone = ret?.zone ?? 'eldoria', sp = ZONES[zone].spawn;
    p.ret = null;
    this.w.relocate(p, this.w.roomIn(zone, p), ret?.x ?? tileCenter(sp.tx), ret?.y ?? tileCenter(sp.ty));
    this.w.send(p, { t: 'home', owner: '', mine: false, furn: [], garden: [], now: Date.now() });
    return '';
  }
  /** Once a minute: homes nobody is in are closed. */
  tick() {
    for (const [id, r] of [...this.homes]) {
      if (r.players.size) continue;
      this.homes.delete(id);
      this.w.dropRoom(r);
    }
  }

  // ---------- commands ----------
  /** `{op, ...}` for professions, home, season and wardrobe. Returns '' or the reason. */
  op(p: Player, m: any): string {
    if (!m || typeof m !== 'object') return 'Unknown command';
    const now = Date.now(), home = this.homes.get(p.id), inMyHome = home === p.room, steward = !!objNear(p.room.zoneId, p.x, p.y, STEWARD_RANGE, ['steward']);
    switch (m.op) {
      case 'fish': {
        if (p.dead) return 'You are dead';
        if (ZONES[p.room.zoneId]?.kind === 'dungeon') return 'There is no fishing here';
        if (!this.nearWater(p)) return 'Stand at the water to fish';
        if (now < (this.fishAt.get(p.id) ?? 0)) return 'The fish are not biting yet';
        const base = matOf('fishing', p.room.zoneId), qty = haulRoll(p.life.prof.fishing.lv, this.w.rnd());
        if (p.inv.length >= INVENTORY_SIZE && !p.inv.some((i) => i.base === base && i.qty + qty <= (ITEMS[base].stack ?? 1))) return 'Inventory is full';
        const why = this.payEnergy(p, base, now);
        if (why) return why;
        this.fishAt.set(p.id, now + FISH_COOLDOWN_MS);
        give(p, { base, rar: 0, ilvl: 1, aff: [], up: 0, qty });
        this.w.send(p, { t: 'loot', gold: 0, items: [{ base, rar: 0, qty }] });
        this.train(p, 'fishing', 8 + 6 * zoneTier(p.room.zoneId));
        sendInv(this.w, p);
        this.send(p);
        return '';
      }
      case 'cook': {
        // five herbs and five fish of a tier make one dish of that tier, at a merchant
        if (!objNear(p.room.zoneId, p.x, p.y, 200, ['merchant'])) return 'You need to be at a merchant';
        const kind = FOODS.find((k) => k === m.food) as FoodKind | undefined, tier = Number(m.tier);
        if (!kind || !Number.isInteger(tier) || tier < 1 || tier > 4) return 'Unknown dish';
        const cost = cookCost(tier);
        for (const [mat, n] of cost) if (count(p, mat) < n) return `Requires ${n} ${ITEMS[mat].name}`;
        if (!give(p, { base: foodId(kind, tier), rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 })) return 'Inventory is full';
        for (const [mat, n] of cost) consume(p, mat, n);
        this.w.send(p, { t: 'sys', text: `You cooked ${ITEMS[foodId(kind, tier)].name}.`, cue: 'loot' });
        sendInv(this.w, p);
        return '';
      }
      case 'forge': {
        if (!objNear(p.room.zoneId, p.x, p.y, 200, ['merchant'])) return 'You need to be at a merchant';
        const b = typeof m.base === 'string' ? ITEMS[m.base] : undefined;
        if (!b || b.kind !== 'equip' || b.unique) return 'That cannot be forged';
        const lvl = FORGE_LEVELS.find((f) => f.ilvl === m.ilvl);
        if (!lvl) return 'Choose the level of the gear: 30, 60, 90 or 120';
        // the sub-stats in the smith's order of preference; the item takes as many as its rarity has
        const stats: GearStat[] = Array.isArray(m.stats) ? [...new Set<GearStat>(m.stats.filter((k: unknown): k is GearStat => GEAR_STATS.includes(k as GearStat)))].slice(0, 5) : [];
        if (!stats.length) return 'Choose the sub-stats to forge';
        const cost = forgeCost(lvl.ilvl);
        if (p.gold < cost.gold) return `Forging costs ${cost.gold} gold`;
        for (const [mat, n] of cost.mats) if (count(p, mat) < n) return `Requires ${n} ${ITEMS[mat].name}`;
        if (p.inv.length >= INVENTORY_SIZE) return 'Inventory is full';
        const smith = p.life.prof.smithing.lv, rar = rollForge(smith, this.w.rnd()), slots = forgeSlots(rar);
        const it = rollItem(this.w.rnd, b.id, lvl.ilvl, rar);
        const picked = stats.slice(0, slots), rest = GEAR_STATS.filter((k) => !picked.includes(k));
        while (picked.length < slots && rest.length) picked.push(rest.splice(Math.floor(this.w.rnd() * rest.length), 1)[0]);
        it.aff = picked.map((k) => forgedAffix(k, lvl.ilvl, rar, this.w.rnd));
        p.gold -= cost.gold;
        for (const [mat, n] of cost.mats) consume(p, mat, n);
        give(p, it);
        this.train(p, 'smithing', 25 + 15 * lvl.tier + 10 * FORGE_RARITY_RANK[rar]);
        this.w.send(p, { t: 'sys', text: `You forged a ${RARITIES[rar]} ${ITEMS[b.id].name}.`, cue: rar >= 4 ? 'questdone' : 'upgrade_ok' });
        sendInv(this.w, p);
        this.send(p);
        return '';
      }
      case 'home': {
        // enter your own home (from the Housing Steward), or visit someone's (online, by name)
        if (!steward) return 'Speak with the Housing Steward in Eldoria';
        const owner = typeof m.name === 'string' && m.name ? [...this.w.online.values()].find((x) => x.name.toLowerCase() === m.name.toLowerCase()) : p;
        if (!owner) return 'That adventurer is not online';
        const room = this.homeRoom(owner), sp = ZONES[HOME_ZONE].spawn;
        p.ret = { zone: p.room.zoneId, x: p.x, y: p.y };
        this.w.relocate(p, room, tileCenter(sp.tx), tileCenter(sp.ty));
        this.sendHome(room);
        return '';
      }
      case 'leave':
        return this.leaveHome(p);
      case 'buy': {
        if (!steward) return 'Speak with the Housing Steward in Eldoria';
        const base = typeof m.base === 'string' ? m.base : '', price = FURNITURE[base]?.price ?? (SEEDS[base] ? ITEMS[base].price : 0);
        if (!price) return 'Not for sale';
        if (p.gold < price) return 'Not enough gold';
        if (!give(p, { base, rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 })) return 'Inventory is full';
        p.gold -= price;
        sendInv(this.w, p);
        return '';
      }
      case 'place': {
        if (!inMyHome) return 'Furniture is placed in your own home';
        const it = p.inv.find((i) => i.uid === m.uid);
        if (!it || !FURNITURE[it.base]) return 'That is not furniture';
        const { tx, ty } = m;
        if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < HOME_SLOTS.x0 || tx > HOME_SLOTS.x1 || ty < HOME_SLOTS.y0 || ty > HOME_SLOTS.y1) return 'It does not fit there';
        if (p.life.home.furn.some((f) => f.tx === tx && f.ty === ty) || PLOT_TILES.some(([x, y]) => x === tx && y === ty)) return 'Something is already there';
        if (p.life.home.furn.length >= FURNITURE_MAX) return `A home holds at most ${FURNITURE_MAX} pieces`;
        consume(p, it.base, 1);
        p.life.home.furn.push({ base: it.base, tx, ty });
        sendInv(this.w, p);
        this.touch(p);
        this.sendHome(p.room);
        return '';
      }
      case 'pickup': {
        if (!inMyHome) return 'Furniture is moved in your own home';
        const i = p.life.home.furn.findIndex((f) => f.tx === m.tx && f.ty === m.ty);
        if (i < 0) return 'There is nothing there';
        if (!give(p, { base: p.life.home.furn[i].base, rar: 0, ilvl: 1, aff: [], up: 0, qty: 1 })) return 'Inventory is full';
        p.life.home.furn.splice(i, 1);
        sendInv(this.w, p);
        this.touch(p);
        this.sendHome(p.room);
        return '';
      }
      case 'plant': {
        if (!inMyHome) return 'Plant in your own garden';
        const i = m.plot, it = p.inv.find((x) => x.uid === m.uid);
        if (!Number.isInteger(i) || i < 0 || i >= GARDEN_PLOTS) return 'Unknown plot';
        if (p.life.home.garden[i]) return 'Something already grows there';
        if (!it || !SEEDS[it.base]) return 'That is not a seed';
        consume(p, it.base, 1);
        p.life.home.garden[i] = { seed: it.base, at: now };
        sendInv(this.w, p);
        this.touch(p);
        this.sendHome(p.room);
        return '';
      }
      case 'harvest': {
        if (!inMyHome) return 'Harvest your own garden';
        const g = Number.isInteger(m.plot) ? p.life.home.garden[m.plot] : null;
        if (!g) return 'Nothing grows there';
        if (now - g.at < GROW_MS) return 'It is not ripe yet';
        const [base, qty] = SEEDS[g.seed].yields;
        if (!give(p, { base, rar: 0, ilvl: 1, aff: [], up: 0, qty })) return 'Inventory is full';
        p.life.home.garden[m.plot] = null;
        this.train(p, 'herbalism', 30);
        this.w.send(p, { t: 'loot', gold: 0, items: [{ base, rar: 0, qty }] });
        sendInv(this.w, p);
        this.touch(p);
        this.sendHome(p.room);
        return '';
      }
      case 'rest': {
        if (!inMyHome) return 'Rest in your own bed';
        const bed = p.life.home.furn.find((f) => FURNITURE[f.base].bed && Math.hypot(tileCenter(f.tx) - p.x, tileCenter(f.ty) - p.y) <= BED_RANGE);
        if (!bed) return 'Lie down next to your bed';
        if (now - p.life.home.restAt < REST_EVERY_MS) return 'You are not tired yet';
        p.life.home.restAt = now;
        applyStatus(p, STATUS_INDEX.rested, this.w.tick, 0, p.id);
        this.w.send(p, { t: 'sys', text: 'You wake up rested: stronger for half an hour.', cue: 'rep' });
        this.touch(p);
        return '';
      }
      case 'claim': {
        this.rollSeason(p, now);
        const lv = m.level;
        if (!Number.isInteger(lv) || lv < 1 || lv > SEASON_LEVELS) return 'Unknown season level';
        if (seasonLevel(p.life.season.xp) < lv) return 'You have not reached that season level';
        if (p.life.season.claimed.includes(lv)) return 'Already claimed';
        const r = seasonReward(lv);
        if (r.item && p.inv.length >= INVENTORY_SIZE) return 'Make room in your bag first';
        p.life.season.claimed.push(lv);
        if (r.gold) award(this.w, p, r.gold, []);
        if (r.item) award(this.w, p, 0, [{ base: r.item[0], rar: 0, ilvl: 1, aff: [], up: 0, qty: r.item[1] }]);
        if (r.aura && !p.life.auras.includes(r.aura)) p.life.auras.push(r.aura);
        this.touch(p);
        return '';
      }
      case 'look': {
        // wear another look for armour or helmet (any collected), or '' for the real one
        const slot = m.slot === 'armor' || m.slot === 'helmet' ? m.slot : null;
        if (!slot) return 'Unknown slot';
        if (m.base && (!p.life.looks.includes(m.base) || ITEMS[m.base]?.slot !== slot)) return 'You have not collected that look';
        if (m.base) p.life.tmog[slot as 'armor'] = m.base;
        else delete p.life.tmog[slot as 'armor'];
        p.recalc();
        this.w.relook(p);
        this.touch(p);
        return '';
      }
      case 'buyaura': {
        const a = typeof m.id === 'string' ? AURA_SKINS[m.id] : undefined;
        if (!a?.price) return 'Not for sale';
        if (p.life.auras.includes(m.id)) return 'You already own that glow';
        if (p.gold < a.price) return 'Not enough gold';
        p.gold -= a.price;
        p.life.auras.push(m.id);
        p.life.aura = m.id; // worn at once
        p.selfDirty = true;
        sendInv(this.w, p);
        this.w.relook(p);
        this.touch(p);
        return '';
      }
      case 'aura': {
        if (m.id && !p.life.auras.includes(m.id)) return 'You have not unlocked that glow';
        p.life.aura = m.id && AURA_SKINS[m.id] ? m.id : '';
        this.w.relook(p);
        this.touch(p);
        return '';
      }
      default:
        return 'Unknown command';
    }
  }
  /** A look is collected the first time an armour or helmet is worn. */
  collect(p: Player) {
    let changed = false;
    for (const it of [p.eq.armor, p.eq.helmet])
      if (it && !p.life.looks.includes(it.base) && ITEMS[it.base]?.look) {
        p.life.looks.push(it.base);
        changed = true;
      }
    if (changed) this.touch(p);
  }
}
export { newUid, getZoneMap };
