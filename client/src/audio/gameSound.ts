// What the game sounds like: turns game events into engine calls. Everything here reacts to
// state the server sent (welcome, snapshots, damage events, notices) or, for footsteps and UI
// clicks, to the player's own input. Each client runs this independently; nothing about sound
// is sent over the network.
import type { AbilityDef } from '../../../shared/src/abilities';
import {
  abilitySound, ambienceFor, BGM, dropSound, MENU_INPUT, MusicDirector, STEP_MS, STEP_SOUND, surfaceOf, WEAPON_SOUND, ZONE_MUSIC,
  type MusicInput,
} from '../../../shared/src/audio';
import { COMBAT_TIMEOUT_MS, Dmg } from '../../../shared/src/combat';
import { ITEMS, POTION_CD_MS, type Equipment } from '../../../shared/src/items';
import { JOB_DEFS } from '../../../shared/src/jobs';
import { MONSTERS } from '../../../shared/src/monsters';
import type { Cue, Job } from '../../../shared/src/protocol';
import type { T, Theme } from '../../../shared/src/world';
import { ZONES } from '../../../shared/src/world';
import { audio } from './engine';

export interface WorldAudioState {
  zone: string;
  dungeon: boolean;
  villageDist: number;
  dead: boolean;
  attacking: boolean;
  boss: '' | 'dungeon' | 'world';
}
export interface DamageSound {
  /** The local player was hit. */
  mine: boolean;
  /** The local player dealt it. */
  byMe: boolean;
  /** Dealt by the local player's weapon rather than by an ability. */
  basic: boolean;
  /** Monster type of the target ('' = a player). */
  targetMt: string;
  /** Monster type of the attacker ('' = a player or nothing). */
  srcMt: string;
  flags: number;
  amount: number;
  /** Offset of the target from the listener. */
  dx: number;
  dy: number;
  job: Job;
  weapon: number;
}
const weaponOf = (job: Job, weapon: number) => WEAPON_SOUND[(JOB_DEFS[job].weapons[weapon] ?? JOB_DEFS[job].weapons[0]).kind];
const eqKey = (eq: Equipment) => Object.entries(eq).map(([slot, it]) => `${slot}:${it?.uid}`).sort().join();

class GameSound {
  private director = new MusicDirector();
  private lastCombat = -Infinity;
  private lastElite = -Infinity;
  private lastStep = 0;
  private lastLoot = -Infinity;
  private lastRoar = -Infinity;
  private bosses = new Set<number>();
  /** The track the director chose last, to notice the moment a fight starts. */
  private track = '';
  /** A special event is running. Nothing sets this yet: the game has no event system (see docs/M10.md). */
  event = false;

  // ---------- music ----------
  /** Sign-in, character select and character creator. */
  menu() {
    audio.setMusic(this.director.update(performance.now(), MENU_INPUT));
    audio.setAmbience('');
  }
  /** Called a few times a second with the authoritative state of the world around the player. */
  frame(now: number, s: WorldAudioState) {
    const input: MusicInput = { screen: 'world', ...s, sinceCombat: now - this.lastCombat, elite: now - this.lastElite < COMBAT_TIMEOUT_MS, event: this.event };
    const track = this.director.update(now, input), fight = (id: string) => id === BGM.COMBAT || id === BGM.ELITE;
    // a fight begins: one hard hit under the first bar of the combat music
    if (fight(track) && !fight(this.track) && this.track !== BGM.DUNGEON_BOSS && this.track !== BGM.WORLD_BOSS) audio.play('game.battle_start');
    this.track = track;
    audio.setMusic(track);
    audio.setAmbience(ambienceFor(s.zone, s.dungeon, 'world'));
  }
  /** The player arrived in a zone (first join, portal, waystone, dungeon entry or exit, reconnect). */
  zone(zone: string, changed: boolean, hadZone: boolean) {
    this.bosses.clear();
    this.lastCombat = this.lastElite = -Infinity;
    if (!changed) return;
    const dungeon = ZONES[zone]?.kind === 'dungeon';
    if (dungeon) audio.play('game.dungeon_enter');
    else if (hadZone) audio.play('env.portal');
    // what this place is likely to need next: decoded ahead of time so the switch is instant
    audio.preload(dungeon ? [BGM.DUNGEON, BGM.DUNGEON_BOSS, BGM.COMBAT] : [ZONE_MUSIC[zone] ?? '', BGM.COMBAT, BGM.ELITE, ZONES[zone]?.town && zone !== 'eldoria' ? BGM.VILLAGE : '']);
  }

  // ---------- movement ----------
  /** A footstep of the local player (dx/dy omitted) or of a nearby player. Returns the ms until the next one. */
  step(tile: T, theme: Theme, run: boolean, dx?: number, dy?: number): number {
    const mine = dx === undefined;
    audio.play(STEP_SOUND[surfaceOf(tile, theme)], { vary: 0.09, vol: mine ? (run ? 1 : 0.75) : 0.45, dx, dy });
    if (run && mine) audio.play('move.run', { vary: 0.1 });
    return run ? STEP_MS.run : STEP_MS.walk;
  }
  /** Local footsteps are paced here so walking into a wall and stopping do not drift the rhythm. */
  myStep(now: number, tile: T, theme: Theme, run: boolean) {
    if (now - this.lastStep < (run ? STEP_MS.run : STEP_MS.walk)) return;
    this.lastStep = now;
    this.step(tile, theme, run);
  }

  // ---------- combat ----------
  swing(job: Job, weapon: number, dx?: number, dy?: number) {
    const w = weaponOf(job, weapon);
    audio.play(w.swing, { rate: w.swingRate, vary: 0.06, dx, dy });
  }
  /** One damage event from a snapshot. */
  damage(now: number, d: DamageSound) {
    if (d.flags & Dmg.Heal) {
      if (d.amount > 0 && (d.mine || d.byMe)) audio.play('skill.heal', { vol: 0.45, vary: 0.04 });
      return;
    }
    if (d.mine || d.byMe) {
      this.lastCombat = now;
      const other = MONSTERS[d.mine ? d.srcMt : d.targetMt];
      if (other?.elite && !other.boss) this.lastElite = now;
    }
    if (d.flags & (Dmg.Miss | Dmg.Dot)) return; // a miss is only the swing; damage over time is silent
    const pos = d.mine ? {} : { dx: d.dx, dy: d.dy };
    if (d.mine) {
      if (d.flags & Dmg.Block) audio.play('combat.shield_block', { vary: 0.05 });
      else if (d.flags & Dmg.Absorb) audio.play('skill.shield', { vol: 0.6, vary: 0.05 });
      else audio.play('combat.player_damage', { vary: 0.07 });
      return;
    }
    if (d.flags & Dmg.Crit) audio.play('combat.critical_hit', pos);
    if (!d.targetMt) return void audio.play('combat.physical_hit', { ...pos, vary: 0.07 });
    // a modern blow: the synthesized punch carries the weight, the sample the texture of the hit
    audio.punch({ ...pos, vol: d.byMe ? 1 : 0.55, crit: !!(d.flags & Dmg.Crit) });
    audio.play('combat.monster_hit', { ...pos, vary: 0.1, vol: d.byMe ? 0.7 : 0.5 });
    // the local player's weapon is heard landing; ranged weapons land a moment after the release
    if (d.byMe && d.basic) {
      const w = weaponOf(d.job, d.weapon);
      audio.play(w.impact, { ...pos, vary: 0.06, delayMs: JOB_DEFS[d.job].range > 100 ? 90 : 0 });
    }
  }
  /** Something died within earshot. */
  death(mt: string, dx: number, dy: number, now: number) {
    if (!mt) return void audio.play('combat.player_death', { dx, dy, vol: 0.7 });
    if (MONSTERS[mt]?.boss) {
      audio.play('game.boss_defeat');
      const ms = audio.durationOf(BGM.VICTORY) * 1000;
      if (ms) this.director.playStinger(BGM.VICTORY, now, ms);
      return;
    }
    audio.play('combat.monster_death', { dx, dy, vary: 0.12 });
  }
  /** The local player died. */
  died() {
    audio.play('combat.player_death');
  }
  /** A living boss came into view. */
  bossSeen(id: number, now: number) {
    if (this.bosses.has(id)) return;
    this.bosses.add(id);
    this.roar(now);
    audio.preload([BGM.DUNGEON_BOSS, BGM.WORLD_BOSS, BGM.VICTORY]);
  }
  private roar(now: number) {
    if (now - this.lastRoar < 8000) return;
    this.lastRoar = now;
    audio.play('game.boss_spawn');
  }

  // ---------- abilities ----------
  /** A cast with a cast time began. */
  castStart(def: AbilityDef, dx?: number, dy?: number) {
    const s = abilitySound(def);
    if (s.cast) audio.play(s.cast, { dx, dy });
  }
  /** An ability took effect (the server's Fx event). */
  ability(def: AbilityDef, job: Job | undefined, weapon: number | undefined, dx?: number, dy?: number) {
    const s = abilitySound(def);
    if (s.weapon && job) this.swing(job, weapon ?? 0, dx, dy);
    if (s.fx) audio.play(s.fx, { dx, dy, vary: 0.04 });
    if (s.impact) audio.play(s.impact, { dx, dy, delayMs: s.impactMs, vary: 0.04 });
  }
  at(id: string, dx: number, dy: number, vol = 1) {
    audio.play(id, { dx, dy, vol });
  }

  // ---------- items and notices ----------
  loot(now: number, gold: number, items: { base: string; rar: number }[]) {
    this.lastLoot = now;
    const best = Math.max(-1, ...items.filter((i) => ITEMS[i.base]?.kind === 'equip').map((i) => i.rar));
    const fanfare = dropSound(best);
    if (fanfare) audio.play(fanfare);
    else if (items.length) audio.play('item.pickup', { vary: 0.05 });
    else if (gold) audio.play('item.gold', { vary: 0.05 });
  }
  /** The server confirmed a change to the inventory: a potion was drunk, gear changed hands, or gold moved at a shop. */
  inventory(now: number, prev: { eq: Equipment; gold: number; potionAt: number }, next: { eq: Equipment; gold: number; pcd: number }, atShop: boolean) {
    const wasLeft = prev.potionAt ? Math.max(0, POTION_CD_MS - (now - prev.potionAt)) : 0;
    if (next.pcd > wasLeft + 500) audio.play('item.potion');
    if (eqKey(prev.eq) !== eqKey(next.eq)) audio.play('item.equip');
    else if (atShop && next.gold !== prev.gold && now - this.lastLoot > 400) audio.play('item.gold', { vary: 0.05 });
  }
  levelUp() {
    audio.play('game.level_up');
  }
  /** A server notice. The cue names the authoritative event; without one it is an ordinary notification. */
  notice(cue: Cue | undefined, now: number, banner: boolean) {
    switch (cue) {
      case 'upgrade_ok': return void audio.play('item.upgrade_ok');
      case 'upgrade_fail': return void audio.play('item.upgrade_fail');
      case 'cache': return void audio.play('env.cache_open');
      case 'worldboss': return void audio.play('game.world_boss_announce');
      case 'boss': return this.roar(now);
      case 'quest': return void audio.play('game.quest_accept');
      case 'questdone': return void audio.play('game.quest_complete');
      default: if (banner || cue) audio.play('ui.notify');
    }
  }
  gather() {
    audio.play('env.gather', { vary: 0.06 });
  }
  refused() {
    audio.play('ui.error', { vol: 0.8 });
  }
  notify() {
    audio.play('ui.notify');
  }
}
export const sound = new GameSound();

/** Buttons, tabs and menus click. Installed once for the whole page. */
export function installUiSounds() {
  document.addEventListener('click', (e) => {
    const el = e.target as Element | null;
    if (el?.closest?.('button, [role="tab"], select, summary')) audio.play('ui.click', { vary: 0.03 });
  }, { capture: true, passive: true });
}
