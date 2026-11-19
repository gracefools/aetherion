// G7: seasonal ladders on the server. Scores are written as things happen; an hourly check pays
// the season that just ended (each ladder exactly once, by mail).
import { LADDER_TOP, LADDERS, seasonBefore, seasonEndsAt, seasonOf, ladderReward, type LadderId } from '../../../shared/src/seasons';
import type { Repo } from '../db/repo';
import type { Player, World } from './World';

export class Seasons {
  private lastCheck = 0;
  constructor(private w: World, private repo: Repo) {}

  /** A score for this season's ladder (sums, or the best result for "max" ladders). */
  add(p: Player, ladder: LadderId, n: number) {
    const def = LADDERS.find((l) => l.id === ladder);
    if (!def || !(n > 0)) return;
    this.repo.seasonScore(seasonOf(Date.now()), ladder, { id: p.id, name: p.name, job: p.job }, Math.round(n), def.mode).catch((e) => console.error('season score failed', e));
  }
  /** The top of a ladder and where this player stands. */
  async view(p: Player, ladder: unknown) {
    const def = LADDERS.find((l) => l.id === ladder) ?? LADDERS[0], season = seasonOf(Date.now());
    const [rows, me] = await Promise.all([this.repo.seasonTop(season, def.id, LADDER_TOP), this.repo.seasonMine(season, def.id, p.id)]);
    this.w.send(p, { t: 'season', season, ladder: def.id, ends: seasonEndsAt(Date.now()), rows, me });
  }
  op(p: Player, m: any): string {
    if (m?.op === 'view') return void this.view(p, m.ladder).catch((e) => console.error('season view failed', e)), '';
    return 'Unknown command';
  }
  /** About once an hour: the season before this one is paid if it has not been. */
  async tick(now: number) {
    if (now - this.lastCheck < 3600_000) return;
    this.lastCheck = now;
    const past = seasonBefore(seasonOf(now));
    for (const l of LADDERS) {
      const top = await this.repo.seasonTop(past, l.id, 10);
      if (!Array.isArray(top) || !top.length || !(await this.repo.seasonClaim(past, l.id))) continue;
      for (const [i, row] of top.entries()) {
        const r = ladderReward(i + 1);
        if (!r) continue;
        await this.repo.systemMail(row.id, `Season ${past}: ${l.name}, rank ${i + 1}`, `You finished season ${past} at rank ${i + 1} on the ${l.name} ladder (${l.score}: ${row.score}).`,
          r.items.map(([base, qty]) => ({ base, rar: 0, ilvl: 1, aff: [], up: 0, qty })), r.gold);
        const o = this.w.online.get(row.id);
        if (o) void this.w.mail.notify(o);
      }
      this.w.announceAll(`Season ${past} is over: ${top[0].name} leads the ${l.name} ladder.`, 'rep');
    }
  }
}
