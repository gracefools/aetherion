// Server-authoritative inventory: every change to items, equipment and gold happens here.
// Items are instances with a unique id; the whole inventory is saved as one atomic snapshot, so
// an item can never exist twice (see cleanInventory for the load-time duplicate check).
import { ARM_MAX, ARMAMENT_LEVEL, armChance, armCost, armFallback, SIGIL_LEVEL, sigilBase } from '../../../shared/src/gear';
import crypto from 'node:crypto';
import { COMBAT_TIMEOUT_MS } from '../../../shared/src/combat';
import { bindSpec,
  equipBlock, INVENTORY_SIZE, ITEMS, MAX_UPGRADE, POTION_CD_MS, rollLoot, sellValue, SHOP_RANGE, SHOP_STOCK, SHOP_BUY_MAX, SHOP_COMPANIONS, SHOP_ONCE, HP_POTION, MANA_POTION, RAGE_POTION, DAILY_STONES, SLOTS, SLOT_NAMES, starterKit,
  UPGRADE_CHANCE, upgradeCost, type Item, type ItemSpec, type Slot,
} from '../../../shared/src/items';
import { JOB_DEFS } from '../../../shared/src/jobs';
import { SORT_KEYS, TICK_MS, type SortKey } from '../../../shared/src/protocol';
import { lootAllowed } from '../../../shared/src/autohunt';
import { objNear, RUNE_SHOP_RANGE } from '../../../shared/src/places';
import { ELEMENT_NAMES, ELEMENTS, type Element } from '../../../shared/src/abilities';
import { applyScroll, ownsRune, rollScroll, RUNE_SHOP, RUNE_STOCK, runePrice, SCROLLS } from '../../../shared/src/runes';
import { buildChanged } from './Abilities';
import { learnCompanion } from './Companions';
import type { Monster } from './Monster';
import { dayOf } from '../../../shared/src/journal';
import type { Player, World } from './World';

export const newUid = () => crypto.randomBytes(9).toString('base64url');

/** Adds an item, stacking where possible. Returns false (and adds nothing) if there is no room. */
export function give(p: Player, spec: ItemSpec): boolean {
  const b = ITEMS[spec.base];
  if (!b) return false;
  let left = spec.qty;
  const max = b.stack ?? 1;
  if (max > 1) {
    let room = 0;
    for (const it of p.inv) if (it.base === spec.base) room += max - it.qty;
    room += (INVENTORY_SIZE - p.inv.length) * max;
    if (room < left) return false;
    for (const it of p.inv) {
      if (it.base !== spec.base || it.qty >= max || !left) continue;
      const n = Math.min(left, max - it.qty);
      it.qty += n;
      left -= n;
    }
  } else if (p.inv.length >= INVENTORY_SIZE) return false;
  while (left > 0) {
    const n = Math.min(left, max);
    p.inv.push({ ...spec, aff: spec.aff.map((a) => [a[0], a[1]]), uid: newUid(), qty: n });
    left -= n;
  }
  p.invDirty = true;
  return true;
}
/** Removes `qty` of a stack (or the whole item). */
function take(p: Player, it: Item, qty = it.qty) {
  it.qty -= qty;
  if (it.qty <= 0) p.inv.splice(p.inv.indexOf(it), 1);
  p.invDirty = true;
}
export function count(p: Player, base: string) {
  let n = 0;
  for (const it of p.inv) if (it.base === base) n += it.qty;
  return n;
}
export function consume(p: Player, base: string, qty: number) {
  for (let i = p.inv.length - 1; i >= 0 && qty > 0; i--) {
    const it = p.inv[i];
    if (it.base !== base) continue;
    const n = Math.min(qty, it.qty);
    take(p, it, n);
    qty -= n;
  }
}

export function sendInv(w: World, p: Player) {
  w.quests.refresh(p);
  w.send(p, { t: 'inv', inv: p.inv, eq: p.eq, gold: p.gold, ap: p.ap, pcd: Math.max(0, (p.potionReady - w.tick) * TICK_MS), gear: p.gear });
}
/** Gear changed: recompute stats, keep the HP fraction, and resend the character's look to everyone nearby. */
function gearChanged(w: World, p: Player) {
  w.life.collect(p);
  const frac = p.maxHp ? p.hp / p.maxHp : 1, look = JSON.stringify(p.ap) + p.weaponGlow(); // the weapon glow is part of the look others see
  p.recalc();
  p.hp = p.dead ? 0 : Math.max(1, Math.min(p.maxHp, Math.round(p.maxHp * frac)));
  p.res = Math.min(p.res, p.stats.maxRes);
  p.sver++;
  p.invDirty = true;
  if (JSON.stringify(p.ap) + p.weaponGlow() !== look) for (const o of p.room.players.values()) if (o !== p) o.known.delete(p.id);
  w.send(p, { t: 'stats', level: p.level, stats: p.stats, exp: p.exp, next: w.nextExp(p) });
}

/** Trading needs a merchant NPC nearby; every town has one. */
export function nearShop(p: Player): boolean {
  return !!objNear(p.room.zoneId, p.x, p.y, SHOP_RANGE, ['merchant']);
}

/** Buying runes and scrolls needs the Rune Merchant close by. */
export function nearRunesmith(p: Player): boolean {
  return !!objNear(p.room.zoneId, p.x, p.y, RUNE_SHOP_RANGE, ['runesmith']);
}

/** Executes one inventory command. Returns '' or the reason it was refused. */
export function invOp(w: World, p: Player, m: any): string {
  if (!m || typeof m !== 'object') return 'Unknown inventory command';
  const op = m.op;
  if (p.dead && op !== 'destroy') return 'You are dead';
  const it: Item | undefined = typeof m.uid === 'string' ? p.inv.find((x) => x.uid === m.uid) : undefined;
  const qty = Number.isInteger(m.qty) && m.qty > 0 && m.qty <= SHOP_BUY_MAX ? (m.qty as number) : 1;
  // an item on the table in a trade cannot be touched until the trade ends
  if (it && w.trades.locked(p, it.uid)) return 'That item is in your trade offer';
  switch (op) {
    case 'equip': {
      if (!it) return 'Item not found';
      const why = equipBlock(it, p.job, p.level);
      if (why) return why;
      const slot = ITEMS[it.base].slot!;
      const old = p.eq[slot];
      p.inv.splice(p.inv.indexOf(it), 1);
      if (old) p.inv.push(old);
      it.bd = 1; // worn once, it is bound to this character
      p.eq[slot] = it;
      gearChanged(w, p);
      break;
    }
    case 'unequip': {
      const slot = m.slot as Slot;
      if (!SLOTS.includes(slot) || !p.eq[slot]) return 'Nothing equipped there';
      if (p.inv.length >= INVENTORY_SIZE) return 'Inventory is full';
      p.inv.push(p.eq[slot]!);
      delete p.eq[slot];
      gearChanged(w, p);
      break;
    }
    case 'use': {
      if (!it) return 'Item not found';
      const kind = ITEMS[it.base].kind;
      if (kind === 'pet' || kind === 'mount') {
        // a whistle or reins: the companion joins the collection, the item is used up
        const why = learnCompanion(w, p, it.base);
        if (why) return why;
        take(p, it, 1);
        break;
      }
      if (kind === 'food') {
        const why = w.life.eat(p, it.base);
        if (why) return why;
        take(p, it, 1);
        break;
      }
      if (kind !== 'potion') return 'Cannot be used';
      if (w.tick < p.potionReady) return 'Potions are on cooldown';
      const rage = JOB_DEFS[p.job].resource === 'rage';
      if (it.base === 'hp_potion') {
        if (p.hp >= p.maxHp) return 'Already at full health';
        w.heal(p, Math.ceil(p.maxHp * HP_POTION));
      } else {
        if (p.res >= p.stats.maxRes) return rage ? 'Rage is already full' : 'Already at full mana';
        p.res = Math.min(p.stats.maxRes, p.res + (rage ? RAGE_POTION : Math.ceil(p.stats.maxRes * MANA_POTION)));
        p.selfDirty = true;
      }
      p.potionReady = w.tick + Math.ceil(POTION_CD_MS / TICK_MS);
      take(p, it, 1);
      break;
    }
    case 'sell': {
      if (!it) return 'Item not found';
      if (!nearShop(p)) return 'You need to be at a shop';
      const n = Math.min(qty, it.qty);
      p.gold += sellValue(it) * n;
      take(p, it, n);
      break;
    }
    case 'sellall': {
      // Bulk sale: every listed item, in full, in one step. Nothing is sold unless all of them can be.
      if (!Array.isArray(m.uids) || !m.uids.length || m.uids.length > INVENTORY_SIZE) return 'Nothing selected';
      if (!nearShop(p)) return 'You need to be at a shop';
      const uids = new Set<string>(m.uids.filter((u: unknown) => typeof u === 'string'));
      if (uids.size !== m.uids.length) return 'Invalid selection';
      const items = p.inv.filter((x) => uids.has(x.uid));
      if (items.length !== uids.size) return 'Item not found';
      if (items.some((x) => w.trades.locked(p, x.uid))) return 'An item is in your trade offer';
      let total = 0;
      for (const x of items) total += sellValue(x) * x.qty;
      p.inv = p.inv.filter((x) => !uids.has(x.uid));
      p.gold += total;
      p.invDirty = true;
      w.send(p, { t: 'sys', text: `Sold ${items.length} item${items.length > 1 ? 's' : ''} for ${total} gold.` });
      break;
    }
    case 'sort': {
      if (!SORT_KEYS.includes(m.by)) return 'Unknown sort order';
      if (w.trades.active(p)) return 'Finish your trade first';
      sortInventory(p, m.by as SortKey);
      break;
    }
    case 'scroll': {
      // Reading a Rune Scroll: one scroll is consumed and its reward applied in the same step, so a
      // scroll can never be read twice and a rune is never overwritten (an owned rune gains experience).
      if (!it || !SCROLLS[it.base]) return 'That is not a Rune Scroll';
      const res = rollScroll(w.rnd, it.base, p.build);
      if (!res) return 'That is not a Rune Scroll';
      take(p, it, 1);
      const levels = applyScroll(p.build, res);
      buildChanged(w, p);
      const name = ELEMENT_NAMES[res.el];
      w.send(p, { t: 'rune', el: res.el, isNew: res.isNew, xp: res.xp, levels });
      w.send(p, { t: 'sys', text: res.isNew ? `The scroll unlocks the ${name}! Attune it in a rune slot (K).` : `You already own the ${name}: it gains ${res.xp} experience${levels ? ` and reaches level ${p.build.runes.lv[res.el]}` : ''}.` });
      break;
    }
    case 'buyrune': {
      const el = m.el as Element;
      if (!ELEMENTS.includes(el)) return 'Unknown rune';
      if (!nearRunesmith(p)) return 'You need to be at the Rune Merchant';
      if (ownsRune(p.build, el)) return 'You already own that rune';
      const shop = RUNE_SHOP[el], price = runePrice(p.build, el);
      if (p.level < shop.level) return `Requires level ${shop.level}`;
      if (p.gold < price) return 'Not enough gold';
      p.gold -= price;
      p.build.runes.lv[el] = 1;
      buildChanged(w, p);
      w.send(p, { t: 'rune', el, isNew: true, xp: 0, levels: 0 });
      w.send(p, { t: 'sys', text: `You now own the ${ELEMENT_NAMES[el]}. Attune it in a rune slot (K).` });
      break;
    }
    case 'buy': {
      const rune = false; // Rune Scrolls are no longer sold: they drop from monsters and bosses
      void RUNE_STOCK;
      const b = typeof m.base === 'string' && (SHOP_STOCK.includes(m.base) || SHOP_COMPANIONS.includes(m.base) || rune) ? ITEMS[m.base] : undefined;
      if (!b) return 'Not for sale';
      if (rune ? !nearRunesmith(p) : !nearShop(p)) return rune ? 'You need to be at the Rune Merchant' : 'You need to be at a shop';
      if (rune && p.room.zoneId !== 'eldoria') return 'Rune Scrolls are sold only by the Rune Merchant of Eldoria';
      if (SHOP_COMPANIONS.includes(b.id) && p.room.zoneId !== 'eldoria') return 'Pets and mounts are sold only in Eldoria';
      // some things are sold once to each character: one starter pet, the first mount, one of each scroll
      const once = SHOP_ONCE[b.id], n = once ? 1 : qty;
      if (once && p.journal.s.b.includes(once)) return 'You have already bought that; a shop sells it only once';
      if (p.gold < b.price * n) return 'Not enough gold';
      if (!give(p, { base: b.id, rar: 0, ilvl: 1, aff: [], up: 0, qty: n })) return 'Inventory is full';
      p.gold -= b.price * n;
      if (once) {
        p.journal.s.b.push(once);
        w.journals.touch(p);
      }
      break;
    }
    case 'dailystone': {
      // the merchant's daily gift: Upgrade Stones are no longer sold
      if (!nearShop(p)) return 'You need to be at a shop';
      const day = dayOf(Date.now());
      if (p.journal.s.sd === day) return 'You have already taken today\'s Upgrade Stones';
      if (!give(p, { base: 'upgrade_stone', rar: 0, ilvl: 1, aff: [], up: 0, qty: DAILY_STONES })) return 'Inventory is full';
      p.journal.s.sd = day;
      w.journals.touch(p);
      w.send(p, { t: 'sys', text: `The merchant hands you ${DAILY_STONES} Upgrade Stones. Come back tomorrow for more.`, cue: 'rep' });
      break;
    }
    case 'upgrade': {
      // works on an inventory item or an equipped one (uid matched against both)
      const target = it ?? SLOTS.map((s) => p.eq[s]).find((x) => x && x.uid === m.uid);
      if (!target || ITEMS[target.base].kind !== 'equip') return 'Item not found';
      if (target.up >= MAX_UPGRADE) return 'Already at maximum upgrade';
      if ((w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Cannot upgrade in combat';
      const cost = upgradeCost(target);
      if (p.gold < cost.gold) return 'Not enough gold';
      if (count(p, 'upgrade_stone') < cost.stones) return `Requires ${cost.stones} Upgrade Stone${cost.stones > 1 ? 's' : ''}`;
      p.gold -= cost.gold;
      consume(p, 'upgrade_stone', cost.stones);
      // A failed attempt costs the gold and stones but never damages or destroys the item.
      const ok = w.rnd() * 100 < UPGRADE_CHANCE[target.up];
      if (ok) target.up++;
      w.send(p, { t: 'sys', text: ok ? `Upgrade succeeded: ${ITEMS[target.base].name} is now +${target.up}.` : 'The upgrade failed. The item is unharmed.', cue: ok ? 'upgrade_ok' : 'upgrade_fail' });
      if (ok && !it) gearChanged(w, p);
      p.invDirty = true;
      break;
    }
    case 'arm': {
      // Armament enhancement: gold and materials are paid for every attempt; a failure drops to the last checkpoint.
      const slot = m.slot as Slot;
      if (!SLOTS.includes(slot)) return 'Unknown armament';
      if (p.level < ARMAMENT_LEVEL) return `Armament unlocks at level ${ARMAMENT_LEVEL}`;
      if ((w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Cannot enhance in combat';
      if (w.trades.active(p)) return 'Finish your trade first';
      const from = p.gear.arm[slot] ?? 0;
      if (from >= ARM_MAX) return 'Already at maximum enhancement';
      const cost = armCost(from);
      if (p.gold < cost.gold) return 'Not enough gold';
      if (count(p, cost.mat) < cost.qty) return `Requires ${cost.qty} ${ITEMS[cost.mat].name}`;
      p.gold -= cost.gold;
      consume(p, cost.mat, cost.qty);
      const glow0 = p.weaponGlow(), ok = w.rnd() * 100 < armChance(from), to = ok ? from + 1 : armFallback(from + 1);
      if (to > 0) p.gear.arm[slot] = to;
      else delete p.gear.arm[slot];
      w.journals.best(p, 'arm', to);
      const name = SLOT_NAMES[slot];
      w.send(p, { t: 'sys', text: ok ? `${name} armament enhanced to +${to}.` : to < from ? `The enhancement failed. The ${name.toLowerCase()} armament fell back to +${to}.` : `The enhancement failed. The ${name.toLowerCase()} armament stays at +${to}.`, cue: ok ? 'upgrade_ok' : 'upgrade_fail' });
      gearChanged(w, p);
      if (p.weaponGlow() !== glow0) w.relook(p); // the weapon's glow changed: everyone nearby is sent the new look
      p.invDirty = true;
      break;
    }
    case 'sigil': {
      // Equipping a sigil: it goes into the slot of its own shape (a sigil already there returns to the bag).
      if (!it) return 'Item not found';
      const sb = sigilBase(it.base);
      if (!sb) return 'That is not a sigil';
      if (p.level < SIGIL_LEVEL) return `Sigils unlock at level ${SIGIL_LEVEL}`;
      if (w.trades.locked(p, it.uid)) return 'That item is in your trade offer';
      const old = p.gear.sig[sb.shape];
      take(p, it);
      p.gear.sig[sb.shape] = it;
      if (old) p.inv.push(old);
      gearChanged(w, p);
      p.invDirty = true;
      break;
    }
    case 'unsigil': {
      const i = Number.isInteger(m.slot) ? (m.slot as number) : -1, cur = p.gear.sig[i];
      if (!cur) return 'Nothing equipped there';
      if (p.inv.length >= INVENTORY_SIZE) return 'Your inventory is full';
      p.gear.sig[i] = null;
      p.inv.push(cur);
      gearChanged(w, p);
      p.invDirty = true;
      break;
    }
    case 'destroy': {
      if (!it) return 'Item not found';
      take(p, it);
      break;
    }
    default:
      return 'Unknown inventory command';
  }
  sendInv(w, p);
  return '';
}

/**
 * Loot from an ordinary monster. Solo players and parties on personal loot roll for themselves.
 * In the two shared modes the party still gets one roll per rewarded member (so the expected
 * amount is the same), but who receives each drop is decided by the mode: the next member in
 * turn (round robin), or a member picked with odds proportional to damage dealt (contribution).
 * Gold from shared rolls is split equally.
 */
export function distributeLoot(w: World, m: Monster, looters: Player[]) {
  const groups = new Map<object, Player[]>();
  for (const p of looters) {
    if (!p.party || p.party.loot === 'personal') {
      const l = rollLoot(w.rnd, m.level, m.def.elite, p.job, w.dropRate * m.dropScale, w.goldRate * m.goldScale);
      award(w, p, l.gold, l.items, true);
    } else groups.set(p.party, [...(groups.get(p.party) ?? []), p]);
  }
  for (const [, group] of groups) {
    const party = group[0].party!, n = group.length;
    const gold = new Array(n).fill(0), items: ItemSpec[][] = group.map(() => []);
    let pot = 0;
    // weights for contribution mode: damage dealt, with a floor so supports are never shut out
    const dmg = group.map((p) => m.dmgBy.get(p.id) ?? 0), sum = dmg.reduce((a, b) => a + b, 0), floor = sum / n / 4 || 1;
    const weights = dmg.map((d) => d + floor), wsum = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) {
      let k: number;
      if (party.loot === 'roundrobin') {
        // the next member in party order who is among the rewarded
        k = -1;
        for (let step = 0; step < party.members.length && k < 0; step++) k = group.findIndex((p) => p.id === party.members[(party.rr + step) % party.members.length]);
        k = Math.max(0, k);
      } else {
        let r = w.rnd() * wsum;
        k = 0;
        while (k < n - 1 && (r -= weights[k]) >= 0) k++;
      }
      const l = rollLoot(w.rnd, m.level, m.def.elite, group[k].job, w.dropRate * m.dropScale, w.goldRate * m.goldScale);
      pot += l.gold;
      if (!l.items.length) continue;
      items[k].push(...l.items);
      if (party.loot === 'roundrobin') party.rr = (party.members.indexOf(group[k].id) + 1) % party.members.length;
    }
    for (let i = 0; i < n; i++) gold[i] = Math.floor(pot / n) + (i < pot % n ? 1 : 0);
    group.forEach((p, i) => award(w, p, gold[i], items[i], true));
  }
}

/** First login of a character: its starting weapon and a few potions, granted exactly once. */
export function grantStarterKit(p: Player) {
  if (p.kit) return;
  p.kit = true;
  p.invDirty = true;
  const [weapon, ...rest] = starterKit(p.job, p.baseAp.weapon);
  if (!p.eq.weapon) p.eq.weapon = { ...weapon, uid: newUid() };
  for (const s of rest) give(p, s);
}

const KIND_ORDER = { equip: 0, potion: 1, scroll: 2, material: 3 } as Record<string, number>;
/** Puts the bag in order: partial stacks are merged, then items are sorted by the chosen key. The order is stored, like the bag itself. */
export function sortInventory(p: Player, by: SortKey) {
  const merged: Item[] = [];
  for (const it of p.inv) {
    const max = ITEMS[it.base].stack ?? 1;
    if (max > 1) {
      for (const o of merged) {
        if (o.base !== it.base || o.qty >= max || !it.qty) continue;
        const n = Math.min(it.qty, max - o.qty);
        o.qty += n;
        it.qty -= n;
      }
      if (!it.qty) continue;
    }
    merged.push(it);
  }
  const name = (x: Item) => ITEMS[x.base].name, kind = (x: Item) => KIND_ORDER[ITEMS[x.base].kind] ?? 9, slot = (x: Item) => SLOTS.indexOf(ITEMS[x.base].slot as Slot);
  const tie = (a: Item, b: Item) => kind(a) - kind(b) || slot(a) - slot(b) || b.rar - a.rar || b.ilvl - a.ilvl || name(a).localeCompare(name(b)) || (a.uid < b.uid ? -1 : 1);
  const cmp: Record<SortKey, (a: Item, b: Item) => number> = {
    kind: tie,
    rarity: (a, b) => b.rar - a.rar || tie(a, b),
    level: (a, b) => b.ilvl - a.ilvl || tie(a, b),
    value: (a, b) => sellValue(b) * b.qty - sellValue(a) * a.qty || tie(a, b),
    name: (a, b) => name(a).localeCompare(name(b)) || tie(a, b),
  };
  p.inv = merged.sort(cmp[by]);
  p.invDirty = true;
}

/**
 * Hands loot to a player: items that fit go to the bag, the rest is lost (the player is told);
 * gold always arrives. `hunted` marks loot from an ordinary monster kill: while the player is
 * auto hunting, their loot rules decide which of those items are collected at all.
 */
/** `mailOverflow`: items that do not fit are sent by mail with this subject instead of being left behind. */
export function award(w: World, p: Player, gold: number, items: ItemSpec[], hunted = false, mailOverflow = '', bound = false) {
  gold = Math.round(gold * w.guilds.bonus(p, 'treasury'));
  const got: ItemSpec[] = [];
  let full = false;
  if (hunted && p.autoOn) {
    const keep = items.filter((s) => lootAllowed(p.autoCfg, s.base, s.rar));
    p.autoStats.skipped += items.length - keep.length;
    items = keep;
  }
  // quest rewards come bound; everything else stays tradable until it is worn
  if (bound) items = items.map(bindSpec);
  const left: ItemSpec[] = [];
  for (const s of items) (give(p, s) ? got : ((full = true), left)).push(s);
  if (hunted && p.autoOn) {
    p.autoStats.gold += gold;
    for (const s of got) p.autoStats.items += s.qty;
    p.autoStats.skipped += items.length - got.length;
    if (full && p.autoCfg.onFull === 'stop') w.stopAuto(p, 'Your inventory is full');
  }
  if (!gold && !got.length && !full) return;
  p.gold += gold;
  p.invDirty = true;
  w.send(p, { t: 'loot', gold, items: got.map((s) => ({ base: s.base, rar: s.rar, qty: s.qty })) });
  if (full && mailOverflow) {
    w.mailItems(p, mailOverflow, left);
    w.send(p, { t: 'sys', text: 'Your inventory is full: the rest of your reward was sent to you by mail.' });
  } else if (full) w.send(p, { t: 'sys', text: 'Your inventory is full. Some loot was left behind.' });
  sendInv(w, p);
}
