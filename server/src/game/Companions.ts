// Pets and mounts on the server (M15): collection, summoning, naming, levelling, riding.
import { COMBAT_TIMEOUT_MS } from '../../../shared/src/combat';
import { MAX_PETS, MOUNT_FORBIDDEN_KINDS, MOUNTS, PET_EXP_SHARE, PET_MAX_LEVEL, PET_NAME, petExpToNext, PETS } from '../../../shared/src/companions';
import { ITEMS } from '../../../shared/src/items';
import { TICK_MS } from '../../../shared/src/protocol';
import { newUid, sendInv } from './Inventory';
import type { Player, World } from './World';

const send = (w: World, p: Player) => w.send(p, { t: 'comp', comp: p.comp });

/** Whistles and reins from the bag: the pet or mount joins the collection and the item is used up. */
export function learnCompanion(w: World, p: Player, base: string): string {
  const b = ITEMS[base];
  if (b?.kind === 'pet') {
    if (!b.ref || !PETS[b.ref]) return 'Unknown pet';
    if (p.comp.pets.length >= MAX_PETS) return `You can keep at most ${MAX_PETS} pets`;
    p.comp.pets.push({ uid: newUid(), kind: b.ref, name: PETS[b.ref].name, level: 1, exp: 0 });
    w.send(p, { t: 'sys', text: `${PETS[b.ref].name} joins your companions. Summon it from the companions panel (P).` });
  } else if (b?.kind === 'mount') {
    if (!b.ref || !MOUNTS[b.ref]) return 'Unknown mount';
    if (p.comp.mounts.includes(b.ref)) return 'You already have this mount';
    p.comp.mounts.push(b.ref);
    w.send(p, { t: 'sys', text: `${MOUNTS[b.ref].name} added to your mounts (P to ride).` });
  } else return 'Cannot be used';
  p.progDirty = true;
  send(w, p);
  return '';
}

/** Stops riding (combat, entering an instance, or by choice). */
export function dismount(w: World, p: Player, why = '') {
  if (!p.comp.riding) return;
  p.comp.riding = '';
  w.companionsChanged(p);
  if (why) w.send(p, { t: 'sys', text: why });
}

export function companionOp(w: World, p: Player, m: any): string {
  if (!m || typeof m !== 'object') return 'Unknown command';
  if (p.dead) return 'You are dead';
  const c = p.comp;
  switch (m.op) {
    case 'summon': {
      const pet = typeof m.uid === 'string' ? c.pets.find((x) => x.uid === m.uid) : undefined;
      if (!pet) return 'You do not have that pet';
      c.pet = c.pet === pet.uid ? '' : pet.uid;
      break;
    }
    case 'dismiss':
      c.pet = '';
      break;
    case 'rename': {
      const pet = typeof m.uid === 'string' ? c.pets.find((x) => x.uid === m.uid) : undefined, name = typeof m.name === 'string' ? m.name.trim().replace(/\s+/g, ' ') : '';
      if (!pet) return 'You do not have that pet';
      if (!PET_NAME.test(name)) return 'Pet names: 2-14 letters and spaces, starting with a letter';
      pet.name = name;
      break;
    }
    case 'release': {
      const i = typeof m.uid === 'string' ? c.pets.findIndex((x) => x.uid === m.uid) : -1;
      if (i < 0) return 'You do not have that pet';
      if (c.pet === c.pets[i].uid) c.pet = '';
      c.pets.splice(i, 1);
      break;
    }
    case 'mount': {
      const id = m.id;
      if (typeof id !== 'string' || !c.mounts.includes(id)) return 'You do not have that mount';
      if (p.level < MOUNTS[id].level) return `Requires level ${MOUNTS[id].level}`;
      if (MOUNT_FORBIDDEN_KINDS.includes(p.room.map.def.kind ?? '')) return 'You cannot ride here';
      if ((w.tick - p.lastCombat) * TICK_MS <= COMBAT_TIMEOUT_MS) return 'Not while in combat';
      if (p.casting) return 'Not while casting';
      c.riding = c.riding === id ? '' : id;
      break;
    }
    case 'dismount':
      c.riding = '';
      break;
    default:
      return 'Unknown command';
  }
  p.progDirty = true;
  w.companionsChanged(p);
  return '';
}

/** The summoned pet learns alongside its owner. Returns true if it levelled (stats change). */
export function petExp(w: World, p: Player, exp: number): boolean {
  const pet = p.comp.pet ? p.comp.pets.find((x) => x.uid === p.comp.pet) : undefined;
  if (!pet || pet.level >= PET_MAX_LEVEL) return false;
  pet.exp += Math.max(1, Math.round(exp * PET_EXP_SHARE));
  p.progDirty = true;
  let up = false;
  while (pet.level < PET_MAX_LEVEL && pet.exp >= petExpToNext(pet.level)) {
    pet.exp -= petExpToNext(pet.level);
    pet.level++;
    up = true;
  }
  if (pet.level >= PET_MAX_LEVEL) pet.exp = 0;
  if (up) {
    w.send(p, { t: 'sys', text: `${pet.name} reached level ${pet.level}.` });
    w.companionsChanged(p);
  } else send(w, p);
  return up;
}
export { send as sendCompanions, sendInv };
