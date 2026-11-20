// Quests that take you there: a click on a quest (or one of its objectives) sets off to what it needs
// and does it on arrival. Kill objectives go to the nearest camp of the monster and hunt only it;
// gathering goes to a node of the material; hidden caches are walked to and opened; talking walks
// up to the character; a finished quest goes back to its giver.
import { SPAWNS, WORLD_BOSSES } from '../../shared/src/monsters';
import { objById, zoneObjects } from '../../shared/src/places';
import { giverId, QUESTS, type Objective, type QuestDef } from '../../shared/src/quests';
import type { Place } from '../../shared/src/travel';
import { REGIONS, tileCenter, ZONES } from '../../shared/src/world';
import type { Game, Hud } from './game/Game';

export interface QuestGoal { place: Place; near: number; label: string; then: (game: Game) => void }
const spot = (zone: string, tx: number, ty: number): Place => ({ zone, x: tileCenter(tx), y: tileCenter(ty) });

/** Every place an objective can be worked on, with what to do there. */
export function questPlaces(disc: string[], o: Objective): QuestGoal[] {
  const camps = (pick: (zone: string, type: string) => boolean, hunt: (type: string) => string[] | null): QuestGoal[] =>
    Object.entries(SPAWNS).flatMap(([zone, groups]) => groups.filter((g) => pick(zone, g.type)).map((g) => ({
      place: spot(zone, g.tx, g.ty), near: 150, label: o.label,
      then: (game: Game) => { const only = hunt(g.type); if (only) game.huntOnly(only); else game.startAuto(); },
    })));
  switch (o.kind) {
    case 'kill':
      return o.mob ? camps((_, ty) => ty === o.mob, (ty) => [ty]) : camps((z) => z === o.zone, () => null);
    case 'loot':
      return camps((_, ty) => ty === o.mob, (ty) => [ty]);
    case 'boss': {
      const b = WORLD_BOSSES.filter((x) => x.type === o.mob).map((x) => ({ place: spot(x.zone, x.tx, x.ty + 4), near: 120, label: o.label, then: () => {} }));
      return b.length ? b : camps((_, ty) => ty === o.mob, (ty) => [ty]);
    }
    case 'collect':
      return REGIONS.flatMap((z) => zoneObjects(z).filter((n) => n.kind === 'node' && n.res === o.item).map((n) => ({ place: { zone: z, x: n.x, y: n.y }, near: 44, label: o.label, then: (game: Game) => game.objOp('gather', { id: n.id }) })));
    case 'discover':
      return zoneObjects(o.zone).filter((c) => c.kind === 'cache' && !disc.includes(c.id)).map((c) => ({ place: { zone: c.zone, x: c.x, y: c.y }, near: 44, label: o.label, then: (game: Game) => game.objOp('open', { id: c.id }) }));
    case 'talk': {
      const n = objById(o.npc);
      return n ? [{ place: { zone: n.zone, x: n.x, y: n.y }, near: 44, label: n.name, then: (game: Game) => game.interact() }] : [];
    }
    case 'visit':
      return [{ place: { zone: o.zone, x: o.x, y: o.y }, near: Math.max(24, o.r * 0.5), label: o.label, then: () => {} }];
    case 'clear':
      return Object.values(ZONES).flatMap((z) => (z.gates ?? []).filter((g) => g.dungeon === o.dungeon).map((g) => ({ place: spot(z.id, g.tx, g.ty + 1), near: 40, label: o.label, then: () => {} })));
  }
  return [];
}
/**
 * Where to go for a quest: back to its giver when every objective is met, otherwise the objective
 * asked for (or the first unfinished one), at the place quickest to reach from here.
 */
export function questGoal(hud: Hud, game: Game, q: QuestDef, index = -1): QuestGoal | null {
  const prog = hud.qprog[q.id] ?? q.objectives.map(() => 0);
  if (prog.every((v, i) => v >= q.objectives[i].n)) {
    const n = objById(giverId(q));
    return n ? { place: { zone: n.zone, x: n.x, y: n.y }, near: 44, label: n.name, then: (g) => g.interact() } : null;
  }
  const i = index >= 0 && prog[index] < q.objectives[index].n ? index : prog.findIndex((v, k) => v < q.objectives[k].n);
  let best: QuestGoal | null = null, cost = Infinity;
  for (const c of questPlaces(hud.disc, q.objectives[i])) {
    const r = game.routeTo(c.place);
    if (r && r.cost < cost) { cost = r.cost; best = c; }
  }
  return best;
}
/** Sets off for a quest. Returns false (with a line in chat) when there is nowhere to go yet. */
export function goQuest(game: Game, hud: Hud, questId: string, index = -1): boolean {
  const q = QUESTS[questId], goal = q && questGoal(hud, game, q, index);
  if (!goal) return game.say('There is no way there for you yet'), false;
  return game.travelTo(goal.place, { near: goal.near, label: goal.label, then: () => goal.then(game) });
}
