// In-process benchmark of the simulation + replication step, without sockets or a database:
// N players packed around the Eldoria plaza, all moving, all in each other's view.
// Usage: tsx scripts/bench.ts [players=250] [ticks=600] [spreadPx=500]
import { performance } from 'node:perf_hooks';
import { defaultAppearance } from '../shared/src/appearance';
import { JOBS } from '../shared/src/protocol';
import { tileCenter, ZONES } from '../shared/src/world';
import { World } from '../server/src/game/World';

const N = Number(process.argv[2] ?? 250), TICKS = Number(process.argv[3] ?? 600), SPREAD = Number(process.argv[4] ?? 500);
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
const repo: any = new Proxy({}, { get: () => async () => {} });
const world = new World(repo, { roomCapacity: N + 10, reconnectGraceMs: 0, autosaveMs: 1e9, rng: rnd });
const sp = ZONES.eldoria.spawn;
let bytes = 0, msgs = 0;
const conn = { send: (d: string) => { bytes += d.length; msgs++; }, close() {} };
const players = Array.from({ length: N }, (_, i) => world.join({
  id: i + 1, account_id: i + 1, name: 'B' + i, job: JOBS[i % 6], level: 5, exp: 0, appearance: defaultAppearance(JOBS[i % 6]), zone_id: 'eldoria',
  pos_x: tileCenter(sp.tx) + (rnd() - 0.5) * SPREAD, pos_y: tileCenter(sp.ty) + (rnd() - 0.5) * SPREAD, equipment: { kit: true },
} as any, conn));
const dirs = players.map(() => [0, 0]);
const times: number[] = [];
for (let t = 0; t < TICKS + 40; t++) {
  players.forEach((p, i) => {
    if (t % 20 === i % 20) dirs[i] = [Math.floor(rnd() * 3) - 1, Math.floor(rnd() * 3) - 1];
    if (dirs[i][0] || dirs[i][1]) world.input(p, p.lastSeq + 1 + (p.inQ.length >> 2), dirs[i][0], dirs[i][1], 1);
    if ((t + i) % 20 === 0) world.action(p, 0);
  });
  if (t === 40) { bytes = 0; msgs = 0; }
  const t0 = performance.now();
  (world as any).step();
  if (t >= 40) times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const q = (f: number) => times[Math.min(times.length - 1, Math.floor(times.length * f))];
console.log(JSON.stringify({
  players: N, ticks: TICKS, spreadPx: SPREAD, monsters: world.metrics().monsters,
  stepMs: { avg: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p50: +q(0.5).toFixed(3), p99: +q(0.99).toFixed(3), max: +times.at(-1)!.toFixed(3) },
  bytesPerPlayerPerSec: Math.round(bytes / N / (TICKS / 20)), msgsPerPlayerPerSec: +(msgs / N / (TICKS / 20)).toFixed(1),
}));
