// Audits where monsters stand in every open-world zone: is each one on ground that connects to
// the rest of the zone, clear of obstacles, with room to move? Run before and after a change to
// the spawn rules to see its effect.   npx tsx scripts/spawn-audit.ts [seeds=20]
import { navOf, spawnFault } from '../shared/src/nav';
import { REGIONS } from '../shared/src/world';
import { World } from '../server/src/game/World';

const SEEDS = Number(process.argv[2] ?? 20);
const repo: any = new Proxy({}, { get: () => async () => {} });
const total: Record<string, number> = {};
let all = 0;
console.log('zone        reachable tiles   monsters   unreachable   cramped   inside-obstacle');
for (const zone of REGIONS) {
  const nav = navOf(zone), count: Record<string, number> = {};
  let n = 0;
  for (let s = 1; s <= SEEDS; s++) {
    let seed = s * 7919;
    const world = new World(repo, { roomCapacity: 10, reconnectGraceMs: 0, autosaveMs: 1e9, rng: () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647) });
    for (const m of world.roomIn(zone).monsters.values()) {
      if (m.def.boss) continue;
      n++;
      const f = spawnFault(nav, m.x, m.y, m.def.flying);
      if (f) count[f] = (count[f] ?? 0) + 1;
    }
  }
  all += n;
  for (const k in count) total[k] = (total[k] ?? 0) + count[k];
  const pct = (k: string) => `${count[k] ?? 0} (${(((count[k] ?? 0) / n) * 100).toFixed(1)}%)`.padStart(13);
  console.log(`${zone.padEnd(11)} ${String(nav.size).padStart(15)} ${String(n).padStart(10)} ${pct('unreachable')} ${pct('cramped').padStart(9)} ${pct('inside-obstacle')}`);
}
const bad = Object.values(total).reduce((a, b) => a + b, 0);
console.log(`${all} monsters placed over ${SEEDS} seeds per zone: ${bad} in a bad position (${((bad / all) * 100).toFixed(1)}%)  ${JSON.stringify(total)}`);
process.exit(bad ? 1 : 0);
