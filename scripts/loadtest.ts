// Load generator: N bots random-walking at the real input rate (20/s each) against a running server.
// Usage: tsx scripts/loadtest.ts [clients=20] [seconds=60] [base=http://127.0.0.1:8080] [spread=0]
// spread=0 keeps every bot at the Eldoria spawn (worst case: everyone inside everyone's AOI).
// Server must run with AUTH_RATE_LIMIT and MAX_CONNECTIONS_PER_IP raised (e.g. 100000) so the bots, which all share one address, are not throttled.
// If the server has a METRICS_TOKEN, pass the same value in the environment.
import { Bot, http, sleep } from './bot';

const N = Number(process.argv[2] ?? 20);
const SECS = Number(process.argv[3] ?? 60);
const base = process.argv[4] ?? 'http://127.0.0.1:8080';
const run = Date.now().toString(36).slice(-5);

const bots: Bot[] = [];
for (let i = 0; i < N; i += 10) {
  bots.push(...(await Promise.all(Array.from({ length: Math.min(10, N - i) }, (_, k) => Bot.create(base, `lt${run}_${i + k}`, `Lt${run}x${i + k}`)))));
}
await Promise.all(bots.map((b) => b.connect()));
for (const b of bots) {
  b.raw({ t: 'learn', id: 'shield_bash' });
  b.raw({ t: 'rune', slot: 0, el: 'fire' });
}
// parties of five: each leader invites four members (one invite per 1.6s, the server's rate limit)
for (let k = 1; k < 5; k++) {
  for (let i = 0; i + k < N; i += 5) bots[i].raw({ t: 'party', op: 'invite', id: bots[i + k].characterId });
  await sleep(400);
  for (let i = 0; i + k < N; i += 5) bots[i + k].raw({ t: 'party', op: 'accept' });
  await sleep(1300);
}
console.log(`${N} bots connected, ${bots.filter((b) => b.party).length} in parties`);

let sent = 0;
const dirs = bots.map(() => [0, 0]);
const until = bots.map(() => 0);
let beat = 0;
const timer = setInterval(() => {
  const now = Date.now();
  beat++;
  for (let i = 0; i < bots.length; i++) {
    if (now >= until[i]) {
      const r = Math.random();
      dirs[i] = r < 0.15 ? [0, 0] : [Math.floor(Math.random() * 3) - 1, Math.floor(Math.random() * 3) - 1];
      until[i] = now + 400 + Math.random() * 1600;
    }
    if ((beat + i) % 20 === 0) bots[i].raw({ t: 'act', k: 0 }); // attack whatever is in reach once a second
    if ((beat + i) % 50 === 0) bots[i].raw({ t: 'use', a: 'shield_bash' }); // a skill and a rune spell every 2.5s
    if ((beat + i) % 50 === 25) bots[i].raw({ t: 'use', a: 'fireball' });
    if ((beat + i) % 200 === 100) bots[i].raw({ t: 'chat', text: 'regroup at the plaza', ch: 'party' });
    if (dirs[i][0] || dirs[i][1]) {
      bots[i].input(dirs[i][0], dirs[i][1]);
      sent++;
    }
  }
}, 50);

await sleep(5000); // warm-up
const m0 = (await http(base, '/api/metrics', undefined, process.env.METRICS_TOKEN)).body;
const snaps0 = bots.reduce((a, b) => a + b.snaps, 0);
const bytes0 = bots.reduce((a, b) => a + b.bytesIn, 0);
const cpu0 = process.cpuUsage();
await sleep(SECS * 1000);
const m1 = (await http(base, '/api/metrics', undefined, process.env.METRICS_TOKEN)).body;
clearInterval(timer);
const snaps = bots.reduce((a, b) => a + b.snaps, 0) - snaps0;
const bytes = bots.reduce((a, b) => a + b.bytesIn, 0) - bytes0;
const avgRemotes = bots.reduce((a, b) => a + b.remotes.size, 0) / N;
const dropped = bots.filter((b) => b.closed).length;
const ticks = m1.tick - m0.tick;

console.log(JSON.stringify({
  clients: N, seconds: SECS, dropped,
  serverTickRateHz: +(ticks / SECS).toFixed(2),
  // tick-duration ring buffer covers the last 60 s of the run
  serverTickMs: m1.tickMs, lateTicks: m1.lateTicks - m0.lateTicks,
  avgVisiblePlayersPerClient: +avgRemotes.toFixed(1),
  snapshotsPerClientPerSec: +(snaps / N / SECS).toFixed(1),
  kBpsDownPerClient: +((bytes * 8) / 1000 / N / SECS).toFixed(1),
  monsters: m1.monsters, parties: m1.parties, damageEventsSeen: bots.reduce((a, b) => a + b.dmg.length, 0), botsThatGainedExp: bots.filter((b) => b.xp > 0).length,
  abilityCasts: bots.reduce((a, b) => a + b.events.filter((e) => e[0] === b.characterId && e[1] === 4).length, 0),
  inputsSentPerSec: Math.round(sent / (SECS + 5)),
  botProcessCpuPct: Math.round(((process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1e4) / SECS),
}, null, 1));
for (const b of bots) b.close();
await sleep(200);
process.exit(0);
