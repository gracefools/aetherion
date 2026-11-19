// Quests and faction reputation on the server (M13). Progress comes only from events the server
// resolved itself; accepting, turning in and the faction shop need the right NPC close by.
import { INTERACT_RANGE, objById, objNear, zoneObjects } from '../../../shared/src/places';
import {
  acceptBlock, cleanQuests, cleanRep, DEFAULT_FACTIONS, giverId, HISTORY_SIZE, isComplete, progressOf, QUESTS, REP_GIFT, REP_LEVELS, REP_MAX, repLevel, utcDay,
  type FactionDef, type QuestCtx, type QuestState,
} from '../../../shared/src/quests';
import { ITEMS, type ItemSpec } from '../../../shared/src/items';
import { award, consume, count, give, sendInv } from './Inventory';
import type { Monster } from './Monster';
import type { Player, World } from './World';

const TALK_RANGE = INTERACT_RANGE * 2.2;
const spec = (base: string, qty: number): ItemSpec => ({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty });

export class Quests {
  /** Factions in force: from the database when the server started, else the built-in defaults. */
  factions: FactionDef[] = DEFAULT_FACTIONS;
  constructor(private w: World) {}

  /** Loads faction records. Rows that name an unknown region or unknown shop items are cleaned or skipped. */
  setFactions(rows: { id: string; name: string; seat: string; region: string; creed: string; about: string; shop: unknown }[]) {
    const out: FactionDef[] = [];
    for (const r of rows) {
      if (!zoneObjects(r.region).some((o) => o.kind === 'lorekeeper')) {
        console.warn(`faction ${r.id}: region "${r.region}" has no lorekeeper; skipped`);
        continue;
      }
      const shop = Array.isArray(r.shop) ? (r.shop as unknown[]).filter((x): x is [string, number, number] => Array.isArray(x) && !!ITEMS[x[0] as string] && Number.isInteger(x[1]) && (x[1] as number) > 0 && Number.isInteger(x[2]) && (x[2] as number) >= 0 && (x[2] as number) < REP_LEVELS.length) : [];
      out.push({ id: r.id, name: r.name, seat: r.seat, region: r.region, creed: r.creed, about: r.about, shop });
    }
    if (out.length) this.factions = out;
  }
  faction(id: string) {
    return this.factions.find((f) => f.id === id);
  }
  ctx(p: Player): QuestCtx {
    return { count: (b) => count(p, b), found: (zone) => zoneObjects(zone).filter((o) => o.kind === 'cache' && p.disc.has(o.id)).length };
  }
  load(p: Player, quests: unknown, rep: unknown) {
    p.quests = cleanQuests(quests);
    p.rep = cleanRep(rep, this.factions);
  }
  send(p: Player) {
    const ctx = this.ctx(p), prog: Record<string, number[]> = {};
    for (const [id, a] of Object.entries(p.quests.active)) prog[id] = progressOf(QUESTS[id], a, ctx);
    this.w.send(p, { t: 'quests', q: p.quests, prog, rep: p.rep });
  }
  private changed(p: Player) {
    p.progDirty = true;
    this.send(p);
  }
  /** Standing close to the quest giver (a town's lorekeeper). */
  private atGiver(p: Player, giver: string) {
    const o = objById(giver);
    return !!o && o.zone === p.room.zoneId && Math.hypot(o.x - p.x, o.y - p.y) <= TALK_RANGE;
  }

  /** One quest or faction command. Returns '' or the reason it was refused. */
  op(p: Player, m: any): string {
    if (!m || typeof m !== 'object') return 'Unknown quest command';
    if (p.dead) return 'You are dead';
    const now = Date.now(), s = p.quests;
    switch (m.op) {
      case 'accept': {
        const q = typeof m.id === 'string' ? QUESTS[m.id] : undefined;
        if (!q) return 'Unknown quest';
        if (!this.atGiver(p, giverId(q))) return 'Talk to the quest giver to accept this quest';
        const why = acceptBlock(q, s, p.level, p.rep, now);
        if (why) return why;
        s.active[q.id] = { p: q.objectives.map(() => 0), at: now };
        this.w.send(p, { t: 'sys', text: `Quest accepted: ${q.name}.`, cue: 'quest' });
        this.changed(p);
        return '';
      }
      case 'abandon': {
        if (typeof m.id !== 'string' || !s.active[m.id]) return 'You do not have that quest';
        delete s.active[m.id];
        this.w.send(p, { t: 'sys', text: `Quest abandoned: ${QUESTS[m.id].name}.` });
        this.changed(p);
        return '';
      }
      case 'turnin': {
        const q = typeof m.id === 'string' ? QUESTS[m.id] : undefined, a = q && s.active[q.id];
        if (!q || !a) return 'You do not have that quest';
        if (!this.atGiver(p, giverId(q))) return 'Return to the quest giver to turn this quest in';
        if (!isComplete(q, a, this.ctx(p))) return 'The quest is not complete yet';
        // the reward must fit in the bag before anything is taken (collected items leave first)
        const trial = { inv: p.inv.map((i) => ({ ...i })), invDirty: false } as unknown as Player;
        for (const o of q.objectives) if (o.kind === 'collect') consume(trial, o.item, o.n);
        for (const [b, n] of q.reward.items) if (!give(trial, spec(b, n))) return 'Make room in your bag for the reward first';
        for (const o of q.objectives) if (o.kind === 'collect') consume(p, o.item, o.n);
        delete s.active[q.id];
        const d = s.done[q.id] ?? { n: 0, day: 0 };
        s.done[q.id] = { n: d.n + 1, day: utcDay(now) };
        s.hist.unshift({ id: q.id, at: now });
        if (s.hist.length > HISTORY_SIZE) s.hist.length = HISTORY_SIZE;
        this.w.grantExp(p, Math.round(q.reward.exp));
        award(this.w, p, Math.round(q.reward.gold * this.w.goldRate), q.reward.items.map(([b, n]) => spec(b, n)));
        for (const [f, n] of q.reward.rep) this.addRep(p, f, n);
        this.w.send(p, { t: 'sys', text: `Quest complete: ${q.name}. ${q.reward.exp} EXP, ${Math.round(q.reward.gold * this.w.goldRate)} gold.`, cue: 'questdone' });
        this.w.journals.onQuest(p);
        this.changed(p);
        sendInv(this.w, p);
        return '';
      }
      case 'talk': {
        // a conversation was opened: counts for quests that ask the player to speak to this townsperson
        if (typeof m.npc !== 'string' || !this.atGiver(p, m.npc)) return '';
        let hit = false;
        for (const [id, a] of Object.entries(s.active))
          QUESTS[id].objectives.forEach((o, i) => {
            if (o.kind === 'talk' && o.npc === m.npc && a.p[i] < o.n) { a.p[i]++; hit = true; }
          });
        if (hit) this.changed(p);
        return '';
      }
      case 'shop': {
        // faction quartermaster: the faction's lorekeeper sells its goods to those it trusts
        const f = typeof m.faction === 'string' ? this.faction(m.faction) : undefined;
        if (!f) return 'Unknown faction';
        const line = f.shop.find((x) => x[0] === m.base);
        if (!line) return 'Not sold by this faction';
        if (!objNear(p.room.zoneId, p.x, p.y, TALK_RANGE, ['lorekeeper']) || p.room.zoneId !== f.region) return `Visit ${f.name} at ${f.seat}`;
        const [base, price, need] = line, have = repLevel(p.rep[f.id] ?? 0);
        if (have < need) return `Requires ${REP_LEVELS[need].name} reputation with ${f.name}`;
        if (p.gold < price) return 'Not enough gold';
        if (!give(p, spec(base, 1))) return 'Inventory is full';
        p.gold -= price;
        p.invDirty = true;
        sendInv(this.w, p);
        return '';
      }
      default:
        return 'Unknown quest command';
    }
  }

  /** Reputation from quests. Reaching a new level is announced and rewarded once. */
  addRep(p: Player, faction: string, n: number) {
    const f = this.faction(faction);
    if (!f || n <= 0) return;
    const before = p.rep[f.id] ?? 0, after = Math.min(REP_MAX, before + n), l0 = repLevel(before), l1 = repLevel(after);
    p.rep[f.id] = after;
    p.progDirty = true;
    for (let l = l0 + 1; l <= l1; l++) {
      // faction announcement: everyone nearby hears it, the player gets the faction's gift
      this.w.announce(p.room, `${p.name} is now ${REP_LEVELS[l].name} with ${f.name}.`, 'rep');
      const gift = REP_GIFT[l];
      if (gift) award(this.w, p, 0, gift.map(([b, k]) => spec(b, k)));
    }
  }

  // ---------- events ----------
  /** A monster died and this player was rewarded for it. */
  onKill(p: Player, m: Monster) {
    let hit = false;
    for (const [id, a] of Object.entries(p.quests.active)) {
      const q = QUESTS[id];
      q.objectives.forEach((o, i) => {
        if (a.p[i] >= o.n) return;
        const ok = (o.kind === 'kill' && (!o.mob || o.mob === m.def.id) && (!o.zone || o.zone === p.room.zoneId) && !m.summoner) || (o.kind === 'boss' && o.mob === m.def.id)
          || (o.kind === 'loot' && o.mob === m.def.id && !m.summoner && this.w.rnd() < o.chance);
        if (ok) {
          a.p[i]++;
          hit = true;
        }
      });
    }
    if (hit) this.changed(p);
  }
  /** Visit objectives: checked about once a second for players who have one. */
  onMove(p: Player) {
    let hit = false;
    for (const [id, a] of Object.entries(p.quests.active))
      QUESTS[id].objectives.forEach((o, i) => {
        if (o.kind === 'visit' && a.p[i] < o.n && o.zone === p.room.zoneId && Math.hypot(p.x - o.x, p.y - o.y) <= o.r) {
          a.p[i] = o.n;
          hit = true;
          this.w.send(p, { t: 'sys', text: `Objective complete: ${o.label}.`, cue: 'quest' });
        }
      });
    if (hit) this.changed(p);
  }
  /** A dungeon run this player was inside was cleared. */
  onClear(p: Player, dungeon: string) {
    let hit = false;
    for (const [id, a] of Object.entries(p.quests.active))
      QUESTS[id].objectives.forEach((o, i) => {
        if (o.kind === 'clear' && o.dungeon === dungeon && a.p[i] < o.n) {
          a.p[i]++;
          hit = true;
        }
      });
    if (hit) this.changed(p);
  }
  /** The bag or discoveries changed: collect and explore objectives are read live, so the tracker is refreshed. */
  refresh(p: Player) {
    if (Object.values(p.quests.active).length && QUESTS && Object.keys(p.quests.active).some((id) => QUESTS[id].objectives.some((o) => o.kind === 'collect' || o.kind === 'discover'))) this.send(p);
  }
}
export type { QuestState };
